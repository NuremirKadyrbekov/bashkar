import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {catalog,fixture,password} from './fixtures/operations';
import {validateCatalog} from '../src/modules/menu/catalog';
import {priceLine} from '../src/modules/menu/pricing';
import {TableService} from '../src/modules/tables/table-service';
import {OrderService} from '../src/modules/orders/order-service';

function tea(){
 const c=catalog();c.items=[{
  id:'tea',categoryId:'drinks',name:'Чай',archived:false,available:true,kitchen:true,price:null,
  pricingMode:'MATRIX' as const,
  variants:[{id:'small',name:'Маленькая кружка',price:0,available:true},{id:'large',name:'Большая кружка',price:0,available:true}],
  groups:[{id:'milk',name:'Молоко',min:1,max:1,options:[{id:'with',name:'С молоком',price:0,available:true},{id:'without',name:'Без молока',price:0,available:true}]}],
  combinationPrices:[
   {id:'small_with',variantId:'small',optionIds:['with'],price:4500,available:true},
   {id:'small_without',variantId:'small',optionIds:['without'],price:4000,available:true},
   {id:'large_with',variantId:'large',optionIds:['with'],price:8000,available:true},
   {id:'large_without',variantId:'large',optionIds:['without'],price:6500,available:true}
  ]
 }];return c;
}
const select=(variantId:string,modifierId:string)=>({itemId:'tea',variantId,modifierIds:[modifierId],quantity:1});

it('prices each complete tea combination independently and keeps legacy additive items intact',()=>{
 const c=validateCatalog(tea());
 expect([['small','with'],['small','without'],['large','with'],['large','without']].map(([v,m])=>priceLine(c,1,select(v,m)).unitPrice)).toEqual([4500,4000,8000,6500]);
 expect(priceLine(c,1,select('large','with'))).toMatchObject({combinationId:'large_with',basePrice:8000,unitPrice:8000,modifiers:[{id:'with',price:0}]});
 expect(()=>priceLine(c,1,{...select('small','with'),modifierIds:[]})).toThrow('MODIFIER_SELECTION_LIMIT');
 expect(()=>priceLine(c,1,{...select('small','with'),modifierIds:['with','without']})).toThrow('MODIFIER_SELECTION_LIMIT');
 expect(()=>priceLine(c,1,select('small','with'),{small_with:false})).toThrow('COMBINATION_UNAVAILABLE');
 expect(priceLine(validateCatalog(catalog()),1,{itemId:'coffee',variantId:'large',modifierIds:['oat'],quantity:1}).unitPrice).toBe(27000);
});

it('rejects incomplete, duplicate and ambiguous matrix prices on the server',()=>{
 const missing=tea();missing.items[0].combinationPrices!.pop();expect(()=>validateCatalog(missing)).toThrow('INVALID_COMBINATION_PRICES');
 const duplicate=tea();duplicate.items[0].combinationPrices![1].optionIds=['with'];expect(()=>validateCatalog(duplicate)).toThrow('INVALID_COMBINATION_PRICES');
 const blank=tea();(blank.items[0].combinationPrices![0] as unknown as {price:null}).price=null;expect(()=>validateCatalog(blank)).toThrow('INVALID_PRICE');
  const free=tea();free.items[0].combinationPrices![0].price=0;expect(priceLine(validateCatalog(free),1,select('small','with')).unitPrice).toBe(0);
 const optional=tea();optional.items[0].groups[0].min=0;expect(()=>validateCatalog(optional)).toThrow('INVALID_MATRIX_STRUCTURE');
 const more=tea();for(let i=0;i<65;i++)more.items[0].variants.push({id:`size_${i}`,name:`Размер ${i}`,price:0,available:true});expect(()=>validateCatalog(more)).toThrow('TOO_MANY_COMBINATIONS');
});

it('saves a draft without changing the active menu and stops one combination separately',async()=>{
 const f=await fixture();try{
  const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:tea()});
  expect(f.menu.active(f.token).revision).toBe(0);
  await f.menu.publish(f.token,randomUUID(),draft);
  expect(f.menu.quote(f.token,{menuRevision:1,type:'COUNTER',lines:[select('small','with')],discount:0}).total).toBe(4500);
  const stopped=await f.menu.stoplist(f.token,randomUUID(),{entityId:'small_with',available:false,revision:0});
  expect(stopped.revision).toBe(1);expect(f.menu.active(f.token).revision).toBe(1);
  expect(()=>f.menu.quote(f.token,{menuRevision:1,type:'COUNTER',lines:[select('small','with')],discount:0})).toThrow('COMBINATION_UNAVAILABLE');
  expect(f.menu.quote(f.token,{menuRevision:1,type:'COUNTER',lines:[select('large','with')],discount:0}).total).toBe(8000);
  expect(f.menu.quote(f.token,{menuRevision:1,type:'COUNTER',lines:[select('small','without')],discount:0}).total).toBe(4000);
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'with',available:false,revision:0});
  expect(()=>f.menu.quote(f.token,{menuRevision:1,type:'COUNTER',lines:[select('large','with')],discount:0})).toThrow('MODIFIER_UNAVAILABLE');
  expect(f.menu.quote(f.token,{menuRevision:1,type:'COUNTER',lines:[select('large','without')],discount:0}).total).toBe(6500);
  await expect(f.menu.stoplist(f.token,randomUUID(),{entityId:'small_with',available:true,revision:0})).rejects.toThrow('AVAILABILITY_CONFLICT');
 }finally{f.close();}
});

it('stops and restores sizes independently while preserving their stop state under a stopped dish',async()=>{
 const f=await fixture();try{
  const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:tea()});
  await f.menu.publish(f.token,randomUUID(),draft);
  const quote=(variantId:string)=>f.menu.quote(f.token,{menuRevision:1,type:'TABLE',lines:[select(variantId,'with')],discount:0});
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'small',available:false,revision:0});
  expect(()=>quote('small')).toThrow('VARIANT_UNAVAILABLE');
  expect(quote('large').total).toBe(8000);
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'tea',available:false,revision:0});
  expect(()=>quote('large')).toThrow('ITEM_UNAVAILABLE');
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'tea',available:true,revision:1});
  expect(()=>quote('small')).toThrow('VARIANT_UNAVAILABLE');
  expect(quote('large').total).toBe(8000);
  expect(f.menu.availability().small).toMatchObject({available:false,revision:1});
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'small',available:true,revision:1});
  expect(quote('small').total).toBe(4500);
  expect((f.db.prepare("SELECT count(*) n FROM audit_events WHERE action='menu.stoplist'").get() as {n:number}).n).toBe(4);
 }finally{f.close();}
});

it('keeps accepted matrix prices immutable while an open shift receives a new menu revision',async()=>{
 const f=await fixture();try{
  const tables=new TableService(f.db,f.bus,f.auth,f.now),orders=new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now),owner=f.auth.current(f.token);
  await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:owner.employee.revision,permission:'shift.open',allowed:true});
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true}),table=await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name:'7',active:true});
  await tables.setMode(f.token,randomUUID(),{revision:0,mode:'STRICT'});
  const visit=await tables.open(f.token,randomUUID(),{tableId:table.id,responsibleWaiterId:null});
  const first=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:tea()});await f.menu.publish(f.token,randomUUID(),first);
  const request=()=>({draftId:randomUUID(),draftRevision:1,menuRevision:f.menu.active(f.token).revision,discount:0,lines:[{lineId:randomUUID(),...select('small','with')}]});
  const before=request(),quote=orders.prepare(f.token,visit.sessionId,before);await orders.submit(f.token,randomUUID(),visit.sessionId,{...before,orderRevision:quote.orderRevision,confirmationHash:quote.confirmationHash});
  const changed=tea();changed.items[0].combinationPrices![0].price=4900;
  const second=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:1,catalog:changed});await f.menu.publish(f.token,randomUUID(),second);
  const after=request(),newQuote=orders.prepare(f.token,visit.sessionId,after);await orders.submit(f.token,randomUUID(),visit.sessionId,{...after,orderRevision:newQuote.orderRevision,confirmationHash:newQuote.confirmationHash});
  expect(orders.history(f.token,visit.sessionId).batches.map(b=>b.lines[0].unitPrice)).toEqual([4500,4900]);
  expect(f.shifts.current(f.token)).toMatchObject({status:'OPEN'});
  const reused=tea(),rows=reused.items[0].combinationPrices!;[rows[0].id,rows[1].id]=[rows[1].id,rows[0].id];
  const invalid=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:2,catalog:reused});
  await expect(f.menu.publish(f.token,randomUUID(),invalid)).rejects.toThrow('ENTITY_ID_REUSED');
 }finally{f.close();}
});

it('validates whole-combination translations and snapshots them independently of later catalog edits',()=>{
 const c=tea();c.items[0].combinationPrices![0].translations={ky:'Кичине сүттүү чай'};
 const validated=validateCatalog(c),line=priceLine(validated,1,select('small','with'));
 expect(line.combination?.translations.ky).toBe('Кичине сүттүү чай');
 validated.items[0].combinationPrices![0].translations!.ky='Башка';expect(line.combination?.translations.ky).toBe('Кичине сүттүү чай');
 c.items[0].combinationPrices![0].translations={zz:'Unsupported'};expect(()=>validateCatalog(c)).toThrow();
});
