-- Menu images live in Bunny. Cloud stores only the immutable object key and item binding.
create table public.menu_photo_grants (
 nonce uuid primary key, branch_id uuid not null references public.branches(id),
 registration_id uuid not null references public.server_registrations(id),
 item_id text not null, operation text not null check(operation in ('UPLOAD','READ','REMOVE')),
 expires_at timestamptz not null, consumed_at timestamptz not null default now()
);
create index menu_photo_grants_expiry on public.menu_photo_grants(expires_at);
create table public.menu_photo_assets (
 id uuid primary key, branch_id uuid not null references public.branches(id), item_id text not null,
 object_key text not null unique, mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 byte_size integer not null check(byte_size>0 and byte_size<=10485760), sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 actor_id uuid, created_at timestamptz not null default now(), unique(branch_id,id)
);
create table public.menu_photo_manifest (
 branch_id uuid primary key references public.branches(id), revision bigint not null default 0 check(revision>=0)
);
create table public.menu_item_photos (
 branch_id uuid not null references public.branches(id), item_id text not null,
 asset_id uuid, revision bigint not null check(revision>0), updated_at timestamptz not null default now(),
 primary key(branch_id,item_id), foreign key(branch_id,asset_id) references public.menu_photo_assets(branch_id,id)
);
create table public.menu_item_photo_revisions (
 branch_id uuid not null references public.branches(id), item_id text not null, revision bigint not null check(revision>0),
 asset_id uuid, actor_id uuid, created_at timestamptz not null default now(),
 primary key(branch_id,item_id,revision), foreign key(branch_id,asset_id) references public.menu_photo_assets(branch_id,id)
);
do $$declare t text;begin foreach t in array array['menu_photo_grants','menu_photo_assets','menu_photo_manifest','menu_item_photos','menu_item_photo_revisions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop;end;$$;

create function public.menu_photo_item_exists(p_branch uuid,p_item text) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from jsonb_array_elements((select v.document->'items' from public.menu_device_acknowledgements a join public.menu_cloud_versions v on v.branch_id=a.branch_id and v.id=a.version_id
 where a.branch_id=p_branch order by a.applied_at desc,a.local_revision desc limit 1)) i where i->>'id'=p_item and coalesce((i->>'archived')::boolean,false)=false);
$$;
create function public.menu_photo_owner(p_branch uuid,p_owner uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id where b.id=p_branch and o.owner_id=p_owner);
$$;
create function public.menu_photo_claim(p_branch uuid,p_registration uuid,p_nonce uuid,p_item text,p_operation text,p_expires_ms bigint) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_operation not in ('UPLOAD','READ','REMOVE') or p_expires_ms<=extract(epoch from clock_timestamp())*1000 or p_expires_ms>extract(epoch from clock_timestamp())*1000+120000 then raise exception 'PHOTO_GRANT_EXPIRED';end if;
 if not exists(select 1 from public.server_registrations r where r.id=p_registration and r.branch_id=p_branch and r.status='ACTIVE') then raise exception 'PHOTO_DEVICE_DENIED';end if;
 if not public.menu_photo_item_exists(p_branch,p_item) then raise exception 'PHOTO_ITEM_UNPUBLISHED';end if;
 insert into public.menu_photo_grants(nonce,branch_id,registration_id,item_id,operation,expires_at) values(p_nonce,p_branch,p_registration,p_item,p_operation,to_timestamp(p_expires_ms/1000.0));
 return true;
end;$$;
create function public.menu_photo_commit(p_branch uuid,p_item text,p_asset uuid,p_key text,p_mime text,p_size integer,p_hash text,p_actor uuid,p_expected bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare current_revision bigint; global_revision bigint;
begin
 if not public.menu_photo_item_exists(p_branch,p_item) then raise exception 'PHOTO_ITEM_UNPUBLISHED';end if;
 insert into public.menu_photo_manifest(branch_id) values(p_branch) on conflict do nothing;
 perform 1 from public.menu_photo_manifest where branch_id=p_branch for update;
 select revision into current_revision from public.menu_item_photos where branch_id=p_branch and item_id=p_item;
 if coalesce(current_revision,0)<>p_expected then raise exception 'PHOTO_REVISION_CONFLICT';end if;
 insert into public.menu_photo_assets(id,branch_id,item_id,object_key,mime_type,byte_size,sha256,actor_id) values(p_asset,p_branch,p_item,p_key,p_mime,p_size,p_hash,p_actor);
 insert into public.menu_item_photos(branch_id,item_id,asset_id,revision) values(p_branch,p_item,p_asset,p_expected+1)
 on conflict(branch_id,item_id) do update set asset_id=excluded.asset_id,revision=excluded.revision,updated_at=now();
 insert into public.menu_item_photo_revisions(branch_id,item_id,revision,asset_id,actor_id) values(p_branch,p_item,p_expected+1,p_asset,p_actor);
 update public.menu_photo_manifest set revision=revision+1 where branch_id=p_branch returning revision into global_revision;
 return jsonb_build_object('itemRevision',p_expected+1,'photoRevision',global_revision,'assetId',p_asset);
end;$$;
create function public.menu_photo_remove(p_branch uuid,p_item text,p_expected bigint,p_actor uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare current_revision bigint; global_revision bigint;
begin
 if not public.menu_photo_item_exists(p_branch,p_item) then raise exception 'PHOTO_ITEM_UNPUBLISHED';end if;
 insert into public.menu_photo_manifest(branch_id) values(p_branch) on conflict do nothing;
 perform 1 from public.menu_photo_manifest where branch_id=p_branch for update;
 select revision into current_revision from public.menu_item_photos where branch_id=p_branch and item_id=p_item;
 if coalesce(current_revision,0)<>p_expected then raise exception 'PHOTO_REVISION_CONFLICT';end if;
 insert into public.menu_item_photos(branch_id,item_id,asset_id,revision) values(p_branch,p_item,null,p_expected+1)
 on conflict(branch_id,item_id) do update set asset_id=null,revision=excluded.revision,updated_at=now();
 insert into public.menu_item_photo_revisions(branch_id,item_id,revision,asset_id,actor_id) values(p_branch,p_item,p_expected+1,null,p_actor);
 update public.menu_photo_manifest set revision=revision+1 where branch_id=p_branch returning revision into global_revision;
 return jsonb_build_object('itemRevision',p_expected+1,'photoRevision',global_revision);
end;$$;
create function public.menu_photo_current(p_branch uuid,p_item text) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('itemRevision',coalesce((select revision from public.menu_item_photos where branch_id=p_branch and item_id=p_item),0),'photoRevision',coalesce((select revision from public.menu_photo_manifest where branch_id=p_branch),0),'objectKey',(select a.object_key from public.menu_item_photos p join public.menu_photo_assets a on a.branch_id=p.branch_id and a.id=p.asset_id where p.branch_id=p_branch and p.item_id=p_item));
$$;
revoke all on function public.menu_photo_item_exists(uuid,text),public.menu_photo_owner(uuid,uuid),public.menu_photo_claim(uuid,uuid,uuid,text,text,bigint),public.menu_photo_commit(uuid,text,uuid,text,text,integer,text,uuid,bigint),public.menu_photo_remove(uuid,text,bigint,uuid),public.menu_photo_current(uuid,text) from public,anon,authenticated;
grant execute on function public.menu_photo_item_exists(uuid,text),public.menu_photo_owner(uuid,uuid),public.menu_photo_claim(uuid,uuid,uuid,text,text,bigint),public.menu_photo_commit(uuid,text,uuid,text,text,integer,text,uuid,bigint),public.menu_photo_remove(uuid,text,bigint,uuid),public.menu_photo_current(uuid,text) to service_role;
