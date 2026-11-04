-- Menu-only protocol. Service RPCs are exclusively called after Ed25519 proof in menu-sync Edge.
create table public.menu_cloud_versions (
 id uuid primary key, branch_id uuid not null references public.branches(id), registration_id uuid not null references public.server_registrations(id),
 sequence bigint generated always as identity unique, parent_id uuid references public.menu_cloud_versions(id),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'), catalog_schema integer not null check(catalog_schema=1),
 document jsonb not null check(jsonb_typeof(document)='object'), author jsonb not null, origin text not null check(origin in ('LOCAL_POS','CLOUD_RESTORE')),
 local_revision bigint not null check(local_revision>0), published_at bigint not null, received_at timestamptz not null default now(),
 unique(branch_id,id)
);
create index menu_versions_branch_sequence on public.menu_cloud_versions(branch_id,sequence desc);
create table public.menu_entity_owners(branch_id uuid not null references public.branches(id),entity_id text not null,owner text not null,primary key(branch_id,entity_id));
create table public.menu_cloud_heads (branch_id uuid primary key references public.branches(id),version_id uuid, generation bigint not null default 0,foreign key(branch_id,version_id) references public.menu_cloud_versions(branch_id,id));
create table public.menu_sync_commands (registration_id uuid not null references public.server_registrations(id),command_id uuid not null,operation text not null,fingerprint text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(registration_id,command_id));
create table public.menu_device_acknowledgements (registration_id uuid primary key references public.server_registrations(id),branch_id uuid not null,version_id uuid not null,content_hash text not null,local_revision bigint not null check(local_revision>0),applied_at timestamptz not null default now(),foreign key(branch_id,version_id) references public.menu_cloud_versions(branch_id,id));
create table public.menu_sync_conflicts (version_id uuid primary key references public.menu_cloud_versions(id),branch_id uuid not null references public.branches(id),registration_id uuid not null references public.server_registrations(id),remote_head uuid references public.menu_cloud_versions(id),resolution_id uuid references public.menu_cloud_versions(id),created_at timestamptz not null default now());
create table public.menu_sync_challenges (id uuid primary key default gen_random_uuid(),registration_id uuid not null references public.server_registrations(id),nonce uuid not null default gen_random_uuid(),expires_at timestamptz not null default now()+interval '60 seconds',created_at timestamptz not null default now(),used boolean not null default false,processed boolean not null default false);
create index menu_challenges_registration on public.menu_sync_challenges(registration_id,created_at);
create table public.menu_sync_audit (id bigint generated always as identity primary key,branch_id uuid not null references public.branches(id),registration_id uuid not null references public.server_registrations(id),operation text not null,version_id uuid,created_at timestamptz not null default now());

create function public.menu_immutable() returns trigger language plpgsql as $$ begin raise exception 'IMMUTABLE_MENU';end;$$;
create trigger menu_cloud_versions_immutable before update or delete on public.menu_cloud_versions for each row execute function public.menu_immutable();
create trigger menu_sync_commands_immutable before update or delete on public.menu_sync_commands for each row execute function public.menu_immutable();
create trigger menu_entity_owners_immutable before update or delete on public.menu_entity_owners for each row execute function public.menu_immutable();
create trigger menu_sync_audit_immutable before update or delete on public.menu_sync_audit for each row execute function public.menu_immutable();

do $$declare t text;begin foreach t in array array['menu_cloud_versions','menu_cloud_heads','menu_sync_commands','menu_device_acknowledgements','menu_sync_conflicts','menu_sync_challenges','menu_sync_audit','menu_entity_owners'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 if t <> 'menu_sync_challenges' and t <> 'menu_sync_commands' then
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy owner_read on public.%I for select to authenticated using (exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id where b.id=branch_id and o.owner_id=(select auth.uid())))',t);
 end if;
end loop;end;$$;
grant usage,select on sequence public.menu_cloud_versions_sequence_seq,public.menu_sync_audit_id_seq to service_role;

create function public.menu_device_assert(p_registration uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.server_registrations%rowtype; o uuid;
begin
 select s.* into r from public.server_registrations s join public.branches b on b.id=s.branch_id join public.organizations x on x.id=b.organization_id where s.id=p_registration and s.status='ACTIVE' and s.owner_id=x.owner_id;
 if not found then raise exception 'MENU_DEVICE_DENIED';end if;
 return jsonb_build_object('branchId',r.branch_id,'instanceId',r.instance_id,'registrationId',r.id,'deviceHash',r.device_public_key_hash);
end;$$;
create function public.menu_issue_challenge(p_registration uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb;c public.menu_sync_challenges%rowtype;
begin
 d:=public.menu_device_assert(p_registration);
 perform 1 from public.server_registrations where id=p_registration for update;
 if (select count(*) from public.menu_sync_challenges where registration_id=p_registration and created_at>now()-interval '1 minute')>=120 then raise exception 'MENU_RATE_LIMIT';end if;
 delete from public.menu_sync_challenges where registration_id=p_registration and created_at<now()-interval '1 hour';
 insert into public.menu_sync_challenges(registration_id) values(p_registration) returning * into c;
 return d||jsonb_build_object('challengeId',c.id,'nonce',c.nonce);
end;$$;

create function public.menu_consume_challenge(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb;begin d:=public.menu_device_assert(p_registration);if d->>'deviceHash'<>p_device_hash then raise exception 'MENU_DEVICE_DENIED';end if;
 update public.menu_sync_challenges set used=true where id=p_challenge and registration_id=p_registration and nonce=p_nonce and not used and expires_at>clock_timestamp();
 if not found then raise exception 'MENU_CHALLENGE_EXPIRED';end if;return jsonb_build_object('consumed',true);end;$$;
create function public.menu_sync_execute(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text,p_operation text,p_fingerprint text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare node record;d jsonb;b uuid; h uuid;g bigint;cmd uuid;prior public.menu_sync_commands%rowtype;v jsonb;vid uuid;parent uuid;result jsonb;entry public.menu_cloud_versions%rowtype; page jsonb;
begin
 d:=public.menu_device_assert(p_registration);b:=(d->>'branchId')::uuid;
 if d->>'deviceHash'<>p_device_hash then raise exception 'MENU_DEVICE_DENIED';end if;
 update public.menu_sync_challenges set processed=true where id=p_challenge and registration_id=p_registration and nonce=p_nonce and used and not processed and expires_at>clock_timestamp();
 if not found then raise exception 'MENU_CHALLENGE_EXPIRED';end if;
 perform 1 from public.branches where id=b for update;
 insert into public.menu_cloud_heads(branch_id) values(b) on conflict do nothing;
 select version_id,generation into h,g from public.menu_cloud_heads where branch_id=b for update;
 if p_operation in ('push','ack') then
  cmd:=(p_payload->>'commandId')::uuid;
  if cmd is null then raise exception 'INVALID_MENU_COMMAND';end if;
  select * into prior from public.menu_sync_commands where registration_id=p_registration and command_id=cmd;
  if found then if prior.operation<>p_operation or prior.fingerprint<>p_fingerprint then raise exception 'MENU_COMMAND_CONFLICT';end if;return prior.result;end if;
 end if;
 if p_operation='manifest' then
  select jsonb_build_object('versionId',a.version_id,'hash',a.content_hash,'localRevision',a.local_revision,'appliedAt',a.applied_at) into result from public.menu_device_acknowledgements a where a.registration_id=p_registration;
  return jsonb_build_object('head',h,'generation',g,'ack',result);
 elsif p_operation='history' then
  select coalesce(jsonb_agg(x.row),'[]'::jsonb) into page from (select jsonb_build_object('id',id,'sequence',sequence,'hash',content_hash,'parentId',parent_id,'author',author,'origin',origin,'publishedAt',published_at,'receivedAt',received_at) row from public.menu_cloud_versions where branch_id=b and (coalesce((p_payload->>'before')::bigint,0)=0 or sequence<(p_payload->>'before')::bigint) order by sequence desc limit least(greatest(coalesce((p_payload->>'limit')::integer,20),1),50)) x;
  return jsonb_build_object('head',h,'versions',page);
 elsif p_operation='version' then
  select * into entry from public.menu_cloud_versions where branch_id=b and id=(p_payload->>'versionId')::uuid;
  if not found then raise exception 'MENU_VERSION_NOT_FOUND';end if;
  return jsonb_build_object('id',entry.id,'parentId',entry.parent_id,'hash',entry.content_hash,'schema',entry.catalog_schema,'document',entry.document,'author',entry.author,'origin',entry.origin,'publishedAt',entry.published_at,'localRevision',entry.local_revision);
 elsif p_operation='receipt' then
  select c.result into result from public.menu_sync_commands c where c.registration_id=p_registration and c.command_id=(p_payload->>'commandId')::uuid;
  return jsonb_build_object('found',found,'result',result);
 elsif p_operation='push' then
  v:=p_payload->'version';vid:=(v->>'id')::uuid;parent:=(v->>'parentId')::uuid;
  if vid is null or p_payload->>'expectedHead' is distinct from v->>'parentId' or (v->>'schema')::integer<>1 or octet_length((v->'document')::text)>2097152 or v->>'origin' not in ('LOCAL_POS','CLOUD_RESTORE') then raise exception 'INVALID_MENU_VERSION';end if;
  if parent is not null and not exists(select 1 from public.menu_cloud_versions where id=parent and branch_id=b) then raise exception 'MENU_PARENT_UNKNOWN';end if;
  select * into entry from public.menu_cloud_versions where id=vid;
  if found then raise exception 'MENU_VERSION_ID_CONFLICT';end if;
  if h is not distinct from parent and h is not null and exists (
   select 1 from public.menu_cloud_versions old, lateral (select value->>'id' id from jsonb_array_elements(old.document->'items') union all select value->>'id' from jsonb_array_elements(old.document->'categories')) old_id
   where old.id=h and not exists(select 1 from (select value->>'id' id from jsonb_array_elements(v->'document'->'items') union all select value->>'id' from jsonb_array_elements(v->'document'->'categories')) new_id where new_id.id=old_id.id)
  ) then raise exception 'MENU_ARCHIVE_REQUIRED';end if;
  for node in
   with items as (select value i from jsonb_array_elements(v->'document'->'items'))
   select i->>'id' id,'item:'||coalesce(i->>'kind','ITEM') owner from items
   union all select value->>'id','category' from jsonb_array_elements(v->'document'->'categories')
   union all select x->>'id','variant:'||(i->>'id') from items,lateral jsonb_array_elements(i->'variants') x
   union all select grp->>'id','group:'||(i->>'id') from items,lateral jsonb_array_elements(i->'groups') grp
   union all select x->>'id','modifier:'||(i->>'id')||':'||(grp->>'id') from items,lateral jsonb_array_elements(i->'groups') grp,lateral jsonb_array_elements(grp->'options') x
   union all select c->>'id','combination:'||(i->>'id')||':'||jsonb_build_array(c->'variantId',(select coalesce(jsonb_agg(o order by o::text),'[]'::jsonb) from jsonb_array_elements(c->'optionIds') o))::text from items,lateral jsonb_array_elements(coalesce(i->'combinationPrices','[]'::jsonb)) c
  loop
   if exists(select 1 from public.menu_entity_owners where branch_id=b and entity_id=node.id and owner<>node.owner) then raise exception 'ENTITY_ID_REUSED';end if;
   insert into public.menu_entity_owners values(b,node.id,node.owner) on conflict do nothing;
  end loop;
  insert into public.menu_cloud_versions(id,branch_id,registration_id,parent_id,content_hash,catalog_schema,document,author,origin,local_revision,published_at) values(vid,b,p_registration,parent,v->>'hash',1,v->'document',v->'author',v->>'origin',(v->>'localRevision')::bigint,(v->>'publishedAt')::bigint);
  if h is not distinct from parent then
   update public.menu_cloud_heads set version_id=vid,generation=generation+1 where branch_id=b;
   result:=jsonb_build_object('state','ACCEPTED','versionId',vid,'head',vid,'generation',g+1,'hash',v->>'hash');
   if jsonb_typeof(p_payload->'resolves')='array' and (p_payload->'resolves') @> jsonb_build_array(h) then update public.menu_sync_conflicts set resolution_id=vid where branch_id=b and registration_id=p_registration and resolution_id is null;end if;
  else
   insert into public.menu_sync_conflicts(version_id,branch_id,registration_id,remote_head) values(vid,b,p_registration,h);
   result:=jsonb_build_object('state','CONFLICT','versionId',vid,'head',h,'generation',g,'hash',v->>'hash');
  end if;
 elsif p_operation='ack' then
  vid:=(p_payload->>'versionId')::uuid;
  select * into entry from public.menu_cloud_versions where branch_id=b and id=vid;
  if not found or entry.content_hash<>p_payload->>'hash' or (p_payload->>'localRevision')::bigint<1 then raise exception 'INVALID_MENU_ACK';end if;
  insert into public.menu_device_acknowledgements(registration_id,branch_id,version_id,content_hash,local_revision) values(p_registration,b,vid,entry.content_hash,(p_payload->>'localRevision')::bigint) on conflict(registration_id) do update set version_id=excluded.version_id,content_hash=excluded.content_hash,local_revision=excluded.local_revision,applied_at=now();
  result:=jsonb_build_object('state','ACKNOWLEDGED','versionId',vid,'hash',entry.content_hash);
 else raise exception 'MENU_OPERATION_DENIED';end if;
 insert into public.menu_sync_commands(registration_id,command_id,operation,fingerprint,result) values(p_registration,cmd,p_operation,p_fingerprint,result);
 insert into public.menu_sync_audit(branch_id,registration_id,operation,version_id) values(b,p_registration,p_operation,vid);
 return result;
end;$$;
revoke all on function public.menu_device_assert(uuid),public.menu_issue_challenge(uuid),public.menu_sync_execute(uuid,uuid,uuid,text,text,text,jsonb),public.menu_consume_challenge(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.menu_device_assert(uuid),public.menu_issue_challenge(uuid),public.menu_sync_execute(uuid,uuid,uuid,text,text,text,jsonb),public.menu_consume_challenge(uuid,uuid,uuid,text) to service_role;
