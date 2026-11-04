import {latestSchema} from '../src/migrations';
import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture,password } from './fixtures/operations';
import { CommandBus,audit } from '../src/command-bus';
import { AuthService } from '../src/modules/auth/auth-service';
import { ShiftService } from '../src/modules/shifts/shift-service';
async function permit(f:Awaited<ReturnType<typeof fixture>>) {
 const owner=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:owner.employee.revision,permission:'shift.open',allowed:true});
}
it('replays original result, conflicts on payload and actor changes, rolls back on missing audit, and bounds the writer queue',async()=>{
 const f=await fixture();try {
  const actor=f.auth.current(f.token),id=randomUUID();let effects=0;const events:string[]=[];f.bus.onCommit=(_branch,type)=>events.push(type);
  const run=(payload:unknown)=>f.bus.run({id,type:'test',actor,payload},()=>{f.auth.current(f.token);},()=>{effects++;audit(f.db,actor,'test',null,id,f.now());return {effects};});
  expect(await run({b:2,a:1})).toEqual({effects:1});expect(await run({a:1,b:2})).toEqual({effects:1});expect(events).toEqual(['test']);
  await expect(run({a:2})).rejects.toThrow('COMMAND_ID_CONFLICT');expect(effects).toBe(1);
  const tiny=new CommandBus(f.db,f.now,1);const job=tiny.run({id:randomUUID(),type:'one',actor,payload:{}},()=>{},()=>({done:true}));
  await expect(tiny.run({id:randomUUID(),type:'two',actor,payload:{}},()=>{},()=>({done:true}))).rejects.toThrow('WRITE_QUEUE_FULL');await job;
  const before=f.db.prepare('SELECT count(*) AS n FROM commands').get();
  await expect(f.bus.run({id:randomUUID(),type:'fail',actor,payload:{}},()=>{},()=>{audit(f.db,actor,'test',null,id,f.now());throw new Error('failure');})).rejects.toThrow('failure');
  expect(f.db.prepare('SELECT count(*) AS n FROM commands').get()).toEqual(before);
 }finally{f.close();}
});
it('opens at most one shift in a concurrent race, replays it and preserves it across login/logout and connection restart',async()=>{
 const f=await fixture();try {
  await permit(f);await expect(f.shifts.open(f.token,randomUUID(),'owner','bad-password')).rejects.toThrow('INVALID_CREDENTIALS');
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  const results=await Promise.allSettled(ids.map(id=>f.shifts.open(f.token,id,'owner',password)));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const winner=results.findIndex(r=>r.status==='fulfilled'),value=(results[winner] as PromiseFulfilledResult<unknown>).value;
  expect(await f.shifts.open(f.token,ids[winner],'owner',password)).toEqual(value);
  expect(f.db.prepare("SELECT count(*) AS n FROM shifts WHERE status='OPEN'").get()).toEqual({n:1});
  f.auth.logout(f.token);const second=(await f.auth.login('owner',password,'POS')).token;expect(f.shifts.current(second)).toEqual(value);
  f.storage.close();expect(f.storage.open().schemaVersion).toBe(latestSchema);
  const db=f.storage.connection(),bus=new CommandBus(db,f.now),auth=new AuthService(db,bus,f.claims.branchId,f.now),shifts=new ShiftService(db,bus,auth,f.now);
  expect(shifts.current(second)).toEqual(value);expect(await shifts.open(second,ids[winner],'owner',password)).toEqual(value);
 }finally{f.close();}
});
it('rechecks authorization when a queued replay is executed',async()=>{
 const f=await fixture();try {
  await permit(f);const id=randomUUID();await f.shifts.open(f.token,id,'owner',password);
  const owner=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:owner.employee.revision,permission:'shift.open',allowed:false});
  await expect(f.shifts.open(f.token,id,'owner',password)).rejects.toThrow('PERMISSION_DENIED');
 }finally{f.close();}
});
