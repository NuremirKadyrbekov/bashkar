-- Read-only release download lookup. A download is never an install grant.
create function public.update_get_release_download(p_owner uuid,p_registration uuid,p_branch uuid,p_instance uuid,p_device_hash text,p_release text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_registration public.server_registrations%rowtype;v_release public.update_releases%rowtype;
begin
 if p_owner is null or p_registration is null or p_branch is null or p_instance is null or p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' or p_release is null or p_release !~ '^[a-z0-9_-]{1,80}$' then
  raise exception using message='UPDATE_REQUEST_INVALID',errcode='P0001';
 end if;
 select * into v_registration from public.server_registrations where id=p_registration;
 if not found or v_registration.status!='ACTIVE' or v_registration.branch_id!=p_branch or v_registration.instance_id!=p_instance or v_registration.owner_id!=p_owner or v_registration.device_public_key_hash!=p_device_hash then
  raise exception using message='UPDATE_DEVICE_DENIED',errcode='P0001';
 end if;
 if not exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id where b.id=p_branch and o.owner_id=p_owner) then
  raise exception using message='UPDATE_OWNER_DENIED',errcode='P0001';
 end if;
 select * into v_release from public.update_releases where id=p_release;
 if not found or v_release.status!='PUBLISHED' or v_release.signed_manifest is null or v_release.storage_path is null or v_release.artifact_size_bytes is null then
  raise exception using message='UPDATE_RELEASE_DENIED',errcode='P0001';
 end if;
 if not exists(select 1 from public.update_release_targets where release_id=p_release and branch_id=p_branch) then
  raise exception using message='UPDATE_RELEASE_DENIED',errcode='P0001';
 end if;
 return jsonb_build_object('releaseId',v_release.id,'signedRelease',v_release.signed_manifest,'storagePath',v_release.storage_path,
  'manifestSha256',v_release.manifest_sha256,'artifactSha256',v_release.artifact_sha256,'sizeBytes',v_release.artifact_size_bytes);
end;$$;
revoke all on function public.update_get_release_download(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.update_get_release_download(uuid,uuid,uuid,uuid,text,text) to service_role;
