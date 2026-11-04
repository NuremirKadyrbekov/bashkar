-- Add a second presentation while keeping existing branches on classic.
alter table public.public_menu_design add column template text not null default 'classic' check(template in ('classic','categories'));
alter table public.public_menu_design add column wifi jsonb not null default '{"ssid":"","password":""}'::jsonb;
alter table public.public_menu_design add column category_titles jsonb not null default '{}'::jsonb;
create or replace function public.menu_photo_item_exists(p_branch uuid,p_item text) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select case when p_item in ('public_logo','public_banner') then exists(select 1 from public.branches where id=p_branch)
 when left(p_item,11)='public_cat_' then exists(select 1 from public.menu_device_acknowledgements ack join public.menu_cloud_versions v on v.branch_id=ack.branch_id and v.id=ack.version_id, lateral jsonb_array_elements(v.document->'categories') c where ack.branch_id=p_branch and ack.version_id=(select x.version_id from public.menu_device_acknowledgements x where x.branch_id=p_branch order by x.applied_at desc,x.local_revision desc limit 1) and c->>'id'=substring(p_item from 12) and coalesce((c->>'archived')::boolean,false)=false)
 else exists(select 1 from jsonb_array_elements((select v.document->'items' from public.menu_device_acknowledgements a join public.menu_cloud_versions v on v.branch_id=a.branch_id and v.id=a.version_id
 where a.branch_id=p_branch order by a.applied_at desc,a.local_revision desc limit 1)) i where i->>'id'=p_item and coalesce((i->>'archived')::boolean,false)=false) end;
$$;
create or replace function public.public_menu_design_manage(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text,p_operation text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb;b uuid;r public.public_menu_design%rowtype;langs text[];entry record;
begin
 d:=public.menu_device_assert(p_registration);b:=(d->>'branchId')::uuid;
 if d->>'deviceHash'<>p_device_hash then raise exception 'MENU_DEVICE_DENIED';end if;
 update public.menu_sync_challenges set processed=true where id=p_challenge and registration_id=p_registration and nonce=p_nonce and used and not processed and expires_at>clock_timestamp();
 if not found then raise exception 'MENU_CHALLENGE_EXPIRED';end if;
 if p_operation='publicMenuDesignSet' then
  if jsonb_typeof(p_payload->'expectedRevision')<>'number' or jsonb_typeof(p_payload->'theme')<>'string' or p_payload->>'theme' not in ('emerald','light','warm')
   or jsonb_typeof(p_payload->'defaultLanguage')<>'string' or jsonb_typeof(p_payload->'languages')<>'array' or jsonb_typeof(p_payload->'copy')<>'object' then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  if (p_payload->>'expectedRevision')::bigint<0 then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  if p_payload ? 'template' and (jsonb_typeof(p_payload->'template')<>'string' or p_payload->>'template' not in ('classic','categories')) then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  if p_payload ? 'wifi' and (jsonb_typeof(p_payload->'wifi')<>'object' or (select count(*) from jsonb_object_keys(p_payload->'wifi'))<>2 or not (p_payload->'wifi' ? 'ssid') or not (p_payload->'wifi' ? 'password') or jsonb_typeof(p_payload->'wifi'->'ssid')<>'string' or jsonb_typeof(p_payload->'wifi'->'password')<>'string' or length(p_payload->'wifi'->>'ssid')>80 or length(p_payload->'wifi'->>'password')>120) then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  if p_payload ? 'categoryTitles' then
   if jsonb_typeof(p_payload->'categoryTitles')<>'object' or (select count(*) from jsonb_object_keys(p_payload->'categoryTitles'))>500 then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
   if exists(select 1 from jsonb_each(p_payload->'categoryTitles') category where not exists(
      select 1 from public.menu_device_acknowledgements a join public.menu_cloud_versions v on v.branch_id=a.branch_id and v.id=a.version_id,
       lateral jsonb_array_elements(v.document->'categories') c
      where a.branch_id=b and a.version_id=(select latest.version_id from public.menu_device_acknowledgements latest where latest.branch_id=b order by latest.applied_at desc,latest.local_revision desc limit 1) and c->>'id'=category.key and coalesce((c->>'archived')::boolean,false)=false
      order by a.applied_at desc,a.local_revision desc limit 1)
     or jsonb_typeof(category.value)<>'object'
     or exists(select 1 from jsonb_each(category.value) title where title.key not in ('ru','ky','en') or jsonb_typeof(title.value)<>'string' or length(title.value#>>'{}')>120)) then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  end if;
  select array_agg(value) into langs from jsonb_array_elements_text(p_payload->'languages') value;
  if langs is null or array_length(langs,1)>3 or array_length(langs,1)<>array_length(array(select distinct unnest(langs)),1)
   or not (p_payload->>'defaultLanguage'=any(langs)) or exists(select 1 from unnest(langs) l where l not in ('ru','ky','en')) then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  if (select count(*) from jsonb_object_keys(p_payload->'copy'))>3 or nullif(btrim(p_payload->'copy'->(p_payload->>'defaultLanguage')->>'title'),'') is null then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  for entry in select key,value from jsonb_each(p_payload->'copy') loop
   if entry.key<>all(langs) or jsonb_typeof(entry.value)<>'object' or exists(select 1 from jsonb_object_keys(entry.value) k where k not in ('eyebrow','title','description','foot','menuTitle','menuDescription'))
    or exists(select 1 from jsonb_each(entry.value) f where jsonb_typeof(f.value)<>'string' or length(f.value#>>'{}')>500) then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  end loop;
  insert into public.public_menu_design(branch_id,theme,default_language,languages,copy,template,wifi,category_titles) select b,p_payload->>'theme',p_payload->>'defaultLanguage',langs,p_payload->'copy',coalesce(p_payload->>'template','classic'),coalesce(p_payload->'wifi','{"ssid":"","password":""}'::jsonb),coalesce(p_payload->'categoryTitles','{}'::jsonb)
   where (p_payload->>'expectedRevision')::bigint=0 on conflict do nothing;
  if not found then
   update public.public_menu_design set revision=revision+1,theme=p_payload->>'theme',default_language=p_payload->>'defaultLanguage',languages=langs,copy=p_payload->'copy',template=coalesce(p_payload->>'template',template),wifi=coalesce(p_payload->'wifi',wifi),category_titles=coalesce(p_payload->'categoryTitles',category_titles),updated_at=now()
   where branch_id=b and revision=(p_payload->>'expectedRevision')::bigint;
   if not found then raise exception 'PUBLIC_MENU_DESIGN_CONFLICT';end if;
  end if;
 elsif p_operation<>'publicMenuDesignStatus' then raise exception 'MENU_OPERATION_DENIED';end if;
 select * into r from public.public_menu_design where branch_id=b;
 return jsonb_build_object('revision',coalesce(r.revision,0),'theme',coalesce(r.theme,'emerald'),'defaultLanguage',coalesce(r.default_language,'ru'),'languages',coalesce(to_jsonb(r.languages),'["ru"]'::jsonb),'copy',coalesce(r.copy,'{}'::jsonb),'template',coalesce(r.template,'classic'),'wifi',coalesce(r.wifi,'{"ssid":"","password":""}'::jsonb),'categoryTitles',coalesce(r.category_titles,'{}'::jsonb),'updatedAt',r.updated_at);
end;$$;
create or replace function public.public_menu_design_read(p_branch uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('revision',coalesce(d.revision,0),'theme',coalesce(d.theme,'emerald'),'defaultLanguage',coalesce(d.default_language,'ru'),'languages',coalesce(to_jsonb(d.languages),'["ru"]'::jsonb),'copy',coalesce(d.copy,'{}'::jsonb),'template',coalesce(d.template,'classic'),'wifi',coalesce(d.wifi,'{"ssid":"","password":""}'::jsonb),'categoryTitles',coalesce(d.category_titles,'{}'::jsonb),'updatedAt',d.updated_at,
 'logoKey',(select a.object_key from public.menu_item_photos p join public.menu_photo_assets a on a.branch_id=p.branch_id and a.id=p.asset_id where p.branch_id=p_branch and p.item_id='public_logo'),
 'bannerKey',(select a.object_key from public.menu_item_photos p join public.menu_photo_assets a on a.branch_id=p.branch_id and a.id=p.asset_id where p.branch_id=p_branch and p.item_id='public_banner'),
 'categoryImageKeys',coalesce((select jsonb_object_agg(c->>'id',a.object_key) from public.menu_device_acknowledgements ack join public.menu_cloud_versions v on v.branch_id=ack.branch_id and v.id=ack.version_id, lateral jsonb_array_elements(v.document->'categories') c join public.menu_item_photos p on p.branch_id=p_branch and p.item_id='public_cat_'||(c->>'id') join public.menu_photo_assets a on a.branch_id=p.branch_id and a.id=p.asset_id where ack.branch_id=p_branch and ack.version_id=(select x.version_id from public.menu_device_acknowledgements x where x.branch_id=p_branch order by x.applied_at desc,x.local_revision desc limit 1) and coalesce((c->>'archived')::boolean,false)=false),'{}'::jsonb))
 from (select 1) x left join public.public_menu_design d on d.branch_id=p_branch;
$$;
revoke all on function public.public_menu_design_read(uuid) from public,anon,authenticated;
grant execute on function public.public_menu_design_read(uuid) to service_role;
