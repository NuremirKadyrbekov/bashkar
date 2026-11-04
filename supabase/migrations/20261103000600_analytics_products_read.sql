create or replace function public.analytics_products(p_organization uuid,p_branch uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare tz text;units bigint;top_products jsonb;updated_at timestamptz;incomplete boolean;
begin
 if auth.uid() is null or not exists(select 1 from public.organizations where id=p_organization and owner_id=auth.uid()) then raise exception 'OWNER_ACCESS_DENIED';end if;
 if p_branch is not null and not exists(select 1 from public.branches where id=p_branch and organization_id=p_organization) then raise exception 'BRANCH_ACCESS_DENIED';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then raise exception 'INVALID_PERIOD';end if;
 select case when p_branch is null then o.time_zone else b.time_zone end into tz from public.organizations o left join public.branches b on b.id=p_branch where o.id=p_organization;
 select coalesce(sum(f.quantity),0) into units from public.analytics_product_facts f join public.branches b on b.id=f.branch_id
  where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and (f.occurred_at at time zone b.time_zone)::date between p_from and p_to;
 with grouped as (
  select f.product_id,f.category_id,sum(f.quantity) quantity,
   (array_agg(f.product_name order by f.occurred_at desc,f.fact_id desc))[1] product_name,
   (array_agg(f.category_name order by f.occurred_at desc,f.fact_id desc))[1] category_name
  from public.analytics_product_facts f join public.branches b on b.id=f.branch_id
  where b.organization_id=p_organization and (p_branch is null or b.id=p_branch) and (f.occurred_at at time zone b.time_zone)::date between p_from and p_to
  group by f.product_id,f.category_id
 ), ranked as (select * from grouped order by quantity desc,product_name,product_id limit 10)
 select coalesce(jsonb_agg(jsonb_build_object('productId',product_id,'name',product_name,'categoryId',category_id,'category',category_name,'quantity',quantity) order by quantity desc,product_name,product_id),'[]'::jsonb) into top_products from ranked;
 select min(s.last_sync_at),bool_or(s.last_sync_at is null or not s.backfill_complete) into updated_at,incomplete
 from public.branches b left join public.analytics_sync_state s on s.branch_id=b.id where b.organization_id=p_organization and (p_branch is null or b.id=p_branch);
 return jsonb_build_object('branchId',p_branch,'dateFrom',p_from,'dateTo',p_to,'totalUnits',units,'topProducts',top_products,'lastSyncAt',updated_at,'partial',coalesce(incomplete,true),'timeZone',tz);
end;$$;
revoke all on function public.analytics_products(uuid,uuid,date,date) from public,anon;
grant execute on function public.analytics_products(uuid,uuid,date,date) to authenticated;
