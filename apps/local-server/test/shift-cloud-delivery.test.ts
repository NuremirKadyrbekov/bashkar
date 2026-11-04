import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,password,catalog} from './fixtures/operations';
import {TableService} from '../src/modules/tables/table-service';
import {OrderService} from '../src/modules/orders/order-service';
import {FinanceService} from '../src/modules/orders/finance-service';
import {ShiftFinanceService} from '../src/modules/shifts/shift-finance-service';
import {ShiftCloudDelivery} from '../src/modules/shifts/shift-cloud-delivery';

it('queues the report with closure and retries offline delivery without duplicate Cloud data',async()=>{
 const f=await fixture();
 try{
  const owner=f.auth.current(f.token);
  await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:owner.employee.revision,permission:'shift.open',allowed:true});
  const shift=await f.shifts.open(f.token,randomUUID(),'owner',password);
  const tables=new TableService(f.db,f.bus,f.auth,f.now),orders=new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now);
  const service=new ShiftFinanceService(new FinanceService(orders));
  const prepared=service.prepareClose(f.token,shift.id,{expectedShiftRevision:shift.revision});
  const result=await service.close(f.token,randomUUID(),{shiftId:shift.id,expectedShiftRevision:shift.revision,confirmationHash:prepared.confirmationHash},'owner',password);
  expect(f.db.prepare('SELECT report_id,delivered_at FROM shift_cloud_delivery WHERE shift_id=?').get(shift.id)).toEqual({report_id:result.reportId,delivered_at:null});
  let offline=true;const received:any[]=[];
  const remote={call:async(operation:string,body:any)=>{expect(operation).toBe('shiftReport');received.push(body);if(offline)throw Error('OFFLINE');return {state:'APPLIED',reportId:body.reportId,hash:body.hash};}};
  const worker=new ShiftCloudDelivery(f.db,f.bus,f.claims.branchId,remote,f.now);
  await worker.syncOnce();expect(worker.status().pendingReports).toBe(1);
  expect((f.db.prepare('SELECT attempts,last_error FROM shift_cloud_delivery WHERE report_id=?').get(result.reportId) as any)).toEqual({attempts:1,last_error:'OFFLINE'});
  await worker.syncOnce();expect(received).toHaveLength(1);
  f.advance(15000);offline=false;await worker.syncOnce();
  expect(received[1]).toEqual(received[0]);expect(worker.status().pendingReports).toBe(0);
  await worker.syncOnce();expect(received).toHaveLength(2);
 }finally{f.close();}
});

it('queues paid journal records at closure and sends each once after the report',async()=>{
 const f=await fixture();
 try{
  const owner=f.auth.current(f.token);
  for(const permission of ['shift.open','counter.view','counter.batch.submit','order.settle.counter'] as const){const target=f.auth.employee(owner.id);await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:target.revision,permission,allowed:true});}
  const shift=await f.shifts.open(f.token,randomUUID(),'owner',password);
  const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});await f.menu.publish(f.token,randomUUID(),draft);
  const tables=new TableService(f.db,f.bus,f.auth,f.now),orders=new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now),finance=new FinanceService(orders);
  const request={draftId:randomUUID(),draftRevision:1,menuRevision:1,discount:0,lines:[{lineId:randomUUID(),itemId:'coffee',variantId:'small',modifierIds:['regular'],quantity:1,comment:''}],mode:'CHECKOUT' as const,payment:{kind:'SINGLE' as const,method:'CASH' as const}};
  const quote=finance.prepareCounter(f.token,null,request);
  await finance.counterCommit(f.token,null,{...request,expectedOrderRevision:quote.expectedOrderRevision,expectedVisitRevision:quote.expectedVisitRevision,shiftId:quote.shiftId,confirmationHash:quote.confirmationHash},randomUUID());
  const service=new ShiftFinanceService(finance),prepared=service.prepareClose(f.token,shift.id,{expectedShiftRevision:shift.revision});
  await service.close(f.token,randomUUID(),{shiftId:shift.id,expectedShiftRevision:shift.revision,confirmationHash:prepared.confirmationHash},'owner',password);
  expect((f.db.prepare('SELECT count(*) n FROM sale_cloud_delivery WHERE shift_id=?').get(shift.id) as {n:number}).n).toBe(1);
  const sent:string[]=[];const remote={call:async(operation:string,body:any)=>{sent.push(operation);return operation==='shiftReport'?{state:'APPLIED',reportId:body.reportId,hash:body.hash}:operation==='saleRecord'?{state:'APPLIED',settlementId:body.record.settlementId,hash:body.hash}:{state:'APPLIED',shiftId:body.record.shiftId,employeeId:body.record.employeeId,hash:body.hash};}};
  const worker=new ShiftCloudDelivery(f.db,f.bus,f.claims.branchId,remote,f.now);
  await worker.syncOnce();await worker.syncOnce();await worker.syncOnce();
  expect(sent).toEqual(['shiftReport','saleRecord','staffRecord']);
  expect((f.db.prepare('SELECT delivered_at FROM sale_cloud_delivery').get() as {delivered_at:number}).delivered_at).toBe(f.now());
 }finally{f.close();}
});
