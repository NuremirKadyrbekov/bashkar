-- Immutable shift reports received from signed branch devices.
create table public.owner_shift_reports (
 branch_id uuid not null references public.branches(id),
 report_id uuid not null, shift_id uuid not null,
 snapshot jsonb not null, content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 closed_at timestamptz not null, received_at timestamptz not null default clock_timestamp(),
 primary key(branch_id,report_id),unique(branch_id,shift_id)
);
create index owner_shift_reports_recent on public.owner_shift_reports(branch_id,closed_at desc);
alter table public.owner_shift_reports enable row level security;
revoke all on public.owner_shift_reports from public,anon,authenticated;
grant all on public.owner_shift_reports to service_role;

-- A report creates one logical Telegram job. A later bot pairing flow supplies
-- the verified recipient; delivery is never performed by the POS computer.
create table public.owner_report_notifications (
 branch_id uuid not null,report_id uuid not null,
 state text not null default 'WAITING_CONFIGURATION' check(state in ('WAITING_CONFIGURATION','PENDING','SENDING','SENT','FAILED','UNKNOWN')),
 attempts integer not null default 0 check(attempts>=0),last_error text,sent_at timestamptz,
 primary key(branch_id,report_id),foreign key(branch_id,report_id) references public.owner_shift_reports(branch_id,report_id)
);
alter table public.owner_report_notifications enable row level security;
revoke all on public.owner_report_notifications from public,anon,authenticated;
grant all on public.owner_report_notifications to service_role;

create or replace function public.shift_report_ingest(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text,p_fingerprint text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb;b uuid;prior public.analytics_sync_commands%rowtype;existing public.owner_shift_reports%rowtype;result jsonb;rid uuid;sid uuid;h text;snapshot jsonb;
begin
 d:=public.menu_device_assert(p_registration);b:=(d->>'branchId')::uuid;
 if d->>'deviceHash'<>p_device_hash then raise exception 'MENU_DEVICE_DENIED';end if;
 update public.menu_sync_challenges set processed=true where id=p_challenge and registration_id=p_registration and nonce=p_nonce and used and not processed and expires_at>clock_timestamp();
 if not found then raise exception 'MENU_CHALLENGE_EXPIRED';end if;
 if p_payload->>'commandId' is null or p_payload->>'reportId' is null or p_payload->>'commandId'<>p_payload->>'reportId' or p_payload->>'hash' is null or p_payload->>'hash' !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload->'snapshot') is distinct from 'object' then raise exception 'INVALID_SHIFT_REPORT';end if;
 rid:=(p_payload->>'reportId')::uuid;sid:=(p_payload->>'shiftId')::uuid;h:=p_payload->>'hash';snapshot:=p_payload->'snapshot';
 if snapshot->>'branchId'<>b::text or snapshot->>'shiftId'<>sid::text or snapshot->>'reportId'<>rid::text or snapshot->>'status'<>'CLOSED' then raise exception 'INVALID_SHIFT_REPORT';end if;
 perform 1 from public.branches where id=b for update;
 select * into prior from public.analytics_sync_commands where registration_id=p_registration and command_id=rid;
 if found then
  if prior.fingerprint<>p_fingerprint then raise exception 'SHIFT_REPORT_CONFLICT';end if;
  return prior.result;
 end if;
 select * into existing from public.owner_shift_reports where branch_id=b and (report_id=rid or shift_id=sid);
 if found then
  if existing.report_id<>rid or existing.shift_id<>sid or existing.content_hash<>h then raise exception 'SHIFT_REPORT_CONFLICT';end if;
 else
  insert into public.owner_shift_reports(branch_id,report_id,shift_id,snapshot,content_hash,closed_at)
   values(b,rid,sid,snapshot,h,to_timestamp((snapshot->>'closedAt')::numeric/1000));
 end if;
 insert into public.owner_report_notifications(branch_id,report_id) values(b,rid) on conflict do nothing;
 result:=jsonb_build_object('state','APPLIED','reportId',rid,'hash',h);
 insert into public.analytics_sync_commands(registration_id,command_id,fingerprint,result) values(p_registration,rid,p_fingerprint,result);
 return result;
end;$$;
revoke all on function public.shift_report_ingest(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.shift_report_ingest(uuid,uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.owner_shift_reports_list(p_organization uuid,p_branch uuid default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.organizations where id=p_organization and owner_id=auth.uid()) then raise exception 'OWNER_ACCESS_DENIED';end if;
 if p_branch is not null and not exists(select 1 from public.branches where id=p_branch and organization_id=p_organization) then raise exception 'BRANCH_ACCESS_DENIED';end if;
 if p_limit<1 or p_limit>100 then raise exception 'INVALID_LIMIT';end if;
 select coalesce(jsonb_agg(jsonb_build_object('branchId',q.branch_id,'reportId',q.report_id,'shiftId',q.shift_id,'closedAt',q.closed_at,'receivedAt',q.received_at,'snapshot',q.snapshot,'telegramStatus',q.telegram_state) order by q.closed_at desc,q.report_id desc),'[]'::jsonb) into result
 from (select r.*,n.state telegram_state from public.owner_shift_reports r join public.branches b on b.id=r.branch_id left join public.owner_report_notifications n on n.branch_id=r.branch_id and n.report_id=r.report_id where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and (p_before is null or r.closed_at<p_before or (r.closed_at=p_before and p_before_id is not null and r.report_id<p_before_id)) order by r.closed_at desc,r.report_id desc limit p_limit) q;
 return result;
end;$$;
revoke all on function public.owner_shift_reports_list(uuid,uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.owner_shift_reports_list(uuid,uuid,timestamptz,uuid,integer) to authenticated;
