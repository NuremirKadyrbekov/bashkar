import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './fixtures/operations';
import {canonical,digest} from '../src/command-bus';
import {CloudMenuTransport} from '../src/modules/menu/cloud-menu-transport';
import {TableService} from '../src/modules/tables/table-service';
import {TableCloudSyncService} from '../src/modules/tables/table-cloud-sync-service';

let cloud:PGlite,makeMenuHandler:any;
beforeAll(async()=>{
 cloud=new PGlite();
 await cloud.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
 for(const name of ['20261021000100_activation_registry.sql','20261024000100_menu_sync.sql','20261101000300_table_cloud_sync.sql'])await cloud.exec(readFileSync('supabase/migrations/'+name,'utf8'));
 ({makeMenuHandler}=await import(/* @vite-ignore */pathToFileURL(resolve('supabase/functions/_shared/menu-sync.mjs')).href));
},20000);
afterAll(async()=>{await cloud?.close();});

it('syncs a full signed snapshot, retries lost receipts, keeps inactive links, and rejects old revisions',async()=>{
 const f=await fixture(),key=generateKeyPairSync('ed25519');
 try{
  await cloud.query('insert into auth.users(id) values($1)',[f.claims.ownerCloudId]);
  await cloud.query("insert into organizations(id,owner_id,name) values($1,$2,'QA')",[f.claims.organizationId,f.claims.ownerCloudId]);
  await cloud.query("insert into branches(id,organization_id,name) values($1,$2,'QA')",[f.claims.branchId,f.claims.organizationId]);
  await cloud.query('insert into server_registrations(id,branch_id,owner_id,instance_id,device_public_key_hash,nonce,issued_at,expires_at) values($1,$2,$3,$4,$5,$6,1,9999999999999)',[f.claims.registrationId,f.claims.branchId,f.claims.ownerCloudId,f.claims.instanceId,f.claims.devicePublicKeyHash,'q'.repeat(43)]);
  const rpc=async(name:string,args:Record<string,unknown>)=>{await cloud.exec('set role service_role');try{return (await cloud.query<{r:any}>(`select public.${name}(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) r`,Object.values(args))).rows[0].r;}finally{await cloud.exec('reset role');}};
  const handler=makeMenuHandler({rpc,privateKeyPem:key.privateKey.export({type:'pkcs8',format:'pem'}).toString()});
  let drop=true;
  const network:typeof fetch=async(url,init)=>{const response=await handler(new Request(String(url),init));if(drop&&JSON.parse(String(init?.body)).operation==='tableSnapshot'){drop=false;throw Error('LOST_RESPONSE');}return response;};
  const remote=new CloudMenuTransport({url:'https://table-qa.invalid',publishableKey:'qa',publicKey:key.publicKey.export({type:'spki',format:'pem'}).toString(),keyId:'menu-v1'},f.claims,{...f.trust.device,initialize:()=>{}} as any,network);
  const tables=new TableService(f.db,f.bus,f.auth,f.now),sync=new TableCloudSyncService(tables,remote,f.now);
  const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true});
  const table=await tables.saveTable(f.token,randomUUID(),{tableId:null,revision:0,zoneId:zone.id,name:'Стол 1',active:true});
  const code=table.publicPath.split('/').at(-1);
  sync.start();
  try{
   await sync.run();expect(sync.status(f.token).state).toBe('MENU_CLOUD_UNAVAILABLE');
   expect((await cloud.query<{n:number}>('select count(*) n from table_cloud_tables where branch_id=$1',[f.claims.branchId])).rows[0].n).toBe(1);
   await sync.run();expect(sync.status(f.token)).toMatchObject({state:'SYNCED',revision:2,acknowledgedRevision:2});
   const inactive=await tables.saveTable(f.token,randomUUID(),{tableId:table.id,revision:table.revision,zoneId:zone.id,name:'Стол 1',active:false});
   expect(inactive.publicPath.split('/').at(-1)).toBe(code);
   await sync.run();expect(sync.status(f.token)).toMatchObject({state:'SYNCED',revision:3,acknowledgedRevision:3});
   const stored=(await cloud.query<{code:string;active:boolean}>('select code,active from table_cloud_tables where branch_id=$1',[f.claims.branchId])).rows[0];
   expect(stored).toEqual({code,active:false});
   const old={zones:[{id:zone.id,name:'Зал',active:true,revision:1}],tables:[{id:table.id,zoneId:zone.id,code,name:'Стол 1',active:true,revision:1}]};
   await expect(remote.call('tableSnapshot',{commandId:randomUUID(),revision:2,hash:digest(canonical(old)),document:old})).rejects.toThrow('TABLE_STALE_REVISION');
   expect((await cloud.query<{active:boolean}>('select active from table_cloud_tables where branch_id=$1',[f.claims.branchId])).rows[0].active).toBe(false);
   await cloud.query("select set_config('request.jwt.claim.sub',$1,false)",[f.claims.ownerCloudId]);await cloud.exec('set role authenticated');
   try{expect((await cloud.query('select id from table_cloud_tables where branch_id=$1',[f.claims.branchId])).rows).toHaveLength(1);await expect(cloud.query('delete from table_cloud_tables where branch_id=$1',[f.claims.branchId])).rejects.toThrow(/permission denied/);}finally{await cloud.exec('reset role');await cloud.query("select set_config('request.jwt.claim.sub','',false)");}
   await cloud.exec('set role anon');try{await expect(cloud.query('select id from table_cloud_tables')).rejects.toThrow(/permission denied/);}finally{await cloud.exec('reset role');}
  }finally{await sync.stop();}
 }finally{f.close();}
},30000);

it('exposes and encodes a table URL only after sync and menu publication',async()=>{
 const f=await fixture();
 try{
  const tables=new TableService(f.db,f.bus,f.auth,f.now);
  let published=true,releaseStatus:(value:{enabled:boolean;versionId:string})=>void=()=>{},holdStatus=false,statusCalls=0;
  const remote={call:async(operation:string,body:any)=>{
   if(operation==='publicMenuStatus'){statusCalls++;return holdStatus?new Promise<{enabled:boolean;versionId:string}>(resolve=>{releaseStatus=resolve;}):{enabled:published,versionId:randomUUID()};}
   if(operation==='tableSnapshot')return {state:'APPLIED',revision:body.revision,hash:body.hash,zoneCount:body.document.zones.length,tableCount:body.document.tables.length};
   throw Error('UNEXPECTED_OPERATION');
  }};
  const sync=new TableCloudSyncService(tables,remote,f.now,'https://bashkarmenu-beta.vercel.app');
  const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true});
  const table=await tables.saveTable(f.token,randomUUID(),{tableId:null,revision:0,zoneId:zone.id,name:'Стол 1',active:true});
  expect(sync.links(f.token)[0]).toMatchObject({publicUrl:null,publicLinkStatus:'PENDING_SYNC'});
  sync.start();
  try{
   await sync.run();
   expect(sync.links(f.token)[0]).toMatchObject({publicUrl:null,publicLinkStatus:'PENDING_VERIFY'});
   holdStatus=true;const pending=sync.linksFresh(f.token);
   expect(sync.links(f.token)[0]).toMatchObject({publicUrl:null,publicLinkStatus:'PENDING_VERIFY'});
   releaseStatus({enabled:true,versionId:randomUUID()});holdStatus=false;
   const link=(await pending)[0];
   expect(link).toMatchObject({tableId:table.id,publicUrl:'https://bashkarmenu-beta.vercel.app'+table.publicPath,publicLinkStatus:'READY'});
   const beforeBatch=statusCalls,batch=await sync.qrBatch(f.token,[table.id]);
   expect(batch[0]).toMatchObject({tableId:table.id,publicUrl:link.publicUrl});
   expect(batch[0].qrDataUrl).toMatch(/^data:image\/png;base64,/);
   expect(statusCalls).toBe(beforeBatch);
   await expect(sync.qrBatch(f.token,[table.id,table.id])).rejects.toThrow('INVALID_TABLE_IDS');
   expect((await sync.qr(f.token,table.id)).qrDataUrl).toMatch(/^data:image\/png;base64,/);
   published=false;
   expect((await sync.linksFresh(f.token))[0]).toMatchObject({publicUrl:null,publicLinkStatus:'MENU_NOT_PUBLISHED'});
   expect((await sync.qrBatch(f.token,[table.id]))[0].qrDataUrl).toBeNull();
   await tables.saveTable(f.token,randomUUID(),{tableId:table.id,revision:table.revision,zoneId:zone.id,name:table.name,active:false});
   expect(sync.links(f.token)[0]).toMatchObject({publicUrl:null,publicLinkStatus:'INACTIVE'});
  }finally{await sync.stop();}
 }finally{f.close();}
});
