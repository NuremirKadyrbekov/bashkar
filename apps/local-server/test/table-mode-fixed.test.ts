import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,password} from './fixtures/operations';
import {TableService} from '../src/modules/tables/table-service';
import {createServer} from '../src/server';

it('uses SHARED for an unconfigured branch and preserves a historical STRICT row',async()=>{
 const f=await fixture();
 try{
  const tables=new TableService(f.db,f.bus,f.auth,f.now);
  expect(tables.list(f.token).settings).toEqual({mode:'SHARED',revision:0,configured:true});
  await tables.setMode(f.token,randomUUID(),{mode:'STRICT',revision:0});
  expect(f.db.prepare('SELECT mode FROM table_settings WHERE branch_id=?').get(f.claims.branchId)).toEqual({mode:'STRICT'});
  expect(tables.list(f.token).settings).toEqual({mode:'SHARED',revision:1,configured:true});
  const owner=f.auth.current(f.token);
  await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:owner.employee.revision,permission:'shift.open',allowed:true});
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true});
  const table=await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name:'1',active:true});
  const visit=await tables.open(f.token,randomUUID(),{tableId:table.id,responsibleWaiterId:null});
  expect(visit.sessionId).toBeTruthy();
  f.storage.close();
  const app=await createServer(f.dir,0,false,f.trust);
  try{
   const headers={authorization:'Bearer '+f.token};
   expect((await app.inject({url:'/api/v1/tables',headers})).json().settings.mode).toBe('SHARED');
   const change=await app.inject({method:'POST',url:'/api/v1/tables/settings',headers,payload:{commandId:randomUUID(),revision:1,mode:'STRICT'}});
   expect(change.statusCode).toBe(423);
   expect(change.json().error.code).toBe('TABLE_MODE_CLOSED');
  }finally{await app.close();}
 }finally{f.close();}
});

it('shares active visits without changing the responsible waiter and still enforces role grants',async()=>{
 const f=await fixture();try{
  const tables=new TableService(f.db,f.bus,f.auth,f.now),owner=f.auth.current(f.token);
  await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:owner.employee.revision,permission:'shift.open',allowed:true});
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true});
  const table=await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name:'1',active:true});
  const waiters:{id:string;token:string}[]=[];
  for(const login of ['waiter-a','waiter-b']){
   const employee=await f.auth.createEmployee(f.token,randomUUID(),{login,name:login,role:'WAITER'});
   const first=await f.auth.login(login,employee.temporaryPassword,'WAITER_WEB');
   await f.auth.changePassword(first.token,randomUUID(),employee.temporaryPassword,password);
   waiters.push({id:employee.id,token:(await f.auth.login(login,password,'WAITER_WEB')).token});
  }
  const visit=await tables.open(waiters[0].token,randomUUID(),{tableId:table.id,responsibleWaiterId:null});
  expect(tables.list(waiters[1].token).tables[0]).toMatchObject({state:'OCCUPIED',canViewDetails:true,sessionId:visit.sessionId});
  expect(tables.details(waiters[1].token,visit.sessionId).responsibleWaiter?.id).toBe(waiters[0].id);
  const target=f.auth.employee(waiters[1].id);
  await f.auth.setPermission(f.token,randomUUID(),{employeeId:target.id,revision:target.revision,permission:'table.view_details',allowed:false});
  expect(tables.list(waiters[1].token).tables[0]).toMatchObject({state:'OCCUPIED',canViewDetails:false});
  expect(()=>tables.details(waiters[1].token,visit.sessionId)).toThrow('PERMISSION_DENIED');
  expect(tables.details(waiters[0].token,visit.sessionId).responsibleWaiter?.id).toBe(waiters[0].id);
  f.storage.close();const app=await createServer(f.dir,0,false,f.trust);
  try{
   const headers={authorization:'Bearer '+f.token};
   const permission=await app.inject({method:'POST',url:'/api/v1/employees/permission',headers,payload:{commandId:randomUUID(),employeeId:target.id,revision:target.revision+1,permission:'table.view_details',allowed:true}});
   expect(permission.statusCode).toBe(423);expect(permission.json().error.code).toBe('PERMISSION_EDITING_CLOSED');
   const mode=await app.inject({method:'POST',url:'/api/v1/tables/settings',headers,payload:{commandId:randomUUID(),revision:0,mode:'STRICT'}});
   expect(mode.statusCode).toBe(423);expect(mode.json().error.code).toBe('TABLE_MODE_CLOSED');
  }finally{await app.close();}
 }finally{f.close();}
});
