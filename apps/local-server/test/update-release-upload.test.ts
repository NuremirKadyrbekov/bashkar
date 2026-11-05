import {expect,it} from 'vitest';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {canonical} from '../src/command-bus';

const modulePath=pathToFileURL(resolve('supabase/functions/_shared/update-release-upload.mjs')).href;
const hash=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');
const releaseId='rel_upload_01',actor=randomUUID(),keyId='test_release_key';
const signer=generateKeyPairSync('ed25519');
const bytes=Buffer.from('EXE');
const manifest={format:1,releaseId,version:'0.2.0',gitCommit:'a'.repeat(40),keyId,platform:{os:'win32',arch:'x64'},compatibility:{minSourceVersion:'0.1.0',maxSourceVersion:'0.1.0',minAgentVersion:'0.1.0',minSchema:26,maxSchema:26,targetSchema:26,migrationVersions:[]},artifact:{fileName:'Bashkar-POS-Setup-0.2.0.exe',sizeBytes:bytes.length,sha256:hash(bytes)},minFreeBytes:0};
const envelope={manifest,signature:sign(null,Buffer.from(canonical(manifest)),signer.privateKey).toString('base64url')};
const draft={releaseId,version:manifest.version,sourceCommit:manifest.gitCommit,manifestSha256:hash(canonical(manifest)),artifactSha256:manifest.artifact.sha256};
function fixture(){
 let status='DRAFT',storedPath='',reads=0,deleted=0,validated=0,published=0,loseValidation=false;const objects=new Map<string,Uint8Array>();
 const json=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
 const network=async(input:string,options:any={})=>{
  const url=String(input);
  if(url.endsWith('/auth/v1/user'))return json(200,{id:actor,email_confirmed_at:'now'});
  if(url.includes('/rpc/')){
   const name=url.split('/rpc/')[1],body=JSON.parse(options.body);
   if(name==='platform_release_assert')return json(200,null);
   if(name==='update_admin_upload_preflight')return status==='DRAFT'?json(200,draft):json(400,{message:'UPDATE_RELEASE_STATE_INVALID'});
   if(name==='update_admin_validate_release'){status='VALIDATED';validated++;storedPath=body.p_path;if(loseValidation)throw Error('lost-db-response');return json(200,{releaseId,status});}
   if(name==='update_admin_release_file')return status==='VALIDATED'?json(200,{...draft,storagePath:storedPath,sizeBytes:bytes.length,signedManifest:envelope}):json(400,{message:'UPDATE_RELEASE_STATE_INVALID'});
   if(name==='update_admin_publish_release'){status='PUBLISHED';published++;return json(200,{releaseId,status});}
  }
  if(url.startsWith('https://storage.bunnycdn.com/')){
   if(options.method==='PUT'){const chunks:Uint8Array[]=[];for await(const chunk of options.body)chunks.push(chunk);objects.set(url,Buffer.concat(chunks));return json(201,{});}
   if(options.method==='GET'){reads++;return objects.has(url)?new Response(Buffer.from(objects.get(url)!),{status:200}):json(404,{});}
   if(options.method==='DELETE'){deleted++;objects.delete(url);return json(200,{});}
  }
  return json(404,{});
 };
 const env=(key:string)=>({SUPABASE_URL:'https://cloud.invalid',SUPABASE_SERVICE_ROLE_KEY:'test_service',BASHKAR_ADMIN_ORIGINS:'https://admin.invalid',BASHKAR_UPDATE_STORAGE_ZONE:'release-test',BASHKAR_UPDATE_STORAGE_ENDPOINT:'https://storage.bunnycdn.com/',BASHKAR_UPDATE_STORAGE_KEY:'test_bunny',BASHKAR_RELEASE_KEY_ID:keyId,BASHKAR_RELEASE_PUBLIC_KEY_PEM:signer.publicKey.export({type:'spki',format:'pem'}).toString()} as Record<string,string>)[key];
 return {network,env,objects,loseValidation:()=>{loseValidation=true;},get status(){return status;},get reads(){return reads;},get deleted(){return deleted;},get validated(){return validated;},get published(){return published;}};
}
function req(body:BodyInit,header?:string,origin='https://admin.invalid'){return new Request('https://cloud.invalid/functions/v1/update-release-upload',{method:'POST',headers:{authorization:'Bearer '+('x'.repeat(40)),origin,'x-release-id':releaseId,'content-type':header?'application/octet-stream':'application/json',...(header?{'x-signed-release':header}:{})},body});}
it('verifies publisher signature, stream and private Storage readback before VALIDATED, then rechecks on publish',async()=>{
 const {makeUpdateReleaseUploadHandler}=await import(modulePath);const f=fixture(),handler=makeUpdateReleaseUploadHandler(f);
 const header=Buffer.from(JSON.stringify(envelope)).toString('base64url');
 const badSig=Buffer.from(JSON.stringify({...envelope,signature:'x'.repeat(86)})).toString('base64url');
 expect((await handler(req(bytes,badSig))).status).toBe(400);expect(f.objects.size).toBe(0);
 expect((await handler(req(Buffer.from('BAD'),header))).status).toBe(400);expect(f.deleted).toBe(1);expect(f.status).toBe('DRAFT');
 expect((await handler(req(bytes,header,'https://hostile.invalid'))).status).toBe(403);
 const uploaded=await handler(req(bytes,header));expect(uploaded.status).toBe(200);expect(f.status).toBe('VALIDATED');expect(f.reads).toBe(1);expect(f.validated).toBe(1);
 expect((await handler(req(bytes,header))).status).toBe(409);
 const path=[...f.objects.keys()][0];f.objects.set(path,Buffer.from('BAD'));
 expect((await handler(req(JSON.stringify({action:'publish'})))).status).toBe(400);expect(f.status).toBe('VALIDATED');
 f.objects.set(path,bytes);
 expect((await handler(req(JSON.stringify({action:'publish'})))).status).toBe(200);expect(f.status).toBe('PUBLISHED');expect(f.reads).toBe(3);expect(f.published).toBe(1);
});
it('keeps the verified object when validation commits but its response is lost',async()=>{
 const {makeUpdateReleaseUploadHandler}=await import(modulePath);const f=fixture(),handler=makeUpdateReleaseUploadHandler(f);f.loseValidation();
 const result=await handler(req(bytes,Buffer.from(JSON.stringify(envelope)).toString('base64url')));
 expect(result.status).toBe(503);expect(f.status).toBe('VALIDATED');expect(f.objects.size).toBe(1);expect(f.deleted).toBe(0);
});
