-- Additive cloud administration. Existing Owner RLS and activation stay intact.
create table public.platform_admins (
 user_id uuid primary key references auth.users(id) on delete restrict,
 enabled boolean not null default true, created_at timestamptz not null default now()
);
create table public.platform_admin_requests (
 command_id uuid primary key, actor_id uuid not null references auth.users(id),
 type text not null check(type in ('CREATE_OWNER','ADD_BRANCH')),
 payload jsonb not null, credential_proof text,
 owner_user_id uuid, owner_email text,
 status text not null default 'PREPARED' check(status in ('PREPARED','DONE')),
 result jsonb, created_at timestamptz not null default now(),
 check((status='DONE')=(result is not null)),
 check(type!='CREATE_OWNER' or (owner_user_id is not null and owner_email is not null and credential_proof is not null and credential_proof ~ '^[0-9a-f]{64}$'))
);
create unique index platform_request_email on public.platform_admin_requests(owner_email) where type='CREATE_OWNER';
create table public.platform_admin_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
 command_id uuid not null unique references public.platform_admin_requests(command_id),
 action text not null check(action in ('owner.provisioned','branch.created')),
 target_id uuid not null, details jsonb not null, created_at timestamptz not null default now()
);
create table public.platform_admin_limits (actor_id uuid primary key references auth.users(id), window_at timestamptz not null, count integer not null);
alter table public.platform_admins enable row level security;
alter table public.platform_admin_requests enable row level security;
alter table public.platform_admin_audit enable row level security;
alter table public.platform_admin_limits enable row level security;
revoke all on public.platform_admins,public.platform_admin_requests,public.platform_admin_audit,public.platform_admin_limits from public,anon,authenticated;
grant all on public.platform_admins,public.platform_admin_requests,public.platform_admin_audit,public.platform_admin_limits to service_role;

create function public.platform_admin_assert(p_actor uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor and enabled) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
end; $$;
create function public.platform_admin_budget(p_actor uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform public.platform_admin_assert(p_actor);
 insert into public.platform_admin_limits values(p_actor,now(),1) on conflict(actor_id) do update set
 count=case when platform_admin_limits.window_at < now()-interval '1 minute' then 1 else platform_admin_limits.count+1 end,
 window_at=case when platform_admin_limits.window_at < now()-interval '1 minute' then now() else platform_admin_limits.window_at end;
 if (select count from public.platform_admin_limits where actor_id=p_actor)>10 then raise exception 'ADMIN_RATE_LIMITED'; end if;
end; $$;
create function public.platform_admin_prepare(p_actor uuid,p_command uuid,p_payload jsonb,p_proof text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.platform_admin_requests%rowtype; v_email text; v_names text[];
begin
 perform public.platform_admin_budget(p_actor);
 if p_command is null or p_payload is null or jsonb_typeof(p_payload)!='object' or p_proof is null or p_proof !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_PROVISIONING'; end if;
 if (select count(*) from jsonb_object_keys(p_payload))!=4 or not(p_payload ?& array['email','name','organization','branches']) then raise exception 'INVALID_PROVISIONING'; end if;
 v_email:=p_payload->>'email';
 if v_email is null or v_email!=lower(btrim(v_email)) or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or coalesce(length(btrim(p_payload->>'name')),0) not between 1 and 200 or coalesce(length(btrim(p_payload->>'organization')),0) not between 1 and 200
 or jsonb_typeof(p_payload->'branches')!='array' or jsonb_array_length(p_payload->'branches') not between 1 and 20 then raise exception 'INVALID_PROVISIONING'; end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'branches') e where jsonb_typeof(e)!='string') then raise exception 'INVALID_BRANCHES'; end if;
 select array_agg(btrim(value)) into v_names from jsonb_array_elements_text(p_payload->'branches');
 if exists(select 1 from unnest(v_names) n where length(n) not between 1 and 200) or cardinality(v_names)!=(select count(distinct lower(n)) from unnest(v_names) n) then raise exception 'INVALID_BRANCHES'; end if;
 select * into v from public.platform_admin_requests where command_id=p_command for update;
 if found then
 if v.actor_id!=p_actor or v.type!='CREATE_OWNER' or v.payload!=p_payload or v.credential_proof!=p_proof then raise exception 'ADMIN_COMMAND_CONFLICT'; end if;
 else
 if exists(select 1 from auth.users where lower(email)=v_email) then raise exception 'OWNER_EMAIL_IN_USE'; end if;
 begin
 insert into public.platform_admin_requests(command_id,actor_id,type,payload,credential_proof,owner_user_id,owner_email)
 values(p_command,p_actor,'CREATE_OWNER',p_payload,p_proof,gen_random_uuid(),v_email) returning * into v;
 exception when unique_violation then raise exception 'OWNER_EMAIL_IN_USE'; end;
 end if;
 return jsonb_build_object('commandId',v.command_id,'ownerId',v.owner_user_id,'status',v.status,'result',v.result);
end; $$;
create function public.platform_admin_finish(p_actor uuid,p_command uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.platform_admin_requests%rowtype; v_org uuid:=gen_random_uuid(); v_branch uuid; v_branches jsonb:='[]'::jsonb; v_name text; v_result jsonb;
begin
 perform public.platform_admin_assert(p_actor);
 select * into v from public.platform_admin_requests where command_id=p_command for update;
 if not found or v.actor_id!=p_actor or v.type!='CREATE_OWNER' then raise exception 'ADMIN_COMMAND_NOT_FOUND'; end if;
 if v.status='DONE' then return v.result; end if;
 if not exists(select 1 from auth.users where id=v.owner_user_id and lower(email)=v.owner_email and email_confirmed_at is not null and raw_app_meta_data->>'bashkar_provisioning'=p_command::text) then raise exception 'OWNER_AUTH_NOT_READY'; end if;
 insert into public.organizations(id,owner_id,name) values(v_org,v.owner_user_id,v.payload->>'organization');
 for v_name in select jsonb_array_elements_text(v.payload->'branches') loop
 v_branch:=gen_random_uuid();insert into public.branches(id,organization_id,name) values(v_branch,v_org,btrim(v_name));
 v_branches:=v_branches||jsonb_build_array(jsonb_build_object('id',v_branch,'name',btrim(v_name)));
 end loop;
 v_result:=jsonb_build_object('commandId',p_command,'ownerId',v.owner_user_id,'email',v.owner_email,'organizationId',v_org,'organization',v.payload->>'organization','branches',v_branches);
 update public.platform_admin_requests set status='DONE',result=v_result where command_id=p_command;
 insert into public.platform_admin_audit(actor_id,command_id,action,target_id,details) values(p_actor,p_command,'owner.provisioned',v_org,jsonb_build_object('ownerId',v.owner_user_id,'branchCount',jsonb_array_length(v_branches)));
 return v_result;
end; $$;
create function public.platform_admin_add_branch(p_actor uuid,p_command uuid,p_organization uuid,p_name text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.platform_admin_requests%rowtype; v_branch uuid:=gen_random_uuid(); v_payload jsonb; v_result jsonb;
begin
 perform public.platform_admin_budget(p_actor);
 if p_command is null or p_organization is null or p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'INVALID_BRANCH'; end if;
 v_payload:=jsonb_build_object('organizationId',p_organization,'name',btrim(p_name));
 -- One writer per organization; duplicate name and request replay are serialized.
 perform 1 from public.organizations where id=p_organization for update;
 if not found then raise exception 'ORGANIZATION_NOT_FOUND'; end if;
 select * into v from public.platform_admin_requests where command_id=p_command for update;
 if found then
 if v.actor_id!=p_actor or v.type!='ADD_BRANCH' or v.payload!=v_payload then raise exception 'ADMIN_COMMAND_CONFLICT'; end if;
 return v.result;
 end if;
 if exists(select 1 from public.branches where organization_id=p_organization and lower(btrim(name))=lower(btrim(p_name))) then raise exception 'BRANCH_NAME_USED'; end if;
 insert into public.branches(id,organization_id,name) values(v_branch,p_organization,btrim(p_name));
 v_result:=jsonb_build_object('commandId',p_command,'branchId',v_branch,'organizationId',p_organization,'name',btrim(p_name));
 insert into public.platform_admin_requests(command_id,actor_id,type,payload,status,result) values(p_command,p_actor,'ADD_BRANCH',v_payload,'DONE',v_result);
 insert into public.platform_admin_audit(actor_id,command_id,action,target_id,details) values(p_actor,p_command,'branch.created',v_branch,jsonb_build_object('organizationId',p_organization));
 return v_result;
end; $$;
create function public.platform_admin_snapshot(p_actor uuid,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_orgs jsonb; v_pending jsonb;
begin
 perform public.platform_admin_assert(p_actor);
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'INVALID_PAGE'; end if;
 select coalesce(jsonb_agg(x.data order by x.created_at desc,x.id),'[]'::jsonb) into v_orgs from (
 select o.id,o.created_at,jsonb_build_object('id',o.id,'name',o.name,'ownerId',o.owner_id,'email',u.email,'ownerName',u.raw_user_meta_data->>'name','createdAt',o.created_at,
 'branches',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'activated',exists(select 1 from public.server_registrations r where r.branch_id=b.id and r.status='ACTIVE')) order by b.created_at,b.id),'[]'::jsonb) from public.branches b where b.organization_id=o.id)) data
 from public.organizations o join auth.users u on u.id=o.owner_id order by o.created_at desc,o.id offset p_offset limit 50) x;
 select coalesce(jsonb_agg(jsonb_build_object('commandId',command_id,'payload',payload,'createdAt',created_at) order by created_at desc),'[]'::jsonb) into v_pending
 from (select * from public.platform_admin_requests where actor_id=p_actor and status='PREPARED' order by created_at desc limit 50) p;
 return jsonb_build_object('organizations',v_orgs,'pending',v_pending,'offset',p_offset,'hasMore',exists(select 1 from public.organizations offset (p_offset+50) limit 1));
end; $$;
-- No authenticated-role RPC entrypoint: Edge must verify Auth and supply actor.
revoke all on function public.platform_admin_assert(uuid),public.platform_admin_budget(uuid),public.platform_admin_prepare(uuid,uuid,jsonb,text),public.platform_admin_finish(uuid,uuid),public.platform_admin_add_branch(uuid,uuid,uuid,text),public.platform_admin_snapshot(uuid,integer) from public,anon,authenticated;
grant execute on function public.platform_admin_assert(uuid),public.platform_admin_budget(uuid),public.platform_admin_prepare(uuid,uuid,jsonb,text),public.platform_admin_finish(uuid,uuid),public.platform_admin_add_branch(uuid,uuid,uuid,text),public.platform_admin_snapshot(uuid,integer) to service_role;
