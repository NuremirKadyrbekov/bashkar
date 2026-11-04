-- Paid item quantities are immutable snapshots at settlement. Refunds never delete them.
create table public.analytics_product_facts (
 branch_id uuid not null references public.branches(id),fact_id uuid not null,order_id uuid not null,
 occurred_at timestamptz not null,product_id text not null,product_name text not null,
 category_id text not null,category_name text not null,quantity integer not null check(quantity between 1 and 9999),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),primary key(branch_id,fact_id)
);
create index analytics_product_facts_range on public.analytics_product_facts(branch_id,occurred_at);
alter table public.analytics_product_facts enable row level security;
revoke all on public.analytics_product_facts from public,anon,authenticated;
grant all on public.analytics_product_facts to service_role;

create or replace function public.analytics_ingest(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text,p_fingerprint text,p_payload jsonb)
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
  if (v->>'kind') not in ('SETTLEMENT','PAYMENT','REFUND','CANCELLED','PRODUCT') or (v->>'amount') !~ '^[0-9]{1,15}$'
    or (v->>'discount') !~ '^[0-9]{1,15}$' or (v->>'hash') !~ '^[0-9a-f]{64}$'
    or (v->>'occurredAt') is null or (v->>'id') is null or (v->>'orderId') is null then raise exception 'INVALID_ANALYTICS_BATCH';end if;
  if v->>'kind'='PRODUCT' then
   if (v->>'productId') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' or (v->>'categoryId') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
      or length(v->>'productName') not between 1 and 300 or length(v->>'categoryName') not between 1 and 300
      or (v->>'quantity') !~ '^[1-9][0-9]{0,3}$' or (v->>'quantity')::integer>9999
      or v->>'amount'<>'0' or v->>'discount'<>'0' or v->>'method' is not null or v->>'serviceType' is not null then raise exception 'INVALID_ANALYTICS_BATCH';end if;
   insert into public.analytics_product_facts(branch_id,fact_id,order_id,occurred_at,product_id,product_name,category_id,category_name,quantity,content_hash)
    values(b,(v->>'id')::uuid,(v->>'orderId')::uuid,to_timestamp((v->>'occurredAt')::numeric/1000),v->>'productId',v->>'productName',v->>'categoryId',v->>'categoryName',(v->>'quantity')::integer,v->>'hash') on conflict do nothing;
   select content_hash into existing_hash from public.analytics_product_facts where branch_id=b and fact_id=(v->>'id')::uuid;
  else
  insert into public.analytics_facts(branch_id,kind,fact_id,order_id,occurred_at,amount,discount,method,service_type,content_hash)
   values(b,v->>'kind',(v->>'id')::uuid,(v->>'orderId')::uuid,to_timestamp((v->>'occurredAt')::numeric/1000),(v->>'amount')::bigint,(v->>'discount')::bigint,
     nullif(v->>'method',''),nullif(v->>'serviceType',''),v->>'hash') on conflict do nothing;
  select content_hash into existing_hash from public.analytics_facts where branch_id=b and kind=v->>'kind' and fact_id=(v->>'id')::uuid;
  end if;
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
