import {createHash,createPublicKey,verify} from 'node:crypto';

class UploadError extends Error{constructor(code,status=400){super(code);this.status=status;}}
const requireValue=(value,code,status=400)=>{if(!value)throw new UploadError(code,status);};
const hex=/^[0-9a-f]{64}$/,id=/^[a-z0-9_-]{1,80}$/;
const versionParts=value=>typeof value==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)&&value.split('.').map(Number).every(Number.isSafeInteger)?value.split('.').map(Number):null;
const compareVersions=(a,b)=>{const left=versionParts(a),right=versionParts(b);if(!left||!right)return null;for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]<right[i]?-1:1;return 0;};
const exact=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===names.sort().join(',');
function canonical(value){if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isSafeInteger(value))return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';throw new UploadError('UPDATE_MANIFEST_INVALID');}
function signedRelease(input,keyId,keyPem){
 requireValue(exact(input,['manifest','signature']),'UPDATE_MANIFEST_INVALID');
 const m=input.manifest;
 requireValue(exact(m,['format','releaseId','version','gitCommit','keyId','platform','compatibility','artifact','minFreeBytes'])&&m.format===1&&id.test(m.releaseId)&&versionParts(m.version)&&/^[0-9a-f]{40}$/.test(m.gitCommit)&&m.keyId===keyId&&Number.isSafeInteger(m.minFreeBytes)&&m.minFreeBytes>=0,'UPDATE_MANIFEST_INVALID');
 requireValue(exact(m.platform,['os','arch'])&&m.platform.os==='win32'&&m.platform.arch==='x64'&&exact(m.artifact,['fileName','sizeBytes','sha256'])&&/^Bashkar(?:-POS|POS)-Setup-[A-Za-z0-9._-]+\.exe$/.test(m.artifact.fileName)&&!m.artifact.fileName.includes('..')&&(m.artifact.fileName.endsWith(`-${m.version}.exe`)||m.artifact.fileName.endsWith(`-${m.version}-win-x64.exe`))&&Number.isSafeInteger(m.artifact.sizeBytes)&&m.artifact.sizeBytes>0&&hex.test(m.artifact.sha256),'UPDATE_MANIFEST_INVALID');
 const c=m.compatibility;
 requireValue(exact(c,['minSourceVersion','maxSourceVersion','minAgentVersion','minSchema','maxSchema','targetSchema','migrationVersions'])&&[c.minSourceVersion,c.maxSourceVersion,c.minAgentVersion].every(v=>versionParts(v))&&compareVersions(c.minSourceVersion,c.maxSourceVersion)<=0&&[c.minSchema,c.maxSchema,c.targetSchema].every(v=>Number.isSafeInteger(v)&&v>0)&&c.minSchema<=c.maxSchema&&c.targetSchema>=c.minSchema&&c.targetSchema-c.minSchema<=256&&Array.isArray(c.migrationVersions)&&c.migrationVersions.length===c.targetSchema-c.minSchema&&c.migrationVersions.every((v,i)=>v===c.minSchema+i+1),'UPDATE_MANIFEST_INVALID');
 requireValue(typeof input.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(input.signature),'UPDATE_SIGNATURE_INVALID');
 let key;try{key=createPublicKey(keyPem);}catch{throw new UploadError('UPDATE_CONFIGURATION_UNAVAILABLE',503);}
 requireValue(key.asymmetricKeyType==='ed25519'&&verify(null,Buffer.from(canonical(m)),key,Buffer.from(input.signature,'base64url')),'UPDATE_SIGNATURE_INVALID');
 return {manifest:m,manifestSha256:createHash('sha256').update(canonical(m)).digest('hex')};
}
function matchDraft(v,draft,releaseId){const m=v.manifest;requireValue(m.releaseId===releaseId&&m.version===draft.version&&m.gitCommit===draft.sourceCommit&&v.manifestSha256===draft.manifestSha256&&m.artifact.sha256===draft.artifactSha256,'UPDATE_DRAFT_MISMATCH',409);}
function storageUrl(endpoint,zone,path){let url;try{url=new URL(endpoint);}catch{throw new UploadError('UPDATE_CONFIGURATION_UNAVAILABLE',503);}requireValue(url.protocol==='https:'&&/^(?:[a-z0-9-]+\.)?storage\.bunnycdn\.com$/.test(url.hostname)&&url.pathname==='/'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&zone&&/^[a-z0-9-]{1,80}$/.test(zone),'UPDATE_CONFIGURATION_UNAVAILABLE',503);return `${url.origin}/${zone}/${path}`;}
async function boundedJson(request){const text=await request.text();requireValue(text.length<=16384,'PAYLOAD_TOO_LARGE',413);try{return JSON.parse(text);}catch{throw new UploadError('INVALID_REQUEST');}}
export function makeUpdateReleaseUploadHandler({env,network=fetch}){
 return async request=>{
  const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin'};
  const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers});
  let pathToClean=null,storageKey=null,committed=false;
  try{
   const origin=request.headers.get('origin'),allowed=(env('BASHKAR_ADMIN_ORIGINS')??'').split(',').map(v=>v.trim()).filter(Boolean);
   requireValue(!origin||allowed.includes(origin),'ORIGIN_DENIED',403);if(origin)headers['access-control-allow-origin']=origin;
   if(request.method==='OPTIONS'){headers['access-control-allow-methods']='POST';headers['access-control-allow-headers']='authorization,apikey,content-type,x-release-id,x-signed-release';return new Response(null,{status:204,headers});}
   requireValue(request.method==='POST','METHOD_NOT_ALLOWED',405);
   const authorization=request.headers.get('authorization');requireValue(authorization&&/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(authorization),'CLOUD_LOGIN_REQUIRED',401);
   const base=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY');requireValue(base&&service,'CLOUD_CONFIGURATION_UNAVAILABLE',503);
   const rpc=async(name,body)=>{let response;try{response=await network(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:service,authorization:'Bearer '+service,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{throw new UploadError('CLOUD_ADMIN_UNAVAILABLE',503);}const result=await response.json().catch(()=>null);if(!response.ok){const code=result?.message;if(['PLATFORM_ADMIN_REQUIRED','RELEASE_PUBLISHER_REQUIRED'].includes(code))throw new UploadError(code,403);if(['UPDATE_RELEASE_NOT_FOUND','UPDATE_RELEASE_STATE_INVALID','UPDATE_UPLOAD_INVALID'].includes(code))throw new UploadError(code,code==='UPDATE_RELEASE_NOT_FOUND'?404:409);throw new UploadError('CLOUD_ADMIN_UNAVAILABLE',503);}return result;};
   let response;try{response=await network(base+'/auth/v1/user',{headers:{apikey:service,authorization},signal:AbortSignal.timeout(10000)});}catch{throw new UploadError('CLOUD_AUTH_UNAVAILABLE',503);}
   requireValue(response.ok,'CLOUD_LOGIN_REQUIRED',401);const user=await response.json();requireValue(user.id&&user.email_confirmed_at&&!user.is_anonymous,'CONFIRMED_ADMIN_REQUIRED',403);
   await rpc('platform_release_assert',{p_actor:user.id});
   const releaseId=request.headers.get('x-release-id');requireValue(releaseId&&id.test(releaseId),'UPDATE_RELEASE_ID_INVALID');
   const zone=env('BASHKAR_UPDATE_STORAGE_ZONE'),endpoint=env('BASHKAR_UPDATE_STORAGE_ENDPOINT');storageKey=env('BASHKAR_UPDATE_STORAGE_KEY');
   const keyId=env('BASHKAR_RELEASE_KEY_ID'),publicKey=env('BASHKAR_RELEASE_PUBLIC_KEY_PEM');requireValue(zone&&endpoint&&storageKey&&keyId&&publicKey,'UPDATE_CONFIGURATION_UNAVAILABLE',503);
   if(request.headers.get('content-type')==='application/octet-stream'){
    const header=request.headers.get('x-signed-release');requireValue(header&&header.length<=8192&&/^[A-Za-z0-9_-]+$/.test(header),'UPDATE_MANIFEST_INVALID');
    let envelope;try{envelope=JSON.parse(Buffer.from(header,'base64url').toString('utf8'));}catch{throw new UploadError('UPDATE_MANIFEST_INVALID');}
    const verified=signedRelease(envelope,keyId,publicKey),draft=await rpc('update_admin_upload_preflight',{p_actor:user.id,p_release:releaseId});matchDraft(verified,draft,releaseId);
    requireValue(request.body,'UPDATE_UPLOAD_EMPTY');
    const objectPath=`updates/${releaseId}/${crypto.randomUUID()}/${verified.manifest.artifact.fileName}`;
    pathToClean=storageUrl(endpoint,zone,objectPath);
    const hash=createHash('sha256');let size=0;
    const body=request.body.pipeThrough(new TransformStream({transform(chunk,controller){size+=chunk.byteLength;if(size>verified.manifest.artifact.sizeBytes)throw new UploadError('UPDATE_ARTIFACT_SIZE_MISMATCH',400);hash.update(chunk);controller.enqueue(chunk);}}));
    let put;try{put=await network(pathToClean,{method:'PUT',headers:{AccessKey:storageKey,'content-type':'application/octet-stream'},body,duplex:'half',signal:AbortSignal.timeout(125000)});}catch{throw new UploadError('UPDATE_STORAGE_UNAVAILABLE',503);}
    requireValue(put.ok,'UPDATE_STORAGE_UNAVAILABLE',503);
    requireValue(size===verified.manifest.artifact.sizeBytes&&hash.digest('hex')===verified.manifest.artifact.sha256,'UPDATE_ARTIFACT_HASH_MISMATCH');
    await verifyStored(pathToClean,storageKey,verified.manifest.artifact,network);
    // The DB may commit even if its HTTP response is lost. Keep the verified
    // object once finalization starts so a VALIDATED row never points at a deleted file.
    committed=true;
    const result=await rpc('update_admin_validate_release',{p_actor:user.id,p_release:releaseId,p_manifest:envelope,p_path:objectPath,p_size:size});
    return reply(200,result);
   }
   requireValue(request.headers.get('content-type')?.split(';')[0]==='application/json','JSON_REQUIRED',415);
   const body=await boundedJson(request);requireValue(exact(body,['action'])&&body.action==='publish','INVALID_REQUEST');
   const file=await rpc('update_admin_release_file',{p_actor:user.id,p_release:releaseId});
   const verified=signedRelease(file.signedManifest,keyId,publicKey);matchDraft(verified,file,releaseId);
   requireValue(file.sizeBytes===verified.manifest.artifact.sizeBytes&&file.storagePath?.startsWith(`updates/${releaseId}/`)&&file.storagePath.endsWith('/'+verified.manifest.artifact.fileName),'UPDATE_RELEASE_FILE_INVALID',409);
   await verifyStored(storageUrl(endpoint,zone,file.storagePath),storageKey,verified.manifest.artifact,network);
   return reply(200,await rpc('update_admin_publish_release',{p_actor:user.id,p_release:releaseId,p_path:file.storagePath,p_manifest_hash:verified.manifestSha256,p_artifact_hash:verified.manifest.artifact.sha256,p_size:file.sizeBytes}));
  }catch(error){if(pathToClean&&!committed&&storageKey){try{await network(pathToClean,{method:'DELETE',headers:{AccessKey:storageKey},signal:AbortSignal.timeout(10000)});}catch{}}
   return reply(error instanceof UploadError?error.status:503,{code:error instanceof UploadError?error.message:'UPDATE_UPLOAD_UNAVAILABLE'});}
 };
}
async function verifyStored(url,key,artifact,network){let result;try{result=await network(url,{method:'GET',headers:{AccessKey:key},signal:AbortSignal.timeout(125000)});}catch{throw new UploadError('UPDATE_STORAGE_UNAVAILABLE',503);}requireValue(result.ok&&result.body,'UPDATE_STORAGE_UNAVAILABLE',503);const hash=createHash('sha256');let size=0;for await(const chunk of result.body){size+=chunk.byteLength;if(size>artifact.sizeBytes){await result.body.cancel().catch(()=>{});throw new UploadError('UPDATE_STORED_HASH_MISMATCH');}hash.update(chunk);}requireValue(size===artifact.sizeBytes&&hash.digest('hex')===artifact.sha256,'UPDATE_STORED_HASH_MISMATCH');}
