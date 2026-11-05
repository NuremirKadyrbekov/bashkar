import {expect,it} from 'vitest';
import {createHash,createHmac,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {canonical} from '../src/command-bus';

const modulePath=pathToFileURL(resolve('supabase/functions/_shared/update-release-download.mjs')).href;
const device=generateKeyPairSync('ed25519'),devicePublicKey=device.publicKey.export({type:'spki',format:'pem'}).toString(),owner=randomUUID(),branch=randomUUID(),instance=randomUUID(),registration=randomUUID(),nonce=randomUUID(),releaseId='rel_020',now=1793850000000;
const path=`updates/${releaseId}/${randomUUID()}/Bashkar-POS-Setup-0.2.0.exe`,tokenKey='test-token-key-with-more-than-32-chars';
const body={format:1,action:'DOWNLOAD',releaseId,branchId:branch,instanceId:instance,registrationId:registration,nonce,issuedAt:now};
const signed=(data=body)=>({...data,devicePublicKey,deviceSignature:sign(null,Buffer.from(canonical(data)),device.privateKey).toString('base64url')});
const request=(data:unknown,origin?:string)=>new Request('https://cloud.invalid/functions/v1/update-release-download',{method:'POST',headers:{authorization:'Bearer '+('x'.repeat(40)),'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(data)});
it('issues only a short-lived path-scoped Bunny token after Owner and device checks',async()=>{
 const {makeUpdateReleaseDownloadHandler}=await import(modulePath);let calls=0;
 const row={releaseId,signedRelease:{manifest:{releaseId},signature:'test'},storagePath:path,manifestSha256:'a'.repeat(64),artifactSha256:'b'.repeat(64),sizeBytes:100};
 const handler=makeUpdateReleaseDownloadHandler({now:()=>now,tokenKey,pullZoneOrigin:'https://releases.b-cdn.net/',authUser:async()=>({id:owner,email_confirmed_at:'now'}),rpc:async(_name:string,args:any)=>{calls++;expect(args).toMatchObject({p_owner:owner,p_branch:branch,p_instance:instance,p_registration:registration,p_device_hash:createHash('sha256').update(devicePublicKey).digest('hex'),p_release:releaseId});return row;}});
 expect((await handler(request({...signed(),deviceSignature:'x'.repeat(86)}))).status).toBe(403);expect(calls).toBe(0);
 expect((await handler(request(signed(),'https://hostile.invalid'))).status).toBe(403);expect(calls).toBe(0);
 const response=await handler(request(signed()));expect(response.status).toBe(200);const result=await response.json();expect(result.signedRelease).toEqual(row.signedRelease);expect(result.expiresAt).toBe(now+300000);
 const url=new URL(result.downloadUrl),expires=String(Math.floor(now/1000)+300),expected=createHmac('sha256',tokenKey).update('/'+path+expires).digest('base64url');
 expect(url.origin).toBe('https://releases.b-cdn.net');expect(url.searchParams.get('token')).toBe('HS256-'+expected);expect(url.searchParams.get('expires')).toBe(expires);expect(calls).toBe(1);
 const denied=makeUpdateReleaseDownloadHandler({now:()=>now,tokenKey,pullZoneOrigin:'https://releases.b-cdn.net/',authUser:async()=>({id:owner,email_confirmed_at:'now'}),rpc:async()=>{throw Error('UPDATE_RELEASE_DENIED');}});
 expect((await denied(request(signed()))).status).toBe(403);
});
