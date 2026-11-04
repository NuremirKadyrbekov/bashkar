-- Confirmed financial facts only. Local SQLite remains authoritative.
alter table public.organizations add column if not exists time_zone text not null default 'Asia/Bishkek';
alter table public.branches add column if not exists time_zone text not null default 'Asia/Bishkek';

create table public.analytics_facts (
 branch_id uuid not null references public.branches(id),kind text not null check(kind in ('SETTLEMENT','PAYMENT','REFUND','CANCELLED')),
 fact_id uuid not null,order_id uuid not null,occurred_at timestamptz not null,
 amount bigint not null check(amount>=0),discount bigint not null default 0 check(discount>=0),
 method text check(method in ('CASH','CARD_MANUAL','QR_TRANSFER_MANUAL')),
 service_type text check(service_type in ('TABLE','COUNTER')),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 primary key(branch_id,kind,fact_id),
 check((kind='PAYMENT' and method is not null and service_type is not null and amount>0 and discount=0)
    or (kind='SETTLEMENT' and method is null and service_type is not null and amount>0)
    or (kind='REFUND' and method is not null and service_type is null and amount>0 and discount=0)
    or (kind='CANCELLED' and method is null and service_type is null and amount=0 and discount=0))
);
create index analytics_facts_time on public.analytics_facts(branch_id,kind,occurred_at);
create table public.analytics_sync_state (
 branch_id uuid primary key references public.branches(id),registration_id uuid not null references public.server_registrations(id),
 last_sync_at timestamptz not null,backfill_complete boolean not null default false
);
create table public.analytics_sync_commands (
 registration_id uuid not null references public.server_registrations(id),command_id uuid not null,
 fingerprint text not null,result jsonb not null,primary key(registration_id,command_id)
);
do $$declare t text;begin foreach t in array array['analytics_facts','analytics_sync_state','analytics_sync_commands'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop;end;$$;

create function public.analytics_ingest(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text,p_fingerprint text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb;b uuid;prior public.analytics_sync_commands%rowtype;v jsonb;existing_hash text;result jsonb;n integer:=0;
begin
 d:=public.menu_device_assert(p_registration);b:=(d->>'branchId')::uuid;
 if d->>'deviceHash'<>p_device_hash then raise exception 'MENU_DEVICE_DENIED';end if;
 update public.menu_sync_challenges set processed=true where id=p_challenge and registration_id=p_registration and nonce=p_nonce and used and not processed and expires_at>clock_timestamp();
 if not found then raise exception 'MENU_CHALLENGE_EXPIRED';end if;
 if jsonb_typeof(p_payload->'facts')<>'array' or jsonb_array_length(p_payload->'facts')>100
   or jsonb_typeof(p_payload->'backfillComplete')<>'boolean' then raise exception 'INVALID_ANALYTICS_BATCH';end if;
 perform 1 from public.branches where id=b for update;
 select * into prior from public.analytics_sync_commands where registration_id=p_registration and command_id=(p_payload->>'commandId')::uuid;
 if found then
  if prior.fingerprint<>p_fingerprint then raise exception 'ANALYTICS_COMMAND_CONFLICT';end if;
  return prior.result;
 end if;
 for v in select value from jsonb_array_elements(p_payload->'facts') loop
  if (v->>'kind') not in ('SETTLEMENT','PAYMENT','REFUND','CANCELLED') or (v->>'amount') !~ '^[0-9]{1,15}$'
    or (v->>'discount') !~ '^[0-9]{1,15}$' or (v->>'hash') !~ '^[0-9a-f]{64}$'
    or (v->>'occurredAt') is null or (v->>'id') is null or (v->>'orderId') is null then raise exception 'INVALID_ANALYTICS_BATCH';end if;
  insert into public.analytics_facts(branch_id,kind,fact_id,order_id,occurred_at,amount,discount,method,service_type,content_hash)
   values(b,v->>'kind',(v->>'id')::uuid,(v->>'orderId')::uuid,to_timestamp((v->>'occurredAt')::numeric/1000),(v->>'amount')::bigint,(v->>'discount')::bigint,
     nullif(v->>'method',''),nullif(v->>'serviceType',''),v->>'hash') on conflict do nothing;
  select content_hash into existing_hash from public.analytics_facts where branch_id=b and kind=v->>'kind' and fact_id=(v->>'id')::uuid;
  if existing_hash is distinct from v->>'hash' then raise exception 'ANALYTICS_FACT_CONFLICT';end if;
  n:=n+1;
 end loop;
 insert into public.analytics_sync_state(branch_id,registration_id,last_sync_at,backfill_complete)
  values(b,p_registration,clock_timestamp(),coalesce((p_payload->>'backfillComplete')::boolean,false))
  on conflict(branch_id) do update set registration_id=excluded.registration_id,last_sync_at=excluded.last_sync_at,
   backfill_complete=excluded.backfill_complete;
 result:=jsonb_build_object('state','APPLIED','accepted',n,'backfillComplete',coalesce((p_payload->>'backfillComplete')::boolean,false));
 insert into public.analytics_sync_commands(registration_id,command_id,fingerprint,result) values(p_registration,(p_payload->>'commandId')::uuid,p_fingerprint,result);
 return result;
end;$$;
revoke all on function public.analytics_ingest(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.analytics_ingest(uuid,uuid,uuid,text,text,jsonb) to service_role;

create function public.analytics_overview(p_organization uuid,p_branch uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare tz text;start_at timestamptz;end_at timestamptz;gross bigint;refunds bigint;paid integer;discounts bigint;cancelled integer;
 methods jsonb;services jsonb;points jsonb;updated_at timestamptz;incomplete boolean;result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.organizations where id=p_organization and owner_id=auth.uid()) then raise exception 'OWNER_ACCESS_DENIED';end if;
 if p_branch is not null and not exists(select 1 from public.branches where id=p_branch and organization_id=p_organization) then raise exception 'BRANCH_ACCESS_DENIED';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then raise exception 'INVALID_PERIOD';end if;
 select case when p_branch is null then o.time_zone else b.time_zone end into tz from public.organizations o left join public.branches b on b.id=p_branch where o.id=p_organization;
 start_at:=p_from::timestamp at time zone tz;end_at:=(p_to+1)::timestamp at time zone tz;
 select coalesce(sum(amount),0) into gross from public.analytics_facts f join public.branches b on b.id=f.branch_id
  where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and f.kind='PAYMENT' and f.occurred_at>=start_at and f.occurred_at<end_at;
 select coalesce(sum(amount),0) into refunds from public.analytics_facts f join public.branches b on b.id=f.branch_id
  where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and f.kind='REFUND' and f.occurred_at>=start_at and f.occurred_at<end_at;
 select count(*),coalesce(sum(discount),0) into paid,discounts from public.analytics_facts f join public.branches b on b.id=f.branch_id
  where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and f.kind='SETTLEMENT' and f.occurred_at>=start_at and f.occurred_at<end_at;
 select count(*) into cancelled from public.analytics_facts f join public.branches b on b.id=f.branch_id
  where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and f.kind='CANCELLED' and f.occurred_at>=start_at and f.occurred_at<end_at;
 select jsonb_build_object('CASH',coalesce(sum(amount) filter(where method='CASH'),0)::text,'CARD_MANUAL',coalesce(sum(amount) filter(where method='CARD_MANUAL'),0)::text,'QR_TRANSFER_MANUAL',coalesce(sum(amount) filter(where method='QR_TRANSFER_MANUAL'),0)::text) into methods
  from public.analytics_facts f join public.branches b on b.id=f.branch_id where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and f.kind='PAYMENT' and f.occurred_at>=start_at and f.occurred_at<end_at;
 select jsonb_build_object('TABLE',jsonb_build_object('amount',coalesce(sum(amount) filter(where kind='PAYMENT' and service_type='TABLE'),0)::text,'paidOrdersCount',count(*) filter(where kind='SETTLEMENT' and service_type='TABLE')),
  'COUNTER',jsonb_build_object('amount',coalesce(sum(amount) filter(where kind='PAYMENT' and service_type='COUNTER'),0)::text,'paidOrdersCount',count(*) filter(where kind='SETTLEMENT' and service_type='COUNTER'))) into services
  from public.analytics_facts f join public.branches b on b.id=f.branch_id where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and f.kind in ('PAYMENT','SETTLEMENT') and f.occurred_at>=start_at and f.occurred_at<end_at;
 if p_from=p_to then
  select coalesce(jsonb_agg(jsonb_build_object('period',to_char(g at time zone tz,'YYYY-MM-DD"T"HH24'),'amount',coalesce((select sum(f.amount) from public.analytics_facts f join public.branches b on b.id=f.branch_id where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and f.kind='PAYMENT' and f.occurred_at>=g and f.occurred_at<g+interval '1 hour'),0)::text) order by g),'[]'::jsonb) into points from generate_series(start_at,end_at-interval '1 hour',interval '1 hour') g;
 else
  select coalesce(jsonb_agg(jsonb_build_object('period',d::date::text,'amount',coalesce((select sum(f.amount) from public.analytics_facts f join public.branches b on b.id=f.branch_id where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and f.kind='PAYMENT' and f.occurred_at >= (d at time zone tz) and f.occurred_at < ((d+interval '1 day') at time zone tz)),0)::text) order by d),'[]'::jsonb) into points from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d;
 end if;
 select min(s.last_sync_at),bool_or(s.last_sync_at is null or not s.backfill_complete) into updated_at,incomplete from public.branches b left join public.analytics_sync_state s on s.branch_id=b.id where b.organization_id=p_organization and (p_branch is null or b.id=p_branch);
 return jsonb_build_object('organizationId',p_organization,'branchId',p_branch,'dateFrom',p_from,'dateTo',p_to,'timeZone',tz,'grossPaymentsAmount',gross::text,'refundsAmount',refunds::text,'netReceiptsAmount',(gross-refunds)::text,'paidOrdersCount',paid,'averageCheckAmount',case when paid=0 then '0' else round(gross::numeric/paid)::bigint::text end,'discountsAmount',discounts::text,'cancelledOrdersCount',cancelled,'paymentMethods',methods,'serviceTypes',services,'dynamics',points,'lastSyncAt',updated_at,'partial',coalesce(incomplete,true));
end;$$;
revoke all on function public.analytics_overview(uuid,uuid,date,date) from public,anon;
grant execute on function public.analytics_overview(uuid,uuid,date,date) to authenticated;
