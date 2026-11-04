import { expect,it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixture,password } from './fixtures/operations';
import { createServer } from '../src/server';
it('routes real login/session/employee commands through the signed test registration, rejects browser and foreign fields, and hides secrets on failures',async()=>{
 const f=await fixture(),pinKeys=randomBytes(64);f.storage.close();const app=await createServer(f.dir,0,false,{...f.trust,pinKeys:{get:()=>pinKeys}});
 try{
  expect((await app.inject('/api/v1/system/health/ready')).json().state).toBe('READY');
  const notFound=await app.inject('/api/v1/missing?token=do-not-echo');expect(notFound.statusCode).toBe(404);expect(notFound.body).not.toContain('do-not-echo');
  const browser=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'https://evil.test'},payload:{login:'owner',password}});expect(browser.statusCode).toBe(403);
  expect((await app.inject({url:'/api/v1/system/health/live',headers:{host:'evil.test'}})).statusCode).toBe(403);
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{login:'owner',password}});expect(login.statusCode).toBe(200);
  const token=login.json().token;const headers={authorization:'Bearer '+token};
  const design={expectedRevision:0,theme:'emerald',defaultLanguage:'ru',languages:['ru'],copy:{ru:{title:'Меню'}}};
  for(const payload of [design,{...design,template:'categories',wifi:{ssid:'Guest',password:'hello'},categoryTitles:{}}]){
    const response=await app.inject({method:'POST',url:'/api/v1/menu/public/design',headers,payload});
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('CLOUD_SYNC_DISABLED');
  }
  expect((await app.inject({url:'/api/v1/employees?archive=true',headers})).statusCode).toBe(200);
  expect((await app.inject({method:'POST',url:'/api/v1/employees/permission',headers,payload:{commandId:randomUUID(),employeeId:randomUUID(),revision:1,permission:'menu.edit',allowed:true}})).statusCode).toBe(423);
  expect((await app.inject({method:'POST',url:'/api/v1/employees/delegation',headers,payload:{commandId:randomUUID(),employeeId:randomUUID(),revision:1,permissions:[]}})).statusCode).toBe(423);
  const matrix=await app.inject({url:'/api/v1/roles/permissions',headers});expect(matrix.statusCode).toBe(200);
  expect(matrix.json().find((row:{role:string})=>row.role==='WAITER').permissions.find((item:{key:string})=>item.key==='table.open').enabled).toBe(true);
  const roleChange=await app.inject({method:'POST',url:'/api/v1/roles/permissions',headers,payload:{commandId:randomUUID(),role:'WAITER',revision:1,permission:'table.open',allowed:false}});
  expect(roleChange.statusCode).toBe(423);expect(roleChange.json().error.code).toBe('ROLE_MATRIX_CLOSED');
  expect((await app.inject({url:'/api/v1/roles/permissions',headers})).json().find((row:{role:string})=>row.role==='WAITER').permissions.find((item:{key:string})=>item.key==='table.open').enabled).toBe(true);
  expect((await app.inject({method:'POST',url:'/api/v1/roles/permissions',headers,payload:{commandId:randomUUID(),role:'OWNER',revision:1,permission:'table.open',allowed:false}})).statusCode).toBe(423);
  expect((await app.inject({url:'/api/v1/employees?archive=true&branchId=other',headers})).statusCode).toBe(400);
  const foreign=await app.inject({method:'POST',url:'/api/v1/employees',headers,payload:{commandId:randomUUID(),login:'cashier',name:'Name',role:'CASHIER',branchId:'other'}});expect(foreign.statusCode).toBe(400);expect(foreign.body).not.toContain(token);
  const commandId=randomUUID();const payload={commandId,login:'cashier',name:'Name',role:'CASHIER'};
  const first=await app.inject({method:'POST',url:'/api/v1/employees',headers,payload});expect(first.statusCode).toBe(200);expect(first.json().temporaryPassword).toBeTruthy();expect(first.json().temporaryPin).toMatch(/^\d{4}$/);
  const repeat=await app.inject({method:'POST',url:'/api/v1/employees',headers,payload});expect(repeat.statusCode).toBe(200);expect(repeat.json().temporaryPassword).toBeUndefined();expect(repeat.json().temporaryPin).toBeUndefined();expect(repeat.json().id).toBe(first.json().id);
  const conflict=await app.inject({method:'POST',url:'/api/v1/employees',headers,payload:{...payload,name:'Other'}});expect(conflict.statusCode).toBe(409);
  const missing=await app.inject({url:'/api/v1/employees'});expect(missing.statusCode).toBe(401);
  const unknown=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{login:'owner',password:'wrong-secret'}});expect(unknown.statusCode).toBe(401);expect(unknown.body).not.toContain('wrong-secret');
 }finally{await app.close();f.close();}
});
