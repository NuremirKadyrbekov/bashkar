-- Cloud identity/activation only. No local POS passwords, sessions or sales.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now()
);
create index organizations_owner on public.organizations(owner_id);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now()
);
create index branches_organization on public.branches(organization_id);

create table public.server_registrations (
  id uuid primary key,
  branch_id uuid not null references public.branches(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  instance_id uuid not null,
  device_public_key_hash text not null check (device_public_key_hash ~ '^[0-9a-f]{64}$'),
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{43}$'),
  issued_at bigint not null,
  expires_at bigint not null check (expires_at > issued_at),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),
  created_at timestamptz not null default now()
);
create unique index server_one_active_per_branch on public.server_registrations(branch_id) where status = 'ACTIVE';
create unique index server_one_active_per_instance on public.server_registrations(instance_id) where status = 'ACTIVE';
create unique index server_one_active_per_device on public.server_registrations(device_public_key_hash) where status = 'ACTIVE';

create table public.activation_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  registration_id uuid not null references public.server_registrations(id) on delete restrict,
  action text not null check (action = 'server.registered'),
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.server_registrations enable row level security;
alter table public.activation_audit enable row level security;

-- Provisioning Owner/org/branch is an explicit administrative procedure.
-- A signed-in stranger cannot grant themselves organization ownership.
revoke all on public.organizations, public.branches, public.server_registrations, public.activation_audit from public, anon, authenticated;
grant select on public.organizations, public.branches, public.server_registrations, public.activation_audit to authenticated;
grant all on public.organizations, public.branches, public.server_registrations, public.activation_audit to service_role;
create policy owner_organizations on public.organizations for select to authenticated using (owner_id = (select auth.uid()));
create policy owner_branches on public.branches for select to authenticated using (
  exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid()))
);
create policy owner_registrations on public.server_registrations for select to authenticated using (
  exists (select 1 from public.branches b join public.organizations o on o.id = b.organization_id where b.id = branch_id and o.owner_id = (select auth.uid()))
);
create policy owner_activation_audit on public.activation_audit for select to authenticated using (
  exists (select 1 from public.branches b join public.organizations o on o.id = b.organization_id where b.id = branch_id and o.owner_id = (select auth.uid()))
);

-- Only the Edge Function service identity may call this. p_owner_id MUST come
-- from verified Auth /user, never from the incoming JSON or JWT decoding.
create function public.register_branch_server(
  p_owner_id uuid, p_branch_id uuid, p_registration_id uuid,
  p_instance_id uuid, p_device_hash text, p_nonce text
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_org uuid;
  v_existing public.server_registrations%rowtype;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$'
     or p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]{43}$'
     or p_registration_id is null or p_instance_id is null then
    raise exception using message = 'INVALID_REGISTRATION', errcode = 'P0001';
  end if;
  -- Serialize registrations and owner changes for this branch. Lock both rows.
  select b.organization_id into v_org from public.branches b
    join public.organizations o on o.id = b.organization_id
    where b.id = p_branch_id and o.owner_id = p_owner_id for update of b, o;
  if not found then raise exception using message = 'BRANCH_ACCESS_DENIED', errcode = 'P0001'; end if;

  select * into v_existing from public.server_registrations where id = p_registration_id for update;
  if found then
    if v_existing.branch_id <> p_branch_id or v_existing.owner_id <> p_owner_id
       or v_existing.instance_id <> p_instance_id or v_existing.device_public_key_hash <> p_device_hash
       or v_existing.nonce <> p_nonce or v_existing.status <> 'ACTIVE' then
      raise exception using message = 'REGISTRATION_ID_CONFLICT', errcode = 'P0001';
    end if;
    -- Recover the SAME registration after a long outage. No new server/Owner
    -- is created. Local completion must read an existing binding before retry.
    if v_existing.expires_at <= v_now then
      update public.server_registrations set issued_at = v_now, expires_at = v_now + 900000
        where id = p_registration_id returning * into v_existing;
    end if;
  else
    if exists (select 1 from public.server_registrations where branch_id = p_branch_id and status = 'ACTIVE') then
      raise exception using message = 'BRANCH_ALREADY_REGISTERED', errcode = 'P0001';
    end if;
    begin
      insert into public.server_registrations(id,branch_id,owner_id,instance_id,device_public_key_hash,nonce,issued_at,expires_at)
        values(p_registration_id,p_branch_id,p_owner_id,p_instance_id,p_device_hash,p_nonce,v_now,v_now+900000)
        returning * into v_existing;
    exception when unique_violation then
      raise exception using message = 'REGISTRATION_CONFLICT', errcode = 'P0001';
    end;
    insert into public.activation_audit(owner_id,branch_id,registration_id,action)
      values(p_owner_id,p_branch_id,p_registration_id,'server.registered');
  end if;
  return jsonb_build_object('version',1,'instanceId',v_existing.instance_id,
    'branchId',v_existing.branch_id,'organizationId',v_org,'ownerCloudId',p_owner_id,
    'registrationId',v_existing.id,'devicePublicKeyHash',v_existing.device_public_key_hash,
    'nonce',v_existing.nonce,'issuedAt',v_existing.issued_at,'expiresAt',v_existing.expires_at);
end;
$$;
revoke all on function public.register_branch_server(uuid,uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.register_branch_server(uuid,uuid,uuid,uuid,text,text) to service_role;
