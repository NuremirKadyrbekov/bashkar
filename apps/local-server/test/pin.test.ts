import { expect,it } from 'vitest';
import { randomBytes,randomUUID } from 'node:crypto';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { fixture,password } from './fixtures/operations';
import { PinService } from '../src/modules/auth/pin-service';
import { decryptPin,encryptPin,pinLookup } from '../src/modules/auth/pin-crypto';
import { createServer } from '../src/server';
const source='127.0.0.1';
async function setup(){
 const f=await fixture(),keys=randomBytes(64),provider={get:()=>keys},pins=new PinService(f.auth,provider,()=> '0007');
 async function employee(login:string,role:'CASHIER'|'WAITER'|'MANAGER'='CASHIER'){
 const e=await f.auth.createEmployee(f.token,randomUUID(),{login,name:login,role});
 return {...e,revision:()=>f.auth.employee(e.id).revision};
 }
 async function issue(e:{id:string;revision:()=>number},reset=false,id=randomUUID()){return pins.assign(f.token,id,{employeeId:e.id,revision:e.revision()},reset);}
 return {...f,keys,provider,pins,employee,issue};
}
it('creates cashier and waiter with PIN atomically, replays without secrets and rolls back on PIN failure',async()=>{
 const f=await setup();try{
  const command=randomUUID(),cash=await f.pins.createEmployee(f.token,command,{login:'auto-cash',name:'Кассир',role:'CASHIER'});
  expect(cash.temporaryPin).toBe('0007');expect(cash.temporaryPassword).toBeTruthy();
  expect((await f.pins.login(cash.temporaryPin,source)).employeeId).toBe(cash.id);
  const replay=await f.pins.createEmployee(f.token,command,{login:'auto-cash',name:'Кассир',role:'CASHIER'});
  expect(replay.id).toBe(cash.id);expect(replay.temporaryPin).toBeUndefined();expect(replay.secretAlreadyIssued).toBe(true);
  const waiter=await f.pins.createEmployee(f.token,randomUUID(),{login:'auto-waiter',name:'Официант',role:'WAITER'});
  expect((await f.pins.login(waiter.temporaryPin,source,'WAITER_WEB')).employeeId).toBe(waiter.id);
  f.db.exec("CREATE TRIGGER reject_auto_pin BEFORE INSERT ON employee_pins WHEN NEW.employee_id NOT IN (SELECT employee_id FROM employee_pins) BEGIN SELECT RAISE(ABORT,'TEST_PIN_INSERT'); END;");
  await expect(f.pins.createEmployee(f.token,randomUUID(),{login:'rolled-back',name:'Ошибка',role:'WAITER'})).rejects.toThrow('TEST_PIN_INSERT');
  expect(f.db.prepare('SELECT 1 FROM employees WHERE login=?').get('rolled-back')).toBeUndefined();
  const journal=JSON.stringify(f.db.prepare('SELECT * FROM commands').all())+JSON.stringify(f.db.prepare('SELECT * FROM audit_events').all())+JSON.stringify(f.db.prepare('SELECT * FROM outbox').all());
  expect(journal).not.toContain('"'+cash.temporaryPin+'"');expect(journal).not.toContain('"'+waiter.temporaryPin+'"');
 }finally{f.close();}
});
it('refuses cashier creation when the creator lacks PIN issue permission',async()=>{
 const f=await setup();try{
  const owner=f.auth.current(f.token);
  await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:f.auth.employee(owner.id).revision,permission:'employee.pin.issue',allowed:false});
  await expect(f.pins.createEmployee(f.token,randomUUID(),{login:'no-pin-right',name:'Кассир',role:'CASHIER'})).rejects.toThrow('PERMISSION_DENIED');
  expect(f.db.prepare('SELECT 1 FROM employees WHERE login=?').get('no-pin-right')).toBeUndefined();
 }finally{f.close();}
});
it('generates leading-zero unique PINs under concurrent issues, separates reset/reveal grants and never journals secrets',async()=>{
 const f=await setup();try{
 const [a,b,w]=await Promise.all([f.employee('cash-a'),f.employee('cash-b'),f.employee('waiter','WAITER')]);
 const issued=await Promise.all([f.issue(a),f.issue(b),f.issue(w)]);expect(issued.map(r=>r.temporaryPin)).toContain('0007');expect(new Set(issued.map(r=>r.temporaryPin)).size).toBe(3);
 const login=await f.pins.login(issued[0].temporaryPin,source);expect(f.auth.current(login.token).audience).toBe('CASHIER_POS');expect(login.mustChangePassword).toBe(false);
 expect(f.pins.list(login.token)).toEqual(expect.arrayContaining([expect.objectContaining({id:a.id}),expect.objectContaining({id:w.id})]));expect(f.pins.list(login.token)).not.toEqual(expect.arrayContaining([expect.objectContaining({id:b.id})]));
 expect(f.pins.reveal(login.token,a.id).pin).toBe(issued[0].temporaryPin);expect(f.pins.reveal(login.token,w.id).pin).toBe(issued[2].temporaryPin);expect(()=>f.pins.reveal(login.token,b.id)).toThrow('PIN_VIEW_DENIED');expect(()=>f.pins.reveal(login.token,randomUUID())).toThrow('EMPLOYEE_NOT_FOUND');
 expect((await f.pins.assign(login.token,randomUUID(),{employeeId:w.id,revision:w.revision()},true)).temporaryPin).toMatch(/^\d{4}$/);
 await expect(f.pins.login(issued[2].temporaryPin,source)).rejects.toThrow('INVALID_CREDENTIALS');await expect(f.pins.login(issued[0].temporaryPin,source,'WAITER_WEB')).rejects.toThrow('INVALID_CREDENTIALS');
 const journal=JSON.stringify(f.db.prepare('SELECT * FROM commands').all())+JSON.stringify(f.db.prepare('SELECT * FROM audit_events').all())+JSON.stringify(f.db.prepare('SELECT * FROM outbox').all());
 for(const pin of issued.map(r=>r.temporaryPin!))expect(journal).not.toContain('"'+pin+'"');expect(journal).not.toContain('ciphertext');expect(journal).not.toContain('argon2id');
 const input={employeeId:w.id,revision:w.revision()},command=randomUUID();const first=await f.pins.assign(f.token,command,input,true),repeat=await f.pins.assign(f.token,command,input,true);expect(first.temporaryPin).toBeTruthy();expect(repeat.temporaryPin).toBeUndefined();expect(repeat.secretAlreadyIssued).toBe(true);
 }finally{f.close();}
});
it('revokes both methods on reset, keeps historical actors, rejects reset races and preserves suspended reservations until archive',async()=>{
 const f=await setup();try{
 const a=await f.employee('cash-a'),b=await f.employee('cash-b');const old=await f.issue(a);const pinSession=await f.pins.login(old.temporaryPin,source);
 const temporary=await f.auth.login(a.login,a.temporaryPassword,'POS');await f.auth.changePassword(temporary.token,randomUUID(),a.temporaryPassword,password);const passwordSession=await f.auth.login(a.login,password,'POS');
 const revision=a.revision(),r=await Promise.allSettled([f.pins.assign(f.token,randomUUID(),{employeeId:a.id,revision},true),f.pins.assign(f.token,randomUUID(),{employeeId:a.id,revision},true)]);expect(r.filter(v=>v.status==='fulfilled')).toHaveLength(1);expect(r.filter(v=>v.status==='rejected')).toHaveLength(1);
 expect(()=>f.auth.current(pinSession.token)).toThrow('SESSION_INVALID');expect(()=>f.auth.current(passwordSession.token)).toThrow('SESSION_INVALID');await expect(f.pins.login(old.temporaryPin,source)).rejects.toThrow('INVALID_CREDENTIALS');
 await f.auth.updateEmployee(f.token,randomUUID(),{employeeId:a.id,revision:a.revision(),status:'SUSPENDED'});const reserved=f.db.prepare('SELECT lookup FROM employee_pins WHERE employee_id=?').get(a.id);expect(reserved).toBeTruthy();
 await f.auth.updateEmployee(f.token,randomUUID(),{employeeId:a.id,revision:a.revision(),status:'DEACTIVATED'});expect(f.db.prepare('SELECT 1 FROM employee_pins WHERE employee_id=?').get(a.id)).toBeUndefined();expect(f.auth.employee(a.id).id).toBe(a.id);expect((await f.issue(b)).temporaryPin).toBe('0007');
 }finally{f.close();}
});
it('fails closed on swapped ciphertext, unavailable/mismatched keys and mandatory audit failure without damaging passwords',async()=>{
 const f=await setup();try{
 const a=await f.employee('cash-a'),w=await f.employee('waiter','WAITER');const issued=await f.issue(a);await f.issue(w);const login=await f.pins.login(issued.temporaryPin,source);
 const row=f.db.prepare('SELECT ciphertext FROM employee_pins WHERE employee_id=?').get(w.id) as {ciphertext:string};expect(()=>decryptPin(f.keys,f.claims.branchId,a.id,2,row.ciphertext)).toThrow('PIN_CIPHERTEXT_INVALID');
 expect(()=>decryptPin(f.keys,randomUUID(),w.id,3,row.ciphertext)).toThrow();expect(()=>decryptPin(f.keys,f.claims.branchId,w.id,3,row.ciphertext)).toThrow();
 const broken=new PinService(f.auth,{get:()=>randomBytes(64)});await expect(broken.login(issued.temporaryPin,source)).rejects.toThrow('PIN_KEYS_UNAVAILABLE');expect((await f.auth.login('owner',password,'POS')).token).toBeTruthy();
 f.db.exec("CREATE TRIGGER reject_pin_audit BEFORE INSERT ON audit_events WHEN NEW.action LIKE 'employee.pin.%' BEGIN SELECT RAISE(ABORT,'TEST_AUDIT'); END;");
 expect(()=>f.pins.reveal(login.token,w.id)).toThrow('TEST_AUDIT');const version=f.auth.employee(w.id).credential_version;
 await expect(f.issue(w,true)).rejects.toThrow('TEST_AUDIT');expect(f.auth.employee(w.id).credential_version).toBe(version);expect(f.db.prepare('SELECT ciphertext FROM employee_pins WHERE employee_id=?').get(w.id)).toEqual(row);
 }finally{f.close();}
});
it('bounds concurrent hashing, persists source throttling across service recreation, gives retry seconds and leaves passwords usable',async()=>{
 const f=await setup();try{
 const a=await f.employee('cash-a');const issued=await f.issue(a);
 const attempts=await Promise.allSettled(Array.from({length:5},()=>f.pins.login('9999',source)));expect(attempts.filter(r=>r.status==='rejected'&&r.reason.code==='PIN_WORK_LIMIT').length).toBeGreaterThan(0);
 const restarted=new PinService(f.auth,f.provider);await expect(restarted.login(issued.temporaryPin,source)).rejects.toMatchObject({code:'PIN_RATE_LIMITED',retryAfterSeconds:60});
 expect((await f.auth.login('owner',password,'POS')).token).toBeTruthy();f.advance(60000);expect((await restarted.login(issued.temporaryPin,source)).employeeId).toBe(a.id);
 await expect(f.pins.login(7,source)).rejects.toThrow('INVALID_CREDENTIALS');await expect(f.pins.login('0007','attacker')).rejects.toThrow('PIN_SOURCE_DENIED');
 expect(f.db.prepare('SELECT count(*) n FROM pin_attempts').get()).toEqual({n:3});const session=await restarted.login(issued.temporaryPin,source);f.advance(180*60000);expect(()=>f.auth.current(session.token)).toThrow('SESSION_EXPIRED');
 }finally{f.close();}
});
it('enforces direct HTTP PIN scopes, role audience, no-store, expiry, revoke and independent password confirmation',async()=>{
 const f=await setup();let app;try{
 const a=await f.employee('cash-a'),b=await f.employee('cash-b'),w=await f.employee('waiter','WAITER'),m=await f.employee('manager','MANAGER');const [pa,pb,pw]=[await f.issue(a),await f.issue(b),await f.issue(w)];await expect(f.issue(m)).rejects.toThrow('PIN_TARGET_DENIED');
 const waiter=await f.pins.login(pw.temporaryPin,source,'WAITER_WEB');await expect(f.auth.login('waiter',w.temporaryPassword,'POS')).rejects.toThrow('INVALID_CREDENTIALS');
 const cashier=await f.pins.login(pa.temporaryPin,source);await expect(f.shifts.open(cashier.token,randomUUID(),a.login,a.temporaryPassword)).rejects.toThrow('PASSWORD_CHANGE_REQUIRED');
 f.storage.close();app=await createServer(f.dir,0,false,{...f.trust,pinKeys:f.provider});const headers={authorization:'Bearer '+cashier.token};
 const reveal=await app.inject({method:'POST',url:'/api/v1/employees/pin/reveal',headers,payload:{employeeId:w.id}});expect(reveal.statusCode).toBe(200);expect(reveal.headers['cache-control']).toBe('no-store');expect(reveal.json().pin).toBe(pw.temporaryPin);
 expect((await app.inject({method:'POST',url:'/api/v1/employees/pin/reveal',headers,payload:{employeeId:b.id}})).statusCode).toBe(403);
 expect((await app.inject({url:'/api/v1/tables',headers:{authorization:'Bearer '+waiter.token}})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:'/api/v1/auth/pin',payload:{pin:pw.temporaryPin}})).statusCode).toBe(401);
 expect((await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{login:'waiter',password:w.temporaryPassword}})).statusCode).toBe(401);
 await app.close();app=undefined;
 }finally{await app?.close();f.close();}
});
it('allows the same PIN to open a new session after the POS session expires',async()=>{
 const f=await setup();let app;try{
  const employee=await f.employee('cash-expired'),issued=await f.issue(employee),first=await f.pins.login(issued.temporaryPin,source),expiredAt=Date.now()-181*60000;
  f.db.prepare("UPDATE auth_sessions SET issued_at=?,last_activity=? WHERE employee_id=? AND method='PIN'").run(expiredAt,expiredAt,employee.id);
  f.storage.close();app=await createServer(f.dir,0,false,{...f.trust,pinKeys:f.provider});
  const old={authorization:'Bearer '+first.token};
  expect((await app.inject({url:'/api/v1/auth/me',headers:old})).statusCode).toBe(401);
  const renewed=await app.inject({method:'POST',url:'/api/v1/auth/pin',headers:old,payload:{pin:issued.temporaryPin}});
  expect(renewed.statusCode).toBe(200);expect(renewed.json().employeeId).toBe(employee.id);
  expect((await app.inject({url:'/api/v1/auth/me',headers:{authorization:'Bearer '+renewed.json().token}})).statusCode).toBe(200);
 }finally{await app?.close();f.close();}
});
it('confirms shift open and close with only the current cashier PIN without journaling it',async()=>{
 const f=await setup();let app;try{
  const a=await f.employee('cash-a'),b=await f.employee('cash-b'),own=await f.issue(a),other=await f.issue(b),session=await f.pins.login(own.temporaryPin,source);
  f.storage.close();app=await createServer(f.dir,0,false,{...f.trust,pinKeys:f.provider});const headers={authorization:'Bearer '+session.token};
  const denied=await app.inject({method:'POST',url:'/api/v1/shifts/open',headers,payload:{commandId:randomUUID(),pin:other.temporaryPin}});expect(denied.statusCode).toBe(401);
  const opened=await app.inject({method:'POST',url:'/api/v1/shifts/open',headers,payload:{commandId:randomUUID(),pin:own.temporaryPin}});expect(opened.statusCode).toBe(200);const shift=opened.json();
  const context=(await app.inject({url:'/api/v1/shifts/'+shift.id+'/close-context',headers})).json();expect(context.blockers.total).toBe(0);
  const quote=(await app.inject({method:'POST',url:'/api/v1/shifts/'+shift.id+'/close/prepare',headers,payload:{expectedShiftRevision:context.revision}})).json();
  const closed=await app.inject({method:'POST',url:'/api/v1/shifts/close',headers,payload:{commandId:randomUUID(),shiftId:shift.id,expectedShiftRevision:context.revision,confirmationHash:quote.confirmationHash,pin:own.temporaryPin}});expect(closed.statusCode).toBe(200);expect(closed.json().result).toBe('CLOSED');
  await app.close();app=undefined;const db=new Database(join(f.dir,'pos.sqlite'),{readonly:true});try{const journal=JSON.stringify(db.prepare('SELECT * FROM commands').all())+JSON.stringify(db.prepare('SELECT * FROM audit_events').all());expect(journal).not.toContain('"'+own.temporaryPin+'"');}finally{db.close();}
 }finally{await app?.close();f.close();}
});
it('binds hash/lookup/ciphertext and never permits duplicate SQL credentials in one branch',async()=>{
 const f=await setup();try{const a=await f.employee('cash-a'),b=await f.employee('cash-b');const issued=await f.issue(a);const row=f.db.prepare('SELECT * FROM employee_pins WHERE employee_id=?').get(a.id) as any;
 expect(row.lookup).toBe(pinLookup(f.keys,f.claims.branchId,issued.temporaryPin!));expect(decryptPin(f.keys,f.claims.branchId,a.id,row.version,row.ciphertext)).toBe(issued.temporaryPin);
 expect(()=>f.db.prepare('INSERT INTO employee_pins VALUES(?,?,?,?,?,?)').run(b.id,f.claims.branchId,1,row.lookup,row.hash,encryptPin(f.keys,f.claims.branchId,b.id,1,issued.temporaryPin!))).toThrow('UNIQUE');
 }finally{f.close();}
});
it('rechecks Owner and granted Manager PIN view, revocation, target status and branch scope',async()=>{
 const f=await setup();try{
 const a=await f.employee('cash-a'),w=await f.employee('waiter','WAITER'),m=await f.employee('manager','MANAGER');const pa=await f.issue(a),pw=await f.issue(w);const session=await f.pins.login(pa.temporaryPin,source);
 const manager=await f.auth.login(m.login,m.temporaryPassword,'POS');await f.auth.changePassword(manager.token,randomUUID(),m.temporaryPassword,password);const mt=await f.auth.login(m.login,password,'POS');
 expect(f.pins.reveal(f.token,a.id).pin).toBe(pa.temporaryPin);expect(f.pins.reveal(f.token,w.id).pin).toBe(pw.temporaryPin);
 expect(()=>f.pins.reveal(f.token,m.id)).toThrow('PIN_VIEW_DENIED');
 expect(()=>f.pins.reveal(mt.token,w.id)).toThrow('PERMISSION_DENIED');
 await f.auth.setPermission(f.token,randomUUID(),{employeeId:m.id,revision:m.revision(),permission:'employee.pin.view',allowed:true});
 expect(f.pins.reveal(mt.token,w.id).pin).toBe(pw.temporaryPin);expect(f.pins.reveal(mt.token,a.id).pin).toBe(pa.temporaryPin);
 await f.auth.setPermission(f.token,randomUUID(),{employeeId:m.id,revision:m.revision(),permission:'employee.pin.view',allowed:false});
 expect(()=>f.pins.reveal(mt.token,w.id)).toThrow('PERMISSION_DENIED');
 await f.auth.setPermission(f.token,randomUUID(),{employeeId:a.id,revision:a.revision(),permission:'employee.pin.view',allowed:false});expect(()=>f.pins.reveal(session.token,w.id)).toThrow('PERMISSION_DENIED');
 await f.auth.setPermission(f.token,randomUUID(),{employeeId:a.id,revision:a.revision(),permission:'employee.pin.view',allowed:true});
 await f.auth.updateEmployee(f.token,randomUUID(),{employeeId:w.id,revision:w.revision(),status:'SUSPENDED'});expect(()=>f.pins.reveal(session.token,w.id)).toThrow('PIN_VIEW_DENIED');
 await f.auth.updateEmployee(f.token,randomUUID(),{employeeId:w.id,revision:w.revision(),status:'ACTIVE'});
 await f.auth.updateEmployee(f.token,randomUUID(),{employeeId:a.id,revision:a.revision(),role:'MANAGER'});expect(()=>f.auth.current(session.token)).toThrow('SESSION_INVALID');expect(f.db.prepare('SELECT 1 FROM employee_pins WHERE employee_id=?').get(a.id)).toBeUndefined();
 const foreign=new PinService(new (f.auth.constructor as any)(f.db,f.bus,randomUUID(),f.now),f.provider);await expect(foreign.login(pa.temporaryPin,source)).rejects.toThrow('INVALID_CREDENTIALS');
 }finally{f.close();}
});
it('rolls back the first credential and key binding on audit failure and retries without issuing a hidden default',async()=>{
 const f=await setup();try{
 const e=await f.employee('cash-a'),revision=e.revision(),command=randomUUID();
 f.db.exec("CREATE TRIGGER reject_first_pin BEFORE INSERT ON audit_events WHEN NEW.action='employee.pin.issued' BEGIN SELECT RAISE(ABORT,'TEST_FIRST_AUDIT'); END;");
 await expect(f.pins.assign(f.token,command,{employeeId:e.id,revision},false)).rejects.toThrow('TEST_FIRST_AUDIT');
 expect(f.db.prepare('SELECT count(*) n FROM employee_pins').get()).toEqual({n:0});expect(f.db.prepare('SELECT count(*) n FROM pin_key_binding').get()).toEqual({n:0});expect(f.db.prepare('SELECT 1 FROM commands WHERE id=?').get(command)).toBeUndefined();expect(e.revision()).toBe(revision);
 f.db.exec('DROP TRIGGER reject_first_pin');const result=await f.pins.assign(f.token,command,{employeeId:e.id,revision},false);expect(result.temporaryPin).toBe('0007');expect((await f.pins.login(result.temporaryPin,source)).employeeId).toBe(e.id);
 }finally{f.close();}
});
