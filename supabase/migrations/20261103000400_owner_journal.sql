create table public.owner_journal_records (
 branch_id uuid not null references public.branches(id),kind text not null check(kind in ('SALE','REFUND')),
 record_id uuid not null,order_id uuid not null,shift_id uuid not null,
 occurred_at timestamptz not null,record jsonb not null,content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 received_at timestamptz not null default clock_timestamp(),primary key(branch_id,kind,record_id)
);
create index owner_journal_recent on public.owner_journal_records(branch_id,occurred_at desc);
alter table public.owner_journal_records enable row level security;
revoke all on public.owner_journal_records from public,anon,authenticated;
grant all on public.owner_journal_records to service_role;

create or replace function public.owner_record_ingest(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text,p_fingerprint text,p_kind text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb;b uuid;prior public.analytics_sync_commands%rowtype;existing public.owner_journal_records%rowtype;
 rid uuid;oid uuid;sid uuid;at_time timestamptz;h text;rec jsonb;result jsonb;id_key text;time_key text;
begin
 d:=public.menu_device_assert(p_registration);b:=(d->>'branchId')::uuid;
 if d->>'deviceHash'<>p_device_hash then raise exception 'MENU_DEVICE_DENIED';end if;
 update public.menu_sync_challenges set processed=true where id=p_challenge and registration_id=p_registration and nonce=p_nonce and used and not processed and expires_at>clock_timestamp();
 if not found then raise exception 'MENU_CHALLENGE_EXPIRED';end if;
 if p_kind is null or p_kind not in ('SALE','REFUND') or p_payload->>'hash' is null or p_payload->>'hash' !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload->'record') is distinct from 'object' then raise exception 'INVALID_OWNER_RECORD';end if;
 rec:=p_payload->'record';h:=p_payload->>'hash';
 id_key:=case when p_kind='SALE' then 'settlementId' else 'refundId' end;
 time_key:=case when p_kind='SALE' then 'settledAt' else 'createdAt' end;
 rid:=(rec->>id_key)::uuid;oid:=(rec->>'orderId')::uuid;sid:=(rec->>'shiftId')::uuid;
 if p_payload->>'commandId'<>rid::text or (rec->>time_key) is null or (rec->>time_key)::numeric<0 then raise exception 'INVALID_OWNER_RECORD';end if;
 at_time:=to_timestamp((rec->>time_key)::numeric/1000);
 perform 1 from public.branches where id=b for update;
 select * into prior from public.analytics_sync_commands where registration_id=p_registration and command_id=rid;
 if found then
  if prior.fingerprint<>p_fingerprint then raise exception 'OWNER_RECORD_CONFLICT';end if;
  return prior.result;
 end if;
 select * into existing from public.owner_journal_records where branch_id=b and kind=p_kind and record_id=rid;
 if found then
  if existing.content_hash<>h or existing.order_id<>oid or existing.shift_id<>sid then raise exception 'OWNER_RECORD_CONFLICT';end if;
 else
  insert into public.owner_journal_records(branch_id,kind,record_id,order_id,shift_id,occurred_at,record,content_hash)
   values(b,p_kind,rid,oid,sid,at_time,rec,h);
 end if;
 result:=jsonb_build_object('state','APPLIED',id_key,rid,'hash',h);
 insert into public.analytics_sync_commands(registration_id,command_id,fingerprint,result) values(p_registration,rid,p_fingerprint,result);
 return result;
end;$$;
revoke all on function public.owner_record_ingest(uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.owner_record_ingest(uuid,uuid,uuid,text,text,text,jsonb) to service_role;

create or replace function public.owner_journal_list(p_organization uuid,p_branch uuid default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.organizations where id=p_organization and owner_id=auth.uid()) then raise exception 'OWNER_ACCESS_DENIED';end if;
 if p_branch is not null and not exists(select 1 from public.branches where id=p_branch and organization_id=p_organization) then raise exception 'BRANCH_ACCESS_DENIED';end if;
 if p_limit<1 or p_limit>100 then raise exception 'INVALID_LIMIT';end if;
 select coalesce(jsonb_agg(jsonb_build_object('branchId',q.branch_id,'kind',q.kind,'recordId',q.record_id,'orderId',q.order_id,'shiftId',q.shift_id,'occurredAt',q.occurred_at,'receivedAt',q.received_at,'record',q.record) order by q.occurred_at desc,q.record_id desc),'[]'::jsonb) into result
 from (select r.* from public.owner_journal_records r join public.branches b on b.id=r.branch_id where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and (p_before is null or r.occurred_at<p_before or (r.occurred_at=p_before and p_before_id is not null and r.record_id<p_before_id)) order by r.occurred_at desc,r.record_id desc limit p_limit) q;
 return result;
end;$$;
revoke all on function public.owner_journal_list(uuid,uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.owner_journal_list(uuid,uuid,timestamptz,uuid,integer) to authenticated;
