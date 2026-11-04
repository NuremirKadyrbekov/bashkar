import { PosError, requireCondition } from '../../errors';
import { digest } from '../../command-bus';
import type { CloudConfig } from '../activation/cloud-activation';
import type { AuthService, Employee } from './auth-service';

type CloudUser={id:string;email:string;email_confirmed_at:string|null;is_anonymous?:boolean};
type CloudSession={token:string;validatedAt:number;retryAt?:number};
const READ_VALIDATION_MS=30000;
export class CloudOwnerAuth {
  private readonly sessions=new Map<string,CloudSession>();
  private readonly checks=new Map<string,Promise<void>>();
  constructor(private readonly auth:AuthService,private readonly config:CloudConfig,private readonly network:typeof fetch=fetch,private readonly now:()=>number=Date.now){}
  private binding(){
    const row=this.auth.db.prepare('SELECT branch_id AS branchId,organization_id AS organizationId,owner_cloud_id AS ownerId FROM activation WHERE singleton=1').get() as {branchId:string;organizationId:string;ownerId:string}|undefined;
    requireCondition(row,'ACTIVATION_REQUIRED',503);return row;
  }
  private async remote(path:string,token?:string,payload?:unknown){
    try{
      const response=await this.network(this.config.url+path,{method:payload?'POST':'GET',redirect:'error',headers:{apikey:this.config.publishableKey,...(token?{authorization:'Bearer '+token}:{}),...(payload?{'content-type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(15000)});
      if(response.status===429)throw new PosError('AUTH_RATE_LIMITED',429);
      if(response.status===400||response.status===401||response.status===403)throw new PosError('OWNER_CLOUD_INVALID',401);
      if(!response.ok)throw new PosError('OWNER_CLOUD_UNAVAILABLE',503);
      return await response.json();
    }catch(error){if(error instanceof PosError)throw error;throw new PosError('OWNER_CLOUD_UNAVAILABLE',503);}
  }
  private async checkToken(token:string):Promise<CloudUser>{
    const bound=this.binding();
    const user=await this.remote('/auth/v1/user',token) as CloudUser;
    requireCondition(typeof user.id==='string'&&user.id===bound.ownerId&&typeof user.email==='string'&&!!user.email_confirmed_at&&!user.is_anonymous,'OWNER_CLOUD_INVALID',401);
    const [organizations,branches]=await Promise.all([
      this.remote('/rest/v1/organizations?select=id',token),
      this.remote('/rest/v1/branches?select=id,organization_id',token)
    ]) as [{id:string}[],{id:string;organization_id:string}[]];
    requireCondition(Array.isArray(organizations)&&Array.isArray(branches),'OWNER_CLOUD_UNAVAILABLE',503);
    requireCondition(organizations.some(o=>o.id===bound.organizationId)&&branches.some(b=>b.id===bound.branchId&&b.organization_id===bound.organizationId),'OWNER_CLOUD_ACCESS_DENIED',403);
    return user;
  }
  private async credential(email:string,password:string){
    requireCondition(typeof email==='string'&&email.includes('@')&&email.length<=320&&typeof password==='string'&&password.length>0&&Buffer.byteLength(password)<=1024,'OWNER_CLOUD_INVALID',401);
    const result=await this.remote('/auth/v1/token?grant_type=password',undefined,{email,password});
    requireCondition(typeof result.access_token==='string','OWNER_CLOUD_INVALID',401);
    const user=await this.checkToken(result.access_token);
    requireCondition(user.email.toLowerCase()===email.trim().toLowerCase(),'OWNER_CLOUD_INVALID',401);
    return result.access_token as string;
  }
  async prove(email:string,password:string,employee:Employee){
    const row=this.auth.db.prepare('SELECT owner_cloud_id AS id FROM owner_cloud_auth WHERE employee_id=?').get(employee.id) as {id:string}|undefined;
    requireCondition(row&&row.id===this.binding().ownerId,'OWNER_CLOUD_INVALID',401);
    await this.credential(email,password);
  }
  async login(email:string,password:string){
    const identity=digest('cloud-owner:'+String(email).trim().toLowerCase());
    const attempt=this.auth.db.prepare('SELECT failures,retry_after FROM auth_attempts WHERE identity=?').get(identity) as {failures:number;retry_after:number}|undefined;
    requireCondition(!attempt||Date.now()>=attempt.retry_after,'AUTH_RATE_LIMITED',429);
    let token:string;
    try{token=await this.credential(email,password);}
    catch(error){
      if(error instanceof PosError&&error.code==='OWNER_CLOUD_INVALID'){
        const failures=Math.min((attempt?.failures??0)+1,12),delay=failures<5?0:Math.min(60000,1000*2**(failures-5));
        this.auth.db.prepare('INSERT INTO auth_attempts VALUES(?,?,?,?) ON CONFLICT(identity) DO UPDATE SET failures=excluded.failures,retry_after=excluded.retry_after,updated_at=excluded.updated_at').run(identity,failures,Date.now()+delay,Date.now());
      }
      throw error;
    }
    const owner=this.auth.db.prepare("SELECT e.* FROM employees e JOIN owner_cloud_auth c ON c.employee_id=e.id WHERE e.branch_id=? AND c.owner_cloud_id=? AND e.role='OWNER' AND e.status='ACTIVE'").get(this.auth.branchId,this.binding().ownerId) as Employee|undefined;
    requireCondition(owner,'OWNER_CLOUD_ACCESS_DENIED',403);
    const normalized=email.trim().toLowerCase();
    this.auth.db.prepare('UPDATE owner_cloud_auth SET email=? WHERE employee_id=? AND email<>?').run(normalized,owner.id,normalized);
    this.auth.db.prepare('UPDATE employees SET name=? WHERE id=? AND name<>?').run(normalized,owner.id,normalized);
    this.auth.db.prepare('DELETE FROM auth_attempts WHERE identity=?').run(identity);
    const session=this.auth.openSession(owner,'POS','CLOUD_OWNER');
    const current=this.auth.current(session.token);
    this.sessions.set(current.sessionId,{token,validatedAt:this.now()});
    return session;
  }
  async verifySession(sessionId:string,fresh=false){
    const session=this.sessions.get(sessionId);
    requireCondition(session,'OWNER_CLOUD_RELOGIN_REQUIRED',401);
    // Read-only navigation can reuse a recent successful cloud proof. Every
    // business mutation still needs a fresh proof; concurrent reads share it.
    if(!fresh&&this.now()-session.validatedAt<READ_VALIDATION_MS)return;
    let check=this.checks.get(sessionId);
    if(!check){
      check=this.checkToken(session.token).then(()=>{if(this.sessions.get(sessionId)===session){session.validatedAt=this.now();session.retryAt=undefined;}}).catch(error=>{
        if(error instanceof PosError&&error.code==='OWNER_CLOUD_UNAVAILABLE')session.retryAt=this.now()+READ_VALIDATION_MS;
        if(error instanceof PosError&&error.code!=='OWNER_CLOUD_UNAVAILABLE')this.sessions.delete(sessionId);
        throw error;
      }).finally(()=>{this.checks.delete(sessionId);});
      this.checks.set(sessionId,check);
    }
    await check;
  }
  verifyLocalSession(sessionId:string){
    const session=this.sessions.get(sessionId);
    requireCondition(session,'OWNER_CLOUD_RELOGIN_REQUIRED',401);
    if(this.now()-session.validatedAt>=READ_VALIDATION_MS&&this.now()>=(session.retryAt??0))void this.verifySession(sessionId).catch(()=>{});
  }
  forget(sessionId:string){this.sessions.delete(sessionId);}
}
