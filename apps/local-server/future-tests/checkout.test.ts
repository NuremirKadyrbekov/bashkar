// Future contract: not part of the fixed-SHARED MVP test suite.
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,catalog,password} from '../test/fixtures/operations';
import {TableService} from '../src/modules/tables/table-service';
import {OrderService} from '../src/modules/orders/order-service';
import {FinanceService} from '../src/modules/orders/finance-service';
import {CheckoutService} from '../src/modules/orders/checkout-service';
import {roleAllows} from '../src/modules/auth/permissions';
import {createServer} from '../src/server';
async function setup(){
 const f=await fixture(),tables=new TableService(f.db,f.bus,f.auth,f.now),orders=new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now),finance=new FinanceService(orders),checkout=new CheckoutService(finance);
 const grant=async(permission:string,allowed=true,token=f.token,employeeId=f.auth.current(token).id)=>f.auth.setPermission(f.token,randomUUID(),{employeeId,revision:f.auth.employee(employeeId).revision,permission:permission as never,allowed});
 for(const permission of ['shift.open','counter.view','counter.batch.submit','order.settle.counter','order.correct','order.cancel','table.access_others'])await grant(permission);
 await f.shifts.open(f.token,randomUUID(),'owner',password);const d=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});await f.menu.publish(f.token,randomUUID(),d);await tables.setMode(f.token,randomUUID(),{mode:'STRICT',revision:0});
 const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true}),table=async(name:string)=>tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name,active:true});
 const draft=(discount=0,unitPrice=1000)=>({draftId:randomUUID(),draftRevision:1,menuRevision:1,discount,lines:[{lineId:randomUUID(),kind:'CUSTOM_AMOUNT',itemId:'CUSTOM_AMOUNT',variantId:null,modifierIds:[],quantity:2,comment:'',unitPrice}]});
 const ordinary=()=>({...draft(),lines:[{lineId:randomUUID(),itemId:'coffee',variantId:'small',modifierIds:['regular'],quantity:1,comment:'Тёплый'}]});
 const input=(type:'TABLE'|'COUNTER',extra={})=>({orderId:null,type,sessionId:null,opening:type==='TABLE'?{tableId:null,responsibleWaiterId:null}:null,draft:draft(),payment:{kind:'SINGLE',method:'CASH'},...extra});
 const confirmation=(q:ReturnType<CheckoutService['prepare']>)=>({expectedOrderRevision:q.expectedOrderRevision,expectedVisitRevision:q.expectedVisitRevision,shiftId:q.shiftId,confirmationHash:q.confirmationHash});
 const pay=async(i:ReturnType<typeof input>,id=randomUUID(),token=f.token)=>{const q=checkout.prepare(token,i);return checkout.commit(token,{...i,...confirmation(q)},id);};
 return {...f,tables,orders,finance,checkout,grant,table,draft,ordinary,input,confirmation,pay};
}

it('moves visits atomically with CAS/events; retains creator/snapshots and enforces object access after responsible reassignment',async()=>{const f=await setup();try{
 const t1=await f.table('1'),t2=await f.table('2'),t3=await f.table('3');const tokens:string[]=[],ids:string[]=[];
 for(const login of ['first','second']){const employee=await f.auth.createEmployee(f.token,randomUUID(),{login,name:login,role:'WAITER'}),session=await f.auth.login(login,employee.temporaryPassword,'WAITER_WEB');await f.auth.changePassword(session.token,randomUUID(),employee.temporaryPassword,password);tokens.push((await f.auth.login(login,password,'WAITER_WEB')).token);ids.push(employee.id);}
 const visit=await f.tables.open(tokens[0],randomUUID(),{tableId:t1.id,responsibleWaiterId:null});await f.tables.setMode(f.token,randomUUID(),{mode:'SHARED',revision:1});
 const d=f.ordinary(),q=f.orders.prepare(tokens[0],visit.sessionId,d),r=await f.orders.submit(tokens[0],randomUUID(),visit.sessionId,{...d,orderRevision:q.orderRevision,confirmationHash:q.confirmationHash}),snapshot=f.db.prepare('SELECT payload FROM print_jobs WHERE batch_id=?').get(r.batchId);
 const move={sessionId:visit.sessionId,tableId:t2.id,revision:2},id=randomUUID();await f.tables.move(f.token,id,move);expect(await f.tables.move(f.token,id,move)).toEqual({sessionId:visit.sessionId,revision:3});expect(f.tables.details(f.token,visit.sessionId)).toMatchObject({tableId:t2.id,openedBy:{id:ids[0]},responsibleWaiter:{id:ids[0]},openedAt:f.now()});
 expect(f.tables.list(f.token).tables.find(t=>t.id===t1.id)?.state).toBe('FREE');expect(f.db.prepare('SELECT payload FROM print_jobs WHERE batch_id=?').get(r.batchId)).toEqual(snapshot);await expect(f.tables.move(f.token,randomUUID(),{...move,tableId:t3.id})).rejects.toThrow('REVISION_CONFLICT');
 const occupied=await f.tables.open(f.token,randomUUID(),{tableId:t3.id,responsibleWaiterId:ids[1]});await expect(f.tables.move(f.token,randomUUID(),{...move,tableId:t3.id,revision:3})).rejects.toThrow('TABLE_OCCUPIED');
 await f.tables.responsible(f.token,randomUUID(),{sessionId:visit.sessionId,responsibleWaiterId:ids[1],revision:3});await f.grant('table.access_others',false,f.token,ids[0]);await f.tables.setMode(f.token,randomUUID(),{mode:'STRICT',revision:2});expect(()=>f.tables.details(tokens[0],visit.sessionId)).toThrow('VISIT_ACCESS_DENIED');expect(f.tables.details(tokens[1],visit.sessionId).openedBy.id).toBe(ids[0]);
 expect(()=>f.db.prepare("UPDATE table_sessions SET opened_by=?,revision=revision+1 WHERE id=?").run(ids[1],visit.sessionId)).toThrow('IMMUTABLE_VISIT_HISTORY');expect(()=>f.db.exec('DELETE FROM table_assignment_events')).toThrow('IMMUTABLE_ASSIGNMENT_EVENT');
 await f.grant('table.access_others',false);expect(()=>f.checkout.prepare(f.token,f.input('TABLE',{opening:{tableId:null,responsibleWaiterId:ids[1]}}))).toThrow('VISIT_ACCESS_DENIED');await expect(f.tables.move(f.token,randomUUID(),{sessionId:occupied.sessionId,tableId:t1.id,revision:1})).rejects.toThrow('VISIT_ACCESS_DENIED');
 }finally{f.close();}});


it('lets waiters pay own tables in STRICT, pay accessible foreign tables in SHARED and transfer only their own tables there',async()=>{const f=await setup();try{
 const [firstTable,secondTable,targetTable]=await Promise.all([f.table('21'),f.table('22'),f.table('23')]);
 const tokens:string[]=[],ids:string[]=[];
 for(const login of ['waiter-pay-one','waiter-pay-two']){const employee=await f.auth.createEmployee(f.token,randomUUID(),{login,name:login,role:'WAITER'}),first=await f.auth.login(login,employee.temporaryPassword,'WAITER_WEB');await f.auth.changePassword(first.token,randomUUID(),employee.temporaryPassword,password);tokens.push((await f.auth.login(login,password,'WAITER_WEB')).token);ids.push(employee.id);}
 const first=await f.tables.open(tokens[0],randomUUID(),{tableId:firstTable.id,responsibleWaiterId:null}),second=await f.tables.open(tokens[1],randomUUID(),{tableId:secondTable.id,responsibleWaiterId:null});
 const accept=async(token:string,sessionId:string)=>{const draft=f.ordinary(),quote=f.orders.prepare(token,sessionId,draft);return f.orders.submit(token,randomUUID(),sessionId,{...draft,orderRevision:quote.orderRevision,confirmationHash:quote.confirmationHash});};
 const order1=await accept(tokens[0],first.sessionId),order2=await accept(tokens[1],second.sessionId),payment={kind:'SINGLE' as const,method:'CASH' as const};
 expect(f.finance.get(tokens[1],order2.orderId).allowedActions).toContain('order.settle.table');
 const own=f.finance.prepareSettlement(tokens[1],order2.orderId,{payment});await f.finance.settle(tokens[1],order2.orderId,{payment,expectedOrderRevision:own.expectedOrderRevision,expectedVisitRevision:own.expectedVisitRevision,shiftId:own.shiftId,confirmationHash:own.confirmationHash},randomUUID());
 await f.grant('table.access_others',true,f.token,ids[1]);
 expect(f.finance.get(tokens[1],order1.orderId).allowedActions).not.toContain('order.settle.table');
 expect(()=>f.finance.prepareSettlement(tokens[1],order1.orderId,{payment})).toThrow('VISIT_ACCESS_DENIED');
 expect(()=>f.checkout.prepare(tokens[1],f.input('TABLE',{orderId:order1.orderId,sessionId:first.sessionId,opening:null,draft:null,payment}))).toThrow('VISIT_ACCESS_DENIED');
 const before=f.tables.details(tokens[0],first.sessionId);
 await expect(f.tables.move(tokens[0],randomUUID(),{sessionId:first.sessionId,tableId:targetTable.id,revision:before.revision})).rejects.toThrow('SHARED_MODE_REQUIRED');
 expect(f.tables.waiters(tokens[0])).toHaveLength(1);
 await f.tables.setMode(f.token,randomUUID(),{mode:'SHARED',revision:1});
 expect(f.tables.waiters(tokens[0])).toHaveLength(2);
 expect(f.finance.get(tokens[1],order1.orderId).allowedActions).toContain('order.settle.table');
 expect(f.finance.prepareSettlement(tokens[1],order1.orderId,{payment}).total).toBeGreaterThan(0);
 await expect(f.tables.move(tokens[1],randomUUID(),{sessionId:first.sessionId,tableId:targetTable.id,revision:before.revision})).rejects.toThrow('RESPONSIBLE_WAITER_REQUIRED');
 const moved=await f.tables.move(tokens[0],randomUUID(),{sessionId:first.sessionId,tableId:targetTable.id,revision:before.revision});
 expect(f.tables.list(tokens[0]).tables.find(table=>table.id===firstTable.id)?.state).toBe('FREE');
 await f.tables.responsible(tokens[0],randomUUID(),{sessionId:first.sessionId,responsibleWaiterId:ids[1],revision:moved.revision});
 expect(f.tables.details(tokens[0],first.sessionId)).toMatchObject({openedBy:{id:ids[0]},responsibleWaiter:{id:ids[1]},tableId:targetTable.id});
 await expect(f.tables.move(tokens[0],randomUUID(),{sessionId:first.sessionId,tableId:firstTable.id,revision:moved.revision+1})).rejects.toThrow('RESPONSIBLE_WAITER_REQUIRED');
 await f.grant('order.settle.table',false,f.token,ids[0]);
 expect(f.finance.get(tokens[0],order1.orderId).allowedActions).not.toContain('order.settle.table');
 expect(()=>f.finance.prepareSettlement(tokens[0],order1.orderId,{payment})).toThrow('PERMISSION_DENIED');
 await f.grant('order.settle.table',true,f.token,ids[0]);
 const shared=f.finance.prepareSettlement(tokens[0],order1.orderId,{payment});await f.finance.settle(tokens[0],order1.orderId,{payment,expectedOrderRevision:shared.expectedOrderRevision,expectedVisitRevision:shared.expectedVisitRevision,shiftId:shared.shiftId,confirmationHash:shared.confirmationHash},randomUUID());
 expect(f.db.prepare('SELECT actor_id FROM payments WHERE order_id=?').get(order1.orderId)).toEqual({actor_id:ids[0]});
 }finally{f.close();}});
