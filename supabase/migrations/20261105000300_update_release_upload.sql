-- The upload endpoint alone can mark a release validated, after reading back
-- the private Storage object. Publishing is a second authenticated action.
alter table public.update_releases add column signed_manifest jsonb;
create or replace function public.update_admin_release_snapshot(p_actor uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform public.platform_release_assert(p_actor);
 return coalesce((select jsonb_agg(jsonb_build_object('releaseId',r.id,'version',r.version,'channel',r.channel,
  'status',r.status,'sourceCommit',r.source_commit,'manifestSha256',r.manifest_sha256,'artifactSha256',r.artifact_sha256,
  'notes',r.notes,'createdAt',r.created_at,'validatedAt',r.validated_at,'publishedAt',r.published_at,
  'artifactSizeBytes',r.artifact_size_bytes,
  'targets',(select coalesce(jsonb_agg(t.branch_id order by t.branch_id),'[]'::jsonb) from public.update_release_targets t where t.release_id=r.id)) order by r.created_at desc,r.id)
  from (select * from public.update_releases order by created_at desc,id limit 50) r),'[]'::jsonb);
end;$$;
alter table public.update_release_admin_events drop constraint update_release_admin_events_action_check;
alter table public.update_release_admin_events add constraint update_release_admin_events_action_check check (action in ('DRAFT_CREATED','VALIDATED','PUBLISHED','PAUSED','WITHDRAWN'));
create or replace function public.update_release_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then
  if old.status in ('PUBLISHED','PAUSED','WITHDRAWN') then raise exception using message='UPDATE_RELEASE_IMMUTABLE',errcode='P0001'; end if;
  return old;
 end if;
 if old.status in ('PUBLISHED','PAUSED','WITHDRAWN') and
  (new.id,new.version,new.channel,new.manifest_sha256,new.artifact_sha256,new.source_commit,new.notes,new.created_by,new.storage_path,new.artifact_size_bytes,new.signed_manifest,new.validated_at,new.published_at) is distinct from
  (old.id,old.version,old.channel,old.manifest_sha256,old.artifact_sha256,old.source_commit,old.notes,old.created_by,old.storage_path,old.artifact_size_bytes,old.signed_manifest,old.validated_at,old.published_at) then
  raise exception using message='UPDATE_RELEASE_IMMUTABLE',errcode='P0001';
 end if;
 if old.status='WITHDRAWN' and new.status!='WITHDRAWN' then raise exception using message='UPDATE_RELEASE_WITHDRAWN',errcode='P0001'; end if;
 if old.status!=new.status and not (
  old.status='DRAFT' and new.status in ('VALIDATED','WITHDRAWN') or
  old.status='VALIDATED' and new.status in ('PUBLISHED','WITHDRAWN') or
  old.status='PUBLISHED' and new.status in ('PAUSED','WITHDRAWN') or
  old.status='PAUSED' and new.status in ('PUBLISHED','WITHDRAWN')
 ) then raise exception using message='UPDATE_RELEASE_STATE_INVALID',errcode='P0001'; end if;
 if new.status in ('VALIDATED','PUBLISHED','PAUSED') and
  (new.signed_manifest is null or new.storage_path is null or new.artifact_size_bytes is null or new.validated_at is null) then
  raise exception using message='UPDATE_RELEASE_FILE_INVALID',errcode='P0001';
 end if;
 return new;
end;$$;
create function public.update_admin_upload_preflight(p_actor uuid,p_release text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.update_releases%rowtype;
begin
 perform public.platform_release_assert(p_actor);
 select * into v from public.update_releases where id=p_release;
 if not found then raise exception using message='UPDATE_RELEASE_NOT_FOUND',errcode='P0001'; end if;
 if v.status!='DRAFT' then raise exception using message='UPDATE_RELEASE_STATE_INVALID',errcode='P0001'; end if;
 return jsonb_build_object('releaseId',v.id,'version',v.version,'sourceCommit',v.source_commit,'manifestSha256',v.manifest_sha256,'artifactSha256',v.artifact_sha256);
end;$$;
create function public.update_admin_validate_release(p_actor uuid,p_release text,p_manifest jsonb,p_path text,p_size bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.update_releases%rowtype;
begin
 perform public.platform_release_assert(p_actor);
 perform public.platform_admin_budget(p_actor);
 select * into v from public.update_releases where id=p_release for update;
 if not found then raise exception using message='UPDATE_RELEASE_NOT_FOUND',errcode='P0001'; end if;
 if v.status!='DRAFT' then raise exception using message='UPDATE_RELEASE_STATE_INVALID',errcode='P0001'; end if;
 if p_manifest is null or p_manifest->'manifest'->>'releaseId'!=v.id or p_manifest->'manifest'->>'version'!=v.version
  or p_manifest->'manifest'->>'gitCommit'!=v.source_commit or p_manifest->'manifest'->'artifact'->>'sha256'!=v.artifact_sha256
  or p_manifest->'manifest'->'artifact'->>'sizeBytes'!=p_size::text
  or p_path is null or p_path !~ ('^updates/'||v.id||'/[0-9a-f-]{36}/Bashkar(POS|-POS)-Setup-[A-Za-z0-9._-]+[.]exe$')
  or right(p_path,length(p_manifest->'manifest'->'artifact'->>'fileName')+1)!='/'||(p_manifest->'manifest'->'artifact'->>'fileName')
  or p_size is null or p_size<1 then raise exception using message='UPDATE_UPLOAD_INVALID',errcode='P0001'; end if;
 update public.update_releases set status='VALIDATED',signed_manifest=p_manifest,storage_path=p_path,artifact_size_bytes=p_size,validated_at=clock_timestamp() where id=p_release;
 insert into public.update_release_admin_events(release_id,actor_id,action,previous_status,new_status) values(p_release,p_actor,'VALIDATED','DRAFT','VALIDATED');
 return jsonb_build_object('releaseId',p_release,'status','VALIDATED','sizeBytes',p_size);
end;$$;
create function public.update_admin_publish_release(p_actor uuid,p_release text,p_path text,p_manifest_hash text,p_artifact_hash text,p_size bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.update_releases%rowtype;
begin
 perform public.platform_release_assert(p_actor);
 perform public.platform_admin_budget(p_actor);
 select * into v from public.update_releases where id=p_release for update;
 if not found then raise exception using message='UPDATE_RELEASE_NOT_FOUND',errcode='P0001'; end if;
 if v.status!='VALIDATED' or v.storage_path!=p_path or v.manifest_sha256!=p_manifest_hash or v.artifact_sha256!=p_artifact_hash or v.artifact_size_bytes!=p_size or v.signed_manifest is null then
  raise exception using message='UPDATE_RELEASE_STATE_INVALID',errcode='P0001'; end if;
 update public.update_releases set status='PUBLISHED',published_at=clock_timestamp() where id=p_release;
 insert into public.update_release_admin_events(release_id,actor_id,action,previous_status,new_status) values(p_release,p_actor,'PUBLISHED','VALIDATED','PUBLISHED');
 return jsonb_build_object('releaseId',p_release,'status','PUBLISHED');
end;$$;
create function public.update_admin_release_file(p_actor uuid,p_release text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.update_releases%rowtype;
begin
 perform public.platform_release_assert(p_actor);
 select * into v from public.update_releases where id=p_release;
 if not found then raise exception using message='UPDATE_RELEASE_NOT_FOUND',errcode='P0001'; end if;
 if v.status!='VALIDATED' then raise exception using message='UPDATE_RELEASE_STATE_INVALID',errcode='P0001'; end if;
 return jsonb_build_object('releaseId',v.id,'storagePath',v.storage_path,'sizeBytes',v.artifact_size_bytes,'signedManifest',v.signed_manifest,'manifestSha256',v.manifest_sha256,'artifactSha256',v.artifact_sha256,'version',v.version,'sourceCommit',v.source_commit);
end;$$;
revoke all on function public.update_admin_upload_preflight(uuid,text),public.update_admin_validate_release(uuid,text,jsonb,text,bigint),public.update_admin_publish_release(uuid,text,text,text,text,bigint),public.update_admin_release_file(uuid,text) from public,anon,authenticated;
grant execute on function public.update_admin_upload_preflight(uuid,text),public.update_admin_validate_release(uuid,text,jsonb,text,bigint),public.update_admin_publish_release(uuid,text,text,text,text,bigint),public.update_admin_release_file(uuid,text) to service_role;
