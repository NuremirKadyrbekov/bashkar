import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture,password } from './fixtures/operations';
import { permissionKeys } from '../src/modules/auth/permissions';
it('issues temporary secret once, restricts first login, changes password and revokes old sessions',async()=>{
 const f=await fixture();try {
  const command=randomUUID();const created=await f.auth.createEmployee(f.token,command,{login:'cashier',name:'Cashier',role:'CASHIER'});
  expect(created.temporaryPassword).toBeTruthy();const repeated=await f.auth.createEmployee(f.token,command,{login:'cashier',name:'Cashier',role:'CASHIER'});expect(repeated.temporaryPassword).toBeUndefined();
  const login=await f.auth.login('cashier',created.temporaryPassword,'POS');expect(login.mustChangePassword).toBe(true);
  expect(()=>f.auth.current(login.token,'shift.open')).toThrow('PASSWORD_CHANGE_REQUIRED');
  await f.auth.changePassword(login.token,randomUUID(),created.temporaryPassword,'личный пароль сотрудника');
  expect(()=>f.auth.current(login.token)).toThrow('SESSION_INVALID');
  const permanent=await f.auth.login('cashier','личный пароль сотрудника','POS');expect(f.auth.current(permanent.token,'shift.open').id).toBe(created.id);
  const serialized=JSON.stringify(f.db.prepare('SELECT * FROM commands').all())+JSON.stringify(f.db.prepare('SELECT * FROM audit_events').all())+JSON.stringify(f.db.prepare('SELECT * FROM outbox').all());
  expect(serialized).not.toContain(created.temporaryPassword);expect(serialized).not.toContain(login.token);expect(serialized).not.toContain('личный пароль сотрудника');expect(serialized).not.toContain('password_hash');
 }finally{f.close();}
});
it('does not refresh idle time on reads, expires at idle and absolute boundaries',async()=>{
 const f=await fixture();try {
  f.advance(179*60000);f.auth.current(f.token);f.advance(60000);expect(()=>f.auth.current(f.token)).toThrow('SESSION_EXPIRED');
  const login=await f.auth.login('owner',password,'POS');
  for(let i=0;i<24;i++){f.advance(29*60000);f.auth.activity(login.token);}f.advance(25*60000);expect(()=>f.auth.current(login.token)).toThrow('SESSION_EXPIRED');
 }finally{f.close();}
});
it('enforces role ceilings, Manager delegation, current grants, archival identity and immediate suspension',async()=>{
 const f=await fixture();try {
  const manager=await f.auth.createEmployee(f.token,randomUUID(),{login:'manager',name:'Manager',role:'MANAGER'});
  const waiter=await f.auth.createEmployee(f.token,randomUUID(),{login:'waiter',name:'Waiter',role:'WAITER'});
  await expect(f.auth.setPermission(f.token,randomUUID(),{employeeId:waiter.id,revision:1,permission:'shift.open',allowed:true})).rejects.toThrow('ROLE_FORBIDDEN');
  let revision=1;
  for(const key of ['employee.permissions.manage','menu.edit'] as const){await f.auth.setPermission(f.token,randomUUID(),{employeeId:manager.id,revision:revision++,permission:key,allowed:true});}
  await f.auth.setDelegations(f.token,randomUUID(),{employeeId:manager.id,revision:revision++,permissions:['menu.edit']});
  const temp=await f.auth.login('manager',manager.temporaryPassword,'POS');await f.auth.changePassword(temp.token,randomUUID(),manager.temporaryPassword,password);revision++;
  const login=await f.auth.login('manager',password,'POS');
  await expect(f.auth.setPermission(login.token,randomUUID(),{employeeId:manager.id,revision,permission:'menu.edit',allowed:true})).rejects.toThrow('MANAGER_TARGET_FORBIDDEN');
  await expect(f.auth.setPermission(login.token,randomUUID(),{employeeId:f.auth.current(f.token).id,revision:1,permission:'shift.open',allowed:true})).rejects.toThrow('OWNER_PROTECTED');
  await f.auth.updateEmployee(f.token,randomUUID(),{employeeId:manager.id,revision,status:'SUSPENDED'});
  expect(()=>f.auth.current(login.token)).toThrow('SESSION_INVALID');
  await f.auth.updateEmployee(f.token,randomUUID(),{employeeId:waiter.id,revision:1,status:'DEACTIVATED'});
  expect(await f.auth.updateEmployee(f.token,randomUUID(),{employeeId:waiter.id,revision:2,status:'ACTIVE'})).toMatchObject({status:'ACTIVE'});
  await expect(f.auth.createEmployee(f.token,randomUUID(),{login:'waiter',name:'Again',role:'WAITER'})).rejects.toThrow('LOGIN_ALREADY_USED');
  const rehire=await f.auth.createEmployee(f.token,randomUUID(),{login:'waiter2',name:'Again',role:'WAITER'});expect(rehire.id).not.toBe(waiter.id);
  expect(permissionKeys.length).toBeGreaterThan(0);
 }finally{f.close();}
});
it('throttles an attacked identity without locking other employees out',async()=>{
 const f=await fixture();try{
  for(let i=0;i<5;i++)await expect(f.auth.login('absent','wrong-password','POS')).rejects.toThrow('INVALID_CREDENTIALS');
  await expect(f.auth.login('absent','wrong-password','POS')).rejects.toThrow('AUTH_RATE_LIMITED');
  expect((await f.auth.login('owner',password,'POS')).token).toBeTruthy();
 }finally{f.close();}
});
