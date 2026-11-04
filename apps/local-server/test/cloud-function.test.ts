import { expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign, webcrypto } from 'node:crypto';
import { canonical } from '../src/command-bus';

const bundle=buildSync({entryPoints:['supabase/functions/register-server/index.ts'],bundle:true,write:false,format:'iife',platform:'neutral'}).outputFiles[0].text;
function fixture(){
 const device=generateKeyPairSync('ed25519'),authority=generateKeyPairSync('ed25519');
 const devicePublicKey=device.publicKey.export({type:'spki',format:'pem'}).toString();
 const devicePublicKeyHash=createHash('sha256').update(devicePublicKey).digest('hex');
 const proof={version:1,registrationId:randomUUID(),branchId:randomUUID(),instanceId:randomUUID(),devicePublicKeyHash,nonce:randomBytes(32).toString('base64url')};
 const {devicePublicKeyHash:_,...input}=proof;
 return {proof,input:{...input,devicePublicKey,deviceSignature:sign(null,Buffer.from(canonical(proof)),device.privateKey).toString('base64url')},key:authority.privateKey.export({type:'pkcs8',format:'pem'}).toString()};
}
function handler(f:ReturnType<typeof fixture>,mode='ok'){
 const calls:{url:string;body:Record<string,unknown>|null}[]=[];
 let serve:(request:Request)=>Promise<Response>=()=>{throw Error('NOT_INITIALIZED');};
 const env:Record<string,string>={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private-service-test-key',BASHKAR_ACTIVATION_PRIVATE_KEY_B64:Buffer.from(f.key).toString('base64')};
 if(mode==='missing-key')delete env.BASHKAR_ACTIVATION_PRIVATE_KEY_B64;
 // JSON.parse in this VM creates the realm's Object.prototype required by the
 // protocol. Fetch mocks return host objects only for already verified claims.
 const context=createContext({Deno:{env:{get:(key:string)=>env[key]},serve:(fn:typeof serve)=>{serve=fn;}},crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,AbortSignal,atob,btoa,
  fetch:async(url:string,options:RequestInit)=>{
   calls.push({url,body:options.body?JSON.parse(String(options.body)):null});
   let body:unknown,status=200;
   if(url.endsWith('/auth/v1/user')){body=mode==='expired'?{msg:'expired'}:{id:'verified-owner',email_confirmed_at:'2026-10-21',is_anonymous:mode==='anonymous'};status=mode==='expired'?401:200;}
   else if(mode==='denied'){body={message:'BRANCH_ACCESS_DENIED'};status=400;}
   else if(mode==='unavailable'){body={message:'upstream sql with secrets'};status=500;}
   else body={...f.proof,organizationId:randomUUID(),ownerCloudId:'verified-owner',issuedAt:Date.now(),expiresAt:Date.now()+900000};
   const response=Response.json(body,{status});
   response.json=async()=>runInContext('JSON',context).parse(await response.text());
   return response;
  }});
 runInContext(bundle,context);
 return {serve,calls};
}
function request(body:unknown,extra:Record<string,string>={}){
 return new Request('https://example.supabase.co/functions/v1/register-server',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+ 'a'.repeat(40),...extra},body:JSON.stringify(body)});
}
it('function rejects unauthenticated, expired, anonymous and browser requests before the registry',async()=>{
 const f=fixture();
 for(const mode of ['expired','anonymous']){
  const h=handler(f,mode),response=await h.serve(request(f.input));
  expect(response.status).toBe(mode==='expired'?401:403);expect(h.calls).toHaveLength(1);
 }
 const h=handler(f);
 expect((await h.serve(request(f.input,{origin:'https://hostile.example'}))).status).toBe(403);
 expect((await h.serve(new Request('https://example.supabase.co',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}))).status).toBe(401);
 expect(h.calls).toHaveLength(0);
});
it('function requires possession, rejects supplied owner identity and never reserves without a signer',async()=>{
 const f=fixture();
 for(const input of [{...f.input,ownerId:'forged-owner'},{...f.input,branchId:randomUUID()}]){
  const h=handler(f),response=await h.serve(request(input));expect(response.status).toBeLessThan(500);expect(response.ok).toBe(false);expect(h.calls).toHaveLength(1);
 }
 const h=handler(f,'missing-key');expect((await h.serve(request(f.input))).status).toBe(503);expect(h.calls).toHaveLength(1);
});
it('function derives Owner from Auth, signs only committed registry claims and hides upstream failure details',async()=>{
 const f=fixture(),h=handler(f),response=await h.serve(request(f.input));
 expect(response.status).toBe(200);expect((await response.json()).signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
 expect(h.calls[1].body).toEqual({p_owner_id:'verified-owner',p_branch_id:f.proof.branchId,p_registration_id:f.proof.registrationId,p_instance_id:f.proof.instanceId,p_device_hash:f.proof.devicePublicKeyHash,p_nonce:f.proof.nonce});
 const denied=await handler(f,'denied').serve(request(f.input));expect(denied.status).toBe(403);expect(await denied.json()).toEqual({code:'BRANCH_ACCESS_DENIED'});
 const unavailable=await handler(f,'unavailable').serve(request(f.input));expect(unavailable.status).toBe(503);expect(await unavailable.json()).toEqual({code:'CLOUD_REGISTRY_UNAVAILABLE'});
});
