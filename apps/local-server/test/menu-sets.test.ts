import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,password} from './fixtures/operations';
import {setCatalog} from './fixtures/sets';
import {validateCatalog} from '../src/modules/menu/catalog';
import {priceLine} from '../src/modules/menu/pricing';
import {receiptLines,renderReceipt,defaultPrintProfile} from '../src/modules/printing/render';
import {TableService} from '../src/modules/tables/table-service';
import {OrderService} from '../src/modules/orders/order-service';
import {FinanceService} from '../src/modules/orders/finance-service';
const selection=(quantity=1)=>({itemId:'set',variantId:null,modifierIds:[],quantity});
const confirm=(q:any)=>({expectedOrderRevision:q.expectedOrderRevision,expectedVisitRevision:q.expectedVisitRevision,shiftId:q.shiftId,confirmationHash:q.confirmationHash});

it('validates real fixed components and rejects nesting, packaging, stale combinations, duplicates and limits',()=>{
 const valid=validateCatalog(setCatalog());expect(valid.items.at(-1)!.kitchen).toBe(true);
 for(const [change,error] of [
  [(c:any)=>{c.items.at(-1).components=[];},'EMPTY_SET'],
  [(c:any)=>{c.items.at(-1).components[0].itemId='missing';},'INVALID_SET_COMPONENT'],
  [(c:any)=>{c.items.at(-1).components[0].itemId='set';},'INVALID_SET_COMPONENT'],
  [(c:any)=>{c.items[0].isPackaging=true;},'INVALID_SET_COMPONENT'],
  [(c:any)=>{c.items[0].archived=true;},'SET_COMPONENT_ARCHIVED'],
  [(c:any)=>{c.items.at(-1).components[1].combinationId='wrong';},'INVALID_SET_SELECTION'],
  [(c:any)=>{c.items.at(-1).components[0].modifierIds=[];},'INVALID_SET_SELECTION'],
  [(c:any)=>{c.items.at(-1).components[0].quantity=.5;},'INVALID_SET_QUANTITY'],
  [(c:any)=>{c.items.at(-1).components[0].quantity=100;},'INVALID_SET_QUANTITY'],
  [(c:any)=>{c.items.at(-1).components.push({...c.items.at(-1).components[0]});},'DUPLICATE_SET_COMPONENT'],
  [(c:any)=>{c.items.at(-1).components=Array(31).fill(c.items.at(-1).components[0]);},'INVALID_ARRAY'],
  [(c:any)=>{c.items.at(-1).isPackaging=true;},'INVALID_SET']
 ] as const){const c=setCatalog();change(c);expect(()=>validateCatalog(c)).toThrow(error);}
 const archived=setCatalog();archived.items.at(-1)!.archived=true;archived.items[0].archived=true;expect(()=>validateCatalog(archived)).not.toThrow();
});

it('uses only the set final price, checks component stop-lists and quantity limits, and renders multiplied composition',()=>{
 const zero=setCatalog();zero.items.at(-1)!.price=0;expect(priceLine(validateCatalog(zero),1,selection()).total).toBe(0);const cold=setCatalog();cold.items.at(-1)!.components=[{itemId:'water',variantId:null,modifierIds:[],quantity:1}];expect(priceLine(validateCatalog(cold),1,selection()).kitchen).toBe(false);const c=validateCatalog(setCatalog()),line=priceLine(c,1,selection(2));expect(line.total).toBe(120000);expect(line.components.map(c=>c.quantity)).toEqual([2,1,1]);expect(line.components[1].combination!.translations.ky).toBe('Кичине сүттүү чай');
 const kitchen=receiptLines('KITCHEN','NEW_BATCH',{lines:[line]}).map(l=>l.text).join('\n');expect(kitchen).toContain('4 × Кофе');expect(kitchen).toContain('2 × Чай');expect(kitchen).not.toContain('Вода');
 const customer=receiptLines('CUSTOMER','RECEIPT',{lines:[line],total:line.total}).map(l=>l.text).join('\n');expect(customer).toContain('2 × Вода');expect(customer).toContain('1200,00 сом');const raster=renderReceipt('KITCHEN','CANCEL',{language:'ky',lines:[{...line,quantity:1}]},defaultPrintProfile,true);expect(raster.preview.subarray(1,4).toString()).toBe('PNG');expect(raster.raw.length).toBeGreaterThan(1000);
 expect(receiptLines('KITCHEN','CANCEL',{language:'ky',lines:[{...line,quantity:1}]}).map(l=>l.text).join('\n')).toContain('Кичине сүттүү чай');
 for(const id of ['coffee','oat','tea','tea_with','tea_small_with','water'])expect(()=>priceLine(c,1,selection(),{[id]:false})).toThrow('SET_COMPONENT_UNAVAILABLE');
 expect(()=>priceLine(c,1,selection(),{set:false})).toThrow('ITEM_UNAVAILABLE');
 expect(()=>priceLine(c,1,selection(5000))).toThrow('SET_QUANTITY_LIMIT');
 c.items[0].variants[1].price=40000;expect(priceLine(c,2,selection()).unitPrice).toBe(60000);
 c.items[1].combinationPrices![0].translations!.ky='Изменение';expect(line.components[1].combination!.translations.ky).toBe('Кичине сүттүү чай');
});

it('preserves drafts, immutable kinds and accepted TABLE composition across publication and whole-set cancellation',async()=>{
 const f=await fixture();try{
  const tables=new TableService(f.db,f.bus,f.auth,f.now),orders=new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now),finance=new FinanceService(orders),actor=f.auth.current(f.token);
  for(const permission of ['shift.open','order.correct','counter.view','counter.batch.submit','order.settle.counter'] as const)await f.auth.setPermission(f.token,randomUUID(),{employeeId:actor.id,revision:f.auth.employee(actor.id).revision,permission,allowed:true});
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  const publish=async(c:unknown,baseRevision:number)=>{const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision,catalog:c});return f.menu.publish(f.token,randomUUID(),draft);};
  const d=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:setCatalog()});expect(f.menu.active(f.token).catalog).toBe(null);await f.menu.publish(f.token,randomUUID(),d);
  const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true}),table=await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name:'1',active:true});await tables.setMode(f.token,randomUUID(),{revision:0,mode:'STRICT'});const visit=await tables.open(f.token,randomUUID(),{tableId:table.id,responsibleWaiterId:null});
  const request={draftId:randomUUID(),draftRevision:1,menuRevision:1,discount:0,lines:[{lineId:randomUUID(),...selection(2)}]},q=orders.prepare(f.token,visit.sessionId,request);
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'water',available:false,revision:0});await expect(orders.submit(f.token,randomUUID(),visit.sessionId,{...request,orderRevision:q.orderRevision,confirmationHash:q.confirmationHash})).rejects.toThrow('SET_COMPONENT_UNAVAILABLE');
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'water',available:true,revision:1});const q2=orders.prepare(f.token,visit.sessionId,request);const accepted=await orders.submit(f.token,randomUUID(),visit.sessionId,{...request,orderRevision:q2.orderRevision,confirmationHash:q2.confirmationHash});
  const orderId=accepted.orderId,portion=finance.dto(finance.row(orderId)).lines[0];expect(portion.components).toHaveLength(3);expect(portion.total).toBe(120000);
  const changed=setCatalog();changed.items[0].name='Новое кофе';changed.items.at(-1)!.components![0].quantity=3;changed.items.at(-1)!.price=70000;await publish(changed,1);
  const r={action:'CANCEL_QUANTITY',targets:[{itemId:portion.itemId,portionId:portion.id,quantity:1}],reason:'Гость отказался'},cq=finance.prepareCorrection(f.token,orderId,r);await finance.correct(f.token,orderId,{...r,...confirm(cq)},randomUUID());
  const remaining=finance.dto(finance.row(orderId)).lines[0];expect(remaining.quantity).toBe(1);expect(remaining.total).toBe(60000);expect((remaining.components as any[])[0]).toMatchObject({name:'Кофе',quantity:2});
  const cancel=f.db.prepare("SELECT payload FROM print_jobs WHERE purpose='CANCEL'").get() as {payload:string};expect(receiptLines('KITCHEN','CANCEL',JSON.parse(cancel.payload)).map(l=>l.text).join('\n')).toContain('2 × Кофе');
  expect(()=>finance.prepareCorrection(f.token,orderId,{...r,targets:[{itemId:portion.itemId,portionId:randomUUID(),quantity:1}]})).toThrow('INVALID_PORTION');
  const counter={draftId:randomUUID(),draftRevision:1,menuRevision:2,discount:0,lines:[{lineId:randomUUID(),...selection()}],mode:'CHECKOUT',payment:{kind:'SINGLE',method:'CASH'}},cp=finance.prepareCounter(f.token,null,counter);expect(cp.total).toBe(70000);const sale=await finance.counterCommit(f.token,null,{...counter,...confirm(cp)},randomUUID());expect(finance.dto(finance.row(sale.orderId)).lines).toHaveLength(1);
  const wrong=setCatalog();wrong.items.at(-1)!.kind='ITEM';delete wrong.items.at(-1)!.components;await expect(publish(wrong,2)).rejects.toThrow('ITEM_KIND_IMMUTABLE');
 }finally{f.close();}
});
