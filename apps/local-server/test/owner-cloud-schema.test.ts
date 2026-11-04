import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './fixtures/operations';
import {CloudMenuTransport} from '../src/modules/menu/cloud-menu-transport';
import {canonical,digest} from '../src/command-bus';

it('installs owner report, journal and staff ledgers with owner-scoped readers',async()=>{
 const db=new PGlite();try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
  for(const file of ['20261021000100_activation_registry.sql','20261024000100_menu_sync.sql','20261103000100_analytics_overview.sql','20261103000200_analytics_products.sql','20261103000300_shift_reports_cloud.sql','20261103000400_owner_journal.sql','20261103000500_owner_staff_snapshots.sql','20261103000600_analytics_products_read.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  for(const table of ['owner_shift_reports','owner_journal_records','owner_staff_snapshots'])expect((await db.query<{name:string}>(`select to_regclass('public.${table}') name`)).rows[0].name).toBe(table);
 }finally{await db.close();}
});

it('accepts signed report, sale, refund and staff records idempotently',async()=>{
 const db=new PGlite(),f=await fixture(),key=generateKeyPairSync('ed25519');
 try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
  for(const file of ['20261021000100_activation_registry.sql','20261024000100_menu_sync.sql','20261103000100_analytics_overview.sql','20261103000200_analytics_products.sql','20261103000300_shift_reports_cloud.sql','20261103000400_owner_journal.sql','20261103000500_owner_staff_snapshots.sql','20261103000600_analytics_products_read.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  await db.query('insert into auth.users(id) values($1)',[f.claims.ownerCloudId]);
  await db.query("insert into organizations(id,owner_id,name) values($1,$2,'QA')",[f.claims.organizationId,f.claims.ownerCloudId]);
  await db.query("insert into branches(id,organization_id,name) values($1,$2,'QA')",[f.claims.branchId,f.claims.organizationId]);
  await db.query('insert into server_registrations(id,branch_id,owner_id,instance_id,device_public_key_hash,nonce,issued_at,expires_at) values($1,$2,$3,$4,$5,$6,1,9999999999999)',[f.claims.registrationId,f.claims.branchId,f.claims.ownerCloudId,f.claims.instanceId,f.claims.devicePublicKeyHash,'q'.repeat(43)]);
  const rpc=async(name:string,args:Record<string,unknown>)=>{await db.exec('set role service_role');try{return (await db.query<{r:any}>(`select public.${name}(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) r`,Object.values(args))).rows[0].r;}finally{await db.exec('reset role');}};
  const {makeMenuHandler}=await import(/* @vite-ignore */pathToFileURL(resolve('supabase/functions/_shared/menu-sync.mjs')).href);
  const handler=makeMenuHandler({rpc,privateKeyPem:key.privateKey.export({type:'pkcs8',format:'pem'}).toString()});
  const remote=new CloudMenuTransport({url:'https://owner-qa.invalid',publishableKey:'qa',publicKey:key.publicKey.export({type:'spki',format:'pem'}).toString(),keyId:'menu-v1'},f.claims,f.trust.device as any,async(url,init)=>handler(new Request(String(url),init)));
  const reportId=randomUUID(),shiftId=randomUUID(),orderId=randomUUID(),settlementId=randomUUID(),refundId=randomUUID(),employeeId=randomUUID();
  const snapshot={branchId:f.claims.branchId,shiftId,reportId,status:'CLOSED',closedAt:Date.now()};
  const report={commandId:reportId,reportId,shiftId,hash:digest(canonical(snapshot)),snapshot};
  expect(await remote.call('shiftReport',report)).toMatchObject({state:'APPLIED',reportId});
  expect(await remote.call('shiftReport',report)).toMatchObject({state:'APPLIED',reportId});
  const saleRecord={settlementId,orderId,shiftId,settledAt:Date.now(),snapshot:{type:'COUNTER',total:18000,lines:[]}};
  expect(await remote.call('saleRecord',{commandId:settlementId,hash:digest(canonical(saleRecord)),record:saleRecord})).toMatchObject({state:'APPLIED',settlementId});
  const refundRecord={refundId,orderId,shiftId,createdAt:Date.now(),amount:18000};
  expect(await remote.call('refundRecord',{commandId:refundId,hash:digest(canonical(refundRecord)),record:refundRecord})).toMatchObject({state:'APPLIED',refundId});
  const staffRecord={shiftId,employeeId,name:'Официант',role:'WAITER',openedTables:1,attributedNetTyiyn:'18000'};
  expect(await remote.call('staffRecord',{commandId:randomUUID(),hash:digest(canonical(staffRecord)),record:staffRecord})).toMatchObject({state:'APPLIED',shiftId,employeeId});
  expect((await db.query<{n:number}>('select count(*) n from owner_shift_reports')).rows[0].n).toBe(1);
  expect((await db.query<{n:number}>('select count(*) n from owner_report_notifications')).rows[0].n).toBe(1);
  expect((await db.query<{n:number}>('select count(*) n from owner_journal_records')).rows[0].n).toBe(2);
  expect((await db.query<{n:number}>('select count(*) n from owner_staff_snapshots')).rows[0].n).toBe(1);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.claims.ownerCloudId]);await db.exec('set role authenticated');
  try{
   const reports=(await db.query<{r:any}>('select public.owner_shift_reports_list($1,null,p_limit=>20) r',[f.claims.organizationId])).rows[0].r;
   const journal=(await db.query<{r:any}>('select public.owner_journal_list($1,null,p_limit=>30) r',[f.claims.organizationId])).rows[0].r;
   const staff=(await db.query<{r:any}>('select public.owner_staff_by_shift($1,$2) r',[f.claims.organizationId,shiftId])).rows[0].r;
   expect(reports).toHaveLength(1);expect(journal).toHaveLength(2);expect(staff).toHaveLength(1);
   await expect(db.query('select * from public.owner_shift_reports')).rejects.toThrow(/permission denied/);
   await db.exec('reset role');
   for(let n=1;n<=3;n++)await db.query('insert into public.owner_shift_reports(branch_id,report_id,shift_id,snapshot,content_hash,closed_at) values($1,$2,$3,$4,$5,$6)',[f.claims.branchId,`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,randomUUID(),JSON.stringify({}), '0'.repeat(64),'2027-01-01T00:00:00Z']);
   await db.exec('set role authenticated');
   const first=(await db.query<{r:any}>('select public.owner_shift_reports_list($1,null,null,null,2) r',[f.claims.organizationId])).rows[0].r;
   const second=(await db.query<{r:any}>('select public.owner_shift_reports_list($1,null,$2,$3,2) r',[f.claims.organizationId,first.at(-1).closedAt,first.at(-1).reportId])).rows[0].r;
   expect(first).toHaveLength(2);expect(second).toHaveLength(2);
   expect(new Set([...first,...second].map(row=>row.reportId)).size).toBe(4);
  }finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}
 }finally{f.close();await db.close();}
},30000);
