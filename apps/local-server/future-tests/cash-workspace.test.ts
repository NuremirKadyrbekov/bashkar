// Future contract: not part of the fixed-SHARED MVP test suite.
import {it,expect} from 'vitest';
import {createServer} from '../src/server';
import {randomUUID} from 'node:crypto';
import {fixture,catalog,password} from '../test/fixtures/operations';
import {TableService} from '../src/modules/tables/table-service';
import {OrderService} from '../src/modules/orders/order-service';
import {FinanceService} from '../src/modules/orders/finance-service';
import {FulfillmentService} from '../src/modules/orders/fulfillment-service';
import {ShiftFinanceService} from '../src/modules/shifts/shift-finance-service';
import {roleAllows} from '../src/modules/auth/permissions';
async function setup(){
 const f=await fixture(),tables=new TableService(f.db,f.bus,f.auth,f.now),orders=new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now),finance=new FinanceService(orders),fulfillment=new FulfillmentService(finance),shifts=new ShiftFinanceService(finance);
 for(const permission of ['shift.open','shift.close','counter.view','counter.batch.submit','order.settle.counter','order.correct','order.cancel','payment.refund'])await f.auth.setPermission(f.token,randomUUID(),{employeeId:f.auth.current(f.token).id,revision:f.auth.employee(f.auth.current(f.token).id).revision,permission:permission as never,allowed:true});
 await f.shifts.open(f.token,randomUUID(),'owner',password);const menu=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});await f.menu.publish(f.token,randomUUID(),menu);await tables.setMode(f.token,randomUUID(),{revision:0,mode:'STRICT'});
 const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true}),table=await tables.saveTable(f.token,randomUUID(),{tableId:null,revision:0,zoneId:zone.id,name:'10',active:true});
 const custom=(unitPrice=12550,quantity=1)=>({lineId:randomUUID(),kind:'CUSTOM_AMOUNT',itemId:'CUSTOM_AMOUNT',unitPrice,quantity,variantId:null,modifierIds:[],comment:''});
 const ordinary=()=>({lineId:randomUUID(),itemId:'coffee',variantId:'small',modifierIds:['regular'],quantity:1,comment:'Без сахара'});
 const request=(lines:unknown[]=[ordinary()],discount=0)=>({draftId:randomUUID(),draftRevision:1,menuRevision:1,lines,discount});
 const accept=async(sessionId:string,r=request(),token=f.token)=>{const q=orders.prepare(token,sessionId,r);return orders.submit(token,randomUUID(),sessionId,{...r,orderRevision:q.orderRevision,confirmationHash:q.confirmationHash});};
 const confirm=(q:{expectedOrderRevision:number;expectedVisitRevision:number|null;shiftId:string;confirmationHash:string})=>({expectedOrderRevision:q.expectedOrderRevision,expectedVisitRevision:q.expectedVisitRevision,shiftId:q.shiftId,confirmationHash:q.confirmationHash});
 return {...f,tables,orders,finance,fulfillment,shifts,table,custom,ordinary,request,accept,confirm};
}

it('enforces STRICT/SHARED for hall without table and preserves its responsible waiter',async()=>{const f=await setup();try{
 const tokens:string[]=[];const ids:string[]=[];for(const login of ['waiter1','waiter2']){const employee=await f.auth.createEmployee(f.token,randomUUID(),{login,name:login,role:'WAITER'}),session=await f.auth.login(login,employee.temporaryPassword,'WAITER_WEB');await f.auth.changePassword(session.token,randomUUID(),employee.temporaryPassword,password);tokens.push((await f.auth.login(login,password,'WAITER_WEB')).token);ids.push(employee.id);}
 await f.auth.setPermission(f.token,randomUUID(),{employeeId:ids[1],revision:f.auth.employee(ids[1]).revision,permission:'table.access_others',allowed:false});const visit=await f.tables.open(tokens[0],randomUUID(),{tableId:null,responsibleWaiterId:null}),accepted=await f.accept(visit.sessionId,f.request(),tokens[0]);
 expect(()=>f.finance.get(tokens[1],accepted.orderId)).toThrow('VISIT_ACCESS_DENIED');expect(f.finance.activeOrders(tokens[1]).orders).toEqual([]);
 const history=f.fulfillment.history(tokens[0],accepted.orderId),line=history.batches[0].lines[0];await expect(f.fulfillment.mark(tokens[1],accepted.orderId,{itemId:line.id,issued:true,expectedRevision:0,expectedOrderRevision:1},randomUUID())).rejects.toThrow('VISIT_ACCESS_DENIED');
 await f.tables.setMode(f.token,randomUUID(),{revision:1,mode:'SHARED'});expect(f.finance.activeOrders(tokens[1]).orders).toHaveLength(1);await f.fulfillment.mark(tokens[1],accepted.orderId,{itemId:line.id,issued:true,expectedRevision:0,expectedOrderRevision:1},randomUUID());expect(f.tables.details(tokens[1],visit.sessionId).responsibleWaiter?.id).toBe(ids[0]);
 expect(roleAllows('WAITER','order.custom_item.create')).toBe(true);
 }finally{f.close();}});
