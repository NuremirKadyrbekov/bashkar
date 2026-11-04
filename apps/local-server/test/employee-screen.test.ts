import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,catalog,password} from './fixtures/operations';
import {TableService} from '../src/modules/tables/table-service';
import {OrderService} from '../src/modules/orders/order-service';
import {FinanceService} from '../src/modules/orders/finance-service';
import {ShiftFinanceService} from '../src/modules/shifts/shift-finance-service';

it('lets Cashier manage Cashier and Waiter accounts without reaching Manager, Owner or self',async()=>{
 const f=await fixture();try{
  const manager=await f.auth.createEmployee(f.token,randomUUID(),{login:'protected-manager',name:'Менеджер',role:'MANAGER'});
  const cashier=await f.auth.createEmployee(f.token,randomUUID(),{login:'staff-cashier',name:'Кассир',role:'CASHIER'});
  const first=await f.auth.login('staff-cashier',cashier.temporaryPassword,'POS');await f.auth.changePassword(first.token,randomUUID(),cashier.temporaryPassword,password);
  const token=(await f.auth.login('staff-cashier',password,'POS')).token;
  expect(f.auth.list(token).every(row=>['CASHIER','WAITER'].includes(row.role))).toBe(true);
  await expect(f.auth.createEmployee(token,randomUUID(),{login:'forbidden-manager',name:'М',role:'MANAGER'})).rejects.toThrow('CASHIER_TARGET_FORBIDDEN');
  await expect(f.auth.updateEmployee(token,randomUUID(),{employeeId:manager.id,revision:manager.revision,status:'SUSPENDED'})).rejects.toThrow('PERMISSION_DENIED');
  await expect(f.auth.updateEmployee(token,randomUUID(),{employeeId:cashier.id,revision:f.auth.employee(cashier.id).revision,status:'SUSPENDED'})).rejects.toThrow('PERMISSION_DENIED');
  const waiter=await f.auth.createEmployee(token,randomUUID(),{login:'cashier-created-waiter',name:'Официант',role:'WAITER'});
  expect(waiter.temporaryPassword).toBeTruthy();
  await expect(f.auth.updateEmployee(token,randomUUID(),{employeeId:waiter.id,revision:waiter.revision,role:'MANAGER'})).rejects.toThrow('CASHIER_TARGET_FORBIDDEN');
  await expect(f.auth.updateEmployee(token,randomUUID(),{employeeId:waiter.id,revision:waiter.revision,status:'SUSPENDED'})).rejects.toThrow('PERMISSION_DENIED');
  await f.auth.setPermission(f.token,randomUUID(),{employeeId:cashier.id,revision:f.auth.employee(cashier.id).revision,permission:'employee.status.manage',allowed:true});
  await expect(f.auth.updateEmployee(token,randomUUID(),{employeeId:manager.id,revision:manager.revision,status:'SUSPENDED'})).rejects.toThrow('CASHIER_TARGET_FORBIDDEN');
  await expect(f.auth.updateEmployee(token,randomUUID(),{employeeId:cashier.id,revision:f.auth.employee(cashier.id).revision,status:'SUSPENDED'})).rejects.toThrow('CASHIER_TARGET_FORBIDDEN');
  for(const status of ['SUSPENDED','DEACTIVATED','ACTIVE'] as const)expect((await f.auth.updateEmployee(token,randomUUID(),{employeeId:waiter.id,revision:f.auth.employee(waiter.id).revision,status})).status).toBe(status);
  expect((await f.auth.resetPassword(token,randomUUID(),{employeeId:waiter.id,revision:f.auth.employee(waiter.id).revision})).temporaryPassword).toBeTruthy();
 }finally{f.close();}
});

it('stores optional phone, scopes employee read and counts the actual TABLE opener',async()=>{
 const f=await fixture();try{
  const owner=f.auth.current(f.token),created=await f.auth.createEmployee(f.token,randomUUID(),{login:'manager-screen',name:'Алия Садыкова',role:'MANAGER',phone:'+996 555 123 456'});
  expect(f.auth.list(f.token).find(row=>row.id===created.id)?.phone).toBe('+996 555 123 456');
  await f.auth.updateEmployee(f.token,randomUUID(),{employeeId:created.id,revision:created.revision,name:'Алия Жумаева',phone:null});
  expect(f.auth.list(f.token).find(row=>row.id===created.id)).toMatchObject({name:'Алия Жумаева',phone:null});
  const tables=new TableService(f.db,f.bus,f.auth,f.now),zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true});
  const table=await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name:'Стол 1',active:true});
  await tables.setMode(f.token,randomUUID(),{revision:0,mode:'SHARED'});
  await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:f.auth.employee(owner.id).revision,permission:'shift.open',allowed:true});
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  await tables.open(f.token,randomUUID(),{tableId:table.id,responsibleWaiterId:null});
  expect(f.auth.statistics(f.token,owner.id)).toMatchObject({openedTables:1,submittedBatches:0,registeredPayments:0,corrections:0});
  expect(f.auth.statistics(f.token,created.id).openedTables).toBe(0);
  const login=await f.auth.login('manager-screen',created.temporaryPassword,'POS');
  await f.auth.changePassword(login.token,randomUUID(),created.temporaryPassword,password);
  const manager=(await f.auth.login('manager-screen',password,'POS')).token;
  expect(()=>f.auth.statistics(manager,owner.id)).toThrow('PERMISSION_DENIED');
 }finally{f.close();}
});

it('credits the final TABLE waiter, COUNTER payment actor and refunds without exposing money to staff-only access',async()=>{
 const f=await fixture();try{
  const owner=f.auth.current(f.token),first=await f.auth.createEmployee(f.token,randomUUID(),{login:'waiter-revenue-1',name:'Первый',role:'WAITER'}),last=await f.auth.createEmployee(f.token,randomUUID(),{login:'waiter-revenue-2',name:'Последний',role:'WAITER'});
  for(const permission of ['shift.open','payment.refund','table.access_others','counter.view','counter.batch.submit','order.settle.counter'])await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:f.auth.employee(owner.id).revision,permission:permission as never,allowed:true});
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});await f.menu.publish(f.token,randomUUID(),draft);
  const tables=new TableService(f.db,f.bus,f.auth,f.now),orders=new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now),finance=new FinanceService(orders),shifts=new ShiftFinanceService(finance);
  await tables.setMode(f.token,randomUUID(),{revision:0,mode:'STRICT'});
  const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true}),table=await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name:'Стол',active:true});
  const visit=await tables.open(f.token,randomUUID(),{tableId:table.id,responsibleWaiterId:first.id});
  const request=()=>({draftId:randomUUID(),draftRevision:1,menuRevision:1,lines:[{lineId:randomUUID(),itemId:'coffee',variantId:'small',modifierIds:['regular'],quantity:1,comment:''}],discount:0});
  const input=request(),prepared=orders.prepare(f.token,visit.sessionId,input),accepted=await orders.submit(f.token,randomUUID(),visit.sessionId,{...input,orderRevision:prepared.orderRevision,confirmationHash:prepared.confirmationHash});
  await tables.responsible(f.token,randomUUID(),{sessionId:visit.sessionId,responsibleWaiterId:last.id,revision:tables.details(f.token,visit.sessionId).revision});
  const payment={kind:'SINGLE' as const,method:'CASH' as const},q=finance.prepareSettlement(f.token,accepted.orderId,{payment});
  const settled=await finance.settle(f.token,accepted.orderId,{payment,expectedOrderRevision:q.expectedOrderRevision,expectedVisitRevision:q.expectedVisitRevision,shiftId:q.shiftId,confirmationHash:q.confirmationHash},randomUUID());
  expect(f.auth.statistics(f.token,first.id).revenueTodayCents).toBe(0);
  expect(f.auth.statistics(f.token,last.id).revenueTodayCents).toBe(18000);
  expect(f.auth.statistics(f.token,owner.id).revenueTodayCents).toBe(0);
  const counterInput={...request(),mode:'ACCEPT' as const},counterQ=finance.prepareCounter(f.token,null,counterInput),counter=await finance.counterCommit(f.token,null,{...counterInput,expectedOrderRevision:counterQ.expectedOrderRevision,expectedVisitRevision:counterQ.expectedVisitRevision,shiftId:counterQ.shiftId,confirmationHash:counterQ.confirmationHash},randomUUID());
  const counterPayment={kind:'MIXED' as const,firstMethod:'CASH' as const,firstAmount:5000,secondMethod:'QR_TRANSFER_MANUAL' as const};
  const counterQ2=finance.prepareSettlement(f.token,counter.orderId,{payment:counterPayment});await finance.settle(f.token,counter.orderId,{payment:counterPayment,expectedOrderRevision:counterQ2.expectedOrderRevision,expectedVisitRevision:counterQ2.expectedVisitRevision,shiftId:counterQ2.shiftId,confirmationHash:counterQ2.confirmationHash},randomUUID());
  expect(f.auth.statistics(f.token,owner.id).revenueTodayCents).toBe(18000);
  const cashier=await f.auth.createEmployee(f.token,randomUUID(),{login:'cashier-no-revenue',name:'Кассир',role:'CASHIER'});
  await f.auth.setPermission(f.token,randomUUID(),{employeeId:cashier.id,revision:f.auth.employee(cashier.id).revision,permission:'sales.view.history',allowed:true});
  const cashierFirst=await f.auth.login('cashier-no-revenue',cashier.temporaryPassword,'POS');await f.auth.changePassword(cashierFirst.token,randomUUID(),cashier.temporaryPassword,password);
  const cashierToken=(await f.auth.login('cashier-no-revenue',password,'POS')).token;
  expect(f.auth.statistics(cashierToken,last.id).revenueTodayCents).toBeNull();
  expect(f.auth.statistics(cashierToken,cashier.id).revenueTodayCents).toBeNull();
  f.advance(86400000);
  const laterToken=(await f.auth.login('owner',password,'POS')).token;
  const refund=shifts.prepareRefund(laterToken,settled.paymentIds[0],{reason:'Возврат оплаты'});
  await shifts.refund(laterToken,settled.paymentIds[0],{reason:refund.reason,currentShiftId:refund.currentShiftId,confirmedExternalReturn:true,confirmationHash:refund.confirmationHash},randomUUID());
  expect(f.auth.statistics(laterToken,last.id).revenueTodayCents).toBe(-18000);
  expect(f.auth.statistics(laterToken,owner.id).revenueTodayCents).toBe(0);
  const manager=await f.auth.createEmployee(laterToken,randomUUID(),{login:'manager-revenue',name:'Менеджер',role:'MANAGER'});
  await f.auth.setPermission(laterToken,randomUUID(),{employeeId:manager.id,revision:manager.revision,permission:'employee.edit',allowed:true});
  const session=await f.auth.login('manager-revenue',manager.temporaryPassword,'POS');await f.auth.changePassword(session.token,randomUUID(),manager.temporaryPassword,password);
  const managerToken=(await f.auth.login('manager-revenue',password,'POS')).token;
  expect(f.auth.statistics(managerToken,owner.id).revenueTodayCents).toBeNull();
 }finally{f.close();}
});
