import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture,catalog} from './fixtures/operations';
import {canonical,digest} from '../src/command-bus';
import {validateCatalog} from '../src/modules/menu/catalog';
import {MenuSyncService} from '../src/modules/menu/menu-sync-service';
import {CloudMenuTransport} from '../src/modules/menu/cloud-menu-transport';
let db:PGlite,makeMenuHandler:any;
beforeAll(async()=>{db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");for(const file of ['20261021000100_activation_registry.sql','20261024000100_menu_sync.sql','20261101000100_menu_description_translations.sql','20261101000200_menu_photos.sql','20261101000300_table_cloud_sync.sql','20261101000400_public_menu.sql','20261101000500_public_menu_design.sql','20261102000100_public_menu_templates.sql','20261102000200_public_menu_visibility.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));const path=pathToFileURL(resolve('supabase/functions/_shared/menu-sync.mjs')).href;({makeMenuHandler}=await import(/* @vite-ignore */path));},20000);
afterAll(async()=>{await db?.close();});
async function setup(legacyDesignRead=false){const f=await fixture(),key=generateKeyPairSync('ed25519');
 await db.query('insert into auth.users(id) values($1)',[f.claims.ownerCloudId]);await db.query("insert into organizations(id,owner_id,name) values($1,$2,'QA')",[f.claims.organizationId,f.claims.ownerCloudId]);await db.query("insert into branches(id,organization_id,name) values($1,$2,'QA')",[f.claims.branchId,f.claims.organizationId]);await db.query("insert into server_registrations(id,branch_id,owner_id,instance_id,device_public_key_hash,nonce,issued_at,expires_at) values($1,$2,$3,$4,$5,$6,1,9999999999999)",[f.claims.registrationId,f.claims.branchId,f.claims.ownerCloudId,f.claims.instanceId,f.claims.devicePublicKeyHash,'q'.repeat(43)]);
 const rpc=async(name:string,args:Record<string,unknown>)=>{await db.exec('set role service_role');try{const value=(await db.query<{r:any}>(`select public.${name}(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) r`,Object.values(args))).rows[0].r;if(legacyDesignRead&&name==='public_menu_design_read')delete value.hiddenCategoryIds;return value;}finally{await db.exec('reset role');}};
 const handler=makeMenuHandler({rpc,privateKeyPem:key.privateKey.export({type:'pkcs8',format:'pem'}).toString()});let drop=false,calls=0,lastRequest:Request|undefined;
 const network:typeof fetch=async(url,init)=>{calls++;lastRequest=new Request(String(url),init);const response=await handler(lastRequest.clone());if(drop&&JSON.parse(String(init?.body)).operation==='push'){drop=false;throw Error('LOST_RESPONSE');}return response;};
 const device={...f.trust.device,initialize:()=>{}} as any;
 const remote=new CloudMenuTransport({url:'https://menu-qa.invalid',publishableKey:'qa',publicKey:key.publicKey.export({type:'spki',format:'pem'}).toString(),keyId:'menu-v1'},f.claims,device,network);
 const sync=new MenuSyncService(f.menu,remote,f.now,()=>1);
 const publish=async(c=catalog())=>{const d=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:f.menu.active(f.token).revision,catalog:c});await f.menu.publish(f.token,randomUUID(),d);};
 const external=async(parent:string,c=catalog())=>{const document=validateCatalog(c),id=randomUUID();await remote.call('push',{commandId:randomUUID(),expectedHead:parent,version:{id,parentId:parent,hash:digest(canonical(document)),schema:1,document,author:{type:'LOCAL_EMPLOYEE',id:f.auth.current(f.token).id,name:'Remote QA author'},origin:'CLOUD_RESTORE',localRevision:99,publishedAt:f.now()}});return id;};
 return {...f,remote,sync,publish,external,handler,lastRequest:()=>lastRequest!.clone(),drop:()=>{drop=true;},calls:()=>calls};
}
it('uses real signed Edge/Postgres delivery, backfills history, survives a lost response and acknowledges without duplicates',async()=>{
 const f=await setup();try{await f.publish();const changed=catalog();changed.items[0].variants[0].price=19000;await f.publish(changed);f.drop();f.sync.start();await f.sync.run();expect(f.sync.status(f.token).state).toBe('MENU_CLOUD_UNAVAILABLE');expect((await db.query('select id from menu_cloud_versions where branch_id=$1',[f.claims.branchId])).rows).toHaveLength(1);await f.sync.run();expect(f.sync.status(f.token)).toMatchObject({state:'SYNCED',pending:0,localRevision:2});expect((await db.query('select id from menu_cloud_versions where branch_id=$1',[f.claims.branchId])).rows).toHaveLength(2);expect((await db.query<{local_revision:number}>('select local_revision from menu_device_acknowledgements where branch_id=$1',[f.claims.branchId])).rows[0].local_revision).toBe(2);const count=f.calls();await f.sync.run();expect(f.calls()-count).toBeLessThan(9);expect(f.menu.active(f.token).revision).toBe(2);
 }finally{await f.sync.stop();f.close();}
});
it('publishes translated descriptions as schema 2 and preserves them through Cloud retrieval',async()=>{
 const f=await setup();try{
  const translated=catalog();Object.assign(translated.items[0],{description:'Горячий\nчай',descriptionTranslations:{ky:'Ысык чай'}});
  await f.publish(translated);f.sync.start();await f.sync.run();
  expect(f.sync.status(f.token).state).toBe('SYNCED');
  const version=f.sync.status(f.token).localVersion!;
  const stored=await db.query<{catalog_schema:number;document:{items:{descriptionTranslations?:Record<string,string>}[]}}>('select catalog_schema,document from menu_cloud_versions where id=$1',[version]);
  expect(stored.rows[0].catalog_schema).toBe(2);
  expect(stored.rows[0].document.items[0].descriptionTranslations?.ky).toBe('Ысык чай');
  expect((await f.remote.call('version',{versionId:version})).document.items[0].description).toBe('Горячий\nчай');
 }finally{await f.sync.stop();f.close();}
});
it('publishes public dish visibility as schema 3 and retrieves it unchanged',async()=>{
 const f=await setup();try{
  const hidden=catalog();hidden.items[0].publicVisible=false;
  await f.publish(hidden);f.sync.start();await f.sync.run();
  expect(f.sync.status(f.token).state).toBe('SYNCED');
  const version=f.sync.status(f.token).localVersion!;
  const stored=await db.query<{catalog_schema:number;document:{items:{publicVisible?:boolean}[]}}>('select catalog_schema,document from menu_cloud_versions where id=$1',[version]);
  expect(stored.rows[0].catalog_schema).toBe(3);
  expect(stored.rows[0].document.items[0].publicVisible).toBe(false);
  expect((await f.remote.call('version',{versionId:version})).document.items[0].publicVisible).toBe(false);
 }finally{await f.sync.stop();f.close();}
});
it('rejects category visibility before writing when the Cloud design schema is old',async()=>{
 const f=await setup(true);try{
  const design={expectedRevision:0,theme:'emerald',template:'categories',wifi:{ssid:'',password:''},hiddenCategoryIds:[],categoryTitles:{},defaultLanguage:'ru',languages:['ru'],copy:{ru:{title:'Меню'}}};
  await expect(f.remote.call('publicMenuDesignSet',design)).rejects.toThrow('PUBLIC_MENU_SCHEMA_UPDATE_REQUIRED');
  expect((await db.query('select count(*)::integer as count from public_menu_design where branch_id=$1',[f.claims.branchId])).rows[0]).toMatchObject({count:0});
 }finally{f.close();}
});
it('defers editing/drafts, applies a signed successor atomically, preserves stoplist and sends ACK without echo',async()=>{
 const f=await setup();try{await f.publish();f.sync.start();await f.sync.run();const parent=f.sync.status(f.token).localVersion!;await f.sync.lease(f.token,true);const changed=catalog();changed.items[0].variants[0].price=21000;const incoming=await f.external(parent,changed);await f.menu.stoplist(f.token,randomUUID(),{entityId:'oat',available:false,revision:0});await f.sync.run();expect(f.sync.status(f.token).state).toBe('EDITING');expect(f.menu.active(f.token).revision).toBe(1);await f.sync.lease(f.token,false);const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:1,catalog:catalog()});await f.sync.run();expect(f.sync.status(f.token).state).toBe('DRAFTS');await f.sync.abandon(f.token,randomUUID(),draft.draftId);await f.sync.run();expect(f.menu.active(f.token).revision).toBe(2);expect(f.menu.active(f.token).catalog!.items[0].variants[0].price).toBe(21000);expect(f.menu.availability().oat.available).toBe(false);expect(f.sync.status(f.token)).toMatchObject({state:'SYNCED',localVersion:incoming});expect(f.menu.revision(f.token,2).authorName).toBe('Remote QA author');expect((f.db.prepare("select count(*) n from outbox where type='menu.published'").get() as {n:number}).n).toBe(1);
 }finally{await f.sync.stop();f.close();}
});
it('stores both divergent versions, never overwrites operational menu, and resolves as a new CAS revision',async()=>{
 const f=await setup();try{await f.publish();f.sync.start();await f.sync.run();const parent=f.sync.status(f.token).localVersion!;const cloud=catalog();cloud.items[0].variants[0].price=22000;const cloudId=await f.external(parent,cloud);const local=catalog();local.items[0].variants[0].price=20000;await f.publish(local);await f.sync.run();expect(f.sync.status(f.token).state).toBe('CONFLICT');expect(f.menu.active(f.token).catalog!.items[0].variants[0].price).toBe(20000);expect((await db.query('select id from menu_cloud_versions where branch_id=$1',[f.claims.branchId])).rows).toHaveLength(3);await f.sync.choose(f.token,randomUUID(),{expectedLocalRevision:2,expectedRemoteVersion:cloudId,choice:'CLOUD'});await f.sync.run();expect(f.menu.active(f.token).revision).toBe(3);expect(f.menu.active(f.token).catalog!.items[0].variants[0].price).toBe(22000);expect(f.sync.status(f.token).state).toBe('SYNCED');expect((await db.query('select * from menu_sync_conflicts where branch_id=$1 and resolution_id is null',[f.claims.branchId])).rows).toHaveLength(0);
 }finally{await f.sync.stop();f.close();}
});
it('enforces owner RLS, immutable history and retired-device denial without local data loss',async()=>{
 const f=await setup();try{await f.publish();f.sync.start();await f.sync.run();for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await expect(db.query('select public.menu_issue_challenge($1)',[f.claims.registrationId])).rejects.toThrow(/permission denied/);if(role==='authenticated')expect((await db.query('select * from menu_cloud_versions')).rows).toHaveLength(0);}finally{await db.exec('reset role');}}
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.claims.ownerCloudId]);await db.exec('set role authenticated');try{expect((await db.query('select * from menu_cloud_versions')).rows).toHaveLength(1);await expect(db.query('delete from menu_cloud_versions')).rejects.toThrow(/permission denied/);}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}
 await expect(db.query('update menu_cloud_versions set origin=origin where branch_id=$1',[f.claims.branchId])).rejects.toThrow('IMMUTABLE_MENU');await db.query("update server_registrations set status='RETIRED' where id=$1",[f.claims.registrationId]);await f.sync.run();expect(f.sync.status(f.token).state).toBe('MENU_DEVICE_DENIED');expect(f.menu.active(f.token).revision).toBe(1);
 }finally{await f.sync.stop();f.close();}
});
it('rejects reused proof, tampered bytes, browser transport and cross-branch device scope',async()=>{
 const f=await setup();try{await f.publish();f.sync.start();await f.sync.run();await f.remote.call('manifest',{});const original=f.lastRequest();const replay=await f.handler(original.clone());expect((await replay.json()).code).toBe('MENU_CHALLENGE_EXPIRED');const input=await original.clone().json();input.branchId=randomUUID();let r=await f.handler(new Request(original.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));expect((await r.json()).code).toBe('MENU_DEVICE_DENIED');r=await f.handler(new Request(original.url,{method:'POST',headers:{'content-type':'application/json',origin:'https://untrusted.invalid'},body:JSON.stringify(input)}));expect((await r.json()).code).toBe('NATIVE_CLIENT_REQUIRED');
 }finally{await f.sync.stop();f.close();}
});
it('rolls back the entire local apply on audit failure and resumes the exact incoming version',async()=>{
 const f=await setup();try{await f.publish();f.sync.start();await f.sync.run();const parent=f.sync.status(f.token).localVersion!,changed=catalog();changed.items[0].variants[0].price=24000;await f.external(parent,changed);f.db.exec("create trigger test_cloud_apply_fail before insert on audit_events when new.action='menu.cloud.applied' begin select raise(abort,'AUDIT_TEST');end;");await f.sync.run();expect(f.menu.active(f.token).revision).toBe(1);expect((f.db.prepare('select count(*) n from menu_revisions').get() as {n:number}).n).toBe(1);f.db.exec('drop trigger test_cloud_apply_fail');await f.sync.run();expect(f.menu.active(f.token).revision).toBe(2);expect(f.sync.status(f.token).state).toBe('SYNCED');expect(f.sync.status(f.token).nextAttempt!-f.now()).toBe(30000);
 }finally{await f.sync.stop();f.close();}
});
it('restores an older version as a new publication, archives later items, and replays the result after Cloud advances',async()=>{
 const f=await setup();try{await f.publish();f.sync.start();await f.sync.run();const old=f.sync.status(f.token).localVersion!,changed=catalog();changed.items.push({id:'later',name:'Поздний товар',categoryId:'drinks',archived:false,available:true,kitchen:false,price:1000,variants:[],groups:[]});await f.publish(changed);await f.sync.run();const head=f.sync.status(f.token).remoteVersion!,command=randomUUID(),input={expectedLocalRevision:2,expectedRemoteVersion:head,choice:'CLOUD' as const,versionId:old};const result=await f.sync.choose(f.token,command,input);await f.sync.run();expect(f.menu.active(f.token).catalog!.items.find(i=>i.id==='later')!.archived).toBe(true);expect(f.menu.active(f.token).revision).toBe(3);expect(await f.sync.choose(f.token,command,input)).toEqual(result);expect(f.menu.active(f.token).revision).toBe(3);expect(f.sync.status(f.token).state).toBe('SYNCED');
 }finally{await f.sync.stop();f.close();}
});
it('preserves local work while Cloud is unavailable and denies sync mutations without menu.edit',async()=>{
 const f=await setup();try{const offline=new MenuSyncService(f.menu,{call:async()=>{throw Error('OFFLINE');}},f.now,()=>1);await f.publish();offline.start();await offline.run();expect(f.menu.active(f.token).revision).toBe(1);expect(offline.status(f.token)).toMatchObject({state:'MENU_CLOUD_UNAVAILABLE',pending:1});expect(offline.status(f.token).nextAttempt!-f.now()).toBe(15000);await offline.stop();const actor=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:actor.id,revision:f.auth.employee(actor.id).revision,permission:'menu.edit',allowed:false});await expect(f.sync.lease(f.token,true)).rejects.toThrow('PERMISSION_DENIED');await expect(f.sync.history(f.token)).rejects.toThrow('PERMISSION_DENIED');expect(f.sync.status(f.token).canEdit).toBe(false);
 }finally{await f.sync.stop();f.close();}
});
it('enables the public menu only after signed acknowledgement of the applied local version',async()=>{
 const f=await setup();try{
  await expect(f.sync.setPublicEnabled(f.token,true)).rejects.toThrow('PUBLIC_MENU_NO_APPLIED_VERSION');
  await f.publish();f.sync.start();await f.sync.run();
  const initial=await f.sync.publicStatus(f.token);expect(initial).toMatchObject({enabled:false,versionId:f.sync.status(f.token).localVersion});
  expect(await f.sync.setPublicEnabled(f.token,true)).toMatchObject({enabled:true,versionId:initial.versionId});
  expect(await f.sync.setPublicEnabled(f.token,false)).toMatchObject({enabled:false,versionId:initial.versionId});
 }finally{await f.sync.stop();f.close();}
});
