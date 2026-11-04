import { beforeAll,afterAll,it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
let db:PGlite;const admin=randomUUID(),owner=randomUUID(),otherAdmin=randomUUID();
beforeAll(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
await db.exec(readFileSync('supabase/migrations/20261021000100_activation_registry.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20261022000100_platform_admin.sql','utf8'));
for(const [id,email]of [[admin,'admin@test.invalid'],[owner,'owner@test.invalid'],[otherAdmin,'admin2@test.invalid']])await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);await db.query('insert into public.platform_admins(user_id) values($1),($2)',[admin,otherAdmin]);},20000);
afterAll(async()=>{await db?.close();});
async function call(name:string,args:unknown[],actor=admin){await db.exec('set role service_role');try{return (await db.query<{result:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;}finally{await db.exec('reset role');}}
const payload=(email:string)=>({email,name:'Owner name',organization:'New organization',branches:['Central','Second']});
async function prepare(email:string,command=randomUUID(),actor=admin){return call('platform_admin_prepare',[actor,command,payload(email),'a'.repeat(64)]);}
async function authReady(request:any,email:string){await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)",[request.ownerId,email,{bashkar_provisioning:request.commandId}]);}
it('requires server service role and enabled admin, with no self-promotion or new Owner privileges',async()=>{
for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await expect(db.query('select * from public.platform_admins')).rejects.toThrow(/permission denied/);await expect(db.query('select public.platform_admin_assert($1)',[admin])).rejects.toThrow(/permission denied/);await expect(db.query('insert into public.platform_admins(user_id) values($1)',[owner])).rejects.toThrow(/permission denied/);}finally{await db.exec('reset role');}}
await expect(call('platform_admin_snapshot',[owner,0])).rejects.toThrow('PLATFORM_ADMIN_REQUIRED');
});
it('reserves a durable Auth UUID, conflicts on changed payload/proof/actor, rejects existing email and does not duplicate replay',async()=>{
const command=randomUUID(),email='new1@test.invalid',first=await prepare(email,command);expect(await prepare(email,command)).toEqual(first);expect(first.ownerId).toMatch(/^[a-f0-9-]{36}$/);
await expect(call('platform_admin_prepare',[admin,command,payload(email),'b'.repeat(64)])).rejects.toThrow('ADMIN_COMMAND_CONFLICT');await expect(prepare(email,command,otherAdmin)).rejects.toThrow('ADMIN_COMMAND_CONFLICT');await expect(prepare(email)).rejects.toThrow('OWNER_EMAIL_IN_USE');await expect(prepare('owner@test.invalid')).rejects.toThrow('OWNER_EMAIL_IN_USE');
});
it('commits organization/branches/audit/result atomically and preserves original Owner RLS',async()=>{
const command=randomUUID(),email='new2@test.invalid',job=await prepare(email,command);await expect(call('platform_admin_finish',[admin,command])).rejects.toThrow('OWNER_AUTH_NOT_READY');await authReady(job,email);const result=await call('platform_admin_finish',[admin,command]);expect(result.branches).toHaveLength(2);expect(await call('platform_admin_finish',[admin,command])).toEqual(result);
expect((await db.query('select * from public.platform_admin_audit where command_id=$1',[command])).rows).toHaveLength(1);
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[job.ownerId]);await db.exec('set role authenticated');try{expect((await db.query('select * from public.organizations')).rows).toHaveLength(1);expect((await db.query('select * from public.branches')).rows).toHaveLength(2);await expect(db.query("insert into public.branches(organization_id,name) values($1,'Unauthorized')",[result.organizationId])).rejects.toThrow(/permission denied/);}finally{await db.exec('reset role');}
});
it('audit failure leaves a resumable prepared job and Auth identity, without partial organization or branch records',async()=>{
const command=randomUUID(),email='new3@test.invalid',job=await prepare(email,command);await authReady(job,email);await db.exec("create function public.test_admin_fail() returns trigger language plpgsql as $$begin raise exception 'AUDIT_TEST';end;$$;create trigger test_admin_fail before insert on public.platform_admin_audit for each row execute function public.test_admin_fail();");
try{await expect(call('platform_admin_finish',[admin,command])).rejects.toThrow('AUDIT_TEST');}finally{await db.exec('drop trigger test_admin_fail on public.platform_admin_audit;drop function public.test_admin_fail();');}
expect((await db.query('select * from public.organizations where owner_id=$1',[job.ownerId])).rows).toHaveLength(0);expect((await db.query('select status from public.platform_admin_requests where command_id=$1',[command])).rows[0]).toEqual({status:'PREPARED'});expect((await db.query('select id from auth.users where id=$1',[job.ownerId])).rows).toHaveLength(1);expect((await call('platform_admin_finish',[admin,command])).branches).toHaveLength(2);
});
it('adds a branch with replay and scoped audit, rejects duplicate names and revoked admin',async()=>{
const snapshot=await call('platform_admin_snapshot',[admin,0]),org=snapshot.organizations[0],command=randomUUID();const first=await call('platform_admin_add_branch',[admin,command,org.id,'Third']);expect(await call('platform_admin_add_branch',[admin,command,org.id,'Third'])).toEqual(first);await expect(call('platform_admin_add_branch',[admin,command,org.id,'Changed'])).rejects.toThrow('ADMIN_COMMAND_CONFLICT');await expect(call('platform_admin_add_branch',[admin,randomUUID(),org.id,' third '])).rejects.toThrow('BRANCH_NAME_USED');
await db.query('update public.platform_admins set enabled=false where user_id=$1',[otherAdmin]);await expect(call('platform_admin_snapshot',[otherAdmin,0])).rejects.toThrow('PLATFORM_ADMIN_REQUIRED');
});
it('rejects duplicate first branches and bounds administrative request budgets',async()=>{
await expect(call('platform_admin_prepare',[admin,randomUUID(),{...payload('bad@test.invalid'),branches:['Same','same']},'a'.repeat(64)])).rejects.toThrow('INVALID_BRANCHES');
await db.query('update public.platform_admin_limits set count=10,window_at=now() where actor_id=$1',[admin]);await expect(prepare('budget@test.invalid')).rejects.toThrow('ADMIN_RATE_LIMITED');expect((await call('platform_admin_snapshot',[admin,0])).organizations.length).toBeGreaterThan(0);
});
