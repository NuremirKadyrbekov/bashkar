// Future contract: not part of the fixed-SHARED MVP test suite.
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,password,catalog} from '../test/fixtures/operations';
import {TableService} from '../src/modules/tables/table-service';
import {OrderService} from '../src/modules/orders/order-service';
import {createServer} from '../src/server';
async function setup(){const f=await fixture(),tables=new TableService(f.db,f.bus,f.auth,f.now),orders=new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now);
 const owner=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:owner.employee.revision,permission:'shift.open',allowed:true});await f.shifts.open(f.token,randomUUID(),'owner',password);
 const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true}),table=await tables.saveTable(f.token,randomUUID(),{tableId:null,revision:0,zoneId:zone.id,name:'7',active:true});await tables.setMode(f.token,randomUUID(),{revision:0,mode:'STRICT'});const visit=await tables.open(f.token,randomUUID(),{tableId:table.id,responsibleWaiterId:null});
 const c=catalog();c.items.push({...structuredClone(c.items[0]),id:'water',name:'Вода',kitchen:false,price:0,variants:[],groups:[]});const d=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:c});await f.menu.publish(f.token,randomUUID(),d);
 function request(item='coffee',comment='Без сахара'){return {draftId:randomUUID(),draftRevision:1,menuRevision:f.menu.active(f.token).revision,discount:orders.get(f.token,visit.sessionId)?.discount??0,lines:[{lineId:randomUUID(),itemId:item,variantId:item==='coffee'?'small':null,modifierIds:item==='coffee'?['regular']:[],quantity:1,comment}]};}
 function prepared(r=request()){const q=orders.prepare(f.token,visit.sessionId,r);return {...r,menuRevision:q.menuRevision,orderRevision:q.orderRevision,confirmationHash:q.confirmationHash};}
 return {...f,tables,orders,visit,c,request,prepared};}

it('rejects changed fee/menu confirmations and enforces live STRICT/SHARED and role access without author spoofing',async()=>{const f=await setup();try{
 const initial=f.prepared();await f.menu.configureFees(f.token,randomUUID(),{revision:0,fees:[{id:'fee',name:'Сервис',rate:100}]});await expect(f.orders.submit(f.token,randomUUID(),f.visit.sessionId,initial)).rejects.toThrow('CONFIRMATION_STALE');
 const created=await f.auth.createEmployee(f.token,randomUUID(),{login:'waiter',name:'Waiter',role:'WAITER'}),first=await f.auth.login('waiter',created.temporaryPassword,'WAITER_WEB');await f.auth.changePassword(first.token,randomUUID(),created.temporaryPassword,password);const token=(await f.auth.login('waiter',password,'WAITER_WEB')).token;
 await f.auth.setPermission(f.token,randomUUID(),{employeeId:created.id,revision:f.auth.employee(created.id).revision,permission:'table.access_others',allowed:false});
 expect(()=>f.orders.prepare(token,f.visit.sessionId,f.request())).toThrow('VISIT_ACCESS_DENIED');expect(()=>f.orders.jobs(token,f.visit.sessionId)).toThrow('VISIT_ACCESS_DENIED');await f.tables.setMode(f.token,randomUUID(),{mode:'SHARED',revision:1});
 const r=f.request(),q=f.orders.prepare(token,f.visit.sessionId,r),p={...r,orderRevision:q.orderRevision,confirmationHash:q.confirmationHash},id=randomUUID();await f.orders.submit(token,id,f.visit.sessionId,p);expect(f.orders.history(f.token,f.visit.sessionId).batches[0].sender.id).toBe(created.id);expect(f.tables.details(f.token,f.visit.sessionId).openedBy.name).toBe('Owner');
 await f.tables.setMode(f.token,randomUUID(),{mode:'STRICT',revision:2});await expect(f.orders.submit(token,id,f.visit.sessionId,p)).rejects.toThrow('VISIT_ACCESS_DENIED');expect(()=>f.orders.history(token,f.visit.sessionId)).toThrow('VISIT_ACCESS_DENIED');
 const quote=f.prepared(),c=structuredClone(f.c);c.items[0].variants[0].price=19000;const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:1,catalog:c});await f.menu.publish(f.token,randomUUID(),draft);await expect(f.orders.submit(f.token,randomUUID(),f.visit.sessionId,quote)).rejects.toThrow('CONFIRMATION_STALE');
 }finally{f.close();}});
