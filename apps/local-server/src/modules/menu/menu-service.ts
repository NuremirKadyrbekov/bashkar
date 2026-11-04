import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { audit, CommandBus, outbox } from '../../command-bus';
import { integer, requireCondition } from '../../errors';
import { AuthService } from '../auth/auth-service';
import { hasPermission } from '../auth/permissions';
import { type Catalog, validateCatalog, validateFees, entityId, object } from './catalog';
import {ensureMenuMetadata} from './sync-store';
import { priceLine, totals } from './pricing';
export class MenuService {
  onPublished?:()=>void;
  private salesRankingCache?:{settlementId:string|null;until:number;ranking:{itemId:string;units:number}[]};
  constructor(readonly db:Database.Database, readonly bus:CommandBus, readonly auth:AuthService, readonly now=Date.now) {}
  active(token:string) {
    this.auth.current(token);
    const row=this.db.prepare('SELECT r.document,r.revision FROM menu_revisions r JOIN menu_current c ON r.branch_id=c.branch_id AND r.revision=c.revision WHERE r.branch_id=?').get(this.auth.branchId) as {document:string;revision:number}|undefined;
    return row ? {revision:row.revision,catalog:JSON.parse(row.document) as Catalog} : {revision:0,catalog:null};
  }
  availability() {
    const rows=this.db.prepare('SELECT entity_id,available,revision FROM menu_availability WHERE branch_id=?').all(this.auth.branchId) as {entity_id:string;available:number;revision:number}[];
    return Object.fromEntries(rows.map(r=>[r.entity_id,{available:r.available===1,revision:r.revision}]));
  }
  salesCatalogLayout(token:string) {
    const actor=this.auth.current(token);
    requireCondition(hasPermission(this.db,actor.employee,'counter.view')||hasPermission(this.db,actor.employee,'table.view_status'),'PERMISSION_DENIED',403);
    const revision=(this.db.prepare('SELECT revision FROM sales_catalog_pin_state WHERE branch_id=?').get(actor.branchId) as {revision:number}|undefined)?.revision??0;
    const pins=this.db.prepare('SELECT category_id categoryId,item_id itemId FROM sales_catalog_pins WHERE branch_id=? ORDER BY category_id,position DESC').all(actor.branchId) as {categoryId:string;itemId:string}[];
    const now=this.now(),latest=(this.db.prepare('SELECT id FROM settlements INDEXED BY sales_time WHERE branch_id=? ORDER BY settled_at DESC,id DESC LIMIT 1').get(actor.branchId) as {id:string}|undefined)?.id??null;
    if(!this.salesRankingCache||this.salesRankingCache.settlementId!==latest||this.salesRankingCache.until<=now){
    const ranking=this.db.prepare(`SELECT json_extract(i.snapshot,'$.itemId') itemId,SUM(p.quantity) units
      FROM settlements s INDEXED BY sales_time
      JOIN settlement_seals seal ON seal.branch_id=s.branch_id AND seal.settlement_id=s.id
      JOIN orders o ON o.branch_id=s.branch_id AND o.id=s.order_id
      JOIN order_batches b ON b.branch_id=o.branch_id AND b.order_id=o.id
      JOIN order_items i ON i.branch_id=b.branch_id AND i.batch_id=b.id
      JOIN order_item_portions p ON p.branch_id=i.branch_id AND p.item_id=i.id
      WHERE s.branch_id=? AND s.settled_at>=? AND s.kind='PAID' AND o.status='COMPLETED' AND p.quantity>0
      GROUP BY json_extract(i.snapshot,'$.itemId')`).all(actor.branchId,now-30*86400000) as {itemId:string|null;units:number}[];
    this.salesRankingCache={settlementId:latest,until:now+60000,ranking:ranking.filter((row):row is {itemId:string;units:number}=>row.itemId!==null)};
    }
    return {revision,pins,ranking:this.salesRankingCache.ranking};
  }
  async setSalesCatalogPin(token:string,id:string,input:{categoryId:string;itemId:string;pinned:boolean;expectedRevision:number}) {
    const actor=this.auth.current(token,'menu.edit');
    requireCondition(typeof input.categoryId==='string'&&input.categoryId.length>0&&input.categoryId.length<=128&&typeof input.itemId==='string'&&input.itemId.length>0&&input.itemId.length<=128,'INVALID_ID');
    requireCondition(typeof input.pinned==='boolean','INVALID_BOOLEAN');integer(input.expectedRevision,0,Number.MAX_SAFE_INTEGER);
    return this.bus.run({id,type:'sales.catalog.pin',actor,payload:input},()=>{this.auth.current(token,'menu.edit');},()=>{
      const current=this.active(token).catalog;
      requireCondition(current?.categories.some(row=>row.id===input.categoryId&&!row.archived)&&current.items.some(row=>row.id===input.itemId&&row.categoryId===input.categoryId&&!row.archived),'MENU_ENTITY_NOT_FOUND',404);
      const revision=(this.db.prepare('SELECT revision FROM sales_catalog_pin_state WHERE branch_id=?').get(actor.branchId) as {revision:number}|undefined)?.revision??0;
      requireCondition(revision===input.expectedRevision,'SALES_CATALOG_PIN_CONFLICT',409);
      const existing=this.db.prepare('SELECT 1 FROM sales_catalog_pins WHERE branch_id=? AND category_id=? AND item_id=?').get(actor.branchId,input.categoryId,input.itemId);
      if(Boolean(existing)!==input.pinned){
        if(input.pinned){const position=(this.db.prepare('SELECT MAX(position) value FROM sales_catalog_pins WHERE branch_id=?').get(actor.branchId) as {value:number|null}).value??0;this.db.prepare('INSERT INTO sales_catalog_pins VALUES(?,?,?,?)').run(actor.branchId,input.categoryId,input.itemId,position+1);}
        else this.db.prepare('DELETE FROM sales_catalog_pins WHERE branch_id=? AND category_id=? AND item_id=?').run(actor.branchId,input.categoryId,input.itemId);
        this.db.prepare('INSERT INTO sales_catalog_pin_state VALUES(?,?) ON CONFLICT(branch_id) DO UPDATE SET revision=excluded.revision').run(actor.branchId,revision+1);
        audit(this.db,actor,input.pinned?'sales.catalog.pinned':'sales.catalog.unpinned',input.itemId,id,this.now(),{categoryId:input.categoryId});
      }
      return {revision:revision+(Boolean(existing)!==input.pinned?1:0),categoryId:input.categoryId,itemId:input.itemId,pinned:input.pinned};
    });
  }
  async saveDraft(token:string,id:string,input:{draftId:string|null;draftRevision:number;baseRevision:number;catalog:unknown}) {
    const actor=this.auth.current(token,'menu.edit'), catalog=validateCatalog(input.catalog);
    integer(input.baseRevision,0,Number.MAX_SAFE_INTEGER);integer(input.draftRevision,0,Number.MAX_SAFE_INTEGER);
    return this.bus.run({id,type:'menu.draft.save',actor,payload:{...input,catalog}},()=>{this.auth.current(token,'menu.edit');},()=>{
      const draftId=input.draftId??randomUUID();
      if(input.draftId) {
        const row=this.db.prepare('SELECT revision,base_revision FROM menu_drafts WHERE id=? AND branch_id=?').get(draftId,actor.branchId) as {revision:number;base_revision:number}|undefined;
        requireCondition(row && row.revision===input.draftRevision && row.base_revision===input.baseRevision,'DRAFT_CONFLICT');
        this.db.prepare('UPDATE menu_drafts SET document=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=?').run(JSON.stringify(catalog),actor.id,this.now(),draftId);
      } else {
        requireCondition(input.draftRevision===0,'DRAFT_CONFLICT');
        this.db.prepare('INSERT INTO menu_drafts VALUES(?,?,?,?,?,?,?)').run(draftId,actor.branchId,input.baseRevision,1,JSON.stringify(catalog),actor.id,this.now());
      }
      audit(this.db,actor,'menu.draft.saved',draftId,id,this.now());return {draftId,draftRevision:input.draftRevision+1};
    });
  }
  drafts(token:string) {
    this.auth.current(token,'menu.edit');return this.db.prepare('SELECT id,base_revision AS baseRevision,revision,updated_at AS updatedAt FROM menu_drafts WHERE branch_id=? ORDER BY updated_at DESC,id DESC LIMIT 100').all(this.auth.branchId);
  }
  revisions(token:string,before=0,limit=20) {
    this.auth.current(token,'menu.edit');integer(before,0,Number.MAX_SAFE_INTEGER);integer(limit,1,100);
    const rows=this.db.prepare("SELECT r.revision,r.created_at AS createdAt,r.created_by AS createdBy,COALESCE(json_extract(m.author,'$.name'),e.name,'Cloud') AS authorName,r.document FROM menu_revisions r LEFT JOIN employees e ON e.branch_id=r.branch_id AND e.id=r.created_by LEFT JOIN menu_sync_versions m ON m.branch_id=r.branch_id AND m.local_revision=r.revision WHERE r.branch_id=? AND (?=0 OR r.revision<?) ORDER BY r.revision DESC LIMIT ?").all(this.auth.branchId,before,before,limit+1) as {revision:number;createdAt:number;createdBy:string;authorName:string;document:string}[];
    const page=rows.slice(0,limit);
    return {revisions:page.map(({document,...row})=>{const c=JSON.parse(document) as Catalog;return {...row,categoryCount:c.categories.filter(c=>!c.archived).length,itemCount:c.items.filter(i=>!i.archived).length};}),next:rows.length>limit?page.at(-1)!.revision:null};
  }
  revision(token:string,revision:number) {
    this.auth.current(token,'menu.edit');integer(revision,1,Number.MAX_SAFE_INTEGER);
    const row=this.db.prepare("SELECT r.revision,r.created_at AS createdAt,r.created_by AS createdBy,COALESCE(json_extract(m.author,'$.name'),e.name,'Cloud') AS authorName,r.document FROM menu_revisions r LEFT JOIN employees e ON e.branch_id=r.branch_id AND e.id=r.created_by LEFT JOIN menu_sync_versions m ON m.branch_id=r.branch_id AND m.local_revision=r.revision WHERE r.branch_id=? AND r.revision=?").get(this.auth.branchId,revision) as {revision:number;createdAt:number;createdBy:string;authorName:string;document:string}|undefined;
    requireCondition(row,'MENU_REVISION_NOT_FOUND',404);const {document,...info}=row;return {...info,catalog:JSON.parse(document) as Catalog};
  }
  fees(token:string) {
    this.auth.current(token,'settings.service_charge.manage');
    const row=this.db.prepare('SELECT revision,fees FROM branch_settings WHERE branch_id=?').get(this.auth.branchId) as {revision:number;fees:string}|undefined;
    return {revision:row?.revision??0,fees:row?JSON.parse(row.fees):[]};
  }
  draft(token:string,id:string) {
    this.auth.current(token,'menu.edit'); const row=this.db.prepare('SELECT id,base_revision,revision,document FROM menu_drafts WHERE id=? AND branch_id=?').get(id,this.auth.branchId) as {id:string;base_revision:number;revision:number;document:string}|undefined;
    requireCondition(row,'DRAFT_NOT_FOUND',404);return {id:row.id,baseRevision:row.base_revision,revision:row.revision,catalog:JSON.parse(row.document)};
  }
  async publish(token:string,id:string,input:{draftId:string;draftRevision:number}) {
    const actor=this.auth.current(token,'menu.edit');
    return this.bus.run({id,type:'menu.publish',actor,payload:input},()=>{this.auth.current(token,'menu.edit');},()=>{
      const draft=this.draft(token,input.draftId); requireCondition(draft.revision===input.draftRevision,'DRAFT_CONFLICT');
      const current=this.active(token);requireCondition(current.revision===draft.baseRevision,'MENU_REVISION_CONFLICT');
      const catalog=validateCatalog(draft.catalog);
      this.validateTransition(catalog,()=>{this.auth.current(token,'menu.stoplist.manage');});
      const revision=this.appendRevision(catalog,actor.id,this.now());
      ensureMenuMetadata(this.db,actor.branchId);this.db.prepare("UPDATE menu_draft_sync SET state='PUBLISHED' WHERE draft_id=?").run(input.draftId);
      audit(this.db,actor,'menu.published',input.draftId,id,this.now(),{before:current.revision,after:revision});outbox(this.db,actor.branchId,'menu.published',{revision},this.now());return {revision};
    }).then(result=>{this.onPublished?.();return result;});
  }
  appendRevision(catalog:Catalog,createdBy:string|null,createdAt:number){const current=(this.db.prepare('SELECT revision FROM menu_current WHERE branch_id=?').get(this.auth.branchId) as {revision:number}|undefined)?.revision??0;const revision=current+1;this.db.prepare('INSERT INTO menu_revisions VALUES(?,?,?,?,?,?,?)').run(randomUUID(),this.auth.branchId,current,revision,JSON.stringify(catalog),createdBy,createdAt);this.db.prepare('INSERT INTO menu_current VALUES(?,?) ON CONFLICT(branch_id) DO UPDATE SET revision=excluded.revision').run(this.auth.branchId,revision);return revision;}
  validateTransition(catalog:Catalog,availabilityChange:()=>void){
    const current=this.activeDocument();
      if(current) {
        for(const category of current.categories) requireCondition(catalog.categories.some(c=>c.id===category.id),'CATEGORY_ARCHIVE_REQUIRED');
        for(const item of current.items) {
          const replacement=catalog.items.find(i=>i.id===item.id); requireCondition(replacement,'ITEM_ARCHIVE_REQUIRED');requireCondition((replacement.kind??'ITEM')===(item.kind??'ITEM'),'ITEM_KIND_IMMUTABLE');
          // Keep old variant and modifier IDs in immutable revisions, and never
          // let an ID change its kind/parent across publications.
        }
        const owners=(c:Catalog) => new Map(c.items.flatMap(i => [[i.id,'item'] as const,...i.variants.map(v=>[v.id,'variant:'+i.id] as const),...i.groups.flatMap(g=>[[g.id,'group:'+i.id] as const,...g.options.map(o=>[o.id,'modifier:'+i.id+':'+g.id] as const)]),...(i.combinationPrices??[]).map(row=>[row.id,'combination:'+i.id+':'+JSON.stringify([row.variantId,[...row.optionIds].sort()])] as const)]).concat(c.categories.map(x=>[x.id,'category'] as const)));
        const availabilityOf=(c:Catalog)=>new Map(c.items.flatMap(i=>[[i.id,i.available] as const,...i.variants.map(v=>[v.id,v.available] as const),...i.groups.flatMap(g=>g.options.map(o=>[o.id,o.available] as const)),...(i.combinationPrices??[]).map(row=>[row.id,row.available] as const)]));
        const oldAvailability=availabilityOf(current),newAvailability=availabilityOf(catalog);
        if([...newAvailability].some(([key,value])=>oldAvailability.has(key)&&oldAvailability.get(key)!==value))availabilityChange();
        const before=owners(current),after=owners(catalog);
        for(const [key,kind] of after)requireCondition(!before.has(key) || before.get(key)===kind,'ENTITY_ID_REUSED');
        // An ID removed in an earlier revision must not return under a different owner.
        const history=this.db.prepare('SELECT document FROM menu_revisions WHERE branch_id=?').all(this.auth.branchId) as {document:string}[];
        const nextKinds=new Map(catalog.items.map(item=>[item.id,item.kind??'ITEM']));
        for(const row of history){
          const prior=JSON.parse(row.document) as Catalog;
          for(const item of prior.items){const nextKind=nextKinds.get(item.id);requireCondition(nextKind===undefined||nextKind===(item.kind??'ITEM'),'ITEM_KIND_IMMUTABLE');}
          for(const [key,kind] of owners(prior))requireCondition(!after.has(key)||after.get(key)===kind,'ENTITY_ID_REUSED');
        }
      }
  }
  activeDocument():Catalog|null {const row=this.db.prepare('SELECT r.document FROM menu_revisions r JOIN menu_current c ON r.branch_id=c.branch_id AND r.revision=c.revision WHERE r.branch_id=?').get(this.auth.branchId) as {document:string}|undefined;return row?JSON.parse(row.document):null;}
  async stoplist(token:string,id:string,input:{entityId:string;available:boolean;revision:number}) {
    requireCondition(typeof input.available==='boolean','INVALID_BOOLEAN');integer(input.revision,0,Number.MAX_SAFE_INTEGER);
    const actor=this.auth.current(token,'menu.stoplist.manage');
    return this.bus.run({id,type:'menu.stoplist',actor,payload:input},()=>{this.auth.current(token,'menu.stoplist.manage');},()=>{
      const menu=this.active(token).catalog;requireCondition(menu && menu.items.some(i=>i.id===input.entityId || i.variants.some(v=>v.id===input.entityId) || i.groups.some(g=>g.options.some(o=>o.id===input.entityId)) || i.combinationPrices?.some(c=>c.id===input.entityId)),'MENU_ENTITY_NOT_FOUND');
      const current=this.availability()[input.entityId]; requireCondition((current?.revision??0)===input.revision,'AVAILABILITY_CONFLICT');
      const revision=input.revision+1;
      this.db.prepare('INSERT INTO menu_availability VALUES(?,?,?,?) ON CONFLICT(branch_id,entity_id) DO UPDATE SET available=excluded.available,revision=excluded.revision').run(actor.branchId,input.entityId,input.available?1:0,revision);
      audit(this.db,actor,'menu.stoplist',input.entityId,id,this.now(),{available:input.available,revision});outbox(this.db,actor.branchId,'menu.availability',{...input,revision},this.now());return {entityId:input.entityId,revision,available:input.available};
    });
  }
  async stoplistCategory(token:string,id:string,input:{categoryId:unknown;available:unknown;menuRevision:unknown;expected:unknown}) {
    const categoryId=entityId(input.categoryId),available=input.available;
    requireCondition(typeof available==='boolean','INVALID_BOOLEAN');
    const menuRevision=integer(input.menuRevision,1,Number.MAX_SAFE_INTEGER);
    requireCondition(Array.isArray(input.expected)&&input.expected.length<=10000,'INVALID_ARRAY');
    const expected=input.expected.map(value=>{const row=object(value,['entityId','revision']);return {entityId:entityId(row.entityId),revision:integer(row.revision,0,Number.MAX_SAFE_INTEGER)};});
    requireCondition(new Set(expected.map(row=>row.entityId)).size===expected.length,'DUPLICATE_ENTITY');
    const actor=this.auth.current(token,'menu.stoplist.manage');
    const payload={categoryId,available,menuRevision,expected};
    return this.bus.run({id,type:'menu.stoplist.category',actor,payload},()=>{this.auth.current(token,'menu.stoplist.manage');},()=>{
      const active=this.active(token);
      requireCondition(active.revision===menuRevision,'MENU_REVISION_CONFLICT',409);
      const catalog=active.catalog;
      requireCondition(catalog,'MENU_NOT_PUBLISHED',409);
      requireCondition(catalog.categories.some(row=>row.id===categoryId&&!row.archived),'MENU_CATEGORY_NOT_FOUND',404);
      const items=catalog.items.filter(row=>row.categoryId===categoryId&&!row.archived);
      requireCondition(items.length===expected.length&&items.every(row=>expected.some(value=>value.entityId===row.id)),'AVAILABILITY_CONFLICT',409);
      const current=this.availability();
      for(const row of expected)requireCondition((current[row.entityId]?.revision??0)===row.revision,'AVAILABILITY_CONFLICT',409);
      let changed=0;const now=this.now();
      for(const item of items){const prior=current[item.id],effective=prior?.available??item.available;if(effective===available)continue;const revision=(prior?.revision??0)+1;
        this.db.prepare('INSERT INTO menu_availability VALUES(?,?,?,?) ON CONFLICT(branch_id,entity_id) DO UPDATE SET available=excluded.available,revision=excluded.revision').run(actor.branchId,item.id,available?1:0,revision);
        audit(this.db,actor,'menu.stoplist',item.id,id,now,{available,revision,categoryId});
        outbox(this.db,actor.branchId,'menu.availability',{entityId:item.id,available,revision},now);changed++;
      }
      return {categoryId,available,changed,total:items.length};
    });
  }
  async configureFees(token:string,id:string,input:{revision:number;fees:unknown}) {
    const actor=this.auth.current(token,'settings.service_charge.manage'),fees=validateFees(input.fees);integer(input.revision,0,Number.MAX_SAFE_INTEGER);
    return this.bus.run({id,type:'settings.fees',actor,payload:{revision:input.revision,fees}},()=>{this.auth.current(token,'settings.service_charge.manage');},()=>{
      const previous=this.db.prepare('SELECT revision FROM branch_settings WHERE branch_id=?').get(actor.branchId) as {revision:number}|undefined;
      requireCondition((previous?.revision??0)===input.revision,'SETTINGS_CONFLICT');const revision=input.revision+1;
      this.db.prepare('INSERT INTO branch_settings VALUES(?,?,?) ON CONFLICT(branch_id) DO UPDATE SET revision=excluded.revision,fees=excluded.fees').run(actor.branchId,revision,JSON.stringify(fees));
      audit(this.db,actor,'settings.fees',actor.branchId,id,this.now(),{fees,revision});outbox(this.db,actor.branchId,'settings.fees',{fees,revision},this.now());return {revision,fees};
    });
  }
  quote(token:string,input:{menuRevision:number;type:'TABLE'|'COUNTER';lines:unknown[];discount:number}) {
    const current=this.active(token);requireCondition(current.catalog,'MENU_NOT_PUBLISHED');requireCondition(input.menuRevision===current.revision,'MENU_REVISION_CONFLICT');
    requireCondition(Array.isArray(input.lines) && input.lines.length>0 && input.lines.length<=1000,'INVALID_LINES');
    const availability=Object.fromEntries(Object.entries(this.availability()).map(([id,row])=>[id,row.available]));
    if(input.lines.some(line=>(line as {kind?:unknown})?.kind==='CUSTOM_AMOUNT'))this.auth.current(token,'order.custom_item.create');
    const lines=input.lines.map(line=>priceLine(current.catalog!,current.revision,line,availability));
    const settings=this.db.prepare('SELECT fees FROM branch_settings WHERE branch_id=?').get(this.auth.branchId) as {fees:string}|undefined;
    return {kind:'QUOTE_ONLY',menuRevision:current.revision,lines,...totals(input.type,lines.map(l=>l.total),input.discount,settings ? JSON.parse(settings.fees):[])};
  }
}
