import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,catalog,password} from './fixtures/operations';
import {TableService} from '../src/modules/tables/table-service';
import {OrderService} from '../src/modules/orders/order-service';
import {FinanceService} from '../src/modules/orders/finance-service';

it('shares pins, orders recent paid portions and excludes open and zero settlements',async()=>{
 const f=await fixture();try{
  const c=catalog();c.items.push({id:'tea',categoryId:'drinks',name:'Чай',archived:false,available:true,kitchen:false,price:5000,variants:[],groups:[]});
  c.items.push({id:'water',categoryId:'drinks',name:'Вода',archived:false,available:true,kitchen:false,price:0,variants:[],groups:[]});
  const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:c});await f.menu.publish(f.token,randomUUID(),draft);
  const tables=new TableService(f.db,f.bus,f.auth,f.now),orders=new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now),finance=new FinanceService(orders);
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  const sale=async(itemId:string,quantity:number,payment:{kind:string;method?:string},mode:'ACCEPT'|'CHECKOUT'='CHECKOUT')=>{
   const request={draftId:randomUUID(),draftRevision:1,menuRevision:1,discount:0,lines:[{lineId:randomUUID(),itemId,variantId:itemId==='coffee'?'small':null,modifierIds:itemId==='coffee'?['regular']:[],quantity,comment:''}],mode,guestLabel:'Гость',...(mode==='CHECKOUT'?{payment}:{})};
   const quote=finance.prepareCounter(f.token,null,request);
   return finance.counterCommit(f.token,null,{...request,expectedOrderRevision:quote.expectedOrderRevision,expectedVisitRevision:quote.expectedVisitRevision,shiftId:quote.shiftId,confirmationHash:quote.confirmationHash},randomUUID());
  };
  await sale('coffee',3,{kind:'SINGLE',method:'CASH'});await sale('tea',2,{kind:'SINGLE',method:'CASH'});await sale('tea',5,{kind:'SINGLE',method:'CASH'},'ACCEPT');await sale('water',4,{kind:'ZERO'});
  expect(Object.fromEntries(f.menu.salesCatalogLayout(f.token).ranking.map(row=>[row.itemId,row.units]))).toEqual({coffee:3,tea:2});
  const first=await f.menu.setSalesCatalogPin(f.token,randomUUID(),{categoryId:'drinks',itemId:'tea',pinned:true,expectedRevision:0});
  expect(first.revision).toBe(1);expect(f.menu.salesCatalogLayout(f.token).pins).toEqual([{categoryId:'drinks',itemId:'tea'}]);
  await expect(f.menu.setSalesCatalogPin(f.token,randomUUID(),{categoryId:'drinks',itemId:'coffee',pinned:true,expectedRevision:0})).rejects.toThrow('SALES_CATALOG_PIN_CONFLICT');
  await f.menu.setSalesCatalogPin(f.token,randomUUID(),{categoryId:'drinks',itemId:'coffee',pinned:true,expectedRevision:1});
  expect(f.menu.salesCatalogLayout(f.token).pins.map(row=>row.itemId)).toEqual(['coffee','tea']);
  await f.menu.setSalesCatalogPin(f.token,randomUUID(),{categoryId:'drinks',itemId:'coffee',pinned:false,expectedRevision:2});
  expect(f.menu.salesCatalogLayout(f.token).pins.map(row=>row.itemId)).toEqual(['tea']);
  const actor=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:actor.id,revision:f.auth.employee(actor.id).revision,permission:'menu.edit',allowed:false});
  expect(f.menu.salesCatalogLayout(f.token).pins).toHaveLength(1);
  await expect(f.menu.setSalesCatalogPin(f.token,randomUUID(),{categoryId:'drinks',itemId:'tea',pinned:false,expectedRevision:3})).rejects.toThrow('PERMISSION_DENIED');
 }finally{f.close();}
});
