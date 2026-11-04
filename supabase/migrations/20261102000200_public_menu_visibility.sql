-- Public category visibility and catalog schema 3 for per-item visibility.
alter table public.public_menu_design add column hidden_categories jsonb not null default '[]'::jsonb check(jsonb_typeof(hidden_categories)='array');
alter table public.menu_cloud_versions drop constraint menu_cloud_versions_catalog_schema_check;
alter table public.menu_cloud_versions add constraint menu_cloud_versions_catalog_schema_check check(catalog_schema in (1,2,3));
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
  if p_payload ? 'hiddenCategoryIds' then
   if jsonb_typeof(p_payload->'hiddenCategoryIds')<>'array' or jsonb_array_length(p_payload->'hiddenCategoryIds')>500
    or exists(select 1 from jsonb_array_elements(p_payload->'hiddenCategoryIds') as hidden(value) where jsonb_typeof(hidden.value)<>'string')
    or (select count(*) from jsonb_array_elements_text(p_payload->'hiddenCategoryIds'))<>(select count(distinct value) from jsonb_array_elements_text(p_payload->'hiddenCategoryIds'))
    or exists(select 1 from jsonb_array_elements_text(p_payload->'hiddenCategoryIds') as hidden(value) where not exists(
     select 1 from public.menu_device_acknowledgements a join public.menu_cloud_versions v on v.branch_id=a.branch_id and v.id=a.version_id,
      lateral jsonb_array_elements(v.document->'categories') c
     where a.branch_id=b and a.version_id=(select latest.version_id from public.menu_device_acknowledgements latest where latest.branch_id=b order by latest.applied_at desc,latest.local_revision desc limit 1)
      and c->>'id'=hidden.value and coalesce((c->>'archived')::boolean,false)=false)) then raise exception 'INVALID_PUBLIC_MENU_DESIGN';end if;
  end if;
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
  insert into public.public_menu_design(branch_id,theme,default_language,languages,copy,template,wifi,category_titles,hidden_categories) select b,p_payload->>'theme',p_payload->>'defaultLanguage',langs,p_payload->'copy',coalesce(p_payload->>'template','classic'),coalesce(p_payload->'wifi','{"ssid":"","password":""}'::jsonb),coalesce(p_payload->'categoryTitles','{}'::jsonb),coalesce(p_payload->'hiddenCategoryIds','[]'::jsonb)
   where (p_payload->>'expectedRevision')::bigint=0 on conflict do nothing;
  if not found then
   update public.public_menu_design set revision=revision+1,theme=p_payload->>'theme',default_language=p_payload->>'defaultLanguage',languages=langs,copy=p_payload->'copy',template=coalesce(p_payload->>'template',template),wifi=coalesce(p_payload->'wifi',wifi),category_titles=coalesce(p_payload->'categoryTitles',category_titles),hidden_categories=coalesce(p_payload->'hiddenCategoryIds',hidden_categories),updated_at=now()
   where branch_id=b and revision=(p_payload->>'expectedRevision')::bigint;
   if not found then raise exception 'PUBLIC_MENU_DESIGN_CONFLICT';end if;
  end if;
 elsif p_operation<>'publicMenuDesignStatus' then raise exception 'MENU_OPERATION_DENIED';end if;
 select * into r from public.public_menu_design where branch_id=b;
 return jsonb_build_object('revision',coalesce(r.revision,0),'theme',coalesce(r.theme,'emerald'),'defaultLanguage',coalesce(r.default_language,'ru'),'languages',coalesce(to_jsonb(r.languages),'["ru"]'::jsonb),'copy',coalesce(r.copy,'{}'::jsonb),'template',coalesce(r.template,'classic'),'wifi',coalesce(r.wifi,'{"ssid":"","password":""}'::jsonb),'categoryTitles',coalesce(r.category_titles,'{}'::jsonb),'hiddenCategoryIds',coalesce(r.hidden_categories,'[]'::jsonb),'updatedAt',r.updated_at);
end;$$;
create or replace function public.public_menu_design_read(p_branch uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('revision',coalesce(d.revision,0),'theme',coalesce(d.theme,'emerald'),'defaultLanguage',coalesce(d.default_language,'ru'),'languages',coalesce(to_jsonb(d.languages),'["ru"]'::jsonb),'copy',coalesce(d.copy,'{}'::jsonb),'template',coalesce(d.template,'classic'),'wifi',coalesce(d.wifi,'{"ssid":"","password":""}'::jsonb),'categoryTitles',coalesce(d.category_titles,'{}'::jsonb),'hiddenCategoryIds',coalesce(d.hidden_categories,'[]'::jsonb),'updatedAt',d.updated_at,
 'logoKey',(select a.object_key from public.menu_item_photos p join public.menu_photo_assets a on a.branch_id=p.branch_id and a.id=p.asset_id where p.branch_id=p_branch and p.item_id='public_logo'),
 'bannerKey',(select a.object_key from public.menu_item_photos p join public.menu_photo_assets a on a.branch_id=p.branch_id and a.id=p.asset_id where p.branch_id=p_branch and p.item_id='public_banner'),
 'categoryImageKeys',coalesce((select jsonb_object_agg(c->>'id',a.object_key) from public.menu_device_acknowledgements ack join public.menu_cloud_versions v on v.branch_id=ack.branch_id and v.id=ack.version_id, lateral jsonb_array_elements(v.document->'categories') c join public.menu_item_photos p on p.branch_id=p_branch and p.item_id='public_cat_'||(c->>'id') join public.menu_photo_assets a on a.branch_id=p.branch_id and a.id=p.asset_id where ack.branch_id=p_branch and ack.version_id=(select x.version_id from public.menu_device_acknowledgements x where x.branch_id=p_branch order by x.applied_at desc,x.local_revision desc limit 1) and coalesce((c->>'archived')::boolean,false)=false),'{}'::jsonb))
 from (select 1) x left join public.public_menu_design d on d.branch_id=p_branch;
$$;
revoke all on function public.public_menu_design_read(uuid) from public,anon,authenticated;
grant execute on function public.public_menu_design_read(uuid) to service_role;
create or replace function public.menu_sync_execute(p_registration uuid,p_challenge uuid,p_nonce uuid,p_device_hash text,p_operation text,p_fingerprint text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
  if vid is null or p_payload->>'expectedHead' is distinct from v->>'parentId' or (v->>'schema')::integer not in (1,2,3) or octet_length((v->'document')::text)>2097152 or v->>'origin' not in ('LOCAL_POS','CLOUD_RESTORE') then raise exception 'INVALID_MENU_VERSION';end if;
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
  insert into public.menu_cloud_versions(id,branch_id,registration_id,parent_id,content_hash,catalog_schema,document,author,origin,local_revision,published_at) values(vid,b,p_registration,parent,v->>'hash',(v->>'schema')::integer,v->'document',v->'author',v->>'origin',(v->>'localRevision')::bigint,(v->>'publishedAt')::bigint);
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
