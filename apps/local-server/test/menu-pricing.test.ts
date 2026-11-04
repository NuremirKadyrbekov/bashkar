import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { catalog,fixture } from './fixtures/operations';
import { validateCatalog, MAX_MONEY, displayName, validateFees } from '../src/modules/menu/catalog';
import { priceLine, totals } from '../src/modules/menu/pricing';
const line={itemId:'coffee',variantId:'large',modifierIds:['oat'],quantity:2};
it('uses final size price, unique modifiers, language fallback and immutable quote snapshots',()=>{
 const c=validateCatalog(catalog()),priced=priceLine(c,1,line);expect(priced.unitPrice).toBe(27000);expect(priced.total).toBe(54000);
 expect(displayName(c.items[0],'ky')).toBe('Кофе');c.items[0].variants[1].price=100;expect(priced.variant?.price).toBe(23000);
 expect(()=>priceLine(c,1,{...line,modifierIds:['oat','oat']})).toThrow('DUPLICATE_MODIFIER');
 expect(()=>priceLine(c,1,{...line,modifierIds:[]})).toThrow('MODIFIER_SELECTION_LIMIT');
 expect(()=>priceLine(c,1,{...line,variantId:null})).toThrow('INVALID_VARIANT');
 expect(()=>priceLine(c,1,{...line,quantity:1.5})).toThrow('INVALID_QUANTITY');
 expect(()=>priceLine(c,1,line,{oat:false})).toThrow('MODIFIER_UNAVAILABLE');
 expect(()=>priceLine(c,1,line,{coffee:false})).toThrow('ITEM_UNAVAILABLE');
});
it('allows explicit zero, rejects absent/negative prices, inconsistent categories and arithmetic limits',()=>{
 const c=catalog();c.items[0].price=0;c.items[0].variants=[];c.items[0].groups=[];expect(priceLine(validateCatalog(c),1,{...line,variantId:null,modifierIds:[]}).total).toBe(0);
 c.items[0].price=-1;expect(()=>validateCatalog(c)).toThrow('INVALID_PRICE');
 c.items[0].price=MAX_MONEY;expect(()=>priceLine(c,1,{...line,variantId:null,modifierIds:[]})).toThrow('MONEY_LIMIT_EXCEEDED');
 c.categories[0].archived=true;expect(()=>validateCatalog(c)).toThrow('INVALID_CATEGORY');
});
it('rounds every independent TABLE fee HALF_UP, ignores COUNTER fees and checks sum/rate bounds',()=>{
 const fees=[{id:'service',name:'Сервис',rate:5000},{id:'other',name:'Другой',rate:5000}];
 expect(totals('TABLE',[3],2,fees)).toMatchObject({subtotal:3,base:1,total:3,fees:[{amount:1},{amount:1}]});
 expect(totals('COUNTER',[3],2,fees)).toMatchObject({base:1,total:1,fees:[]});
 expect(()=>totals('TABLE',[10],11,fees)).toThrow('INVALID_DISCOUNT');
 expect(()=>totals('TABLE',[MAX_MONEY],0,fees)).toThrow('MONEY_LIMIT_EXCEEDED');
 expect(()=>validateFees([{id:'fee',name:'Сбор',rate:10001}])).toThrow('INVALID_RATE');
 expect(()=>validateFees([{id:'fee',name:'Сбор',rate:5001},{id:'fee2',name:'Сбор',rate:5000}])).toThrow('TOTAL_RATE_EXCEEDED');
});
it('publishes an entire immutable revision atomically and rejects stale drafts, malformed menus and waiter stoplist grants',async()=>{
 const f=await fixture();try {
  const first=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});
  const stale=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});
  const id=randomUUID();expect(await f.menu.publish(f.token,id,first)).toEqual({revision:1});expect(await f.menu.publish(f.token,id,first)).toEqual({revision:1});
  await expect(f.menu.publish(f.token,randomUUID(),stale)).rejects.toThrow('MENU_REVISION_CONFLICT');
  const quote=f.menu.quote(f.token,{menuRevision:1,type:'TABLE',lines:[line],discount:0});expect(quote.total).toBe(54000);expect(quote.kind).toBe('QUOTE_ONLY');
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'oat',available:false,revision:0});
  expect(()=>f.menu.quote(f.token,{menuRevision:1,type:'TABLE',lines:[line],discount:0})).toThrow('MODIFIER_UNAVAILABLE');
  await expect(f.menu.stoplist(f.token,randomUUID(),{entityId:'oat',available:true,revision:0})).rejects.toThrow('AVAILABILITY_CONFLICT');
  const changed=catalog();changed.items[0].variants[0].price=500;
  const second=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:1,catalog:changed});
  const count=f.db.prepare('SELECT count(*) AS n FROM commands').get();
  f.db.exec("CREATE TRIGGER fail_menu_audit BEFORE INSERT ON audit_events WHEN NEW.action='menu.published' BEGIN SELECT RAISE(ABORT,'publish-test'); END;");
  await expect(f.menu.publish(f.token,randomUUID(),second)).rejects.toThrow('publish-test');
  expect(f.menu.active(f.token).revision).toBe(1);expect(f.db.prepare('SELECT count(*) AS n FROM commands').get()).toEqual(count);
  f.db.exec('DROP TRIGGER fail_menu_audit');await f.menu.publish(f.token,randomUUID(),second);expect(f.menu.active(f.token).revision).toBe(2);
  expect(quote.lines[0].variant?.price).toBe(23000);
  expect(()=>f.menu.quote(f.token,{menuRevision:1,type:'TABLE',lines:[line],discount:0})).toThrow('MENU_REVISION_CONFLICT');
  expect(()=>f.db.prepare('UPDATE menu_revisions SET document=?').run('{}')).toThrow('IMMUTABLE_MENU');
 }finally{f.close();}
});
it('stops and restores a whole category atomically without clearing size stops or touching another category',async()=>{
 const f=await fixture();try{
  const c=catalog();c.categories.push({id:'food',name:'Еда',archived:false});
  c.items.push({id:'tea',categoryId:'drinks',name:'Чай',archived:false,available:true,kitchen:false,price:10000,variants:[],groups:[]});
  c.items.push({id:'soup',categoryId:'food',name:'Суп',archived:false,available:true,kitchen:true,price:15000,variants:[],groups:[]});
  const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:c});await f.menu.publish(f.token,randomUUID(),draft);
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'small',available:false,revision:0});
  const initial={categoryId:'drinks',available:false,menuRevision:1,expected:[{entityId:'coffee',revision:0},{entityId:'tea',revision:0}]};
  const command=randomUUID(),result=await f.menu.stoplistCategory(f.token,command,initial);
  expect(result).toEqual({categoryId:'drinks',available:false,changed:2,total:2});
  expect(await f.menu.stoplistCategory(f.token,command,initial)).toEqual(result);
  expect(f.menu.availability()).toMatchObject({coffee:{available:false},tea:{available:false},small:{available:false}});
  expect(f.menu.availability().soup).toBeUndefined();
  await expect(f.menu.stoplistCategory(f.token,randomUUID(),{...initial,available:true})).rejects.toThrow('AVAILABILITY_CONFLICT');
  const restored=await f.menu.stoplistCategory(f.token,randomUUID(),{categoryId:'drinks',available:true,menuRevision:1,expected:[{entityId:'coffee',revision:1},{entityId:'tea',revision:1}]});
  expect(restored.changed).toBe(2);expect(f.menu.availability().small.available).toBe(false);
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'tea',available:false,revision:2});
  await expect(f.menu.stoplistCategory(f.token,randomUUID(),{categoryId:'drinks',available:false,menuRevision:1,expected:[{entityId:'coffee',revision:2},{entityId:'tea',revision:2}]})).rejects.toThrow('AVAILABILITY_CONFLICT');
  expect(f.menu.availability().coffee.available).toBe(true);
 }finally{f.close();}
});
