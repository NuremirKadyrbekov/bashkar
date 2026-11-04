-- Branch scoped presentation settings. Catalog publication remains independent.
create table public.public_menu_design (
 branch_id uuid primary key references public.branches(id),
 revision bigint not null default 1 check (revision > 0),
 theme text not null default 'emerald' check (theme in ('emerald','light','warm')),
 default_language text not null default 'ru',
 languages text[] not null default array['ru'],
 copy jsonb not null default '{}'::jsonb check (jsonb_typeof(copy)='object'),
 updated_at timestamptz not null default now()
);
alter table public.public_menu_design enable row level security;
revoke all on public.public_menu_design from public,anon,authenticated;
grant all on public.public_menu_design to service_role;

-- Reserved media slots use the existing signed media grant, CAS and Bunny storage.
create or replace function public.menu_photo_item_exists(p_branch uuid,p_item text) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select case when p_item in ('public_logo','public_banner') then exists(select 1 from public.branches where id=p_branch)
 else exists(select 1 from jsonb_array_elements((select v.document->'items' from public.menu_device_acknowledgements a join public.menu_cloud_versions v on v.branch_id=a.branch_id and v.id=a.version_id
 where a.branch_id=p_branch order by a.applied_at desc,a.local_revision desc limit 1)) i where i->>'id'=p_item and coalesce((i->>'archived')::boolean,false)=false) end;
$$;

create function public.public_menu_design_manage(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text,p_operation text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
  select array_agg(value) into langs from jsonb_array_elements_text(p_payload->'languages') value;
  if langs is null or array_length(langs,1)>3 or array_length(langs,1)<>array_length(array(select distinct unnest(langs)),1)
   or not (p_payload->>'defaultLanguage'=any(langs)) or exists(select 1 from unnest(langs) l where l not in ('ru','ky','en')) then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  if (select count(*) from jsonb_object_keys(p_payload->'copy'))>3 or nullif(btrim(p_payload->'copy'->(p_payload->>'defaultLanguage')->>'title'),'') is null then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  for entry in select key,value from jsonb_each(p_payload->'copy') loop
   if entry.key<>all(langs) or jsonb_typeof(entry.value)<>'object' or exists(select 1 from jsonb_object_keys(entry.value) k where k not in ('eyebrow','title','description','foot','menuTitle','menuDescription'))
    or exists(select 1 from jsonb_each(entry.value) f where jsonb_typeof(f.value)<>'string' or length(f.value#>>'{}')>500) then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  end loop;
  insert into public.public_menu_design(branch_id,theme,default_language,languages,copy) select b,p_payload->>'theme',p_payload->>'defaultLanguage',langs,p_payload->'copy'
   where (p_payload->>'expectedRevision')::bigint=0 on conflict do nothing;
  if not found then
   update public.public_menu_design set revision=revision+1,theme=p_payload->>'theme',default_language=p_payload->>'defaultLanguage',languages=langs,copy=p_payload->'copy',updated_at=now()
   where branch_id=b and revision=(p_payload->>'expectedRevision')::bigint;
   if not found then raise exception 'PUBLIC_MENU_DESIGN_CONFLICT';end if;
  end if;
 elsif p_operation<>'publicMenuDesignStatus' then raise exception 'MENU_OPERATION_DENIED';end if;
 select * into r from public.public_menu_design where branch_id=b;
 return jsonb_build_object('revision',coalesce(r.revision,0),'theme',coalesce(r.theme,'emerald'),'defaultLanguage',coalesce(r.default_language,'ru'),'languages',coalesce(to_jsonb(r.languages),'["ru"]'::jsonb),'copy',coalesce(r.copy,'{}'::jsonb),'updatedAt',r.updated_at);
end;$$;
revoke all on function public.public_menu_design_manage(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.public_menu_design_manage(uuid,uuid,uuid,text,text,jsonb) to service_role;

create function public.public_menu_design_read(p_branch uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('revision',coalesce(d.revision,0),'theme',coalesce(d.theme,'emerald'),'defaultLanguage',coalesce(d.default_language,'ru'),'languages',coalesce(to_jsonb(d.languages),'["ru"]'::jsonb),'copy',coalesce(d.copy,'{}'::jsonb),'updatedAt',d.updated_at,
 'logoKey',(select a.object_key from public.menu_item_photos p join public.menu_photo_assets a on a.branch_id=p.branch_id and a.id=p.asset_id where p.branch_id=p_branch and p.item_id='public_logo'),
 'bannerKey',(select a.object_key from public.menu_item_photos p join public.menu_photo_assets a on a.branch_id=p.branch_id and a.id=p.asset_id where p.branch_id=p_branch and p.item_id='public_banner'))
 from (select 1) x left join public.public_menu_design d on d.branch_id=p_branch;
$$;
revoke all on function public.public_menu_design_read(uuid) from public,anon,authenticated;
grant execute on function public.public_menu_design_read(uuid) to service_role;
