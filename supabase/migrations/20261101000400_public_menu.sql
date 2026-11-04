-- Public menus are derived only from a device acknowledgement of an applied local revision.
create table public.public_menu_settings (
 branch_id uuid primary key references public.branches(id),
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.public_menu_snapshots (
 branch_id uuid primary key references public.branches(id),
 version_id uuid not null references public.menu_cloud_versions(id),
 local_revision bigint not null check(local_revision>0),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 document jsonb not null check(jsonb_typeof(document)='object'),
 applied_at timestamptz not null,
 public_updated_at timestamptz not null default now()
);
alter table public.public_menu_settings enable row level security;
alter table public.public_menu_snapshots enable row level security;
revoke all on public.public_menu_settings,public.public_menu_snapshots from public,anon,authenticated;
grant all on public.public_menu_settings,public.public_menu_snapshots to service_role;
grant select,insert(branch_id,enabled),update(enabled) on public.public_menu_settings to authenticated;
grant select on public.public_menu_snapshots to authenticated;
create policy owner_settings on public.public_menu_settings for all to authenticated
 using (exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id where b.id=branch_id and o.owner_id=(select auth.uid())))
 with check (exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id where b.id=branch_id and o.owner_id=(select auth.uid())));
create policy owner_snapshot on public.public_menu_snapshots for select to authenticated
 using (exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id where b.id=branch_id and o.owner_id=(select auth.uid())));

create function public.public_menu_ack_snapshot() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare v public.menu_cloud_versions%rowtype;
begin
 select * into v from public.menu_cloud_versions where id=new.version_id and branch_id=new.branch_id and content_hash=new.content_hash;
 if not found then raise exception 'PUBLIC_MENU_ACK_INVALID';end if;
 insert into public.public_menu_snapshots(branch_id,version_id,local_revision,content_hash,document,applied_at)
 values(new.branch_id,v.id,new.local_revision,v.content_hash,v.document,new.applied_at)
 on conflict(branch_id) do update set version_id=excluded.version_id,local_revision=excluded.local_revision,content_hash=excluded.content_hash,document=excluded.document,applied_at=excluded.applied_at,public_updated_at=now()
 where excluded.local_revision>public_menu_snapshots.local_revision;
 return new;
end;$$;
create trigger public_menu_on_ack after insert or update on public.menu_device_acknowledgements
 for each row execute function public.public_menu_ack_snapshot();
insert into public.public_menu_snapshots(branch_id,version_id,local_revision,content_hash,document,applied_at)
select distinct on(a.branch_id) a.branch_id,v.id,a.local_revision,v.content_hash,v.document,a.applied_at
from public.menu_device_acknowledgements a join public.menu_cloud_versions v on v.id=a.version_id and v.branch_id=a.branch_id and v.content_hash=a.content_hash
order by a.branch_id,a.local_revision desc,a.applied_at desc;
revoke all on function public.public_menu_ack_snapshot() from public,anon,authenticated;

create function public.public_menu_read(p_branch uuid,p_code text default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s public.public_menu_snapshots%rowtype; branch_name text; table_json jsonb:=null; photos jsonb; photo_revision bigint;
begin
 if not exists(select 1 from public.public_menu_settings where branch_id=p_branch and enabled) then raise exception 'PUBLIC_MENU_UNAVAILABLE';end if;
 select * into s from public.public_menu_snapshots where branch_id=p_branch;
 if not found then raise exception 'PUBLIC_MENU_UNAVAILABLE';end if;
 select name into branch_name from public.branches where id=p_branch;
 if p_code is not null then
  select jsonb_build_object('id',t.id,'name',t.name,'zoneId',t.zone_id,'zoneName',z.name) into table_json from public.table_cloud_tables t
  join public.table_cloud_zones z on z.branch_id=t.branch_id and z.id=t.zone_id
  where t.branch_id=p_branch and t.code=p_code and t.active and z.active;
  if not found then raise exception 'PUBLIC_TABLE_NOT_FOUND';end if;
 end if;
 select coalesce(jsonb_object_agg(p.item_id,a.object_key) filter(where a.object_key is not null),'{}'::jsonb) into photos
 from public.menu_item_photos p join public.menu_photo_assets a on a.branch_id=p.branch_id and a.id=p.asset_id
 where p.branch_id=p_branch;
 select coalesce(revision,0) into photo_revision from public.menu_photo_manifest where branch_id=p_branch;
 return jsonb_build_object('branchId',p_branch,'branchName',branch_name,'versionId',s.version_id,'localRevision',s.local_revision,'contentHash',s.content_hash,'updatedAt',s.public_updated_at,'catalog',s.document,'photoRevision',coalesce(photo_revision,0),'photos',photos,
 'table',table_json);
end;$$;
revoke all on function public.public_menu_read(uuid,text) from public,anon,authenticated;
grant execute on function public.public_menu_read(uuid,text) to service_role;

create function public.public_menu_manage(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text,p_operation text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb;b uuid;enabled_now boolean;v uuid;
begin
 d:=public.menu_device_assert(p_registration);b:=(d->>'branchId')::uuid;
 if d->>'deviceHash'<>p_device_hash then raise exception 'MENU_DEVICE_DENIED';end if;
 update public.menu_sync_challenges set processed=true where id=p_challenge and registration_id=p_registration and nonce=p_nonce and used and not processed and expires_at>clock_timestamp();
 if not found then raise exception 'MENU_CHALLENGE_EXPIRED';end if;
 if p_operation='publicMenuSet' then
  if jsonb_typeof(p_payload->'enabled')<>'boolean' then raise exception 'INVALID_PUBLIC_MENU_SETTING';end if;
  if (p_payload->>'enabled')::boolean and not exists(select 1 from public.public_menu_snapshots where branch_id=b) then raise exception 'PUBLIC_MENU_NO_APPLIED_VERSION';end if;
  insert into public.public_menu_settings(branch_id,enabled) values(b,(p_payload->>'enabled')::boolean)
  on conflict(branch_id) do update set enabled=excluded.enabled,updated_at=now();
 elsif p_operation<>'publicMenuStatus' then raise exception 'MENU_OPERATION_DENIED';end if;
 select enabled into enabled_now from public.public_menu_settings where branch_id=b;
 select version_id into v from public.public_menu_snapshots where branch_id=b;
 return jsonb_build_object('enabled',coalesce(enabled_now,false),'versionId',v);
end;$$;
revoke all on function public.public_menu_manage(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.public_menu_manage(uuid,uuid,uuid,text,text,jsonb) to service_role;
