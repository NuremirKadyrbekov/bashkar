import { randomInt, randomUUID } from 'node:crypto';
import { audit, outbox } from '../../command-bus';
import { PosError, requireCondition, integer, textField } from '../../errors';
import { AuthService, normalizeLogin, normalizePhone } from './auth-service';
import { hashPassword, temporaryPassword, verifyPassword } from './passwords';
import { decryptPin, encryptPin, keyFingerprint, pinLookup, type PinKeys } from './pin-crypto';
import type { ClientType } from './session-policy';
type Credential={employee_id:string;branch_id:string;version:number;lookup:string;hash:string;ciphertext:string};
type CreatedEmployee={id:string;branchId:string;login:string;name:string;role:'CASHIER'|'WAITER';status:'ACTIVE';revision:number};
export class PinThrottle extends PosError {constructor(readonly retryAfterSeconds:number){super('PIN_RATE_LIMITED',429);}}
export class PinService {
 private active=0;
 private loadedKeys?:Buffer;
 private keysUnavailable=false;
 constructor(readonly auth:AuthService,private readonly provider:PinKeys,private readonly generate=()=>String(randomInt(10000)).padStart(4,'0')){}
 private get db(){return this.auth.db;} private now(){return this.auth.now();}
 private keys(create=false){
 const binding=this.db.prepare('SELECT fingerprint FROM pin_key_binding WHERE singleton=1').get() as {fingerprint:string}|undefined;
 requireCondition(binding||create,'PIN_NOT_ISSUED',503);
 requireCondition(!this.keysUnavailable,'PIN_KEYS_UNAVAILABLE',503);
 try{
 const keys=this.loadedKeys??this.provider.get(create&&!binding);requireCondition(keys.length===64&&(!binding||binding.fingerprint===keyFingerprint(keys)),'PIN_KEYS_UNAVAILABLE',503);this.loadedKeys=keys;return keys;
 }catch{this.keysUnavailable=true;throw new PosError('PIN_KEYS_UNAVAILABLE',503);}
 }
 private credential(id:string){return this.db.prepare('SELECT * FROM employee_pins WHERE employee_id=? AND branch_id=?').get(id,this.auth.branchId) as Credential|undefined;}
 private target(token:string,id:string,reset:boolean){
 const p=this.auth.current(token,reset?'employee.pin.reset':'employee.pin.issue'),e=this.auth.employee(id);
 requireCondition(p.role==='OWNER'||['MANAGER','CASHIER'].includes(p.role)&&p.id!==e.id,'PIN_TARGET_DENIED',403);
 requireCondition(e.status==='ACTIVE'&&['CASHIER','WAITER'].includes(e.role),'PIN_TARGET_DENIED',403);return e;
 }
 async createEmployee(token:string,commandId:string,input:{login:unknown;name:unknown;role:'CASHIER'|'WAITER';phone?:string|null}):Promise<CreatedEmployee&{temporaryPassword?:string;temporaryPin?:string;secretAlreadyIssued:boolean}>{
 const actor=this.auth.current(token,'employee.create');this.auth.current(token,'employee.pin.issue');
 requireCondition(['OWNER','MANAGER','CASHIER'].includes(actor.role),'PIN_TARGET_DENIED',403);
 requireCondition(input.role==='CASHIER'||input.role==='WAITER','INVALID_ROLE');
 const login=normalizeLogin(input.login),name=textField(input.name),phone=normalizePhone(input.phone),payload={login,name,phone,role:input.role};
 if(this.db.prepare('SELECT 1 FROM commands WHERE branch_id=? AND id=?').get(this.auth.branchId,commandId)){
  const result=await this.auth.bus.run<CreatedEmployee>({id:commandId,type:'employee.create',actor,payload},()=>{
   this.auth.current(token,'employee.create');this.auth.current(token,'employee.pin.issue');
  },()=>{throw new PosError('COMMAND_RECEIPT_MISSING',409);});
  return {...result,secretAlreadyIssued:true};
 }
 const employeeId=randomUUID();
 const temporary=temporaryPassword(),passwordHash=await hashPassword(temporary),keys=this.keys(true);
 for(let attempt=0;attempt<32;attempt++){
  const used=new Set((this.db.prepare('SELECT lookup FROM employee_pins WHERE branch_id=?').all(this.auth.branchId) as {lookup:string}[]).map(row=>row.lookup));
  requireCondition(used.size<10000,'PIN_SPACE_EXHAUSTED',409);
  const start=this.generate();requireCondition(/^\d{4}$/.test(start),'PIN_GENERATOR_INVALID',503);
  let candidate:string|undefined;
  for(let i=0;i<10000;i++){const next=String((Number(start)+i)%10000).padStart(4,'0');if(!used.has(pinLookup(keys,this.auth.branchId,next))){candidate=next;break;}}
  requireCondition(candidate!==undefined,'PIN_SPACE_EXHAUSTED',409);
  const lookup=pinLookup(keys,this.auth.branchId,candidate),pinHash=await hashPassword(candidate),ciphertext=encryptPin(keys,this.auth.branchId,employeeId,2,candidate);
  let created=false;
  try{
   const result=await this.auth.bus.run({id:commandId,type:'employee.create',actor,payload},()=>{
    this.auth.current(token,'employee.create');this.auth.current(token,'employee.pin.issue');
   },()=>{
    requireCondition(!this.db.prepare('SELECT 1 FROM employees WHERE login=?').get(login),'LOGIN_ALREADY_USED');
    if(this.db.prepare('SELECT 1 FROM employee_pins WHERE branch_id=? AND lookup=?').get(this.auth.branchId,lookup))throw new PosError('PIN_COLLISION',409);
    const binding=this.db.prepare('SELECT fingerprint FROM pin_key_binding WHERE singleton=1').get() as {fingerprint:string}|undefined;
    requireCondition(!binding||binding.fingerprint===keyFingerprint(keys),'PIN_KEYS_UNAVAILABLE',503);
    this.db.prepare('INSERT OR IGNORE INTO pin_key_binding VALUES(1,?)').run(keyFingerprint(keys));
    this.db.prepare("INSERT INTO employees(id,branch_id,login,name,phone,role,status,password_hash,must_change,credential_version,revision,created_at) VALUES(?,?,?,?,?,?,'ACTIVE',?,1,2,2,?)").run(employeeId,this.auth.branchId,login,name,phone,input.role,passwordHash,this.now());
    this.db.prepare('INSERT INTO employee_pins VALUES(?,?,?,?,?,?)').run(employeeId,this.auth.branchId,2,lookup,pinHash,ciphertext);
    const safe:CreatedEmployee={id:employeeId,branchId:this.auth.branchId,login,name,role:input.role,status:'ACTIVE',revision:2};
    audit(this.db,actor,'employee.created',employeeId,commandId,this.now(),{after:safe});
    audit(this.db,actor,'employee.pin.issued',employeeId,commandId,this.now(),{version:2});
    outbox(this.db,this.auth.branchId,'employee.changed',safe,this.now());created=true;return safe;
   });
   return {...result,temporaryPassword:created?temporary:undefined,temporaryPin:created?candidate:undefined,secretAlreadyIssued:!created};
  }catch(error){if(!(error instanceof PosError)||error.code!=='PIN_COLLISION')throw error;}
 }
 throw new PosError('PIN_CONTENTION',409);
 }
 async assign(token:string,commandId:string,input:{employeeId:string;revision:number},reset:boolean){
 const actor=this.auth.current(token,reset?'employee.pin.reset':'employee.pin.issue');integer(input.revision,1,Number.MAX_SAFE_INTEGER);this.target(token,input.employeeId,reset);
 const keys=this.keys(true);let issued:string|undefined;
 // Retry collisions after concurrent preparation; no hash or OS calls in writer.
 for(let attempt=0;attempt<32;attempt++){
 const target=this.auth.employee(input.employeeId),version=target.credential_version+1;
 let candidate:string|undefined;
 const used=new Set((this.db.prepare('SELECT lookup FROM employee_pins WHERE branch_id=?').all(this.auth.branchId) as {lookup:string}[]).map(r=>r.lookup));
 requireCondition(used.size<10000,'PIN_SPACE_EXHAUSTED',409);
 const start=this.generate();requireCondition(/^\d{4}$/.test(start),'PIN_GENERATOR_INVALID',503);
 // Bounded full traversal ensures exhaustion/collision handling never loops forever.
 for(let i=0;i<10000;i++){const next=String((Number(start)+i)%10000).padStart(4,'0');if(!used.has(pinLookup(keys,this.auth.branchId,next))){candidate=next;break;}}
 requireCondition(candidate!==undefined,'PIN_SPACE_EXHAUSTED',409);
 const lookup=pinLookup(keys,this.auth.branchId,candidate),hash=await hashPassword(candidate),ciphertext=encryptPin(keys,this.auth.branchId,target.id,version,candidate);
 try{
 const result=await this.auth.bus.run({id:commandId,type:reset?'employee.pin.reset':'employee.pin.issue',actor,payload:input},()=>{this.target(token,input.employeeId,reset);},()=>{
 const fresh=this.target(token,input.employeeId,reset);requireCondition(fresh.revision===input.revision,'REVISION_CONFLICT',409);
 const current=this.credential(target.id);requireCondition(reset?!!current:!current,reset?'PIN_NOT_ISSUED':'PIN_ALREADY_ISSUED',409);
 requireCondition(fresh.credential_version+1===version,'REVISION_CONFLICT',409);
 if(this.db.prepare('SELECT 1 FROM employee_pins WHERE branch_id=? AND lookup=?').get(this.auth.branchId,lookup))throw new PosError('PIN_COLLISION',409);
 const binding=this.db.prepare('SELECT fingerprint FROM pin_key_binding WHERE singleton=1').get() as {fingerprint:string}|undefined;
 requireCondition(!binding||binding.fingerprint===keyFingerprint(keys),'PIN_KEYS_UNAVAILABLE',503);
 this.db.prepare('INSERT OR IGNORE INTO pin_key_binding VALUES(1,?)').run(keyFingerprint(keys));
 this.db.prepare('INSERT INTO employee_pins VALUES(?,?,?,?,?,?) ON CONFLICT(employee_id) DO UPDATE SET version=excluded.version,lookup=excluded.lookup,hash=excluded.hash,ciphertext=excluded.ciphertext').run(target.id,this.auth.branchId,version,lookup,hash,ciphertext);
 this.db.prepare('UPDATE employees SET credential_version=credential_version+1,revision=revision+1 WHERE id=?').run(target.id);
 this.db.prepare('UPDATE auth_sessions SET revoked=1 WHERE employee_id=?').run(target.id);
 audit(this.db,actor,reset?'employee.pin.reset':'employee.pin.issued',target.id,commandId,this.now(),{version});issued=candidate;
 return {employeeId:target.id,revision:fresh.revision+1};
 });return {...result,temporaryPin:issued,secretAlreadyIssued:!issued};
 }catch(error){if(!(error instanceof PosError)||error.code!=='PIN_COLLISION')throw error;}
 }throw new PosError('PIN_CONTENTION',409);
 }
 private reserve(source:string,lookup:string,client:ClientType='POS'){
 // Native-only A: remoteAddress loopback, never forwarded headers/caller identity.
 requireCondition(client==='POS'?['127.0.0.1','::1','::ffff:127.0.0.1'].includes(source):/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(source),'PIN_SOURCE_DENIED',403);
 const identities=['source:'+client+':'+source,'code:'+lookup],now=this.now();
 const blocked=this.db.transaction(()=>{
 let retry=0;
 for(const identity of identities){
 let row=this.db.prepare('SELECT * FROM pin_attempts WHERE identity=?').get(identity) as {count:number;window_at:number;retry_after:number;strikes:number}|undefined;
 if(row&&row.retry_after>now){retry=Math.max(retry,row.retry_after);continue;}
 if(!row||now-row.window_at>=60000)row={count:0,window_at:now,retry_after:0,strikes:row&&now-row.window_at<3600000?row.strikes:0};
 row.count++;
 if(row.count>5){row.strikes=Math.min(row.strikes+1,5);row.retry_after=now+(identity.startsWith('source:')?Math.min(900000,60000*2**(row.strikes-1)):60000);retry=Math.max(retry,row.retry_after);}
 this.db.prepare('INSERT INTO pin_attempts VALUES(?,?,?,?,?) ON CONFLICT(identity) DO UPDATE SET count=excluded.count,window_at=excluded.window_at,retry_after=excluded.retry_after,strikes=excluded.strikes').run(identity,row.count,row.window_at,row.retry_after,row.strikes);
 }
 return retry;
 }).immediate();if(blocked)throw new PinThrottle(Math.ceil((blocked-now)/1000));
 }
 async login(pin:unknown,source:string,client:ClientType='POS'){
 requireCondition(typeof pin==='string'&&/^[0-9]{4}$/.test(pin),'INVALID_CREDENTIALS',401);
 requireCondition(client==='POS'||client==='WAITER_WEB','INVALID_CLIENT',400);
 const keys=this.keys(),lookup=pinLookup(keys,this.auth.branchId,pin);this.reserve(source,lookup,client);
 requireCondition(this.active<2,'PIN_WORK_LIMIT',429);this.active++;
 try{
 const record=this.db.prepare('SELECT * FROM employee_pins WHERE branch_id=? AND lookup=?').get(this.auth.branchId,lookup) as Credential|undefined;
 const checked=record?this.auth.employee(record.employee_id):undefined;
 const valid=await verifyPassword(pin,record?.hash??('argon2id-v1$'+'00'.repeat(16)+'$'+'00'.repeat(32)));
 return this.db.transaction(()=>{
 const fresh=checked?this.auth.employee(checked.id):undefined,current=checked?this.credential(checked.id):undefined;
 if(!valid||!fresh||fresh.status!=='ACTIVE'||fresh.role!==(client==='POS'?'CASHIER':'WAITER')||fresh.credential_version!==checked?.credential_version||current?.version!==record?.version||current?.lookup!==lookup){
 audit(this.db,null,'auth.pin.denied',null,null,this.now(),{},'DENIED');return null;
 }
 return this.auth.openSession(fresh,client,'PIN');
 }).immediate()??Promise.reject(new PosError('INVALID_CREDENTIALS',401));
 }finally{this.active--;}
 }
 async proveForShift(token:string,pin:unknown,source:string){
 const actor=this.auth.current(token);requireCondition(actor.role==='CASHIER','PIN_SHIFT_ROLE_DENIED',403);
 requireCondition(typeof pin==='string'&&/^[0-9]{4}$/.test(pin),'INVALID_CREDENTIALS',401);
 const keys=this.keys(),lookup=pinLookup(keys,this.auth.branchId,pin);this.reserve(source,lookup,'POS');
 requireCondition(this.active<2,'PIN_WORK_LIMIT',429);this.active++;
 try{
  const record=this.db.prepare('SELECT * FROM employee_pins WHERE branch_id=? AND lookup=?').get(this.auth.branchId,lookup) as Credential|undefined;
  const valid=await verifyPassword(pin,record?.hash??('argon2id-v1$'+'00'.repeat(16)+'$'+'00'.repeat(32)));
  const fresh=this.auth.current(token),credential=this.credential(fresh.id);
  if(!valid||!record||record.employee_id!==fresh.id||!credential||credential.lookup!==lookup||credential.version!==fresh.employee.credential_version){
   audit(this.db,fresh,'auth.pin.shift.denied',fresh.id,null,this.now(),{},'DENIED');throw new PosError('INVALID_CREDENTIALS',401);
  }
  return {credential_version:fresh.employee.credential_version,must_change:0};
 }finally{this.active--;}
 }
 private canView(token:string,id:string){const p=this.auth.current(token,'employee.pin.view'),e=this.auth.employee(id);const scope=p.role==='CASHIER'?e.id===p.id||e.role==='WAITER':['OWNER','MANAGER'].includes(p.role)&&['CASHIER','WAITER'].includes(e.role);requireCondition(e.status==='ACTIVE'&&scope,'PIN_VIEW_DENIED',403);return {p,e};}
 list(token:string){const p=this.auth.current(token,'employee.pin.view');requireCondition(['OWNER','MANAGER','CASHIER'].includes(p.role),'PIN_VIEW_DENIED',403);return this.db.prepare("SELECT e.id,e.name,e.role,e.branch_id AS branchId FROM employees e JOIN employee_pins c ON c.employee_id=e.id AND c.branch_id=e.branch_id WHERE e.branch_id=? AND e.status='ACTIVE' AND (CASE WHEN ?='CASHIER' THEN e.id=? OR e.role='WAITER' ELSE e.role IN ('CASHIER','WAITER') END) ORDER BY e.name,e.id").all(this.auth.branchId,p.role,p.id);}
 reveal(token:string,id:string){
 const actor=this.auth.current(token);
 try{this.canView(token,id);}catch(error){audit(this.db,actor,'employee.pin.view',id,null,this.now(),{},'DENIED');throw error;}
 try{const keys=this.keys();
 return this.db.transaction(()=>{const {p,e}=this.canView(token,id),c=this.credential(id);requireCondition(c,'PIN_NOT_ISSUED',404);const value=decryptPin(keys,this.auth.branchId,id,c.version,c.ciphertext);audit(this.db,p,'employee.pin.view',id,null,this.now(),{version:c.version});return {pin:value,employeeId:id,name:e.name,branchId:this.auth.branchId,expiresInSeconds:20};}).immediate();
 }catch(error){audit(this.db,actor,'employee.pin.view',id,null,this.now(),{},'FAILED');throw error;}
 }
}
