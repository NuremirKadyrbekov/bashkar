// Future contract: not part of the fixed-SHARED MVP test suite.
import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture,password,catalog } from '../test/fixtures/operations';
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

it('enforces STRICT and live SHARED/grant changes without leaking visit details or changing the responsible waiter',async()=>{
 const f=await setup();try{
  await f.mode('STRICT');await f.shift();const one=await f.employee('WAITER','waiter-one'),two=await f.employee('WAITER','waiter-two');
  const opened=await f.tables.open(one.token,randomUUID(),{tableId:f.table.id,responsibleWaiterId:null});
  await f.allow(two.id,'table.access_others',false);
  const row=f.tables.list(two.token).tables[0];expect(row.state).toBe('OCCUPIED');expect(row.canViewDetails).toBe(false);expect(JSON.stringify(row)).not.toMatch(/waiter-one|openedBy|responsibleWaiter|openedAt|sessionId|currentTotal|batchCount/);
  const own=f.tables.list(one.token).tables[0];expect(own.openedBy?.id).toBe(one.id);expect(own.openedAt).toBe(f.now());expect(own.batchCount).toBe(0);expect(own.currentTotal).toBe(0);
  expect(()=>f.tables.details(two.token,opened.sessionId)).toThrow('VISIT_ACCESS_DENIED');
  await f.mode('SHARED');expect(f.tables.details(two.token,opened.sessionId).responsibleWaiter?.id).toBe(one.id);
  await f.mode('STRICT');await expect(f.tables.closeEmpty(two.token,randomUUID(),{sessionId:opened.sessionId,revision:1})).rejects.toThrow('VISIT_ACCESS_DENIED');
  await f.allow(two.id,'table.access_others');const command=randomUUID();const result=await f.tables.closeEmpty(two.token,command,{sessionId:opened.sessionId,revision:1});expect(result.status).toBe('CLOSED');
  await f.allow(two.id,'table.access_others',false);expect(await f.tables.closeEmpty(two.token,command,{sessionId:opened.sessionId,revision:1})).toEqual(result);await expect(f.tables.closeEmpty(two.token,randomUUID(),{sessionId:opened.sessionId,revision:1})).rejects.toThrow('VISIT_ACCESS_DENIED');
  expect(f.tables.details(one.token,opened.sessionId).responsibleWaiter?.id).toBe(one.id);
 }finally{f.close();}
});


it('keeps cashier details of a waiter-opened table private in STRICT until access is granted',async()=>{
 const f=await setup();try{
  await f.mode('STRICT');await f.shift();
  const waiter=await f.employee('WAITER','waiter-private'),cashier=await f.employee('CASHIER','cashier-private');
  const opened=await f.tables.open(waiter.token,randomUUID(),{tableId:f.table.id,responsibleWaiterId:null});
  expect(f.tables.list(cashier.token).tables[0]).toMatchObject({canViewDetails:true,sessionId:opened.sessionId});
  await f.allow(cashier.id,'table.access_others',false);
  const restricted=f.tables.list(cashier.token).tables[0];
  expect(restricted).toMatchObject({state:'OCCUPIED',canViewDetails:false});
  expect(restricted).not.toHaveProperty('sessionId');
  expect(()=>f.tables.details(cashier.token,opened.sessionId)).toThrow('VISIT_ACCESS_DENIED');
  await f.allow(cashier.id,'table.access_others');
  expect(f.tables.list(cashier.token).tables[0]).toMatchObject({canViewDetails:true,sessionId:opened.sessionId});
  expect(f.tables.details(cashier.token,opened.sessionId).responsibleWaiter?.id).toBe(waiter.id);
 }finally{f.close();}
});


it('lets Owner inspect a waiter-opened visit in STRICT through the platform default',async()=>{
 const f=await setup();try{
  await f.mode('STRICT');await f.shift();
  const waiter=await f.employee('WAITER','waiter-for-owner');
  const visit=await f.tables.open(waiter.token,randomUUID(),{tableId:f.table.id,responsibleWaiterId:null});
  expect(f.tables.list(f.token).tables[0]).toMatchObject({canViewDetails:true,sessionId:visit.sessionId});
  expect(f.tables.details(f.token,visit.sessionId).responsibleWaiter?.id).toBe(waiter.id);
 }finally{f.close();}
});
