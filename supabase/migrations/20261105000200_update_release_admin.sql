-- Administrative metadata staging. No RPC here can validate or publish an EXE.
create table public.platform_release_publishers (
 user_id uuid primary key references public.platform_admins(user_id) on delete restrict,
 enabled boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.platform_release_publishers enable row level security;
revoke all on public.platform_release_publishers from public,anon,authenticated;
grant all on public.platform_release_publishers to service_role;
create function public.platform_release_assert(p_actor uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform public.platform_admin_assert(p_actor);
 if not exists(select 1 from public.platform_release_publishers where user_id=p_actor and enabled) then
  raise exception using message='RELEASE_PUBLISHER_REQUIRED',errcode='P0001';
 end if;
end;$$;
revoke all on function public.platform_release_assert(uuid) from public,anon,authenticated;
grant execute on function public.platform_release_assert(uuid) to service_role;
alter table public.update_releases
 add column source_commit text check (source_commit ~ '^[0-9a-f]{40}$'),
 add column notes text check (char_length(notes) <= 4000),
 add column created_by uuid references auth.users(id) on delete restrict,
 add column storage_path text,
 add column artifact_size_bytes bigint check (artifact_size_bytes > 0),
 add column validated_at timestamptz,
 add column published_at timestamptz;
create table public.update_release_admin_events (
 id uuid primary key default gen_random_uuid(),
 release_id text not null references public.update_releases(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 action text not null check (action in ('DRAFT_CREATED','PAUSED','WITHDRAWN')),
 previous_status text,
 new_status text not null,
 created_at timestamptz not null default now()
);
alter table public.update_release_admin_events enable row level security;
revoke all on public.update_release_admin_events from public,anon,authenticated;
grant all on public.update_release_admin_events to service_role;

create function public.update_admin_create_draft(
 p_actor uuid,p_release text,p_version text,p_channel text,p_source_commit text,
 p_manifest_hash text,p_artifact_hash text,p_notes text,p_targets uuid[]
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_target uuid;v_count integer;
begin
 perform public.platform_release_assert(p_actor);
 perform public.platform_admin_budget(p_actor);
 if p_release is null or p_release !~ '^[a-z0-9_-]{1,80}$' or p_version is null or p_version !~ '^[0-9]+\.[0-9]+\.[0-9]+$'
 or p_channel not in ('internal','stable') or p_source_commit is null or p_source_commit !~ '^[0-9a-f]{40}$'
 or p_manifest_hash is null or p_manifest_hash !~ '^[0-9a-f]{64}$' or p_artifact_hash is null or p_artifact_hash !~ '^[0-9a-f]{64}$'
 or p_notes is null or char_length(p_notes)>4000 or p_targets is null or cardinality(p_targets) not between 1 and 50 then
  raise exception using message='UPDATE_DRAFT_INVALID',errcode='P0001';
 end if;
 select count(distinct x) into v_count from unnest(p_targets) x;
 if v_count!=cardinality(p_targets) or exists(select 1 from unnest(p_targets) x where x is null) then
  raise exception using message='UPDATE_TARGETS_INVALID',errcode='P0001';
 end if;
 if (select count(*) from public.branches where id=any(p_targets))!=v_count then
  raise exception using message='UPDATE_TARGETS_INVALID',errcode='P0001';
 end if;
 begin
  insert into public.update_releases(id,version,channel,manifest_sha256,artifact_sha256,status,source_commit,notes,created_by)
   values(p_release,p_version,p_channel,p_manifest_hash,p_artifact_hash,'DRAFT',p_source_commit,p_notes,p_actor);
 exception when unique_violation then
  raise exception using message='UPDATE_RELEASE_EXISTS',errcode='P0001';
 end;
 foreach v_target in array p_targets loop
  insert into public.update_release_targets(release_id,branch_id) values(p_release,v_target);
 end loop;
 insert into public.update_release_admin_events(release_id,actor_id,action,previous_status,new_status)
  values(p_release,p_actor,'DRAFT_CREATED',null,'DRAFT');
 return jsonb_build_object('releaseId',p_release,'status','DRAFT','targetCount',v_count);
end;$$;

create function public.update_admin_release_snapshot(p_actor uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform public.platform_release_assert(p_actor);
 return coalesce((select jsonb_agg(jsonb_build_object('releaseId',r.id,'version',r.version,'channel',r.channel,
  'status',r.status,'sourceCommit',r.source_commit,'manifestSha256',r.manifest_sha256,'artifactSha256',r.artifact_sha256,
  'notes',r.notes,'createdAt',r.created_at,'validatedAt',r.validated_at,'publishedAt',r.published_at,
  'targets',(select coalesce(jsonb_agg(t.branch_id order by t.branch_id),'[]'::jsonb) from public.update_release_targets t where t.release_id=r.id)) order by r.created_at desc,r.id)
  from (select * from public.update_releases order by created_at desc,id limit 50) r),'[]'::jsonb);
end;$$;

create function public.update_admin_branch_options(p_actor uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform public.platform_release_assert(p_actor);
 return coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'organization',o.name) order by o.name,b.name,b.id)
  from (select * from public.branches order by created_at,id limit 500) b join public.organizations o on o.id=b.organization_id),'[]'::jsonb);
end;$$;

create function public.update_admin_stop_release(p_actor uuid,p_release text,p_action text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.update_releases%rowtype;v_new text;
begin
 perform public.platform_release_assert(p_actor);
 perform public.platform_admin_budget(p_actor);
 if p_action not in ('PAUSE','WITHDRAW') or p_release is null then raise exception using message='UPDATE_ACTION_INVALID',errcode='P0001'; end if;
 select * into v from public.update_releases where id=p_release for update;
 if not found then raise exception using message='UPDATE_RELEASE_NOT_FOUND',errcode='P0001'; end if;
 if p_action='PAUSE' and v.status not in ('PUBLISHED','PAUSED') then raise exception using message='UPDATE_RELEASE_STATE_INVALID',errcode='P0001'; end if;
 if p_action='WITHDRAW' and v.status='WITHDRAWN' then return jsonb_build_object('releaseId',p_release,'status','WITHDRAWN'); end if;
 v_new:=case when p_action='PAUSE' then 'PAUSED' else 'WITHDRAWN' end;
 if v.status=v_new then return jsonb_build_object('releaseId',p_release,'status',v_new); end if;
 update public.update_releases set status=v_new where id=p_release;
 insert into public.update_release_admin_events(release_id,actor_id,action,previous_status,new_status)
  values(p_release,p_actor,case when p_action='PAUSE' then 'PAUSED' else 'WITHDRAWN' end,v.status,v_new);
 return jsonb_build_object('releaseId',p_release,'status',v_new);
end;$$;
revoke all on function public.update_admin_create_draft(uuid,text,text,text,text,text,text,text,uuid[]),public.update_admin_release_snapshot(uuid),public.update_admin_branch_options(uuid),public.update_admin_stop_release(uuid,text,text) from public,anon,authenticated;
grant execute on function public.update_admin_create_draft(uuid,text,text,text,text,text,text,text,uuid[]),public.update_admin_release_snapshot(uuid),public.update_admin_branch_options(uuid),public.update_admin_stop_release(uuid,text,text) to service_role;
