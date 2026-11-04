import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture,password,catalog } from './fixtures/operations';
import { TableService } from '../src/modules/tables/table-service';
import { OrderService } from '../src/modules/orders/order-service';
import { FinanceService } from '../src/modules/orders/finance-service';
import type { Role } from '../src/modules/auth/session-policy';
import { createServer } from '../src/server';
import {applyPending,latestSchema} from '../src/migrations';
async function setup(){
 const f=await fixture(),tables=new TableService(f.db,f.bus,f.auth,f.now);
 const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true});
 const table=await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name:'Стол 1',active:true});
 async function allow(employeeId:string,permission:any,allowed=true){const target=f.auth.employee(employeeId);return f.auth.setPermission(f.token,randomUUID(),{employeeId,revision:target.revision,permission,allowed});}
 async function employee(role:Role,name=role.toLowerCase()){
  const id=randomUUID(),owner=f.auth.employee(f.auth.current(f.token).id);
  f.db.prepare('INSERT INTO employees(id,branch_id,login,name,role,status,password_hash,must_change,created_at) VALUES(?,?,?,?,?,\'ACTIVE\',?,0,?)').run(id,owner.branch_id,name,name,role,owner.password_hash,f.now());
  return {id,token:(await f.auth.login(name,password,role==='WAITER'?'WAITER_WEB':'POS')).token};
 }
 async function shift(){await allow(f.auth.current(f.token).id,'shift.open');return f.shifts.open(f.token,randomUUID(),'owner',password);}
 async function mode(value:'STRICT'|'SHARED'){return tables.setMode(f.token,randomUUID(),{mode:value,revision:tables.list(f.token).settings.revision});}
 return {...f,tables,zone,table,allow,employee,shift,mode};
}
it('reports whether the branch shift is open for waiter table actions',async()=>{
 const f=await setup();try{
  expect(f.tables.list(f.token).shiftOpen).toBe(false);
  await f.shift();
  expect(f.tables.list(f.token).shiftOpen).toBe(true);
 }finally{f.close();}
});
it('keeps one opaque public path for a table across edits and command replay',async()=>{
 const f=await setup();try{
  const original=f.tables.publicLinks(f.token).find(row=>row.tableId===f.table.id)!;
  expect(original.publicPath).toMatch(new RegExp(`^/b/${f.claims.branchId}/t/[A-Za-z0-9_-]{22}$`));
  expect(original.publicUrl).toBeNull();
  const command=randomUUID(),input={tableId:f.table.id,revision:f.table.revision,zoneId:f.zone.id,name:'Стол 2',active:true};
  const edited=await f.tables.saveTable(f.token,command,input);
  expect(edited.publicPath).toBe(original.publicPath);
  expect(await f.tables.saveTable(f.token,command,input)).toEqual(edited);
  const next=await f.tables.saveTable(f.token,randomUUID(),{tableId:null,revision:0,zoneId:f.zone.id,name:'Стол 3',active:true});
  expect(next.publicPath).not.toBe(original.publicPath);
  const cashier=await f.employee('CASHIER');expect(f.tables.publicLinks(cashier.token)).toHaveLength(2);
  await f.allow(cashier.id,'table.manage',false);expect(()=>f.tables.publicLinks(cashier.token)).toThrow('PERMISSION_DENIED');
 }finally{f.close();}
});
it('backfills existing tables during schema 21 without changing their IDs or names',async()=>{
 const f=await setup();try{
  const before=f.db.prepare('SELECT id,name FROM dining_tables WHERE branch_id=?').all(f.claims.branchId);
  f.db.exec('DROP TRIGGER queue_closed_shift_sales;DROP TRIGGER queue_refund_cloud;DROP TRIGGER queue_closed_shift_staff;DROP TABLE staff_cloud_delivery;DROP TABLE refund_cloud_delivery;DROP TABLE sale_cloud_delivery;DROP TABLE shift_cloud_delivery');
  f.db.exec('DROP TABLE sales_catalog_pins;DROP TABLE sales_catalog_pin_state');
  f.db.exec('DROP TABLE table_cloud_sync_state');
  f.db.exec('DROP TABLE analytics_sync_state');
  f.db.exec('DROP TABLE dining_table_public_links');
  f.db.prepare('DELETE FROM schema_migrations WHERE version>=21').run();
  applyPending(f.db);
  expect(f.db.prepare('SELECT id,name FROM dining_tables WHERE branch_id=?').all(f.claims.branchId)).toEqual(before);
  const path=f.tables.publicLinks(f.token)[0].publicPath;
  expect(path).toMatch(/\/t\/[A-Za-z0-9_-]{22}$/);
  applyPending(f.db);
  expect(f.tables.publicLinks(f.token)[0].publicPath).toBe(path);
 }finally{f.close();}
});
it('summarizes current waiter assignments and personally sent batches without treating them as revenue',async()=>{
 const f=await setup();try{
  const one=await f.employee('WAITER','waiter-one'),two=await f.employee('WAITER','waiter-two');
  expect(f.tables.waiterShiftSummary(f.token)).toMatchObject({shiftId:null,waiters:[{id:one.id,openTableCount:0,acceptedBatchCount:0,acceptedSubtotalTyiyn:'0'},{id:two.id,openTableCount:0,acceptedBatchCount:0,acceptedSubtotalTyiyn:'0'}]});
  expect(()=>f.tables.waiterShiftSummary(one.token)).toThrow('PERMISSION_DENIED');
  await f.mode('SHARED');await f.shift();const menu=catalog(),draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:menu});await f.menu.publish(f.token,randomUUID(),draft);
  const orders=new OrderService(f.db,f.bus,f.auth,f.menu,f.tables,f.now),finance=new FinanceService(orders),opened=await f.tables.open(one.token,randomUUID(),{tableId:f.table.id,responsibleWaiterId:null});
  const send=async(token:string)=>{const input={draftId:randomUUID(),draftRevision:1,menuRevision:1,discount:0,lines:[{lineId:randomUUID(),itemId:'coffee',variantId:'small',modifierIds:['regular'],quantity:1,comment:''}]},quote=orders.prepare(token,opened.sessionId,input);return orders.submit(token,randomUUID(),opened.sessionId,{...input,orderRevision:quote.orderRevision,confirmationHash:quote.confirmationHash});};
  const first=await send(one.token);let summary=f.tables.waiterShiftSummary(f.token);expect(summary.shiftId).toBeTruthy();expect(summary.waiters.find(row=>row.id===one.id)).toMatchObject({openTableCount:1,acceptedBatchCount:1,acceptedSubtotalTyiyn:'18000'});
  await f.tables.responsible(f.token,randomUUID(),{sessionId:opened.sessionId,responsibleWaiterId:two.id,revision:f.tables.details(f.token,opened.sessionId).revision});await send(two.token);summary=f.tables.waiterShiftSummary(f.token);
  expect(summary.waiters.find(row=>row.id===one.id)).toMatchObject({openTableCount:0,acceptedBatchCount:1,acceptedSubtotalTyiyn:'18000'});
  expect(summary.waiters.find(row=>row.id===two.id)).toMatchObject({openTableCount:1,acceptedBatchCount:1,acceptedSubtotalTyiyn:'18000'});
  const payment={kind:'SINGLE',method:'CASH'},quote=finance.prepareSettlement(f.token,first.orderId,{payment});await finance.settle(f.token,first.orderId,{payment,expectedOrderRevision:quote.expectedOrderRevision,expectedVisitRevision:quote.expectedVisitRevision,shiftId:quote.shiftId,confirmationHash:quote.confirmationHash},randomUUID());
  summary=f.tables.waiterShiftSummary(f.token);expect(summary.waiters.find(row=>row.id===two.id)).toMatchObject({openTableCount:0,acceptedBatchCount:1,acceptedSubtotalTyiyn:'18000'});
 }finally{f.close();}
});
it('configures zones/tables with CAS, normalized unique labels, role ceilings and atomic audit rollback',async()=>{
 const f=await setup();try{
  const cashier=await f.employee('CASHIER');expect(await f.tables.saveZone(cashier.token,randomUUID(),{zoneId:null,revision:0,name:'Other',active:true})).toMatchObject({name:'Other'});
  expect(f.auth.current(cashier.token,'table.manage').id).toBe(cashier.id);
  await expect(f.tables.saveTable(f.token,randomUUID(),{tableId:null,revision:0,zoneId:f.zone.id,name:'  СТОЛ   1 ',active:true})).rejects.toThrow('TABLE_NAME_USED');
  await expect(f.tables.saveZone(f.token,randomUUID(),{zoneId:f.zone.id,revision:0,name:'New',active:true})).rejects.toThrow('REVISION_CONFLICT');
  await expect(f.tables.saveZone(f.token,randomUUID(),{zoneId:f.zone.id,revision:1,name:f.zone.name,active:false})).rejects.toThrow('ZONE_HAS_ACTIVE_TABLES');
  f.db.exec("CREATE TRIGGER fail_table_audit BEFORE INSERT ON audit_events WHEN NEW.action='table.config.saved' BEGIN SELECT RAISE(ABORT,'audit-test'); END;");
  const command=randomUUID();await expect(f.tables.saveTable(f.token,command,{tableId:null,revision:0,zoneId:f.zone.id,name:'Rollback',active:true})).rejects.toThrow('audit-test');
  expect(f.db.prepare("SELECT 1 FROM dining_tables WHERE name='Rollback'").get()).toBeUndefined();expect(f.db.prepare('SELECT 1 FROM commands WHERE id=?').get(command)).toBeUndefined();
 }finally{f.close();}
});
it('saves a branch floor plan with stable table IDs, CAS, replay and permission checks',async()=>{
 const f=await setup();try{
  const empty=f.tables.floorPlan(f.token);expect(empty).toEqual({revision:0,plan:{version:1,zones:[],tables:[]}});
  const plan={version:1 as const,zones:[{zoneId:f.zone.id,kind:'RECT' as const,x:40,y:60,width:500,height:350}],tables:[{tableId:f.table.id,kind:'ROUND' as const,x:160,y:180,rotation:0 as const}]};
  const id=randomUUID(),saved=await f.tables.saveFloorPlan(f.token,id,{revision:0,plan});expect(saved).toEqual({revision:1,plan});expect(await f.tables.saveFloorPlan(f.token,id,{revision:0,plan})).toEqual(saved);expect(f.tables.floorPlan(f.token)).toEqual(saved);
  await expect(f.tables.saveFloorPlan(f.token,randomUUID(),{revision:0,plan})).rejects.toThrow('REVISION_CONFLICT');
  await expect(f.tables.saveFloorPlan(f.token,randomUUID(),{revision:1,plan:{...plan,tables:[{...plan.tables[0],x:1001}]}})).rejects.toThrow('INVALID_FLOOR_PLAN');
  await expect(f.tables.saveFloorPlan(f.token,randomUUID(),{revision:1,plan:{...plan,tables:[{...plan.tables[0],tableId:randomUUID()}]}})).rejects.toThrow('TABLE_NOT_FOUND');
  const cashier=await f.employee('CASHIER');expect(f.tables.floorPlan(cashier.token).revision).toBe(1);await f.allow(cashier.id,'table.manage',false);await expect(f.tables.saveFloorPlan(cashier.token,randomUUID(),{revision:1,plan})).rejects.toThrow('PERMISSION_DENIED');
  expect(f.tables.floorPlan(f.token).revision).toBe(1);
  f.db.prepare('UPDATE dining_floor_plans SET plan_json=? WHERE branch_id=?').run('{"version":2,"zones":[],"tables":[]}',f.claims.branchId);
  expect(()=>f.tables.floorPlan(f.token)).toThrow('FLOOR_PLAN_UNAVAILABLE');expect(f.tables.list(f.token).tables.some(row=>row.id===f.table.id)).toBe(true);
 }finally{f.close();}
});
it('opens once under races/replay, captures immutable author/responsibility, closes EMPTY and reopens a new visit',async()=>{
 const f=await setup();try{
  expect(f.tables.list(f.token).settings.mode).toBe('SHARED');
  await expect(f.tables.open(f.token,randomUUID(),{tableId:f.table.id,responsibleWaiterId:null})).rejects.toThrow('SHIFT_REQUIRED');await f.shift();
  const waiter=await f.employee('WAITER');
  const cashier=await f.employee('CASHIER');
  const cashierVisit=await f.tables.open(cashier.token,randomUUID(),{tableId:null,responsibleWaiterId:null});
  expect(f.tables.details(cashier.token,cashierVisit.sessionId).responsibleWaiter).toEqual({id:cashier.id,name:'cashier'});
  await f.tables.closeEmpty(cashier.token,randomUUID(),{sessionId:cashierVisit.sessionId,revision:1});
  const input={tableId:f.table.id,responsibleWaiterId:null},id=randomUUID();
  const races=await Promise.allSettled([f.tables.open(waiter.token,id,input),f.tables.open(waiter.token,randomUUID(),input)]);expect(races[0].status).toBe('fulfilled');expect(races[1].status).toBe('rejected');
  const opened=(races[0] as PromiseFulfilledResult<Awaited<ReturnType<TableService['open']>>>).value;expect(await f.tables.open(waiter.token,id,input)).toEqual(opened);
  const visit=f.tables.details(waiter.token,opened.sessionId);expect(visit.responsibleWaiter?.id).toBe(waiter.id);expect(visit.openedBy.id).toBe(waiter.id);
  await expect(f.tables.saveTable(f.token,randomUUID(),{tableId:f.table.id,zoneId:f.zone.id,revision:1,name:'Renamed',active:true})).rejects.toThrow('TABLE_OCCUPIED');
  await expect(f.tables.saveZone(f.token,randomUUID(),{zoneId:f.zone.id,revision:1,name:'Renamed',active:true})).rejects.toThrow('ZONE_OCCUPIED');
  const closeId=randomUUID(),close={sessionId:opened.sessionId,revision:1};const closed=await f.tables.closeEmpty(waiter.token,closeId,close);expect(await f.tables.closeEmpty(waiter.token,closeId,close)).toEqual(closed);expect(closed.closeReason).toBe('EMPTY');
  const reopened=await f.tables.open(waiter.token,randomUUID(),input);expect(reopened.sessionId).not.toBe(opened.sessionId);expect(f.tables.details(waiter.token,opened.sessionId).status).toBe('CLOSED');
  expect(()=>f.db.prepare("UPDATE table_sessions SET responsible_waiter_id=NULL,responsible_waiter_name=NULL,revision=revision+1 WHERE id=?").run(reopened.sessionId)).toThrow('IMMUTABLE_VISIT_HISTORY');
  expect(()=>f.db.prepare('DELETE FROM table_sessions WHERE id=?').run(opened.sessionId)).toThrow('IMMUTABLE_VISIT_HISTORY');
 }finally{f.close();}
});
it('blocks closing when any batch/payment marker exists and never clears the historical nonempty guard',async()=>{
 const f=await setup();try{
  await f.mode('STRICT');await f.shift();
  const opened=await f.tables.open(f.token,randomUUID(),{tableId:f.table.id,responsibleWaiterId:null});
  f.db.prepare('UPDATE table_sessions SET has_accepted_batch=1,revision=revision+1 WHERE id=?').run(opened.sessionId);
  await expect(f.tables.closeEmpty(f.token,randomUUID(),{sessionId:opened.sessionId,revision:2})).rejects.toThrow('VISIT_NOT_EMPTY');
  expect(()=>f.db.prepare('UPDATE table_sessions SET has_accepted_batch=0,revision=revision+1 WHERE id=?').run(opened.sessionId)).toThrow('IMMUTABLE_VISIT_HISTORY');
  expect(()=>f.db.prepare("UPDATE table_sessions SET status='CLOSED',closed_at=1,closed_by=?,close_reason='EMPTY',revision=revision+1 WHERE id=?").run(f.auth.current(f.token).id,opened.sessionId)).toThrow();
  const second=await f.tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:f.zone.id,revision:0,name:'Payment guard',active:true});
  const next=await f.tables.open(f.token,randomUUID(),{tableId:second.id,responsibleWaiterId:null});f.db.prepare('UPDATE table_sessions SET has_registered_payment=1,revision=revision+1 WHERE id=?').run(next.sessionId);
  await expect(f.tables.closeEmpty(f.token,randomUUID(),{sessionId:next.sessionId,revision:2})).rejects.toThrow('VISIT_NOT_EMPTY');
 }finally{f.close();}
});
it('enforces foreign branch scope, initial-password restriction, inactive roles and direct SQL uniqueness/FKs',async()=>{
 const f=await setup();try{
  await f.mode('STRICT');await f.shift();const waiter=await f.employee('WAITER');
  await expect(f.tables.open(waiter.token,randomUUID(),{tableId:randomUUID(),responsibleWaiterId:null})).rejects.toThrow('TABLE_NOT_FOUND');
  const inactive=await f.tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:f.zone.id,revision:0,name:'Inactive',active:false});await expect(f.tables.open(waiter.token,randomUUID(),{tableId:inactive.id,responsibleWaiterId:null})).rejects.toThrow('TABLE_INACTIVE');
  f.db.prepare('UPDATE employees SET must_change=1 WHERE id=?').run(waiter.id);expect(()=>f.tables.list(waiter.token)).toThrow('PASSWORD_CHANGE_REQUIRED');f.db.prepare('UPDATE employees SET must_change=0 WHERE id=?').run(waiter.id);
  const opened=await f.tables.open(waiter.token,randomUUID(),{tableId:f.table.id,responsibleWaiterId:null});
  expect(()=>f.db.prepare('INSERT INTO table_sessions SELECT ?,branch_id,table_id,shift_id,opened_by,responsible_waiter_id,table_name,zone_name,opened_by_name,responsible_waiter_name,opened_at,status,closed_at,closed_by,close_reason,revision,has_accepted_batch,has_registered_payment FROM table_sessions WHERE id=?').run(randomUUID(),opened.sessionId)).toThrow(/UNIQUE/);
  expect(()=>f.db.prepare('INSERT INTO dining_tables VALUES(?,?,?,?,?,?,1)').run(randomUUID(),f.claims.branchId,randomUUID(),'Foreign zone','foreign',1)).toThrow(/FOREIGN KEY/);
  const employee=f.auth.employee(waiter.id);await f.auth.updateEmployee(f.token,randomUUID(),{employeeId:waiter.id,revision:employee.revision,status:'SUSPENDED'});expect(()=>f.tables.details(waiter.token,opened.sessionId)).toThrow('SESSION_INVALID');
 }finally{f.close();}
});
it('protects the actual table API from client scope/role spoofing and preserves visits across server restart',async()=>{
 const f=await setup();await f.mode('STRICT');await f.shift();const waiter=await f.employee('WAITER');const opened=await f.tables.open(waiter.token,randomUUID(),{tableId:f.table.id,responsibleWaiterId:null});f.storage.close();
 try{const app=await createServer(f.dir,0,false,f.trust);try{
  const headers={authorization:'Bearer '+waiter.token};const list=await app.inject({url:'/api/v1/tables',headers});expect(list.statusCode).toBe(403);const ownerList=await app.inject({url:'/api/v1/tables',headers:{authorization:'Bearer '+f.token}});expect(ownerList.json().tables[0].state).toBe('OCCUPIED');expect(ownerList.json().tables[0].sessionId).toBe(opened.sessionId);
  const invalid=await app.inject({method:'POST',url:'/api/v1/tables/open',headers,payload:{commandId:randomUUID(),tableId:f.table.id,responsibleWaiterId:null,branchId:randomUUID(),role:'OWNER'}});expect(invalid.statusCode).toBe(400);
  const denied=await app.inject({method:'POST',url:'/api/v1/tables/settings',headers,payload:{commandId:randomUUID(),revision:1,mode:'STRICT'}});expect(denied.statusCode).toBe(403);
  const ownerDenied=await app.inject({method:'POST',url:'/api/v1/tables/settings',headers:{authorization:'Bearer '+f.token},payload:{commandId:randomUUID(),revision:1,mode:'STRICT'}});expect(ownerDenied.statusCode).toBe(423);
  expect((await app.inject({url:'/api/v1/tables',headers:{...headers,origin:'https://hostile.example'}})).statusCode).toBe(403);
 }finally{await app.close();}}finally{f.close();}
});
it('replays only the minimal own EMPTY receipt after SHARED access ends and still checks live permission',async()=>{
 const f=await setup();try{
  await f.mode('SHARED');await f.shift();await f.allow(f.auth.current(f.token).id,'table.access_others',false);const waiter=await f.employee('WAITER');const visit=await f.tables.open(f.token,randomUUID(),{tableId:f.table.id,responsibleWaiterId:waiter.id});
  const id=randomUUID(),input={sessionId:visit.sessionId,revision:1},result=await f.tables.closeEmpty(f.token,id,input);
  expect(()=>f.tables.details(f.token,visit.sessionId)).toThrow('VISIT_ACCESS_DENIED');expect(await f.tables.closeEmpty(f.token,id,input)).toEqual(result);
  await expect(f.tables.closeEmpty(f.token,randomUUID(),input)).rejects.toThrow('VISIT_ACCESS_DENIED');await f.allow(f.auth.current(f.token).id,'table.close_empty',false);await expect(f.tables.closeEmpty(f.token,id,input)).rejects.toThrow('PERMISSION_DENIED');
 }finally{f.close();}
});
