import {createHash} from 'node:crypto';
import {constants,closeSync,fsyncSync,linkSync,lstatSync,openSync,realpathSync,readdirSync,unlinkSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import type {VerifiedRelease,InstalledContext,SignedRelease} from './release-verifier';
import {verifyReleaseArtifact,verifySignedRelease} from './release-verifier';
import type {CloudOwnerAuth} from '../modules/auth/cloud-owner-auth';
import type {SigningDeviceIdentity} from '../modules/activation/platform-device';

const hex=/^[0-9a-f]{64}$/;
const MAX_URL_LENGTH=4096;
function directory(path:string){const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('UPDATE_DOWNLOAD_DIRECTORY_INVALID');if(process.platform!=='win32'&&(stat.mode&0o077)!==0)throw Error('UPDATE_DOWNLOAD_DIRECTORY_UNSAFE');const root=realpathSync(path);if(process.platform==='win32'){if(!process.env.ProgramData||root.toLowerCase()!==resolve(process.env.ProgramData,'BashkarPOS','updates').toLowerCase())throw Error('UPDATE_DOWNLOAD_DIRECTORY_INVALID');}return root;}
function syncDirectory(path:string){if(process.platform==='win32')return;const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function eligibleUrl(raw:string,origin:string,release:VerifiedRelease){if(typeof raw!=='string'||raw.length>MAX_URL_LENGTH)throw Error('UPDATE_DOWNLOAD_URL_INVALID');let url:URL,allowed:URL;try{url=new URL(raw);allowed=new URL(origin);}catch{throw Error('UPDATE_DOWNLOAD_URL_INVALID');}const m=release.manifest;if(url.protocol!=='https:'||allowed.protocol!=='https:'||url.origin!==allowed.origin||allowed.pathname!=='/'||allowed.search||allowed.hash||url.username||url.password||url.hash||!/^\/[A-Za-z0-9_./-]+$/.test(url.pathname)||!url.pathname.startsWith(`/updates/${m.releaseId}/`)||basename(url.pathname)!==m.artifact.fileName)throw Error('UPDATE_DOWNLOAD_URL_INVALID');return url.href;}
function fileStat(path:string,expectedMax:number){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>expectedMax)throw Error('UPDATE_DOWNLOAD_PARTIAL_INVALID');return stat;}
function contentLength(response:Response,expected:number){const value=response.headers.get('content-length');if(value===null)return;if(!/^(0|[1-9]\d*)$/.test(value)||Number(value)!==expected)throw Error('UPDATE_DOWNLOAD_LENGTH_INVALID');}
function range(response:Response,start:number,total:number){const value=response.headers.get('content-range'),match=value&&/^bytes (\d+)-(\d+)\/(\d+)$/.exec(value);if(!match||Number(match[1])!==start||Number(match[3])!==total||Number(match[2])<start||Number(match[2])>=total)throw Error('UPDATE_DOWNLOAD_RANGE_INVALID');const length=Number(match[2])-start+1;contentLength(response,length);return length;}

/** A failed network transfer retains only the partial EXE; no release is authorized by this function. */
export async function downloadReleaseArtifact(input:{release:VerifiedRelease;directory:string;trustedOrigin:string;getUrl:()=>Promise<string>;network?:typeof fetch}){
 const m=input.release.manifest,dir=directory(input.directory),expected=m.artifact;
 if(!hex.test(expected.sha256))throw Error('UPDATE_DOWNLOAD_MANIFEST_INVALID');
 const final=join(dir,expected.fileName),partial=join(dir,`.download-${expected.sha256}.part`),lock=join(dir,`.download-${expected.sha256}.lock`);
 if(readdirSync(dir).some(name=>name.startsWith('.download-')&&name.endsWith('.lock')&&name!==basename(lock)))throw Error('UPDATE_DOWNLOAD_OTHER_LOCK');
 let lockFd:number;try{lockFd=openSync(lock,'wx',0o600);}catch{throw Error('UPDATE_DOWNLOAD_BUSY');}
 try{
  try{fileStat(final,expected.sizeBytes);await verifyReleaseArtifact(input.release,final);return final;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const handle=await open(partial,constants.O_RDWR|constants.O_CREAT|(constants.O_NOFOLLOW??0),0o600);
  let invalid=false;
  try{
   const before=fileStat(partial,expected.sizeBytes),stat=await handle.stat();if(stat.dev!==before.dev||stat.ino!==before.ino)throw Error('UPDATE_DOWNLOAD_PARTIAL_INVALID');
   let position=stat.size;
   if(position<expected.sizeBytes){
    const url=eligibleUrl(await input.getUrl(),input.trustedOrigin,input.release);
    let response:Response;try{response=await(input.network??fetch)(url,{method:'GET',headers:{'accept-encoding':'identity',...(position?{range:`bytes=${position}-`}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(120000)});}catch{throw Error('UPDATE_DOWNLOAD_UNAVAILABLE');}
    if(!response.ok||!response.body)throw Error('UPDATE_DOWNLOAD_UNAVAILABLE');
    if(response.headers.get('content-encoding')&&!['identity'].includes(response.headers.get('content-encoding')!))throw Error('UPDATE_DOWNLOAD_ENCODING_INVALID');
    let transferLength:number;
    if(response.status===206)transferLength=range(response,position,expected.sizeBytes);
    else if(response.status===200){if(position){await handle.truncate(0);position=0;}transferLength=expected.sizeBytes;contentLength(response,transferLength);}
    else throw Error('UPDATE_DOWNLOAD_STATUS_INVALID');
    const reader=response.body.getReader();let received=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||received+value.byteLength>transferLength||position+value.byteLength>expected.sizeBytes){invalid=true;throw Error('UPDATE_DOWNLOAD_SIZE_INVALID');}let offset=0;while(offset<value.byteLength){const result=await handle.write(value,offset,value.byteLength-offset,position+offset);if(result.bytesWritten<=0)throw Error('UPDATE_DOWNLOAD_WRITE_FAILED');offset+=result.bytesWritten;}position+=value.byteLength;received+=value.byteLength;}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    await handle.sync();if(received!==transferLength||position!==expected.sizeBytes)throw Error('UPDATE_DOWNLOAD_INCOMPLETE');
   }
   const after=await handle.stat();if(after.size!==expected.sizeBytes)throw Error('UPDATE_DOWNLOAD_INCOMPLETE');
   const digest=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false}))digest.update(chunk);
   if(digest.digest('hex')!==expected.sha256){invalid=true;throw Error('UPDATE_DOWNLOAD_HASH_MISMATCH');}
  }finally{await handle.close();if(invalid){try{unlinkSync(partial);}catch{}}}
  // Hard-link publication refuses an existing final file atomically.
  fileStat(partial,expected.sizeBytes);linkSync(partial,final);unlinkSync(partial);syncDirectory(dir);
  await verifyReleaseArtifact(input.release,final);
  return final;
 }finally{closeSync(lockFd);unlinkSync(lock);syncDirectory(dir);}
}

/** A fresh Cloud offer is fetched on retry; each offer must describe the same signed bytes. */
export async function downloadPublishedRelease(input:{cloudOwner:CloudOwnerAuth;sessionId:string;device:SigningDeviceIdentity;identity:{branchId:string;instanceId:string;registrationId:string};releaseId:string;releaseTrust:{keyId:string;publicKey:string};installed:InstalledContext;directory:string;trustedOrigin:string;network?:typeof fetch}){
 const fetchOffer=async()=>{
  const offer=await input.cloudOwner.requestUpdateDownload(input.sessionId,input.device,input.identity,input.releaseId);
  const verified=verifySignedRelease(offer.signedRelease,input.releaseTrust,input.installed);
  if(verified.manifest.releaseId!==input.releaseId||verified.manifestSha256!==offer.manifestSha256||verified.manifest.artifact.sha256!==offer.artifactSha256||verified.manifest.artifact.sizeBytes!==offer.sizeBytes)throw Error('UPDATE_CLOUD_RESPONSE_INVALID');
  return {offer,verified};
 };
 const first=await fetchOffer();let initial=true;
 const artifactPath=await downloadReleaseArtifact({release:first.verified,directory:input.directory,trustedOrigin:input.trustedOrigin,network:input.network,getUrl:async()=>{
  if(initial){initial=false;return first.offer.downloadUrl;}
  const next=await fetchOffer();if(next.verified.manifestSha256!==first.verified.manifestSha256)throw Error('UPDATE_RELEASE_CHANGED');return next.offer.downloadUrl;
 }});
 return {release:first.verified,signedRelease:first.offer.signedRelease as SignedRelease,artifactPath};
}
