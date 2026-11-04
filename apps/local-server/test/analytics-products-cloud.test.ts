import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonical,digest} from '../src/command-bus';
const {validateAnalyticsBatch}=require('../../../supabase/functions/_shared/analytics-sync.mjs') as {validateAnalyticsBatch:(body:unknown)=>void};

it('accepts signed product facts and installs the cloud product ledger',async()=>{
 const entry={kind:'PRODUCT',id:randomUUID(),orderId:randomUUID(),occurredAt:Date.now(),amount:'0',discount:'0',method:null,serviceType:null,productId:'plov',productName:'Плов',categoryId:'hot',categoryName:'Горячие блюда',quantity:2};
 const fact={...entry,hash:digest(canonical(entry))};
 expect(()=>validateAnalyticsBatch({commandId:randomUUID(),backfillComplete:true,facts:[fact]})).not.toThrow();
 expect(()=>validateAnalyticsBatch({commandId:randomUUID(),backfillComplete:true,facts:[{...fact,quantity:-1}]})).toThrow('INVALID_ANALYTICS_BATCH');
 const db=new PGlite();try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
  for(const file of ['20261021000100_activation_registry.sql','20261024000100_menu_sync.sql','20261103000100_analytics_overview.sql','20261103000200_analytics_products.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  expect((await db.query<{name:string}>("select to_regclass('public.analytics_product_facts') name")).rows[0].name).toBe('analytics_product_facts');
 }finally{await db.close();}
});
