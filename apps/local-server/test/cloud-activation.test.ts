import { expect, it } from 'vitest';
import { generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blankFixture } from './fixtures/operations';
import { canonical, CommandBus } from '../src/command-bus';
import { ActivationService } from '../src/modules/activation/activation-service';
import { CloudActivation } from '../src/modules/activation/cloud-activation';
import { AuthService } from '../src/modules/auth/auth-service';
import { CloudOwnerAuth } from '../src/modules/auth/cloud-owner-auth';
import { createServer } from '../src/server';

it('persists the same registration before network, recovers after restart, and requires online Owner login',async()=>{
 const f=blankFixture(),authority=generateKeyPairSync('ed25519'),keys=generateKeyPairSync('ed25519');
 const publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
 const device={initialize(){},assertAvailable(){},publicKey:()=>publicKey,sign:(message:string)=>sign(null,Buffer.from(message),keys.privateKey).toString('base64url')};
 const trust={publicKey:authority.publicKey.export({type:'spki',format:'pem'}).toString()};
 const branch=randomUUID(),org=randomUUID(),owner=randomUUID(),cloudPassword='cloud-password-never-persist',cloudToken='cloud-token-never-persist';
 const config={url:'https://example.supabase.co',publishableKey:'sb_publishable_fixture'};
 let db=f.db,drop=true,enabled=0;const attempts:Record<string,unknown>[]=[];
 const network:typeof fetch=async(url,init)=>{
  const path=String(url);
  if(path.includes('/token?'))return Response.json({access_token:cloudToken,expires_in:3600});
  if(path.endsWith('/user'))return Response.json({id:owner,email:'owner@example.com',email_confirmed_at:'2026-10-21'});
  if(path.includes('/organizations?'))return Response.json([{id:org,name:'Org'}]);
  if(path.includes('/branches?'))return Response.json([{id:branch,name:'Branch',organization_id:org}]);
  const body=JSON.parse(String(init?.body));attempts.push(body);
  expect(db.prepare('select registration_id from activation_pending').get()).toEqual({registration_id:body.registrationId});
  const {devicePublicKey,deviceSignature,...fields}=body;
  const {digest}=await import('../src/command-bus.js');
  const proof={...fields,devicePublicKeyHash:digest(devicePublicKey)};
  expect(verify(null,Buffer.from(canonical(proof)),devicePublicKey,Buffer.from(deviceSignature,'base64url'))).toBe(true);
  if(drop){drop=false;throw Error('lost-after-cloud-commit');}
  const claims={...proof,organizationId:org,ownerCloudId:owner,issuedAt:Date.now()-1000,expiresAt:Date.now()+60000};
  return Response.json({claims,signature:sign(null,Buffer.from(canonical(claims)),authority.privateKey).toString('base64url')});
 };
 function controller(){return new CloudActivation(config,device,new ActivationService(db,trust,device),f.dir,()=>f.storage.assertIdentity(),()=>{enabled++;},network);}
 try{
  let cloud=controller();let flow=await cloud.login({email:'owner@example.com',password:cloudPassword});
  const input={flowId:flow.flowId,branchId:branch};
  await expect(cloud.complete({...input,branchId:randomUUID()})).rejects.toThrow('BRANCH_ACCESS_DENIED');
  await expect(cloud.complete({...input,password:'local-secret'})).rejects.toThrow();
  expect(db.prepare('select count(*) n from activation_pending').get()).toEqual({n:0});
  await expect(cloud.complete(input)).rejects.toThrow('CLOUD_REGISTRATION_UNAVAILABLE');
  expect(enabled).toBe(0);expect(db.prepare('select count(*) n from employees').get()).toEqual({n:0});
  f.storage.close();f.storage.open();db=f.storage.connection();cloud=controller();
  await expect(cloud.complete(input)).rejects.toThrow('CLOUD_LOGIN_REQUIRED');
  flow=await cloud.login({email:'owner@example.com',password:cloudPassword});
  const result=await cloud.complete({...input,flowId:flow.flowId});expect(result.branchId).toBe(branch);expect(enabled).toBe(1);
  expect(JSON.parse(readFileSync(join(f.dir,'branch-display.json'),'utf8'))).toMatchObject({branchId:branch,name:'Branch'});
  expect(attempts).toHaveLength(2);expect(attempts[0]).toEqual(attempts[1]);
  expect(await cloud.complete({})).toEqual({branchId:branch,alreadyActivated:true});
  expect(db.prepare('select count(*) n from employees').get()).toEqual({n:1});
  db.prepare("INSERT INTO permission_overrides(employee_id,permission,allowed) SELECT id,'shift.open',1 FROM employees").run();
  expect(db.prepare('select owner_cloud_id,email from owner_cloud_auth').get()).toEqual({owner_cloud_id:owner,email:'owner@example.com'});
  expect(JSON.stringify(db.prepare('select * from employees').all())).not.toContain(cloudPassword);
  expect(JSON.stringify(db.prepare('select * from activation_pending').all())).not.toMatch(/cloud-password|cloud-token|PRIVATE KEY/);
  expect(()=>db.prepare("update activation_pending set nonce='changed'").run()).toThrow('IMMUTABLE_ACTIVATION_PENDING');
  f.storage.close();
  const offline:typeof fetch=async()=>{throw Error('network-forbidden');};
  const app=await createServer(f.dir,0,false,{authority:trust,device,cloud:config,network:offline});
  try{
   expect((await app.inject('/api/v1/system/health/ready')).statusCode).toBe(200);
   expect((await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{login:'owner@example.com',password:cloudPassword}})).statusCode).toBe(401);
   expect((await app.inject({method:'POST',url:'/api/v1/auth/owner-cloud',payload:{email:'owner@example.com',password:cloudPassword}})).statusCode).toBe(503);
  }finally{await app.close();}
  let available=true,allowed=true,confirmed=true,cloudOwnerId=owner,cloudEmail='owner@example.com',acceptedPassword=cloudPassword;
  const ownerNetwork:typeof fetch=async(url,init)=>{
   if(!available)throw Error('offline');
   const path=String(url);
   if(path.includes('/token?')){
    const credentials=JSON.parse(String(init?.body));
    return credentials.email===cloudEmail&&credentials.password===acceptedPassword?Response.json({access_token:cloudToken}):Response.json({error:'invalid_grant'},{status:400});
   }
   if(path.endsWith('/user'))return Response.json({id:cloudOwnerId,email:cloudEmail,email_confirmed_at:confirmed?'2026-10-21':null});
   if(path.includes('/organizations?'))return Response.json(allowed?[{id:org}]:[]);
   if(path.includes('/branches?'))return Response.json(allowed?[{id:branch,organization_id:org}]:[]);
   throw Error('unexpected-cloud-route');
  };
  const online=await createServer(f.dir,0,false,{authority:trust,device,cloud:config,network:ownerNetwork});
  try{
   const ownerSignIn=(email=cloudEmail,password=acceptedPassword)=>online.inject({method:'POST',url:'/api/v1/auth/owner-cloud',payload:{email,password}});
   expect((await ownerSignIn(cloudEmail,'wrong')).statusCode).toBe(401);
   const signed=await ownerSignIn();expect(signed.statusCode).toBe(200);
   const token=signed.json().token as string;
   const me=()=>online.inject({url:'/api/v1/auth/me',headers:{authorization:'Bearer '+token}});
   expect((await me()).json().role).toBe('OWNER');
   expect((await me()).json().branchName).toBe('Branch');
   expect((await me()).json().mustChangePassword).toBe(false);
   cloudEmail='renamed@example.com';acceptedPassword='changed-cloud-password';
   const renamed=await ownerSignIn();expect(renamed.statusCode).toBe(200);
   expect(renamed.json().employeeId).toBe(signed.json().employeeId);
   expect((await ownerSignIn('owner@example.com',cloudPassword)).statusCode).toBe(401);
   const shifted=await online.inject({method:'POST',url:'/api/v1/shifts/open',headers:{authorization:'Bearer '+renamed.json().token},payload:{commandId:randomUUID(),login:cloudEmail,password:acceptedPassword}});
   expect(shifted.statusCode).toBe(200);
   expect((await online.inject({method:'POST',url:'/api/v1/auth/password',headers:{authorization:'Bearer '+renamed.json().token},payload:{commandId:randomUUID(),oldPassword:acceptedPassword,newPassword:'some-new-local-password'}})).statusCode).toBe(403);
   available=false;expect((await me()).statusCode).toBe(200);
   expect((await online.inject({url:'/api/v1/menu',headers:{authorization:'Bearer '+token}})).statusCode).toBe(200);
   expect((await online.inject({url:'/api/v1/tables',headers:{authorization:'Bearer '+token}})).statusCode).toBe(200);
   const protectedWrite=()=>online.inject({method:'POST',url:'/api/v1/auth/password',headers:{authorization:'Bearer '+token},payload:{commandId:randomUUID(),oldPassword:acceptedPassword,newPassword:'some-new-local-password'}});
   expect((await protectedWrite()).statusCode).toBe(403);
   expect((await online.inject({method:'POST',url:'/api/v1/auth/activity',headers:{authorization:'Bearer '+token},payload:{}})).statusCode).toBe(200);
   available=true;expect((await me()).statusCode).toBe(200);
   allowed=false;expect((await online.inject({url:'/api/v1/menu/public/status',headers:{authorization:'Bearer '+token}})).statusCode).toBe(403);
   expect((await me()).statusCode).toBe(401);
   expect((await ownerSignIn()).statusCode).toBe(403);
   allowed=true;confirmed=false;expect((await ownerSignIn()).statusCode).toBe(401);
   confirmed=true;cloudOwnerId=randomUUID();expect((await ownerSignIn()).statusCode).toBe(401);
  }finally{await online.close();}
 }finally{f.close();}
});

it('reuses cloud proof for thirty seconds of reads, coalesces concurrent reads, and checks writes fresh',async()=>{
 const f=blankFixture();
 try{
  const email='owner@example.com',password='cloud-secret';
  await f.activation.activateCloudOwner(f.receipt,{email,ownerCloudId:f.claims.ownerCloudId},f.claims.nonce);
  let clock=Date.now(),calls=0,online=true;
  const network:typeof fetch=async(url)=>{
   calls++;if(!online)throw Error('offline');
   const path=String(url);
   if(path.includes('/token?'))return Response.json({access_token:'test-token'});
   if(path.endsWith('/user'))return Response.json({id:f.claims.ownerCloudId,email,email_confirmed_at:'2026-10-23'});
   if(path.includes('/organizations?'))return Response.json([{id:f.claims.organizationId}]);
   if(path.includes('/branches?'))return Response.json([{id:f.claims.branchId,organization_id:f.claims.organizationId}]);
   throw Error('unexpected-cloud-route');
  };
  const auth=new AuthService(f.db,new CommandBus(f.db),f.claims.branchId);
  const cloud=new CloudOwnerAuth(auth,{url:'https://cloud.example',publishableKey:'fixture-key'},network,()=>clock);
  const session=await cloud.login(email,password),id=auth.current(session.token).sessionId;
  expect(calls).toBe(4);
  await cloud.verifySession(id);expect(calls).toBe(4);
  clock+=30000;
  await Promise.all([cloud.verifySession(id),cloud.verifySession(id)]);expect(calls).toBe(7);
  await cloud.verifySession(id,true);expect(calls).toBe(10);
  online=false;await cloud.verifySession(id);expect(calls).toBe(10);
  await expect(cloud.verifySession(id,true)).rejects.toThrow('OWNER_CLOUD_UNAVAILABLE');
  clock+=30000;await expect(cloud.verifySession(id)).rejects.toThrow('OWNER_CLOUD_UNAVAILABLE');
  online=true;await cloud.verifySession(id);expect(calls).toBe(15);
  online=false;clock+=30000;
  expect(()=>cloud.verifyLocalSession(id)).not.toThrow();
  await new Promise(resolve=>setImmediate(resolve));
  expect(()=>cloud.verifyLocalSession(id)).not.toThrow();
 }finally{f.close();}
});
