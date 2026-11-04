import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {fixture,password} from './fixtures/operations';
import {hasPermission} from '../src/modules/auth/permissions';

it('starts each new branch with the approved FRESH-20261102 role template',async()=>{
 const snapshot=JSON.parse(readFileSync('config/platform-role-template-fresh-20261102.json','utf8')) as {roles:Record<string,string[]>};
 for(let branch=0;branch<2;branch++){
  const f=await fixture();try{
   expect(hasPermission(f.db,f.auth.current(f.token).employee,'table.access_others')).toBe(true);
   expect(hasPermission(f.db,f.auth.current(f.token).employee,'counter.hide')).toBe(true);
   for(const row of f.auth.roleMatrix(f.token)){
    expect(row.permissions.filter(permission=>permission.enabled).map(permission=>permission.key)).toEqual(snapshot.roles[row.role]);
    expect(row.permissions.every(permission=>!permission.custom)).toBe(true);
   }
   const cashier=await f.auth.createEmployee(f.token,randomUUID(),{login:'cashier',name:'Кассир',role:'CASHIER'});
   const waiter=await f.auth.createEmployee(f.token,randomUUID(),{login:'waiter',name:'Официант',role:'WAITER'});
   expect(hasPermission(f.db,f.auth.employee(cashier.id),'employee.status.manage')).toBe(false);
   expect(hasPermission(f.db,f.auth.employee(cashier.id),'table.access_others')).toBe(true);
   expect(hasPermission(f.db,f.auth.employee(waiter.id),'table.access_others')).toBe(true);
  }finally{f.close();}
 }
});

it('applies a branch role rule to every employee immediately, above personal exceptions, with CAS and audit',async()=>{
 const f=await fixture();try{
  const first=await f.auth.createEmployee(f.token,randomUUID(),{login:'waiter-one',name:'One',role:'WAITER'});
  const second=await f.auth.createEmployee(f.token,randomUUID(),{login:'waiter-two',name:'Two',role:'WAITER'});
  const manager=await f.auth.createEmployee(f.token,randomUUID(),{login:'manager-one',name:'Manager',role:'MANAGER'});
  const waiterSession=await f.auth.login('waiter-one',first.temporaryPassword,'WAITER_WEB');
  await f.auth.changePassword(waiterSession.token,randomUUID(),first.temporaryPassword,password);
  const waiterToken=(await f.auth.login('waiter-one',password,'WAITER_WEB')).token;
  const initial=f.auth.roleMatrix(f.token),waiter=initial.find(row=>row.role==='WAITER')!;
  expect(waiter.permissions.find(p=>p.key==='table.open')).toMatchObject({enabled:true,custom:false});
  await f.auth.setPermission(f.token,randomUUID(),{employeeId:first.id,revision:f.auth.employee(first.id).revision,permission:'table.open',allowed:true});
  const commandId=randomUUID(),input={role:'WAITER' as const,revision:waiter.revision,permission:'table.open' as const,allowed:false};
  const receipt=await f.auth.setRolePermission(f.token,commandId,input);
  expect(await f.auth.setRolePermission(f.token,commandId,input)).toEqual(receipt);
  expect(hasPermission(f.db,f.auth.employee(first.id),'table.open')).toBe(false);
  expect(hasPermission(f.db,f.auth.employee(second.id),'table.open')).toBe(false);
  await expect(f.auth.setPermission(f.token,randomUUID(),{employeeId:first.id,revision:f.auth.employee(first.id).revision,permission:'table.open',allowed:true})).rejects.toThrow('ROLE_RULE_LOCKED');
  expect(()=>f.auth.current(waiterToken,'table.open')).toThrow('PERMISSION_DENIED');
  await expect(f.auth.setRolePermission(f.token,randomUUID(),input)).rejects.toThrow('REVISION_CONFLICT');
  await expect(f.auth.setRolePermission(f.token,randomUUID(),{...input,revision:receipt.revision,permission:'counter.view'})).rejects.toThrow('ROLE_FORBIDDEN');
  expect(f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE action='role.permission' AND target_id='WAITER'").get()).toEqual({n:1});
  const managerGrant=await f.auth.setRolePermission(f.token,randomUUID(),{role:'MANAGER',revision:1,permission:'employee.permissions.manage',allowed:true});
  expect(managerGrant.enabled).toBe(true);
  const initialManagerToken=(await f.auth.login('manager-one',manager.temporaryPassword,'POS')).token;
  await f.auth.changePassword(initialManagerToken,randomUUID(),manager.temporaryPassword,password);
  const managerToken=(await f.auth.login('manager-one',password,'POS')).token;
  await expect(f.auth.setRolePermission(managerToken,randomUUID(),{role:'WAITER',revision:receipt.revision,permission:'table.open',allowed:true})).rejects.toThrow('OWNER_REQUIRED');
  expect(()=>f.auth.roleMatrix(managerToken)).toThrow('OWNER_REQUIRED');
  const restored=await f.auth.setRolePermission(f.token,randomUUID(),{...input,revision:receipt.revision,allowed:true});
  expect(restored.enabled).toBe(true);
  expect(hasPermission(f.db,f.auth.employee(first.id),'table.open')).toBe(true);
  expect(hasPermission(f.db,f.auth.employee(second.id),'table.open')).toBe(true);
 }finally{f.close();}
});
