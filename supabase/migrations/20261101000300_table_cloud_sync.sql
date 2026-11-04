-- The local POS is authoritative. A complete branch snapshot replaces public table metadata atomically.
create table public.table_cloud_manifests (
 branch_id uuid primary key references public.branches(id),
 registration_id uuid not null references public.server_registrations(id),
 revision bigint not null check(revision>0),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 document jsonb not null check(jsonb_typeof(document)='object'),
 applied_at timestamptz not null default now()
);
create table public.table_cloud_zones (
 branch_id uuid not null references public.branches(id),id uuid not null,
 name text not null,active boolean not null,revision bigint not null,
 primary key(branch_id,id)
);
create table public.table_cloud_tables (
 branch_id uuid not null references public.branches(id),id uuid not null,zone_id uuid not null,
 code text not null,name text not null,active boolean not null,revision bigint not null,
 primary key(branch_id,id),unique(branch_id,code),
 foreign key(branch_id,zone_id) references public.table_cloud_zones(branch_id,id) deferrable initially deferred
);
create table public.table_cloud_commands (
 registration_id uuid not null references public.server_registrations(id),command_id uuid not null,
 fingerprint text not null,result jsonb not null,created_at timestamptz not null default now(),
 primary key(registration_id,command_id)
);
do $$declare t text;begin foreach t in array array['table_cloud_manifests','table_cloud_zones','table_cloud_tables','table_cloud_commands'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 if t <> 'table_cloud_commands' then
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy owner_read on public.%I for select to authenticated using (exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id where b.id=branch_id and o.owner_id=(select auth.uid())))',t);
 end if;
end loop;end;$$;

create function public.table_cloud_execute(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text,p_fingerprint text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb;b uuid;prior public.table_cloud_commands%rowtype;m public.table_cloud_manifests%rowtype;cmd uuid;rev bigint;h text;doc jsonb;result jsonb;
begin
 d:=public.menu_device_assert(p_registration);b:=(d->>'branchId')::uuid;
 if d->>'deviceHash'<>p_device_hash then raise exception 'MENU_DEVICE_DENIED';end if;
 update public.menu_sync_challenges set processed=true where id=p_challenge and registration_id=p_registration and nonce=p_nonce and used and not processed and expires_at>clock_timestamp();
 if not found then raise exception 'MENU_CHALLENGE_EXPIRED';end if;
 cmd:=(p_payload->>'commandId')::uuid;rev:=(p_payload->>'revision')::bigint;h:=p_payload->>'hash';doc:=p_payload->'document';
 if rev<1 or h !~ '^[0-9a-f]{64}$' or jsonb_typeof(doc)<>'object' then raise exception 'INVALID_TABLE_SNAPSHOT';end if;
 perform 1 from public.branches where id=b for update;
 select * into prior from public.table_cloud_commands where registration_id=p_registration and command_id=cmd;
 if found then
  if prior.fingerprint<>p_fingerprint then raise exception 'TABLE_COMMAND_CONFLICT';end if;
  return prior.result;
 end if;
 select * into m from public.table_cloud_manifests where branch_id=b for update;
 if found and rev<m.revision then raise exception 'TABLE_STALE_REVISION';end if;
 if found and rev=m.revision then
  if h<>m.content_hash then raise exception 'TABLE_REVISION_CONFLICT';end if;
 else
  delete from public.table_cloud_tables where branch_id=b;
  delete from public.table_cloud_zones where branch_id=b;
  insert into public.table_cloud_zones(branch_id,id,name,active,revision)
   select b,(z->>'id')::uuid,z->>'name',(z->>'active')::boolean,(z->>'revision')::bigint from jsonb_array_elements(doc->'zones') z;
  insert into public.table_cloud_tables(branch_id,id,zone_id,code,name,active,revision)
   select b,(t->>'id')::uuid,(t->>'zoneId')::uuid,t->>'code',t->>'name',(t->>'active')::boolean,(t->>'revision')::bigint from jsonb_array_elements(doc->'tables') t;
  insert into public.table_cloud_manifests(branch_id,registration_id,revision,content_hash,document)
   values(b,p_registration,rev,h,doc)
   on conflict(branch_id) do update set registration_id=excluded.registration_id,revision=excluded.revision,content_hash=excluded.content_hash,document=excluded.document,applied_at=now();
 end if;
 result:=jsonb_build_object('state','APPLIED','revision',rev,'hash',h,'zoneCount',jsonb_array_length(doc->'zones'),'tableCount',jsonb_array_length(doc->'tables'));
 insert into public.table_cloud_commands(registration_id,command_id,fingerprint,result) values(p_registration,cmd,p_fingerprint,result);
 return result;
end;$$;
revoke all on function public.table_cloud_execute(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.table_cloud_execute(uuid,uuid,uuid,text,text,jsonb) to service_role;
