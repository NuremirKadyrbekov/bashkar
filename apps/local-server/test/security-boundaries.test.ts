import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixtures/operations';
import { validatePassword } from '../src/modules/auth/passwords';
import { audit,outbox } from '../src/command-bus';
it('enforces foreign branch references in SQL and never records a secret result/audit/outbox DTO',async()=>{
 const f=await fixture();try{
  const actor=f.auth.current(f.token);
  expect(()=>f.db.prepare("INSERT INTO employees(id,branch_id,login,name,role,status,password_hash,must_change,created_at) VALUES(?,'foreign','foreign','Foreign','WAITER','ACTIVE','not-real',1,0)").run(randomUUID())).toThrow('FOREIGN KEY');
  await expect(f.bus.run({id:randomUUID(),type:'bad-result',actor,payload:{}},()=>{},()=>({token:'must-not-persist'}))).rejects.toThrow('SECRET_IN_PERSISTED_DTO');
  expect(()=>audit(f.db,actor,'test',null,null,f.now(),{password:'must-not-persist'})).toThrow('SECRET_IN_PERSISTED_DTO');
  expect(()=>outbox(f.db,actor.branchId,'test',{password_hash:'must-not-persist'},f.now())).toThrow('SECRET_IN_PERSISTED_DTO');
  expect(()=>f.db.prepare('DELETE FROM activation').run()).toThrow('IMMUTABLE_ACTIVATION');
 }finally{f.close();}
});
it('checks a vendored offline common-password dictionary without imposing character classes',()=>{
 expect(()=>validatePassword('qwerty12345')).toThrow('COMMON_PASSWORD');
 expect(()=>validatePassword('пароль123')).toThrow('COMMON_PASSWORD');
 expect(validatePassword('абрикосовые поляны')).toBe('абрикосовые поляны');
});
