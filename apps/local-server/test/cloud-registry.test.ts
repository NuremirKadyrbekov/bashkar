import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { canonical } from '../src/command-bus';
import { blankFixture, password } from './fixtures/operations';
import { ActivationService } from '../src/modules/activation/activation-service';

const owner=randomUUID(),stranger=randomUUID(),org=randomUUID(),branch=randomUUID(),branch2=randomUUID();
const registration=randomUUID(),instance=randomUUID(),hash='a'.repeat(64),nonce=randomBytes(32).toString('base64url');
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
 `);
 await db.exec(readFileSync('supabase/migrations/20261021000100_activation_registry.sql','utf8'));
 await db.query('insert into auth.users values ($1),($2)',[owner,stranger]);
 await db.query('insert into public.organizations(id,owner_id,name) values($1,$2,$3)',[org,owner,'Bashkar test']);
 await db.query('insert into public.branches(id,organization_id,name) values($1,$2,$3),($4,$2,$5)',[branch,org,'One',branch2,'Two']);
},20000);
afterAll(async()=>{await db?.close();});

async function asRole<T>(role:string,sub:string,run:()=>Promise<T>):Promise<T>{
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[sub]);
 await db.exec(`set role ${role}`);
 try{return await run();}finally{await db.exec('reset role');}
}
function register(who=owner,atBranch=branch,id=registration,node=instance,key=hash,challenge=nonce){
 return asRole('service_role','',async()=>{
  const result=await db.query<{claims:Record<string,unknown>}>('select public.register_branch_server($1,$2,$3,$4,$5,$6) as claims',[who,atBranch,id,node,key,challenge]);
  return result.rows[0].claims;
 });
}

it('cloud RLS reveals only owned branches and blocks anonymous and direct registry writes',async()=>{
 await asRole('authenticated',stranger,async()=>{
  expect((await db.query('select * from public.organizations')).rows).toHaveLength(0);
  expect((await db.query('select * from public.branches')).rows).toHaveLength(0);
  await expect(db.query("insert into public.organizations(owner_id,name) values($1,'self-grant')",[stranger])).rejects.toThrow(/permission denied/);
  await expect(db.query('select public.register_branch_server($1,$2,$3,$4,$5,$6)',[owner,branch,registration,instance,hash,nonce])).rejects.toThrow(/permission denied/);
 });
 await asRole('authenticated',owner,async()=>{
  expect((await db.query('select * from public.branches')).rows).toHaveLength(2);
  await expect(db.query("update public.branches set name='tampered'")).rejects.toThrow(/permission denied/);
 });
 await asRole('anon','',async()=>{await expect(db.query('select * from public.branches')).rejects.toThrow(/permission denied/);});
});

it('registry verifies ownership, replays one reservation and refuses a second server or device reuse',async()=>{
 await expect(register(stranger)).rejects.toThrow('BRANCH_ACCESS_DENIED');
 const first=await register();expect(first).toMatchObject({branchId:branch,ownerCloudId:owner,organizationId:org,instanceId:instance,registrationId:registration});
 expect(await register()).toEqual(first);
 await expect(register(owner,branch,randomUUID(),randomUUID(),'b'.repeat(64))).rejects.toThrow('BRANCH_ALREADY_REGISTERED');
 await expect(register(owner,branch,registration,randomUUID())).rejects.toThrow('REGISTRATION_ID_CONFLICT');
 await expect(register(owner,branch2,randomUUID(),randomUUID())).rejects.toThrow('REGISTRATION_CONFLICT');
 await expect(register(owner,branch2,randomUUID(),instance,'c'.repeat(64))).rejects.toThrow('REGISTRATION_CONFLICT');
 expect((await db.query('select * from public.server_registrations')).rows).toHaveLength(1);
 expect((await db.query('select * from public.activation_audit')).rows).toHaveLength(1);
 await asRole('authenticated',stranger,async()=>{
  expect((await db.query('select * from public.server_registrations')).rows).toHaveLength(0);
  expect((await db.query('select * from public.activation_audit')).rows).toHaveLength(0);
 });
});

it('mandatory cloud audit failure rolls back the branch reservation',async()=>{
 await db.exec("create function public.fail_audit() returns trigger language plpgsql as $$begin raise exception 'audit-test'; end;$$; create trigger fail_audit before insert on public.activation_audit for each row execute function public.fail_audit();");
 try{await expect(register(owner,branch2,randomUUID(),randomUUID(),'d'.repeat(64))).rejects.toThrow('audit-test');}
 finally{await db.exec('drop trigger fail_audit on public.activation_audit; drop function public.fail_audit();');}
 expect((await db.query('select * from public.server_registrations')).rows).toHaveLength(1);
});

it('expired response recovery renews only the same device/registration without duplicating audit',async()=>{
 await db.query('update public.server_registrations set issued_at=1,expires_at=2 where id=$1',[registration]);
 const renewed=await register();expect(renewed.expiresAt as number).toBeGreaterThan(Date.now());
 expect((await db.query('select * from public.activation_audit')).rows).toHaveLength(1);
});

it('portable Edge protocol verifies device possession and produces receipts accepted by local activation',async()=>{
 const modulePath=pathToFileURL(resolve('supabase/functions/_shared/registration.mjs')).href;
 // Dynamic module is also loaded unchanged by Deno; it has no Node dependency.
 const protocol=await import(modulePath);
 const f=blankFixture();try{
  const device=generateKeyPairSync('ed25519'),authority=generateKeyPairSync('ed25519');
  const devicePublicKey=device.publicKey.export({type:'spki',format:'pem'}).toString();
  const devicePublicKeyHash=createHash('sha256').update(devicePublicKey).digest('hex');
  const proof={version:1,registrationId:randomUUID(),branchId:randomUUID(),instanceId:f.claims.instanceId,devicePublicKeyHash,nonce:randomBytes(32).toString('base64url')};
  const deviceSignature=sign(null,Buffer.from(canonical(proof)),device.privateKey).toString('base64url');
  const {devicePublicKeyHash:_,...input}=proof;
  expect(await protocol.validateRegistration({...input,devicePublicKey,deviceSignature})).toEqual(proof);
  await expect(protocol.validateRegistration({...input,branchId:randomUUID(),devicePublicKey,deviceSignature})).rejects.toThrow('DEVICE_PROOF_INVALID');
  await expect(protocol.validateRegistration({...input,devicePublicKey,deviceSignature,ownerId:owner})).rejects.toThrow('INVALID_REGISTRATION');
  const signingKey=await protocol.loadAuthority(authority.privateKey.export({type:'pkcs8',format:'pem'}).toString());
  const claims={...f.claims,...proof,organizationId:org,ownerCloudId:owner,issuedAt:Date.now()-1000,expiresAt:Date.now()+60000};
  const receipt=await protocol.signRegistration(claims,signingKey);
  expect(verify(null,Buffer.from(canonical(claims)),authority.publicKey,Buffer.from(receipt.signature,'base64url'))).toBe(true);
  const local=new ActivationService(f.db,{publicKey:authority.publicKey.export({type:'spki',format:'pem'}).toString()},{publicKey:()=>devicePublicKey,assertAvailable(){}});
  await local.activate(receipt,{login:'owner',name:'Owner',password},proof.nonce);
  expect(local.binding()).toEqual({branchId:proof.branchId,organizationId:org});
 }finally{f.close();}
});
