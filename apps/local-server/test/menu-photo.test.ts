import {afterAll,beforeAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {digest} from '../src/command-bus';
import {fixture,catalog} from './fixtures/operations';
import {createServer} from '../src/server';

let db:PGlite,makePhotoHandler:any;
const ids={owner:randomUUID(),organization:randomUUID(),branch:randomUUID(),registration:randomUUID(),instance:randomUUID(),actor:randomUUID(),version:randomUUID()};
const key=generateKeyPairSync('ed25519');
const publicKey=key.publicKey.export({type:'spki',format:'pem'}).toString();
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/cN8AAAAASUVORK5CYII=','base64'));
beforeAll(async()=>{
 db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
 for(const name of ['20261021000100_activation_registry.sql','20261024000100_menu_sync.sql','20261101000100_menu_description_translations.sql','20261101000200_menu_photos.sql','20261101000500_public_menu_design.sql','20261102000100_public_menu_templates.sql','20261102000200_public_menu_visibility.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
 await db.query('insert into auth.users(id) values($1)',[ids.owner]);
 await db.query("insert into organizations(id,owner_id,name) values($1,$2,'QA')",[ids.organization,ids.owner]);
 await db.query("insert into branches(id,organization_id,name) values($1,$2,'QA')",[ids.branch,ids.organization]);
 await db.query("insert into server_registrations(id,branch_id,owner_id,instance_id,device_public_key_hash,nonce,issued_at,expires_at) values($1,$2,$3,$4,$5,$6,1,9999999999999)",[ids.registration,ids.branch,ids.owner,ids.instance,digest(publicKey),'q'.repeat(43)]);
 await db.query("insert into menu_cloud_versions(id,branch_id,registration_id,content_hash,catalog_schema,document,author,origin,local_revision,published_at) values($1,$2,$3,$4,1,$5,$6,'LOCAL_POS',1,1)",[ids.version,ids.branch,ids.registration,'0'.repeat(64),JSON.stringify({items:[{id:'soup',archived:false}],categories:[{id:'hot',archived:false}]}),JSON.stringify({type:'LOCAL_EMPLOYEE',id:ids.actor,name:'QA'})]);
 await db.query("insert into menu_device_acknowledgements(registration_id,branch_id,version_id,content_hash,local_revision) values($1,$2,$3,$4,1)",[ids.registration,ids.branch,ids.version,'0'.repeat(64)]);
 ({makePhotoHandler}=await import(/* @vite-ignore */pathToFileURL(resolve('supabase/functions/_shared/menu-photo.mjs')).href));
},20000);
afterAll(async()=>db?.close());
const rpc=async(name:string,args:Record<string,unknown>)=>{await db.exec('set role service_role');try{return (await db.query<{r:any}>(`select public.${name}(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) r`,Object.values(args))).rows[0].r;}finally{await db.exec('reset role');}};
const grant=(operation:'READ'|'UPLOAD'|'REMOVE',expectedRevision=0,itemId='soup')=>{const payload={branchId:ids.branch,instanceId:ids.instance,registrationId:ids.registration,actorId:ids.actor,itemId,expectedRevision,operation,nonce:randomUUID(),expiresAt:Date.now()+60000};return Buffer.from(JSON.stringify({payload,publicKey,signature:sign(null,Buffer.from(JSON.stringify(payload)),key.privateKey).toString('base64url')})).toString('base64url');};
it('uploads through Cloud to Bunny and records only metadata with CAS',async()=>{
 const uploads:string[]=[],removed:string[]=[];const handler=makePhotoHandler({rpc,bunny:async(path:string,data:Uint8Array)=>{uploads.push(path);expect(data).toEqual(png);return true;},remove:async(path:string)=>{removed.push(path);},authUser:async()=>null,config:{zone:'qa-zone',endpoint:'https://storage.bunnycdn.com',accessKey:'test-secret',cdnOrigin:'https://qa.b-cdn.net'}});
 let response=await handler(new Request('https://qa.invalid/menu-photo',{headers:{'x-photo-grant':grant('READ')}}));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({itemRevision:0,url:null});
 response=await handler(new Request('https://qa.invalid/menu-photo',{method:'POST',headers:{'x-photo-grant':grant('UPLOAD'),'content-type':'image/png'},body:png}));expect(response.status).toBe(200);const uploaded=await response.json();expect(uploaded).toMatchObject({itemRevision:1,photoRevision:1,itemId:'soup'});expect(uploaded.url).toMatch(/^https:\/\/qa\.b-cdn\.net\/menu\//);expect(uploads).toHaveLength(1);
 response=await handler(new Request('https://qa.invalid/menu-photo',{headers:{'x-photo-grant':grant('READ')}}));expect((await response.json()).url).toBe(uploaded.url);
 response=await handler(new Request('https://qa.invalid/menu-photo',{method:'POST',headers:{'x-photo-grant':grant('UPLOAD',0),'content-type':'image/png'},body:png}));expect((await response.json()).code).toBe('PHOTO_REVISION_CONFLICT');expect(removed).toEqual([uploads[1]]);
 expect((await rpc('menu_photo_current',{p_branch:ids.branch,p_item:'soup'})).itemRevision).toBe(1);
 response=await handler(new Request('https://qa.invalid/menu-photo',{method:'DELETE',headers:{'x-photo-grant':grant('REMOVE',1)}}));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({itemRevision:2,photoRevision:2,url:null});
 expect((await rpc('menu_photo_current',{p_branch:ids.branch,p_item:'soup'})).objectKey).toBeNull();
 const history=await db.query<{revision:number;asset_id:string|null}>('select revision,asset_id from menu_item_photo_revisions where branch_id=$1 and item_id=$2 order by revision',[ids.branch,'soup']);expect(history.rows).toHaveLength(2);expect(history.rows[0].asset_id).not.toBeNull();expect(history.rows[1].asset_id).toBeNull();
});
it('accepts reserved logo and banner media slots for the branch',async()=>{
 const handler=makePhotoHandler({rpc,bunny:async()=>true,authUser:async()=>null,config:{zone:'qa-zone',endpoint:'https://storage.bunnycdn.com',accessKey:'test-secret',cdnOrigin:'https://qa.b-cdn.net'}});
 const response=await handler(new Request('https://qa.invalid/menu-photo',{method:'POST',headers:{'x-photo-grant':grant('UPLOAD',0,'public_logo'),'content-type':'image/png'},body:png}));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({itemId:'public_logo',itemRevision:1});
 expect((await rpc('menu_photo_current',{p_branch:ids.branch,p_item:'public_logo'})).objectKey).toMatch(/^menu\//);
 const category=await handler(new Request('https://qa.invalid/menu-photo',{method:'POST',headers:{'x-photo-grant':grant('UPLOAD',0,'public_cat_hot'),'content-type':'image/png'},body:png}));expect(category.status).toBe(200);expect(await category.json()).toMatchObject({itemId:'public_cat_hot',itemRevision:1});
 const unknown=await handler(new Request('https://qa.invalid/menu-photo',{method:'POST',headers:{'x-photo-grant':grant('UPLOAD',0,'public_cat_unknown'),'content-type':'image/png'},body:png}));expect((await unknown.json()).code).toBe('PHOTO_ITEM_UNPUBLISHED');
});
it('rejects replay and non-image data before Bunny',async()=>{
 let uploads=0;const handler=makePhotoHandler({rpc,bunny:async()=>{uploads++;return true;},authUser:async()=>null,config:{zone:'qa-zone',endpoint:'https://storage.bunnycdn.com',accessKey:'test-secret',cdnOrigin:'https://qa.b-cdn.net'}});
 const proof=grant('READ');expect((await handler(new Request('https://qa.invalid',{headers:{'x-photo-grant':proof}}))).status).toBe(200);
 expect((await handler(new Request('https://qa.invalid',{headers:{'x-photo-grant':proof}}))).status).not.toBe(200);
 const response=await handler(new Request('https://qa.invalid',{method:'POST',headers:{'x-photo-grant':grant('UPLOAD',1),'content-type':'image/png'},body:new Uint8Array([1,2,3])}));expect((await response.json()).code).toBe('PHOTO_INVALID_IMAGE');expect(uploads).toBe(0);
});
it('allows only the verified Cloud owner origin and branch for remote photo reads',async()=>{
 const handler=makePhotoHandler({rpc,bunny:async()=>true,authUser:async()=>({id:ids.owner,email_confirmed_at:'2026-11-01T00:00:00Z',is_anonymous:false}),config:{zone:'qa-zone',endpoint:'https://storage.bunnycdn.com',accessKey:'test-secret',cdnOrigin:'https://qa.b-cdn.net',ownerOrigin:'https://owner.example'}});
 const headers={authorization:'Bearer qa-token','x-branch-id':ids.branch,'x-item-id':'soup',origin:'https://owner.example'};
 const allowed=await handler(new Request('https://qa.invalid',{headers}));expect(allowed.status).toBe(200);expect(allowed.headers.get('access-control-allow-origin')).toBe('https://owner.example');
 expect((await handler(new Request('https://qa.invalid',{headers:{...headers,origin:'https://other.example'}}))).status).toBe(403);
 expect((await handler(new Request('https://qa.invalid',{headers:{...headers,'x-branch-id':randomUUID()}}))).status).toBe(403);
 const upload=await handler(new Request('https://qa.invalid',{method:'POST',headers:{...headers,'x-expected-revision':'2','content-type':'image/png'},body:png}));expect(upload.status).toBe(200);expect(await upload.json()).toMatchObject({itemRevision:3,itemId:'soup'});
});
it('issues a scoped Desktop grant only to menu editors for published items',async()=>{
 const f=await fixture();try{
  const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});
  await f.menu.publish(f.token,randomUUID(),draft);
  const actor=f.auth.current(f.token),actorRevision=f.auth.employee(actor.id).revision;f.storage.close();
  const app=await createServer(f.dir,0,false,{...f.trust,cloud:{url:'https://qa.supabase.co',publishableKey:'sb_publishable_qa'}});
  try{
   const request=(itemId:string)=>app.inject({method:'POST',url:'/api/v1/menu/photo/grant',headers:{host:'127.0.0.1',authorization:'Bearer '+f.token,'content-type':'application/json'},payload:{itemId,expectedRevision:0,operation:'UPLOAD'}});
   const issued=await request('coffee');expect(issued.statusCode).toBe(200);
   const response=issued.json();expect(response.mediaUrl).toBe('https://qa.supabase.co/functions/v1/menu-photo');expect(response.publishableKey).toBe('sb_publishable_qa');
   const grant=JSON.parse(Buffer.from(response.grant,'base64url').toString('utf8'));expect(grant.payload).toMatchObject({branchId:f.claims.branchId,itemId:'coffee',operation:'UPLOAD',expectedRevision:0});
   expect((await request('unknown')).statusCode).toBe(409);
   const closed=await app.inject({method:'POST',url:'/api/v1/employees/permission',headers:{host:'127.0.0.1',authorization:'Bearer '+f.token,'content-type':'application/json'},payload:{commandId:randomUUID(),employeeId:actor.id,revision:actorRevision,permission:'menu.edit',allowed:false}});expect(closed.statusCode).toBe(423);expect(closed.json().error.code).toBe('PERMISSION_EDITING_CLOSED');
   expect((await request('coffee')).statusCode).toBe(200);expect((await request('public_logo')).statusCode).toBe(200);expect((await request('public_cat_'+catalog().categories[0].id)).statusCode).toBe(200);
  }finally{await app.close();}
 }finally{f.close();}
});

it('denies a menu photo grant after the editor permission is revoked internally',async()=>{
 const f=await fixture();try{
  const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});await f.menu.publish(f.token,randomUUID(),draft);
  const actor=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:actor.id,revision:actor.employee.revision,permission:'menu.edit',allowed:false});
  f.storage.close();const app=await createServer(f.dir,0,false,{...f.trust,cloud:{url:'https://qa.supabase.co',publishableKey:'sb_publishable_qa'}});
  try{
   const request=(itemId:string)=>app.inject({method:'POST',url:'/api/v1/menu/photo/grant',headers:{host:'127.0.0.1',authorization:'Bearer '+f.token,'content-type':'application/json'},payload:{itemId,expectedRevision:0,operation:'UPLOAD'}});
   expect((await request('coffee')).statusCode).toBe(403);
   expect((await request('public_logo')).statusCode).toBe(200);
  }finally{await app.close();}
 }finally{f.close();}
});
