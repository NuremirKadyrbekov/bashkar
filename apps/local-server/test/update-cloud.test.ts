import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical } from '../src/command-bus';
import { verifySignedRelease, type ReleaseManifest } from '../src/recovery/release-verifier';
import { verifyUpdateInstallGrant } from '../src/recovery/update-authorization';
import { UpdateJournal } from '../src/recovery/update-journal';

const owner=randomUUID(),branch=randomUUID(),org=randomUUID(),registration=randomUUID(),instance=randomUUID(),actor=randomUUID();
const device=generateKeyPairSync('ed25519'),cloud=generateKeyPairSync('ed25519'),publisher=generateKeyPairSync('ed25519');
const devicePublicKey=device.publicKey.export({type:'spki',format:'pem'}).toString();
const deviceHash=createHash('sha256').update(devicePublicKey).digest('hex');
const releaseId='rel_020',artifactHash='b'.repeat(64);
const manifest:ReleaseManifest={format:1,releaseId,version:'0.2.0',gitCommit:'a'.repeat(40),keyId:'publisher_1',platform:{os:'win32',arch:'x64'},compatibility:{minSourceVersion:'0.1.0',maxSourceVersion:'0.1.0',minAgentVersion:'0.1.0',minSchema:26,maxSchema:26,targetSchema:26,migrationVersions:[]},artifact:{fileName:'Bashkar-POS-Setup-0.2.0.exe',sizeBytes:1,sha256:artifactHash},minFreeBytes:0};
const release=verifySignedRelease({manifest,signature:sign(null,Buffer.from(canonical(manifest)),publisher.privateKey).toString('base64url')},{keyId:'publisher_1',publicKey:publisher.publicKey.export({type:'spki',format:'pem'}).toString()},{appVersion:'0.1.0',agentVersion:'0.1.0',schemaVersion:26,os:'win32',arch:'x64',freeBytes:1});
const manifestHash=release.manifestSha256;
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
 await db.exec(readFileSync('supabase/migrations/20261021000100_activation_registry.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261022000100_platform_admin.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261105000100_update_authorization.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261105000200_update_release_admin.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261105000300_update_release_upload.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261105000400_update_release_download.sql','utf8'));
 await db.query('insert into auth.users(id) values($1)',[owner]);
 await db.query('insert into public.platform_admins(user_id) values($1)',[owner]);
 await db.query('insert into public.organizations(id,owner_id,name) values($1,$2,$3)',[org,owner,'Update QA']);
 await db.query('insert into public.branches(id,organization_id,name) values($1,$2,$3)',[branch,org,'QA branch']);
 await db.query('insert into public.server_registrations(id,branch_id,owner_id,instance_id,device_public_key_hash,nonce,issued_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[registration,branch,owner,instance,deviceHash,randomBytes(32).toString('base64url'),Date.now(),Date.now()+900000]);
 await db.query("insert into public.update_releases(id,version,channel,manifest_sha256,artifact_sha256,status,signed_manifest,storage_path,artifact_size_bytes,validated_at,published_at) values($1,'0.2.0','stable',$2,$3,'PUBLISHED',$4,$5,1,now(),now())",[releaseId,manifestHash,artifactHash,{manifest,signature:sign(null,Buffer.from(canonical(manifest)),publisher.privateKey).toString('base64url')},`updates/${releaseId}/${randomUUID()}/${manifest.artifact.fileName}`]);
 await db.query('insert into public.update_release_targets(release_id,branch_id) values($1,$2)',[releaseId,branch]);
},20000);
afterAll(async()=>{await db?.close();});

function args(operation=randomUUID()) {return {p_owner:owner,p_registration:registration,p_branch:branch,p_instance:instance,p_device_hash:deviceHash,p_actor:actor,p_operation:operation,p_release:releaseId,p_manifest_hash:manifestHash,p_artifact_hash:artifactHash,p_nonce:randomUUID()};}
async function issue(input:ReturnType<typeof args>) {const result=await db.query<{grant:Record<string,unknown>}>('select public.update_issue_install_grant($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as grant',Object.values(input));return result.rows[0].grant;}

it('denies restaurant roles and only grants published, assigned releases to the active registered device',async()=>{
 await db.exec('set role authenticated');
 try{
  await expect(db.query('select * from public.update_releases')).rejects.toThrow(/permission denied/);
  await expect(db.query('select public.update_issue_install_grant($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',Object.values(args()))).rejects.toThrow(/permission denied/);
 }finally{await db.exec('reset role');}
 const first=await issue(args());expect(first).toMatchObject({branchId:branch,registrationId:registration,manifestSha256:manifestHash});
 await expect(issue({...args(),p_manifest_hash:'0'.repeat(64)})).rejects.toThrow('UPDATE_RELEASE_DENIED');
 await expect(issue({...args(),p_device_hash:'0'.repeat(64)})).rejects.toThrow('UPDATE_DEVICE_DENIED');
 await expect(issue({...args(),p_owner:randomUUID()})).rejects.toThrow('UPDATE_DEVICE_DENIED');
 await expect(db.query('update public.update_releases set artifact_sha256=$1 where id=$2',['0'.repeat(64),releaseId])).rejects.toThrow('UPDATE_RELEASE_IMMUTABLE');
 await db.query("update public.update_releases set status='PAUSED' where id=$1",[releaseId]);
 await expect(issue(args())).rejects.toThrow('UPDATE_RELEASE_DENIED');
 await db.query("update public.update_releases set status='PUBLISHED' where id=$1",[releaseId]);
 await expect(issue({...args(),p_operation:first.operationId as ReturnType<typeof randomUUID>})).rejects.toThrow('UPDATE_OPERATION_REPLAY');
});

it('platform admin can stage a draft and withdraw it, while restaurant roles cannot publish it',async()=>{
 const draftId='rel_030';
 await db.exec('set role authenticated');
 try{await expect(db.query('select public.update_admin_release_snapshot($1)',[owner])).rejects.toThrow(/permission denied/);}
 finally{await db.exec('reset role');}
 await expect(db.query('select public.update_admin_release_snapshot($1)',[owner])).rejects.toThrow('RELEASE_PUBLISHER_REQUIRED');
 await db.query('insert into public.platform_release_publishers(user_id) values($1)',[owner]);
 const inserted=await db.query<{result:Record<string,unknown>}>('select public.update_admin_create_draft($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',[owner,draftId,'0.3.0','internal','c'.repeat(40),'d'.repeat(64),'e'.repeat(64),'QA draft',[branch]]);
 expect(inserted.rows[0].result).toMatchObject({releaseId:draftId,status:'DRAFT',targetCount:1});
 await expect(db.query('select public.update_admin_create_draft($1,$2,$3,$4,$5,$6,$7,$8,$9)',[owner,draftId,'0.3.0','internal','c'.repeat(40),'d'.repeat(64),'e'.repeat(64),'QA draft',[branch]])).rejects.toThrow('UPDATE_RELEASE_EXISTS');
 await expect(db.query('select public.update_admin_stop_release($1,$2,$3)',[owner,draftId,'PAUSE'])).rejects.toThrow('UPDATE_RELEASE_STATE_INVALID');
 const snapshot=await db.query<{result:Record<string,unknown>[]}>('select public.update_admin_release_snapshot($1) as result',[owner]);
 expect(snapshot.rows[0].result).toEqual(expect.arrayContaining([expect.objectContaining({releaseId:draftId,status:'DRAFT',targets:[branch]})]));
 await db.query('select public.update_admin_stop_release($1,$2,$3)',[owner,draftId,'WITHDRAW']);
 await expect(issue({...args(),p_release:draftId,p_manifest_hash:'d'.repeat(64),p_artifact_hash:'e'.repeat(64)})).rejects.toThrow('UPDATE_RELEASE_DENIED');
 expect((await db.query('select action from public.update_release_admin_events where release_id=$1 order by created_at',[draftId])).rows.map((row:any)=>row.action)).toEqual(['DRAFT_CREATED','WITHDRAWN']);
});

it('requires an uploaded and validated file before publication and records both transitions',async()=>{
 const draftId='rel_040',commit='c'.repeat(40),artifactSha='e'.repeat(64),manifestSha='d'.repeat(64);
 await db.query('insert into public.platform_release_publishers(user_id) values($1) on conflict do nothing',[owner]);
 await db.query('select public.update_admin_create_draft($1,$2,$3,$4,$5,$6,$7,$8,$9)',[owner,draftId,'0.4.0','internal',commit,manifestSha,artifactSha,'QA',[branch]]);
 const path=`updates/${draftId}/${randomUUID()}/Bashkar-POS-Setup-0.4.0.exe`;
 const envelope={manifest:{...manifest,releaseId:draftId,version:'0.4.0',gitCommit:commit,artifact:{fileName:'Bashkar-POS-Setup-0.4.0.exe',sizeBytes:1,sha256:artifactSha}},signature:'x'.repeat(86)};
 await expect(db.query("update public.update_releases set status='PUBLISHED' where id=$1",[draftId])).rejects.toThrow('UPDATE_RELEASE_STATE_INVALID');
 await expect(db.query('select public.update_admin_publish_release($1,$2,$3,$4,$5,$6)',[owner,draftId,path,manifestSha,artifactSha,1])).rejects.toThrow('UPDATE_RELEASE_STATE_INVALID');
 expect((await db.query<{result:Record<string,unknown>}>('select public.update_admin_upload_preflight($1,$2) as result',[owner,draftId])).rows[0].result).toMatchObject({manifestSha256:manifestSha,artifactSha256:artifactSha});
 await expect(db.query('select public.update_admin_validate_release($1,$2,$3,$4,$5)',[owner,draftId,{...envelope,manifest:{...envelope.manifest,artifact:{...envelope.manifest.artifact,sha256:'0'.repeat(64)}}},path,1])).rejects.toThrow('UPDATE_UPLOAD_INVALID');
 expect((await db.query<{status:string}>('select status from public.update_releases where id=$1',[draftId])).rows[0].status).toBe('DRAFT');
 await db.query('select public.update_admin_validate_release($1,$2,$3,$4,$5)',[owner,draftId,envelope,path,1]);
 await expect(db.query('select public.update_admin_publish_release($1,$2,$3,$4,$5,$6)',[owner,draftId,path,manifestSha,'0'.repeat(64),1])).rejects.toThrow('UPDATE_RELEASE_STATE_INVALID');
 await db.query('select public.update_admin_publish_release($1,$2,$3,$4,$5,$6)',[owner,draftId,path,manifestSha,artifactSha,1]);
 expect((await db.query<{status:string}>('select status from public.update_releases where id=$1',[draftId])).rows[0].status).toBe('PUBLISHED');
 await expect(db.query('update public.update_releases set storage_path=$1 where id=$2',['updates/other',draftId])).rejects.toThrow('UPDATE_RELEASE_IMMUTABLE');
 expect((await db.query<{action:string}>('select action from public.update_release_admin_events where release_id=$1 order by created_at,id',[draftId])).rows.map(row=>row.action)).toEqual(['DRAFT_CREATED','VALIDATED','PUBLISHED']);
});
it('returns download metadata only for a published release targeted to the active Owner device',async()=>{
 const params=[owner,registration,branch,instance,deviceHash,releaseId];
 const result=await db.query<{value:Record<string,unknown>}>('select public.update_get_release_download($1,$2,$3,$4,$5,$6) as value',params);
 expect(result.rows[0].value).toMatchObject({releaseId,manifestSha256:manifestHash,artifactSha256:artifactHash,sizeBytes:1});
 await expect(db.query('select public.update_get_release_download($1,$2,$3,$4,$5,$6)',[owner,registration,branch,instance,'0'.repeat(64),releaseId])).rejects.toThrow('UPDATE_DEVICE_DENIED');
 await db.query("update public.update_releases set status='PAUSED' where id=$1",[releaseId]);
 await expect(db.query('select public.update_get_release_download($1,$2,$3,$4,$5,$6)',params)).rejects.toThrow('UPDATE_RELEASE_DENIED');
 await db.query("update public.update_releases set status='PUBLISHED' where id=$1",[releaseId]);
});

it('Edge requires online Owner and device proof before issuing a signed grant',async()=>{
 const {makeUpdateAuthorizeHandler}=await import(/* @vite-ignore */pathToFileURL(resolve('supabase/functions/_shared/update-authorize.mjs')).href);
 const operationId=randomUUID(),nonce=randomUUID();
 const proof={format:1,action:'INSTALL',operationId,branchId:branch,instanceId:instance,registrationId:registration,actorId:actor,releaseId,manifestSha256:manifestHash,artifactSha256:artifactHash,nonce};
 const input={...proof,devicePublicKey,deviceSignature:sign(null,Buffer.from(canonical(proof)),device.privateKey).toString('base64url')};
 let calls=0;
 const handler=makeUpdateAuthorizeHandler({privateKeyPem:cloud.privateKey.export({type:'pkcs8',format:'pem'}).toString(),rpc:async(_name:string,params:ReturnType<typeof args>)=>{calls++;return issue(params);},authUser:async()=>({id:owner,email_confirmed_at:'now'})});
 const request=(body:unknown,authorization='Bearer '+('x'.repeat(40)))=>new Request('https://cloud.invalid/update-authorize',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify(body)});
 const result=await handler(request(input));expect(result.status).toBe(200);
 const grant=await result.json();expect(grant.claims).toMatchObject({operationId,actorId:actor,releaseId,manifestSha256:manifestHash});
 expect(createHash('sha256').update(devicePublicKey).digest('hex')).toBe(deviceHash);
 const {verify}=await import('node:crypto');
 expect(verify(null,Buffer.from(canonical(grant.claims)),cloud.publicKey,Buffer.from(grant.signature,'base64url'))).toBe(true);
 const authorized=verifyUpdateInstallGrant(grant,{keyId:'update-cloud-v1',publicKey:cloud.publicKey.export({type:'spki',format:'pem'}).toString()},{branchId:branch,instanceId:instance,registrationId:registration},{id:actor,branchId:branch,role:'OWNER',audience:'LOCAL_ADMIN',method:'CLOUD_OWNER'},release,operationId,Date.now());
 const root=mkdtempSync(join(tmpdir(),'bashkar-cloud-journal-'));
 try{const config=join(root,'config'),backups=join(root,'backups');mkdirSync(config,{mode:0o700});mkdirSync(backups,{mode:0o700});const journal=new UpdateJournal(config,backups);expect(journal.start(authorized)).toMatchObject({operationId,grantSha256:authorized.grantSha256,manifestSha256:manifestHash});}
 finally{rmSync(root,{recursive:true,force:true});}
 expect((await handler(request(input))).status).toBe(409);
 const bad=await handler(request({...input,operationId:randomUUID()}));expect(bad.status).toBe(403);
 expect(calls).toBe(2);
 const noOwner=makeUpdateAuthorizeHandler({privateKeyPem:cloud.privateKey.export({type:'pkcs8',format:'pem'}).toString(),rpc:async()=>{throw Error('RPC_CALLED');},authUser:async()=>null});
 expect((await noOwner(request(input))).status).toBe(403);
});
