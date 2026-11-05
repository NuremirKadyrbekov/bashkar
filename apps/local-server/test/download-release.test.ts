import {afterEach,expect,it} from 'vitest';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical} from '../src/command-bus';
import {downloadReleaseArtifact,downloadPublishedRelease} from '../src/recovery/download-release';
import {verifySignedRelease,type ReleaseManifest} from '../src/recovery/release-verifier';
import {CloudOwnerAuth} from '../src/modules/auth/cloud-owner-auth';
import type {SigningDeviceIdentity} from '../src/modules/activation/platform-device';
import type {AuthService} from '../src/modules/auth/auth-service';

const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'bashkar-download-'));roots.push(root);const directory=join(root,'updates');mkdirSync(directory,{mode:0o700});const content=Buffer.from('verified Windows installer bytes');const hash=createHash('sha256').update(content).digest('hex');const name='Bashkar-POS-Setup-0.2.0.exe';const m:ReleaseManifest={format:1,releaseId:'rel_020',version:'0.2.0',gitCommit:'a'.repeat(40),keyId:'test',platform:{os:'win32',arch:'x64'},compatibility:{minSourceVersion:'0.1.0',maxSourceVersion:'0.1.0',minAgentVersion:'0.1.0',minSchema:26,maxSchema:26,targetSchema:26,migrationVersions:[]},artifact:{fileName:name,sizeBytes:content.length,sha256:hash},minFreeBytes:0};const pair=generateKeyPairSync('ed25519'),signedRelease={manifest:m,signature:sign(null,Buffer.from(canonical(m)),pair.privateKey).toString('base64url')},releaseTrust={keyId:'test',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString()},installed={appVersion:'0.1.0',agentVersion:'0.1.0',schemaVersion:26,os:'win32',arch:'x64',freeBytes:1};const release=verifySignedRelease(signedRelease,releaseTrust,installed);const url=`https://release.example.invalid/updates/rel_020/11111111-1111-4111-8111-111111111111/${name}?token=short-lived`;return {root,directory,content,hash,name,release,url,signedRelease,releaseTrust,installed,base:{release,directory,trustedOrigin:'https://release.example.invalid/',getUrl:async()=>url}};}
it('downloads into a partial file, resumes with exact Range, then verifies and publishes without overwriting',async()=>{
 const f=fixture();let calls=0;const first=f.content.subarray(0,8),remaining=f.content.subarray(8);
 const network=async(_url:URL|string|Request,init?:RequestInit)=>{calls++;if(calls===1){expect(init?.headers).toMatchObject({'accept-encoding':'identity'});return new Response(first,{status:200});}expect(init?.headers).toMatchObject({range:'bytes=8-'});return new Response(remaining,{status:206,headers:{'content-range':`bytes 8-${f.content.length-1}/${f.content.length}`,'content-length':String(remaining.length)}});};
 await expect(downloadReleaseArtifact({...f.base,network:network as typeof fetch})).rejects.toThrow('UPDATE_DOWNLOAD_INCOMPLETE');
 expect(readdirSync(f.directory)).toEqual([`.download-${f.hash}.part`]);
 const path=await downloadReleaseArtifact({...f.base,network:network as typeof fetch});expect(path).toBe(join(realpathSync(f.directory),f.name));expect(readFileSync(path)).toEqual(f.content);expect(readdirSync(f.directory)).toEqual([f.name]);
 expect(await downloadReleaseArtifact({...f.base,network:async()=>{throw Error('NETWORK_CALLED');}})).toBe(path);expect(calls).toBe(2);
});
it('rejects wrong origin, malformed range and hash mismatch without publishing an EXE',async()=>{
 const f=fixture();let contacted=false;
 await expect(downloadReleaseArtifact({...f.base,getUrl:async()=>f.url.replace('release.example.invalid','attacker.invalid'),network:async()=>{contacted=true;throw Error('UNEXPECTED');}})).rejects.toThrow('UPDATE_DOWNLOAD_URL_INVALID');expect(contacted).toBe(false);
 const partial=join(f.directory,`.download-${f.hash}.part`);writeFileSync(partial,f.content.subarray(0,4));
 await expect(downloadReleaseArtifact({...f.base,network:async()=>new Response(f.content.subarray(4),{status:206,headers:{'content-range':`bytes 5-${f.content.length-1}/${f.content.length}`}})})).rejects.toThrow('UPDATE_DOWNLOAD_RANGE_INVALID');expect(existsSync(join(f.directory,f.name))).toBe(false);
 rmSync(partial);await expect(downloadReleaseArtifact({...f.base,network:async()=>new Response(Buffer.alloc(f.content.length,0),{status:200,headers:{'content-length':String(f.content.length)}})})).rejects.toThrow('UPDATE_DOWNLOAD_HASH_MISMATCH');expect(existsSync(join(f.directory,f.name))).toBe(false);expect(existsSync(partial)).toBe(false);
});
it('fails closed on an existing untrusted final EXE or a concurrent lock',async()=>{
 const f=fixture(),final=join(f.directory,f.name);writeFileSync(final,Buffer.alloc(f.content.length,0));
 await expect(downloadReleaseArtifact({...f.base,network:async()=>{throw Error('UNEXPECTED');}})).rejects.toThrow('UPDATE_ARTIFACT_HASH_MISMATCH');
 rmSync(final);writeFileSync(join(f.directory,`.download-${f.hash}.lock`),'held');
 await expect(downloadReleaseArtifact({...f.base,network:async()=>{throw Error('UNEXPECTED');}})).rejects.toThrow('UPDATE_DOWNLOAD_BUSY');
});
it('accepts a Cloud offer only when its signed manifest and file metadata match the downloaded bytes',async()=>{
 const f=fixture();let calls=0;
 const offer={releaseId:'rel_020',signedRelease:f.signedRelease,manifestSha256:f.release.manifestSha256,artifactSha256:f.hash,sizeBytes:f.content.length,downloadUrl:f.url,expiresAt:Date.now()+300000};
 const cloudOwner={requestUpdateDownload:async()=>{calls++;return offer;}} as unknown as CloudOwnerAuth;
 const input={cloudOwner,sessionId:'owner-session',device:{} as SigningDeviceIdentity,identity:{branchId:'b',instanceId:'i',registrationId:'r'},releaseId:'rel_020',releaseTrust:f.releaseTrust,installed:f.installed,directory:f.directory,trustedOrigin:'https://release.example.invalid/',network:(async()=>new Response(f.content,{status:200,headers:{'content-length':String(f.content.length)}})) as typeof fetch};
 const result=await downloadPublishedRelease(input);expect(readFileSync(result.artifactPath)).toEqual(f.content);expect(result.release.manifestSha256).toBe(f.release.manifestSha256);expect(calls).toBe(1);
 const second=fixture();const invalid={...offer,artifactSha256:'0'.repeat(64)};
 const bad={...input,directory:second.directory,cloudOwner:{requestUpdateDownload:async()=>invalid} as unknown as CloudOwnerAuth};
 await expect(downloadPublishedRelease(bad)).rejects.toThrow('UPDATE_CLOUD_RESPONSE_INVALID');expect(readdirSync(second.directory)).toEqual([]);
});
it('requests a release URL with a fresh device-signed native Cloud request',async()=>{
 const f=fixture(),pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'pem'}).toString(),now=Date.now(),sessionId='owner-session';
 const identity={branchId:'11111111-1111-4111-8111-111111111111',instanceId:'22222222-2222-4222-8222-222222222222',registrationId:'33333333-3333-4333-8333-333333333333'};
 const offer={releaseId:'rel_020',signedRelease:f.signedRelease,manifestSha256:f.release.manifestSha256,artifactSha256:f.hash,sizeBytes:f.content.length,downloadUrl:f.url,expiresAt:now+300000};
 const network=async(_url:URL|string|Request,init?:RequestInit)=>{expect(init?.headers).toMatchObject({authorization:'Bearer cloud-token'});expect(init?.headers).not.toHaveProperty('origin');const payload=JSON.parse(String(init?.body));const {deviceSignature,devicePublicKey,...proof}=payload;expect(proof).toMatchObject({format:1,action:'DOWNLOAD',releaseId:'rel_020',...identity,issuedAt:now});expect(devicePublicKey).toBe(publicKey);expect(deviceSignature).toBe(sign(null,Buffer.from(canonical(proof)),pair.privateKey).toString('base64url'));return new Response(JSON.stringify(offer),{status:200});};
 const cloud=new CloudOwnerAuth({} as AuthService,{url:'https://cloud.invalid',publishableKey:'test-public'} as any,network as typeof fetch,()=>now);
 (cloud as any).sessions.set(sessionId,{token:'cloud-token',validatedAt:now});(cloud as any).verifySession=async()=>{};
 const device={assertAvailable:()=>{},publicKey:()=>publicKey,sign:(value:string)=>sign(null,Buffer.from(value),pair.privateKey).toString('base64url')} as SigningDeviceIdentity;
 expect(await cloud.requestUpdateDownload(sessionId,device,identity,'rel_020')).toEqual(offer);
});
