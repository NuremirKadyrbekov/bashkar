-- Server-only release eligibility and one-time install grants. Publication is
-- deliberately separate; no restaurant client can create or edit a release.
create table public.update_releases (
 id text primary key check (id ~ '^[a-z0-9_-]{1,80}$'),
 version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
 channel text not null check (channel in ('internal','stable')),
 manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
 artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
 status text not null default 'DRAFT' check (status in ('DRAFT','VALIDATED','PUBLISHED','PAUSED','WITHDRAWN')),
 created_at timestamptz not null default now()
);
create table public.update_release_targets (
 release_id text not null references public.update_releases(id) on delete restrict,
 branch_id uuid not null references public.branches(id) on delete restrict,
 primary key (release_id,branch_id)
);
create function public.update_release_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then
  if old.status in ('PUBLISHED','PAUSED','WITHDRAWN') then raise exception using message='UPDATE_RELEASE_IMMUTABLE',errcode='P0001'; end if;
  return old;
 end if;
 if old.status in ('PUBLISHED','PAUSED','WITHDRAWN') and
  (new.id,new.version,new.channel,new.manifest_sha256,new.artifact_sha256) is distinct from
  (old.id,old.version,old.channel,old.manifest_sha256,old.artifact_sha256) then
  raise exception using message='UPDATE_RELEASE_IMMUTABLE',errcode='P0001';
 end if;
 if old.status='WITHDRAWN' and new.status!='WITHDRAWN' then
  raise exception using message='UPDATE_RELEASE_WITHDRAWN',errcode='P0001';
 end if;
 return new;
end;$$;
create trigger update_release_immutable before update on public.update_releases for each row execute function public.update_release_immutable();
create trigger update_release_no_delete before delete on public.update_releases for each row execute function public.update_release_immutable();
revoke all on function public.update_release_immutable() from public,anon,authenticated;
create table public.update_install_grants (
 operation_id uuid primary key,
 release_id text not null references public.update_releases(id) on delete restrict,
 branch_id uuid not null references public.branches(id) on delete restrict,
 instance_id uuid not null,
 registration_id uuid not null references public.server_registrations(id) on delete restrict,
 owner_id uuid not null references auth.users(id) on delete restrict,
 actor_id uuid not null,
 device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
 nonce uuid not null,
 issued_at bigint not null,
 expires_at bigint not null check (expires_at > issued_at and expires_at - issued_at <= 300000),
 unique (registration_id,nonce)
);
create index update_grants_branch_created on public.update_install_grants(branch_id,issued_at desc);
alter table public.update_releases enable row level security;
alter table public.update_release_targets enable row level security;
alter table public.update_install_grants enable row level security;
revoke all on public.update_releases,public.update_release_targets,public.update_install_grants from public,anon,authenticated;
grant all on public.update_releases,public.update_release_targets,public.update_install_grants to service_role;

create function public.update_issue_install_grant(
 p_owner uuid,p_registration uuid,p_branch uuid,p_instance uuid,p_device_hash text,
 p_actor uuid,p_operation uuid,p_release text,p_manifest_hash text,p_artifact_hash text,p_nonce uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_registration public.server_registrations%rowtype;v_release public.update_releases%rowtype;
 v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 if p_owner is null or p_registration is null or p_branch is null or p_instance is null or p_actor is null or p_operation is null or p_nonce is null
 or p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' or p_manifest_hash is null or p_manifest_hash !~ '^[0-9a-f]{64}$'
 or p_artifact_hash is null or p_artifact_hash !~ '^[0-9a-f]{64}$' or p_release is null or p_release !~ '^[a-z0-9_-]{1,80}$' then
  raise exception using message='UPDATE_REQUEST_INVALID',errcode='P0001';
 end if;
 select * into v_registration from public.server_registrations where id=p_registration for update;
 if not found or v_registration.status!='ACTIVE' or v_registration.branch_id!=p_branch or v_registration.instance_id!=p_instance
 or v_registration.owner_id!=p_owner or v_registration.device_public_key_hash!=p_device_hash then
  raise exception using message='UPDATE_DEVICE_DENIED',errcode='P0001';
 end if;
 -- The branch must still belong to the Owner of this active registration.
 if not exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
   where b.id=p_branch and o.owner_id=p_owner) then
  raise exception using message='UPDATE_OWNER_DENIED',errcode='P0001';
 end if;
 select * into v_release from public.update_releases where id=p_release for share;
 if not found or v_release.status!='PUBLISHED' or v_release.manifest_sha256!=p_manifest_hash
 or v_release.artifact_sha256!=p_artifact_hash then
  raise exception using message='UPDATE_RELEASE_DENIED',errcode='P0001';
 end if;
 perform 1 from public.update_release_targets t where t.release_id=p_release and t.branch_id=p_branch for share;
 if not found then raise exception using message='UPDATE_RELEASE_DENIED',errcode='P0001'; end if;
 begin
  insert into public.update_install_grants(operation_id,release_id,branch_id,instance_id,registration_id,owner_id,actor_id,device_hash,nonce,issued_at,expires_at)
   values(p_operation,p_release,p_branch,p_instance,p_registration,p_owner,p_actor,p_device_hash,p_nonce,v_now,v_now+60000);
 exception when unique_violation then
  raise exception using message='UPDATE_OPERATION_REPLAY',errcode='P0001';
 end;
 return jsonb_build_object('operationId',p_operation,'releaseId',p_release,'branchId',p_branch,'instanceId',p_instance,
  'registrationId',p_registration,'actorId',p_actor,'manifestSha256',p_manifest_hash,'artifactSha256',p_artifact_hash,
  'nonce',p_nonce,'issuedAt',v_now,'expiresAt',v_now+60000);
end;$$;
revoke all on function public.update_issue_install_grant(uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.update_issue_install_grant(uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,text,uuid) to service_role;
