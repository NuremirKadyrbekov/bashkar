create table public.owner_staff_snapshots (
 branch_id uuid not null references public.branches(id),shift_id uuid not null,employee_id uuid not null,
 employee_name text not null,employee_role text not null,record jsonb not null,
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),received_at timestamptz not null default clock_timestamp(),
 primary key(branch_id,shift_id,employee_id)
);
create index owner_staff_by_shift on public.owner_staff_snapshots(branch_id,shift_id);
alter table public.owner_staff_snapshots enable row level security;
revoke all on public.owner_staff_snapshots from public,anon,authenticated;
grant all on public.owner_staff_snapshots to service_role;

create or replace function public.owner_staff_ingest(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text,p_fingerprint text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb;b uuid;prior public.analytics_sync_commands%rowtype;existing public.owner_staff_snapshots%rowtype;
 sid uuid;eid uuid;h text;rec jsonb;result jsonb;
begin
 d:=public.menu_device_assert(p_registration);b:=(d->>'branchId')::uuid;
 if d->>'deviceHash'<>p_device_hash then raise exception 'MENU_DEVICE_DENIED';end if;
 update public.menu_sync_challenges set processed=true where id=p_challenge and registration_id=p_registration and nonce=p_nonce and used and not processed and expires_at>clock_timestamp();
 if not found then raise exception 'MENU_CHALLENGE_EXPIRED';end if;
 if p_payload->>'hash' is null or p_payload->>'hash' !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload->'record') is distinct from 'object' then raise exception 'INVALID_STAFF_RECORD';end if;
 rec:=p_payload->'record';h:=p_payload->>'hash';sid:=(rec->>'shiftId')::uuid;eid:=(rec->>'employeeId')::uuid;
 if length(rec->>'name') not between 1 and 200 or rec->>'role' not in ('OWNER','MANAGER','CASHIER','WAITER') then raise exception 'INVALID_STAFF_RECORD';end if;
 perform 1 from public.branches where id=b for update;
 select * into prior from public.analytics_sync_commands where registration_id=p_registration and command_id=(p_payload->>'commandId')::uuid;
 if found then
  if prior.fingerprint<>p_fingerprint then raise exception 'STAFF_RECORD_CONFLICT';end if;
  return prior.result;
 end if;
 select * into existing from public.owner_staff_snapshots where branch_id=b and shift_id=sid and employee_id=eid;
 if found then
  if existing.content_hash<>h then raise exception 'STAFF_RECORD_CONFLICT';end if;
 else
  insert into public.owner_staff_snapshots(branch_id,shift_id,employee_id,employee_name,employee_role,record,content_hash)
   values(b,sid,eid,rec->>'name',rec->>'role',rec,h);
 end if;
 result:=jsonb_build_object('state','APPLIED','shiftId',sid,'employeeId',eid,'hash',h);
 insert into public.analytics_sync_commands(registration_id,command_id,fingerprint,result) values(p_registration,(p_payload->>'commandId')::uuid,p_fingerprint,result);
 return result;
end;$$;
revoke all on function public.owner_staff_ingest(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.owner_staff_ingest(uuid,uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.owner_staff_by_shift(p_organization uuid,p_shift uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.organizations where id=p_organization and owner_id=auth.uid()) then raise exception 'OWNER_ACCESS_DENIED';end if;
 select coalesce(jsonb_agg(jsonb_build_object('branchId',s.branch_id,'shiftId',s.shift_id,'employeeId',s.employee_id,'record',s.record) order by s.employee_name),'[]'::jsonb) into result
 from public.owner_staff_snapshots s join public.branches b on b.id=s.branch_id where b.organization_id=p_organization and s.shift_id=p_shift;
 return result;
end;$$;
revoke all on function public.owner_staff_by_shift(uuid,uuid) from public,anon;
grant execute on function public.owner_staff_by_shift(uuid,uuid) to authenticated;
