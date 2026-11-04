import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,catalog,password} from './fixtures/operations';
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
it('atomically checks out new TABLE assigned/unassigned and COUNTER; shared numbers, frozen fees, kitchen subsets, exact replay',async()=>{const f=await setup();try{
 await f.menu.configureFees(f.token,randomUUID(),{revision:0,fees:[{id:'fee',name:'Сервис',rate:1000}]} as never);
 const table=await f.table('10');let number=0;
 for(const i of [f.input('TABLE',{opening:{tableId:table.id,responsibleWaiterId:null},draft:f.ordinary()}),f.input('COUNTER'),f.input('TABLE')]){
  const id=randomUUID(),q=f.checkout.prepare(f.token,i),request={...i,...f.confirmation(q)},r=await f.checkout.commit(f.token,request,id);expect(r.orderNumber).toBe(++number);expect(r.result).toBe('PAID');expect(await f.checkout.commit(f.token,request,id)).toEqual(r);expect(f.finance.get(f.token,r.orderId).total).toBe(q.total);
  expect(f.db.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=?').get(r.orderId)).toEqual({n:1});expect(f.db.prepare('SELECT COUNT(*) n FROM order_batches WHERE order_id=?').get(r.orderId)).toEqual({n:1});expect(r.kitchenJobIds).toHaveLength(i.draft.lines[0].itemId==='coffee'?1:0);
 }
 expect(f.finance.activeOrders(f.token).orders).toHaveLength(0);expect(f.tables.list(f.token).tables[0].state).toBe('FREE');expect(f.db.pragma('foreign_key_check')).toEqual([]);
 }finally{f.close();}});
it('pays whole existing TABLE/COUNTER with or without new package, keeps number and existing fee snapshot; zero creates no payment',async()=>{const f=await setup();try{
 for(const type of ['TABLE','COUNTER'] as const){
  let sessionId:string|null=null,orderId:string;
  if(type==='TABLE'){sessionId=(await f.tables.open(f.token,randomUUID(),{tableId:null,responsibleWaiterId:null})).sessionId;const d=f.draft(100),q=f.orders.prepare(f.token,sessionId,d);orderId=(await f.orders.submit(f.token,randomUUID(),sessionId,{...d,orderRevision:q.orderRevision,confirmationHash:q.confirmationHash})).orderId;}
  else{const d={...f.draft(100),mode:'ACCEPT'},q=f.finance.prepareCounter(f.token,null,d);orderId=(await f.finance.counterCommit(f.token,null,{...d,...f.confirmation(q as never)},randomUUID())).orderId;}
  const original=f.finance.get(f.token,orderId);await f.menu.configureFees(f.token,randomUUID(),{revision:type==='TABLE'?0:1,fees:[{id:'fee',name:'Сервис',rate:1000}]} as never);
  const i=f.input(type,{orderId,sessionId,opening:null,draft:f.draft(100),payment:{kind:'MIXED',firstMethod:'CASH',firstAmount:1000,secondMethod:'QR_TRANSFER_MANUAL'}}),q=f.checkout.prepare(f.token,i);expect(q.total).toBe(3900);const r=await f.pay(i);expect(r.orderNumber).toBe(original.orderNumber);expect(f.db.prepare('SELECT SUM(amount) n FROM payments WHERE order_id=?').get(r.orderId)).toEqual({n:3900});
 }
 for(const type of ['TABLE','COUNTER'] as const){
  let sessionId:string|null=null,orderId:string;const d=f.draft(2000);
  if(type==='TABLE'){sessionId=(await f.tables.open(f.token,randomUUID(),{tableId:null,responsibleWaiterId:null})).sessionId;const q=f.orders.prepare(f.token,sessionId,d);orderId=(await f.orders.submit(f.token,randomUUID(),sessionId,{...d,orderRevision:q.orderRevision,confirmationHash:q.confirmationHash})).orderId;}
  else{const r={...d,mode:'ACCEPT'},q=f.finance.prepareCounter(f.token,null,r);orderId=(await f.finance.counterCommit(f.token,null,{...r,...f.confirmation(q as never)},randomUUID())).orderId;}
  // Accepted-only settlement does not require permission to add positions.
  await f.grant(type==='TABLE'?'table.batch.submit':'counter.batch.submit',false);const r=await f.pay(f.input(type,{orderId,sessionId,opening:null,draft:null,payment:{kind:'ZERO'}}));expect(r.result).toBe('ZERO_SETTLED');expect(r.paymentIds).toEqual([]);await f.grant(type==='TABLE'?'table.batch.submit':'counter.batch.submit',true);
 }
 }finally{f.close();}});
it('rolls back visit/number/package/payment/print/audit/result at each failed write and retries the same untouched checkout',async()=>{const f=await setup();try{
 for(const table of ['table_sessions','orders','order_batches','order_items','print_jobs','settlements','payments','settlement_seals','audit_events','outbox','commands']){
  const input=f.input('TABLE',{draft:f.ordinary()}),q=f.checkout.prepare(f.token,input),id=randomUUID(),request={...input,...f.confirmation(q)};
  f.db.exec(`CREATE TRIGGER test_checkout_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'TEST_ROLLBACK');END;`);const snapshot=()=>JSON.stringify(['table_sessions','orders','order_batches','order_items','order_numbers','order_sequences','print_jobs','settlements','payments','settlement_seals','audit_events','outbox','commands'].map(t=>f.db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()));const before=snapshot();
  await expect(f.checkout.commit(f.token,request,id)).rejects.toThrow();expect(snapshot()).toBe(before);f.db.exec('DROP TRIGGER test_checkout_failure');const r=await f.checkout.commit(f.token,request,id);expect(r.orderNumber).toBeGreaterThan(0);
 }
 }finally{f.close();}});
it('refuses stale money/revisions, reused drafts, invalid splits and revoked permissions; concurrent commands cannot double settle',async()=>{const f=await setup();try{
 const input=f.input('COUNTER'),q=f.checkout.prepare(f.token,input),request={...input,...f.confirmation(q)};
 await f.grant('order.settle.counter',false);await expect(f.checkout.commit(f.token,request,randomUUID())).rejects.toThrow('PERMISSION_DENIED');await f.grant('order.settle.counter');
 for(const payment of [{kind:'MIXED',firstMethod:'CASH',secondMethod:'CASH',firstAmount:1},{kind:'MIXED',firstMethod:'CASH',secondMethod:'QR_TRANSFER_MANUAL',firstAmount:0},{kind:'MIXED',firstMethod:'CASH',secondMethod:'QR_TRANSFER_MANUAL',firstAmount:2000}])expect(()=>f.checkout.prepare(f.token,{...input,payment})).toThrow('INVALID_PAYMENT_SPLIT');
 const results=await Promise.allSettled([f.checkout.commit(f.token,request,randomUUID()),f.checkout.commit(f.token,request,randomUUID())]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.db.prepare('SELECT COUNT(*) n FROM payments').get()).toEqual({n:1});
 const sessionId=(await f.tables.open(f.token,randomUUID(),{tableId:null,responsibleWaiterId:null})).sessionId,d=f.draft(),b=f.orders.prepare(f.token,sessionId,d),accepted=await f.orders.submit(f.token,randomUUID(),sessionId,{...d,orderRevision:b.orderRevision,confirmationHash:b.confirmationHash});const i=f.input('TABLE',{orderId:accepted.orderId,sessionId,opening:null,draft:null}),old=f.checkout.prepare(f.token,i);await f.orders.discount(f.token,randomUUID(),accepted.orderId,{amount:100,expectedRevision:1});await expect(f.checkout.commit(f.token,{...i,...f.confirmation(old)},randomUUID())).rejects.toThrow('CONFIRMATION_STALE');
 const next=f.input('TABLE'),money=f.checkout.prepare(f.token,next);await f.menu.configureFees(f.token,randomUUID(),{revision:0,fees:[{id:'fee',name:'Сервис',rate:500}]} as never);await expect(f.checkout.commit(f.token,{...next,...f.confirmation(money)},randomUUID())).rejects.toThrow('CONFIRMATION_STALE');
 expect(roleAllows('WAITER','table.move')).toBe(true);expect(roleAllows('WAITER','table.responsible.change')).toBe(true);
 }finally{f.close();}});
it('exposes strict native HTTP checkout and assignment endpoints, refuses forged authority fields',async()=>{const f=await setup();let server:Awaited<ReturnType<typeof createServer>>|undefined;try{
 const input=f.input('COUNTER');f.storage.close();server=await createServer(f.dir,0,false,f.trust);
 const post=(path:string,payload:unknown)=>server!.inject({method:'POST',url:'/api/v1/'+path,headers:{host:'localhost',authorization:'Bearer '+f.token,'content-type':'application/json'},payload:payload as never});
 const prepared=await post('cash/checkout/prepare',input);expect(prepared.statusCode).toBe(200);const q=prepared.json(),id=randomUUID(),commit={...input,...f.confirmation(q),commandId:id};expect((await post('cash/checkout/commit',{...commit,actorId:randomUUID()})).statusCode).toBe(400);const accepted=await post('cash/checkout/commit',commit);expect(accepted.statusCode).toBe(200);expect((await post('cash/checkout/commit',commit)).json()).toEqual(accepted.json());
 const invalid=await post('tables/move',{commandId:randomUUID(),sessionId:randomUUID(),tableId:randomUUID(),revision:1,branchId:randomUUID()});expect(invalid.statusCode).toBe(400);
 }finally{await server?.close();f.close();}});
it('rolls back assignment events together with visit/audit changes and serializes competing targets',async()=>{const f=await setup();try{
 const a=await f.table('a'),b=await f.table('b'),target=await f.table('target');const v1=await f.tables.open(f.token,randomUUID(),{tableId:a.id,responsibleWaiterId:null}),v2=await f.tables.open(f.token,randomUUID(),{tableId:b.id,responsibleWaiterId:null});
 f.db.exec("CREATE TRIGGER fail_assignment BEFORE INSERT ON audit_events WHEN NEW.action='table.visit.assignment.changed' BEGIN SELECT RAISE(ABORT,'TEST_ASSIGNMENT');END;");
 await expect(f.tables.move(f.token,randomUUID(),{sessionId:v1.sessionId,tableId:target.id,revision:1})).rejects.toThrow('TEST_ASSIGNMENT');expect(f.tables.details(f.token,v1.sessionId).tableId).toBe(a.id);expect(f.db.prepare('SELECT COUNT(*) n FROM table_assignment_events').get()).toEqual({n:0});f.db.exec('DROP TRIGGER fail_assignment');
 const results=await Promise.allSettled([f.tables.move(f.token,randomUUID(),{sessionId:v1.sessionId,tableId:target.id,revision:1}),f.tables.move(f.token,randomUUID(),{sessionId:v2.sessionId,tableId:target.id,revision:1})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.db.prepare('SELECT COUNT(*) n FROM table_assignment_events').get()).toEqual({n:1});
 }finally{f.close();}});
it('binds batch and checkout confirmation to visit revision; races settlement against an independent package without partial payment',async()=>{const f=await setup();try{
 const a=await f.table('a'),b=await f.table('b'),sessionId=(await f.tables.open(f.token,randomUUID(),{tableId:a.id,responsibleWaiterId:null})).sessionId;
 const first=f.draft(),proposal=f.orders.prepare(f.token,sessionId,first);await f.tables.move(f.token,randomUUID(),{sessionId,tableId:b.id,revision:1});await expect(f.orders.submit(f.token,randomUUID(),sessionId,{...first,orderRevision:proposal.orderRevision,confirmationHash:proposal.confirmationHash})).rejects.toThrow('CONFIRMATION_STALE');
 const current=f.orders.prepare(f.token,sessionId,first),accepted=await f.orders.submit(f.token,randomUUID(),sessionId,{...first,orderRevision:current.orderRevision,confirmationHash:current.confirmationHash});
 const payment=f.input('TABLE',{orderId:accepted.orderId,sessionId,opening:null,draft:f.draft()}),q=f.checkout.prepare(f.token,payment),other=f.draft(),batch=f.orders.prepare(f.token,sessionId,other);
 const result=await Promise.allSettled([f.checkout.commit(f.token,{...payment,...f.confirmation(q)},randomUUID()),f.orders.submit(f.token,randomUUID(),sessionId,{...other,orderRevision:batch.orderRevision,confirmationHash:batch.confirmationHash})]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.db.prepare('SELECT COUNT(*) n FROM order_batches WHERE order_id=?').get(accepted.orderId)).toEqual({n:2});expect(f.db.prepare('SELECT SUM(amount) n FROM payments WHERE order_id=?').get(accepted.orderId)).toEqual({n:4000});
 }finally{f.close();}});
