import type Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { audit, CommandBus, digest, outbox, type Actor } from '../../command-bus';
import { integer, requireCondition, textField, PosError } from '../../errors';
import { evaluateSession, type Role, type EmployeeStatus, type ClientType } from './session-policy';
import { defaults, hasPermission, permission, permissionKeys, roleAllows, type Permission } from './permissions';
import { hashPassword, passwordFingerprint, temporaryPassword, validatePassword, verifyPassword } from './passwords';
export type Employee = { id:string; branch_id:string; login:string; name:string; phone:string|null; role:Role; status:EmployeeStatus; password_hash:string; must_change:number; credential_version:number; revision:number };
export type Principal = Actor & { audience:string; method:string; role:Role; sessionId:string; employee:Employee };
export function normalizeLogin(value: unknown) {
  const login = textField(value,64).normalize('NFKC').toLowerCase();
  requireCondition(/^[a-z0-9][a-z0-9._-]{2,63}$/.test(login),'INVALID_LOGIN'); return login;
}
export function normalizePhone(value: unknown):string|null {
  if(value===undefined||value===null||value==='')return null;
  requireCondition(typeof value==='string','INVALID_PHONE');
  const phone=value.trim();requireCondition(phone.length<=40&&/^[+0-9()\s-]*$/.test(phone),'INVALID_PHONE');return phone||null;
}
export class AuthService {
  cloudOwnerProve?: (email:string,password:string,employee:Employee)=>Promise<void>;
  constructor(readonly db:Database.Database, readonly bus:CommandBus, readonly branchId:string, readonly now = Date.now, private readonly assertStorage = () => {}) {}
  private get cloudSchema(){return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='owner_cloud_auth'").get();}
  private isCloudOwner(id:string){return this.cloudSchema && !!this.db.prepare('SELECT 1 FROM owner_cloud_auth WHERE employee_id=?').get(id);}
  employee(id:string):Employee { const row = this.db.prepare('SELECT * FROM employees WHERE id=? AND branch_id=?').get(id,this.branchId) as Employee|undefined; requireCondition(row,'EMPLOYEE_NOT_FOUND',404); return row; }
  current(token:string, required?:Permission, allowPasswordChange=false):Principal {
    this.assertStorage();
    requireCondition(typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token),'SESSION_INVALID',401);
    const session = this.db.prepare('SELECT * FROM auth_sessions WHERE secret_hash=?').get(digest(token)) as { id:string;employee_id:string;client:ClientType;issued_at:number;last_activity:number;credential_version:number;revoked:number;audience:string;method:string }|undefined;
    requireCondition(session,'SESSION_INVALID',401);
    const employee = this.employee(session.employee_id);
    requireCondition(session.audience===(employee.role==='OWNER'?'LOCAL_ADMIN':employee.role==='WAITER'?'WAITER_WEB':'CASHIER_POS'),'SESSION_INVALID',401);
    const cloudOwner=this.isCloudOwner(employee.id);
    const cloudSession=this.cloudSchema&&this.db.prepare('SELECT 1 FROM owner_cloud_sessions WHERE session_id=? AND employee_id=?').get(session.id,employee.id);
    requireCondition(!cloudOwner||!!cloudSession,'SESSION_INVALID',401);
    const decision = evaluateSession({branchId:this.branchId,employeeId:employee.id,client:session.client,issuedAtMs:session.issued_at,lastActivityMs:session.last_activity,credentialVersion:session.credential_version,revoked:session.revoked===1},
      {id:employee.id,branchId:employee.branch_id,role:employee.role,status:employee.status,mustChangePassword:allowPasswordChange || session.method==='PIN' ? false : employee.must_change===1,credentialVersion:employee.credential_version},this.now());
    if (!decision.allowed) {
      if(decision.code!=='PASSWORD_CHANGE_REQUIRED' && session.revoked===0) this.db.transaction(()=>{
        this.db.prepare('UPDATE auth_sessions SET revoked=1 WHERE id=?').run(session.id);
        audit(this.db,{id:employee.id,branchId:this.branchId},'auth.session.ended',employee.id,null,this.now(),{reason:decision.code});
      }).immediate();
      throw new PosError(decision.code,401);
    }
    if(required && !hasPermission(this.db,employee,required)) {
      audit(this.db,{id:employee.id,branchId:this.branchId},'auth.permission.denied',employee.id,null,this.now(),{permission:required},'DENIED');
      throw new PosError('PERMISSION_DENIED',403);
    }
    return {id:employee.id,branchId:this.branchId,audience:session.audience,method:cloudSession?'CLOUD_OWNER':session.method,role:employee.role,sessionId:session.id,employee};
  }
  private attempts(identity:string) {
    const row = this.db.prepare('SELECT retry_after FROM auth_attempts WHERE identity=?').get(identity) as {retry_after:number}|undefined;
    requireCondition(!row || this.now() >= row.retry_after,'AUTH_RATE_LIMITED',429);
  }
  private failed(identity:string) {
    const row = this.db.prepare('SELECT failures,updated_at FROM auth_attempts WHERE identity=?').get(identity) as {failures:number;updated_at:number}|undefined;
    const failures = row && this.now()-row.updated_at < 900000 ? Math.min(row.failures+1,12) : 1;
    const delay = failures < 5 ? 0 : Math.min(60000,1000*2**(failures-5));
    this.db.prepare('INSERT INTO auth_attempts VALUES(?,?,?,?) ON CONFLICT(identity) DO UPDATE SET failures=excluded.failures,retry_after=excluded.retry_after,updated_at=excluded.updated_at').run(identity,failures,this.now()+delay,this.now());
  }
  async prove(login:unknown,password:unknown, expectedId?:string):Promise<Employee> {
    this.assertStorage();
    if(typeof login==='string'&&login.includes('@')){
      const row=expectedId?this.db.prepare("SELECT e.* FROM employees e JOIN owner_cloud_auth c ON c.employee_id=e.id WHERE e.id=? AND e.branch_id=? AND e.role='OWNER'").get(expectedId,this.branchId) as Employee|undefined:undefined;
      requireCondition(row&&row.status==='ACTIVE'&&typeof password==='string'&&this.cloudOwnerProve,'INVALID_CREDENTIALS',401);
      await this.cloudOwnerProve(login.trim().toLowerCase(),password,row);
      return row;
    }
    const normalized = normalizeLogin(login), identity = digest(normalized);
    this.attempts(identity);
    const employee = this.db.prepare('SELECT * FROM employees WHERE login=? AND branch_id=?').get(normalized,this.branchId) as Employee|undefined;
    // A valid-format dummy hash gives missing logins the same expensive work.
    const dummy = 'argon2id-v1$'+'00'.repeat(16)+'$'+'00'.repeat(32);
    const valid = await verifyPassword(password,employee?.password_hash ?? dummy);
    this.assertStorage();
    if (!valid || !employee || employee.status !== 'ACTIVE' || expectedId && employee.id !== expectedId) {
      this.db.transaction(() => { this.failed(identity); audit(this.db,null,'auth.denied',null,null,this.now(),{},'DENIED'); }).immediate();
      throw new PosError('INVALID_CREDENTIALS',401);
    }
    return employee;
  }
  async login(login:unknown,password:unknown, client:ClientType) {
    requireCondition(client==='POS' || client==='WAITER_WEB','INVALID_CLIENT');
    requireCondition(typeof login==='string'&&!login.includes('@'),'INVALID_CREDENTIALS',401);
    const checked = await this.prove(login,password);
    requireCondition(!this.isCloudOwner(checked.id),'INVALID_CREDENTIALS',401);
    requireCondition(client==='POS'?checked.role!=='WAITER':checked.role==='WAITER','INVALID_CREDENTIALS',401);
    return this.openSession(checked,client,'PASSWORD');
  }
  openSession(checked:Employee,client:ClientType,method:'PIN'|'PASSWORD'|'CLOUD_OWNER') {
    const token=randomBytes(32).toString('base64url'),id=randomUUID();
    this.assertStorage();
    return this.db.transaction(()=>{
      const employee=this.employee(checked.id);
      requireCondition(employee.status==='ACTIVE'&&employee.credential_version===checked.credential_version&&employee.role===checked.role,'CREDENTIALS_CHANGED',401);
      requireCondition(client==='POS'?employee.role!=='WAITER':employee.role==='WAITER','INVALID_CREDENTIALS',401);
      requireCondition(method!=='PIN'||employee.role===(client==='POS'?'CASHIER':'WAITER'),'INVALID_CREDENTIALS',401);
      requireCondition(method!=='CLOUD_OWNER'||client==='POS'&&employee.role==='OWNER'&&this.isCloudOwner(employee.id),'INVALID_CREDENTIALS',401);
      requireCondition(method==='CLOUD_OWNER'||!this.isCloudOwner(employee.id),'INVALID_CREDENTIALS',401);
      const audience=employee.role==='OWNER'?'LOCAL_ADMIN':client==='WAITER_WEB'?'WAITER_WEB':'CASHIER_POS';
      this.db.prepare('INSERT INTO auth_sessions(id,employee_id,secret_hash,client,issued_at,last_activity,credential_version,revoked,audience,method) VALUES(?,?,?,?,?,?,?,0,?,?)').run(id,employee.id,digest(token),client,this.now(),this.now(),employee.credential_version,audience,method==='CLOUD_OWNER'?'PASSWORD':method);
      if(method==='CLOUD_OWNER'){const cloud=this.db.prepare('SELECT owner_cloud_id AS id FROM owner_cloud_auth WHERE employee_id=?').get(employee.id) as {id:string};this.db.prepare('INSERT INTO owner_cloud_sessions VALUES(?,?,?,?)').run(id,employee.id,cloud.id,this.now());}
      if(method==='PASSWORD')this.db.prepare('DELETE FROM auth_attempts WHERE identity=?').run(digest(employee.login));
      audit(this.db,{id:employee.id,branchId:this.branchId},'auth.login',employee.id,null,this.now(),{method,audience});
      return {token,employeeId:employee.id,mustChangePassword:method==='PASSWORD'&&employee.must_change===1};
    }).immediate();
  }

  logout(token:string) { this.db.transaction(() => { const p=this.current(token,undefined,true); this.db.prepare('UPDATE auth_sessions SET revoked=1 WHERE id=?').run(p.sessionId); audit(this.db,p,'auth.logout',p.id,null,this.now()); }).immediate(); }
  activity(token:string) { const p=this.current(token,undefined,true); this.db.prepare('UPDATE auth_sessions SET last_activity=? WHERE id=?').run(this.now(),p.sessionId); }
  async changePassword(token:string,id:string,oldPassword:unknown,newPassword:unknown) {
    const p=this.current(token,undefined,true);requireCondition(p.method!=='CLOUD_OWNER','OWNER_CLOUD_PASSWORD_ONLY',403);const next=validatePassword(newPassword);
    await this.prove(p.employee.login,oldPassword,p.id);
    const hash=await hashPassword(next), fingerprint=await passwordFingerprint(next,id);
    return this.bus.run({id,type:'auth.password.change',actor:p,payload:{passwordProof:fingerprint}},()=>{this.current(token,undefined,true);},()=>{
      requireCondition(this.employee(p.id).credential_version===p.employee.credential_version,'CREDENTIALS_CHANGED',401);
      this.db.prepare('UPDATE employees SET password_hash=?,must_change=0,credential_version=credential_version+1,revision=revision+1 WHERE id=?').run(hash,p.id);
      this.db.prepare('UPDATE auth_sessions SET revoked=1 WHERE employee_id=?').run(p.id);
      audit(this.db,p,'auth.password.changed',p.id,id,this.now()); return {employeeId:p.id,loginRequired:true};
    });
  }
  private target(actor:Principal,id:string,allowOwner=false,allowArchived=false) {
    const target=this.employee(id);
    requireCondition(allowArchived||target.status!=='DEACTIVATED','EMPLOYEE_ARCHIVED');
    requireCondition(target.role!=='OWNER' || allowOwner && actor.role==='OWNER','OWNER_PROTECTED',403);
    if(actor.role==='MANAGER') requireCondition(target.id!==actor.id,'MANAGER_TARGET_FORBIDDEN',403);
    if(actor.role==='CASHIER') requireCondition(target.id!==actor.id&&['CASHIER','WAITER'].includes(target.role),'CASHIER_TARGET_FORBIDDEN',403);
    return target;
  }
  private publishEmployee(actor:Actor,id:string,action:string,commandId:string,before:unknown=null) {
    const e=this.employee(id), safe={id:e.id,branchId:e.branch_id,login:e.login,name:e.name,role:e.role,status:e.status,revision:e.revision};
    audit(this.db,actor,action,id,commandId,this.now(),{before,after:safe}); outbox(this.db,this.branchId,'employee.changed',safe,this.now()); return safe;
  }
  async createEmployee(token:string,id:string,input:{login:unknown;name:unknown;role:Role;phone?:string|null}) {
    const actor=this.current(token,'employee.create'), login=normalizeLogin(input.login), name=textField(input.name),phone=normalizePhone(input.phone);
    requireCondition(['MANAGER','CASHIER','WAITER'].includes(input.role),'INVALID_ROLE');
    if(actor.role==='CASHIER')requireCondition(['CASHIER','WAITER'].includes(input.role),'CASHIER_TARGET_FORBIDDEN',403);
    const temporary=temporaryPassword(), hash=await hashPassword(temporary); let created=false;
    const result=await this.bus.run({id,type:'employee.create',actor,payload:{login,name,role:input.role,phone}},()=>{this.current(token,'employee.create');},()=>{
      const employeeId=randomUUID();
      requireCondition(!this.db.prepare('SELECT 1 FROM employees WHERE login=?').get(login),'LOGIN_ALREADY_USED');
      this.db.prepare('INSERT INTO employees(id,branch_id,login,name,phone,role,status,password_hash,must_change,created_at) VALUES(?,?,?,?,?,? ,\'ACTIVE\',?,1,?)').run(employeeId,this.branchId,login,name,phone,input.role,hash,this.now());
      created=true; return this.publishEmployee(actor,employeeId,'employee.created',id);
    });
    return {...result,temporaryPassword:created ? temporary:undefined,secretAlreadyIssued:!created};
  }
  async updateEmployee(token:string,id:string,input:{employeeId:string;revision:number;name?:string;phone?:string|null;role?:Role;status?:EmployeeStatus}) {
    const actor=this.current(token,input.status ? 'employee.status.manage':'employee.edit');
    integer(input.revision,1,Number.MAX_SAFE_INTEGER);
    requireCondition(input.name!==undefined || input.phone!==undefined || input.role!==undefined || input.status!==undefined,'EMPTY_UPDATE');
    return this.bus.run({id,type:'employee.update',actor,payload:input},()=>{this.current(token,input.status ? 'employee.status.manage':'employee.edit'); if(input.name!==undefined || input.role!==undefined)this.current(token,'employee.edit');},()=>{
      const target=this.target(this.current(token),input.employeeId,false,input.status==='ACTIVE'); requireCondition(target.revision===input.revision,'REVISION_CONFLICT');
      const role=input.role??target.role, status=input.status??target.status, name=input.name===undefined ? target.name:textField(input.name);
      const phone=input.phone===undefined?target.phone:normalizePhone(input.phone);
      requireCondition(['MANAGER','CASHIER','WAITER'].includes(role) && ['ACTIVE','SUSPENDED','DEACTIVATED'].includes(status),'INVALID_EMPLOYEE');
      if(actor.role==='CASHIER')requireCondition(['CASHIER','WAITER'].includes(role),'CASHIER_TARGET_FORBIDDEN',403);
      this.db.prepare('UPDATE employees SET name=?,phone=?,role=?,status=?,revision=revision+1 WHERE id=?').run(name,phone,role,status,target.id);
      if(status!=='ACTIVE' || role!==target.role)this.db.prepare('UPDATE auth_sessions SET revoked=1 WHERE employee_id=?').run(target.id);
      return this.publishEmployee(actor,target.id,'employee.updated',id,{name:target.name,role:target.role,status:target.status,revision:target.revision});
    });
  }
  async resetPassword(token:string,id:string,input:{employeeId:string;revision:number}) {
    const actor=this.current(token,'employee.password.reset'); const temporary=temporaryPassword(), hash=await hashPassword(temporary); let changed=false;
    const result=await this.bus.run({id,type:'employee.password.reset',actor,payload:input},()=>{this.current(token,'employee.password.reset');},()=>{
      const target=this.target(this.current(token),input.employeeId); requireCondition(target.revision===input.revision,'REVISION_CONFLICT');
      this.db.prepare('UPDATE employees SET password_hash=?,must_change=1,credential_version=credential_version+1,revision=revision+1 WHERE id=?').run(hash,target.id);
      this.db.prepare('UPDATE auth_sessions SET revoked=1 WHERE employee_id=?').run(target.id); changed=true;
      audit(this.db,actor,'employee.password.reset',target.id,id,this.now()); return {employeeId:target.id};
    });
    return {...result,temporaryPassword:changed ? temporary:undefined,secretAlreadyIssued:!changed};
  }
  async setPermission(token:string,id:string,input:{employeeId:string;revision:number;permission:Permission;allowed:boolean}) {
    permission(input.permission); requireCondition(typeof input.allowed==='boolean','INVALID_PERMISSION');
    const actor=this.current(token,'employee.permissions.manage');
    return this.bus.run({id,type:'employee.permission',actor,payload:input},()=>{this.current(token,'employee.permissions.manage');},()=>{
      const fresh=this.current(token), target=this.target(fresh,input.employeeId,true);
      requireCondition(target.revision===input.revision,'REVISION_CONFLICT'); requireCondition(roleAllows(target.role,input.permission),'ROLE_FORBIDDEN',403);
      requireCondition(!this.db.prepare('SELECT 1 FROM role_permission_overrides WHERE branch_id=? AND role=? AND permission=?').get(this.branchId,target.role,input.permission),'ROLE_RULE_LOCKED',409);
      requireCondition(!(target.role==='OWNER' && input.permission==='employee.permissions.manage' && !input.allowed),'OWNER_ADMIN_REQUIRED',403);
      if(fresh.role==='MANAGER') {
        requireCondition(hasPermission(this.db,fresh.employee,input.permission) && this.db.prepare('SELECT 1 FROM manager_delegations WHERE employee_id=? AND permission=?').get(fresh.id,input.permission),'DELEGATION_FORBIDDEN',403);
      }
      const before=hasPermission(this.db,target,input.permission);
      this.db.prepare('INSERT INTO permission_overrides VALUES(?,?,?) ON CONFLICT(employee_id,permission) DO UPDATE SET allowed=excluded.allowed').run(target.id,input.permission,input.allowed?1:0);
      this.db.prepare('UPDATE employees SET revision=revision+1 WHERE id=?').run(target.id);
      audit(this.db,actor,'employee.permission',target.id,id,this.now(),{permission:input.permission,before,after:input.allowed});
      return {employeeId:target.id,revision:target.revision+1};
    });
  }
  async setDelegations(token:string,id:string,input:{employeeId:string;revision:number;permissions:Permission[]}) {
    requireCondition(Array.isArray(input.permissions) && input.permissions.length<=100 && new Set(input.permissions).size===input.permissions.length,'INVALID_PERMISSIONS'); input.permissions.forEach(permission);
    const actor=this.current(token,'employee.permissions.manage'); requireCondition(actor.role==='OWNER','OWNER_REQUIRED',403);
    return this.bus.run({id,type:'employee.delegations',actor,payload:input},()=>{requireCondition(this.current(token,'employee.permissions.manage').role==='OWNER','OWNER_REQUIRED',403);},()=>{
      const target=this.employee(input.employeeId); requireCondition(target.role==='MANAGER' && target.status==='ACTIVE','INVALID_MANAGER'); requireCondition(target.revision===input.revision,'REVISION_CONFLICT');
      const before=this.db.prepare('SELECT permission FROM manager_delegations WHERE employee_id=?').all(target.id);
      this.db.prepare('DELETE FROM manager_delegations WHERE employee_id=?').run(target.id);
      for(const key of input.permissions)this.db.prepare('INSERT INTO manager_delegations VALUES(?,?)').run(target.id,key);
      this.db.prepare('UPDATE employees SET revision=revision+1 WHERE id=?').run(target.id);
      audit(this.db,actor,'employee.delegations',target.id,id,this.now(),{before,after:input.permissions}); return {employeeId:target.id,revision:target.revision+1};
    });
  }
  roleMatrix(token:string) {
    const actor=this.current(token,'employee.permissions.manage');
    requireCondition(actor.role==='OWNER','OWNER_REQUIRED',403);
    return (['OWNER','MANAGER','CASHIER','WAITER'] as const).map(role=>{
      const row=role==='OWNER'?undefined:this.db.prepare('SELECT revision FROM role_permission_revisions WHERE branch_id=? AND role=?').get(this.branchId,role) as {revision:number}|undefined;
      const saved=this.db.prepare('SELECT permission,allowed FROM role_permission_overrides WHERE branch_id=? AND role=?').all(this.branchId,role) as {permission:string;allowed:number}[];
      const overrides=new Map(saved.map(entry=>[entry.permission,entry.allowed===1]));
      return {role,revision:row?.revision??1,permissions:permissionKeys.map(key=>({key,allowed:roleAllows(role,key),enabled:roleAllows(role,key)&&(overrides.get(key)??defaults[role].includes(key)),custom:overrides.has(key)}))};
    });
  }
  async setRolePermission(token:string,id:string,input:{role:Role;revision:number;permission:Permission;allowed:boolean}) {
    const actor=this.current(token,'employee.permissions.manage');
    requireCondition(actor.role==='OWNER','OWNER_REQUIRED',403);
    requireCondition(['MANAGER','CASHIER','WAITER'].includes(input.role),'ROLE_FORBIDDEN',403);
    permission(input.permission); integer(input.revision,1,Number.MAX_SAFE_INTEGER);
    requireCondition(typeof input.allowed==='boolean','INVALID_PERMISSION');
    requireCondition(roleAllows(input.role,input.permission),'ROLE_FORBIDDEN',403);
    return this.bus.run({id,type:'role.permission',actor,payload:input},()=>{
      const fresh=this.current(token,'employee.permissions.manage');requireCondition(fresh.role==='OWNER','OWNER_REQUIRED',403);
    },()=>{
      const current=this.db.prepare('SELECT revision FROM role_permission_revisions WHERE branch_id=? AND role=?').get(this.branchId,input.role) as {revision:number}|undefined;
      requireCondition((current?.revision??1)===input.revision,'REVISION_CONFLICT',409);
      const before=this.db.prepare('SELECT allowed FROM role_permission_overrides WHERE branch_id=? AND role=? AND permission=?').get(this.branchId,input.role,input.permission) as {allowed:number}|undefined;
      const revision=input.revision+1;
      this.db.prepare('INSERT INTO role_permission_revisions(branch_id,role,revision) VALUES(?,?,?) ON CONFLICT(branch_id,role) DO UPDATE SET revision=excluded.revision').run(this.branchId,input.role,revision);
      this.db.prepare('INSERT INTO role_permission_overrides(branch_id,role,permission,allowed) VALUES(?,?,?,?) ON CONFLICT(branch_id,role,permission) DO UPDATE SET allowed=excluded.allowed').run(this.branchId,input.role,input.permission,input.allowed?1:0);
      audit(this.db,actor,'role.permission',input.role,id,this.now(),{permission:input.permission,before:before?.allowed??null,after:input.allowed,revision});
      outbox(this.db,this.branchId,'role.permission.changed',{role:input.role,permission:input.permission,enabled:input.allowed,revision},this.now());
      return {role:input.role,permission:input.permission,enabled:input.allowed,revision};
    });
  }
  list(token:string,archive=false) {
    const actor=this.current(token,archive?'employee.archive.view':'employee.edit');
    const rows=this.db.prepare("SELECT id,login,name,phone,role,status,revision,created_at AS createdAt,(SELECT MAX(last_activity) FROM auth_sessions WHERE employee_id=employees.id) AS lastActivity,EXISTS(SELECT 1 FROM employee_pins WHERE employee_id=employees.id) AS pinIssued FROM employees WHERE branch_id=? AND (status!='DEACTIVATED' OR ?=1) AND (?!='CASHIER' OR role IN ('CASHIER','WAITER')) ORDER BY name,id").all(this.branchId,archive?1:0,actor.role) as {id:string;login:string;name:string;phone:string|null;role:Role;status:EmployeeStatus;revision:number}[];
    if(!hasPermission(this.db,actor.employee,'employee.permissions.manage'))return rows;
    return rows.map(employee=>({...employee,permissions:permissionKeys.filter(key=>hasPermission(this.db,employee,key)),delegations:employee.role==='MANAGER' && (actor.role==='OWNER' || actor.id===employee.id)?(this.db.prepare('SELECT permission FROM manager_delegations WHERE employee_id=?').all(employee.id) as {permission:string}[]).map(row=>row.permission):[]}));
  }
  statistics(token:string,id:string) {
    const actor=this.current(token,'employee.edit'),employee=this.employee(id);
    if(actor.role==='CASHIER')requireCondition(['CASHIER','WAITER'].includes(employee.role),'CASHIER_TARGET_FORBIDDEN',403);
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bishkek',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(this.now());
    const value=(type:string)=>Number(parts.find(part=>part.type===type)?.value);
    const from=Date.UTC(value('year'),value('month')-1,value('day'))-6*60*60*1000,to=from+24*60*60*1000;
    const count=(table:string,actor:string,at:string)=>(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE branch_id=? AND ${actor}=? AND ${at}>=? AND ${at}<?`).get(this.branchId,id,from,to) as {n:number}).n;
    // Settlement snapshot freezes the responsible waiter at payment time. The
    // mutable visit assignment must never be used for historical attribution.
    const credited=`COALESCE(CASE WHEN o.type='TABLE' THEN json_extract(s.snapshot,'$.responsibleWaiter.id') END,p.actor_id)`;
    const source=`FROM payments p JOIN settlements s ON s.branch_id=p.branch_id AND s.id=p.settlement_id JOIN settlement_seals z ON z.branch_id=s.branch_id AND z.settlement_id=s.id JOIN orders o ON o.branch_id=p.branch_id AND o.id=p.order_id`;
    let revenueTodayCents:number|null=null;
    if(actor.role!=='CASHIER'&&hasPermission(this.db,actor.employee,'sales.view_24h')){
      const paid=(this.db.prepare(`SELECT COALESCE(SUM(p.amount),0) n ${source} WHERE p.branch_id=? AND ${credited}=? AND p.registered_at>=? AND p.registered_at<?`).get(this.branchId,id,from,to) as {n:number}).n;
      const refunded=(this.db.prepare(`SELECT COALESCE(SUM(r.amount),0) n ${source} JOIN refunds r ON r.branch_id=p.branch_id AND r.payment_id=p.id WHERE r.branch_id=? AND ${credited}=? AND r.created_at>=? AND r.created_at<?`).get(this.branchId,id,from,to) as {n:number}).n;
      revenueTodayCents=paid-refunded;
    }
    return {employeeId:id,day:[value('year'),String(value('month')).padStart(2,'0'),String(value('day')).padStart(2,'0')].join('-'),openedTables:count('table_sessions','opened_by','opened_at'),submittedBatches:count('order_batches','sender_id','submitted_at'),registeredPayments:count('payments','actor_id','registered_at'),corrections:count('order_corrections','actor_id','created_at'),revenueTodayCents};
  }
}
