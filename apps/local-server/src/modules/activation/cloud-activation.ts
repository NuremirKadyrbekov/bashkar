import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync,renameSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest, uuidPattern } from '../../command-bus';
import { PosError, requireCondition, textField } from '../../errors';
import { object } from '../menu/catalog';
import type { ActivationService } from './activation-service';
import type { SigningDeviceIdentity } from './platform-device';

export type CloudConfig={url:string;publishableKey:string;publicMenuBaseUrl?:string;menuSync?:{publicKey:string;keyId:string;enabled?:boolean}};
type Flow={id:string;ownerId:string;email:string;token:string;expires:number;branches:{id:string;name:string;organizationId:string;organizationName:string}[]};
type Pending={version:1;registrationId:string;branchId:string;ownerId:string;instanceId:string;devicePublicKeyHash:string;nonce:string};
export class CloudActivation {
  private flow?:Flow;
  private busy=false;
  constructor(private readonly config:CloudConfig,private readonly device:SigningDeviceIdentity,private readonly activation:ActivationService,private readonly dir:string,private readonly storageGuard:()=>void,private readonly enable:()=>void,private readonly network:typeof fetch=fetch){}
  private unbound(){this.storageGuard();requireCondition(!this.activation.binding(),'ALREADY_ACTIVATED',409);}
  private async exclusive<T>(job:()=>Promise<T>){requireCondition(!this.busy,'ACTIVATION_BUSY',409);this.busy=true;try{return await job();}finally{this.busy=false;}}
  private async remote(path:string,token?:string,body?:unknown){
    try{
      const response=await this.network(this.config.url+path,{method:body?'POST':'GET',redirect:'error',headers:{apikey:this.config.publishableKey,...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
      const value=await response.json();
      if(!response.ok){
        const allowed=['BRANCH_ACCESS_DENIED','BRANCH_ALREADY_REGISTERED','REGISTRATION_ID_CONFLICT','REGISTRATION_CONFLICT','DEVICE_PROOF_INVALID','CONFIRMED_OWNER_REQUIRED'];
        throw new PosError(response.status===401||response.status===400&&path.startsWith('/auth/')?'CLOUD_LOGIN_INVALID':response.status===429?'AUTH_RATE_LIMIT':allowed.includes(value.code)?value.code:'CLOUD_REGISTRATION_UNAVAILABLE',response.status===401?401:response.status===403?403:response.status===409?409:response.status===429?429:503);
      }
      return value;
    }catch(error){if(error instanceof PosError)throw error;throw new PosError('CLOUD_REGISTRATION_UNAVAILABLE',503);}
  }
  login(input:unknown){return this.exclusive(async()=>{
    this.unbound();this.flow=undefined;
    const b=object(input,['email','password']);
    const email=textField(b.email,320);requireCondition(typeof b.password==='string'&&b.password.length>0&&Buffer.byteLength(b.password)<=1024,'INVALID_PASSWORD');
    const login=await this.remote('/auth/v1/token?grant_type=password',undefined,{email,password:b.password});
    requireCondition(typeof login.access_token==='string','CLOUD_LOGIN_INVALID',401);
    const user=await this.remote('/auth/v1/user',login.access_token);
    requireCondition(typeof user.id==='string'&&typeof user.email==='string'&&user.email_confirmed_at&&!user.is_anonymous,'CONFIRMED_OWNER_REQUIRED',403);
    const organizations=await this.remote('/rest/v1/organizations?select=id,name',login.access_token);
    const branches=await this.remote('/rest/v1/branches?select=id,name,organization_id',login.access_token);
    requireCondition(Array.isArray(organizations)&&Array.isArray(branches),'CLOUD_REGISTRATION_UNAVAILABLE',503);
    const available=branches.flatMap(branch=>{const org=organizations.find(o=>o.id===branch.organization_id);return org?[{id:branch.id,name:branch.name,organizationId:org.id,organizationName:org.name}]:[];});
    requireCondition(available.length>0,'NO_OWNED_BRANCHES',403);
    this.storageGuard();this.device.initialize();
    this.flow={id:randomBytes(32).toString('base64url'),ownerId:user.id,email:user.email,token:login.access_token,expires:Date.now()+Math.min(600000,Number(login.expires_in??600)*1000),branches:available};
    return {flowId:this.flow.id,branches:available};
  });}
  complete(input:unknown){return this.exclusive(async()=>{
    this.storageGuard();
    // Resolve a lost local response without another cloud reservation or
    // resetting the local Owner. No password/receipt is returned by this path.
    const bound=this.activation.binding();if(bound){this.enable();return {branchId:bound.branchId,alreadyActivated:true};}
    const b=object(input,['flowId','branchId']);
    requireCondition(this.flow&&typeof b.flowId==='string'&&b.flowId===this.flow.id&&Date.now()<this.flow.expires,'CLOUD_LOGIN_REQUIRED',401);
    const flow=this.flow;
    requireCondition(typeof b.branchId==='string'&&flow.branches.some(branch=>branch.id===b.branchId),'BRANCH_ACCESS_DENIED',403);
    this.device.assertAvailable();
    const instance=this.activation.db.prepare('SELECT id FROM bootstrap_instance').get() as {id:string};
    const devicePublicKey=this.device.publicKey(),devicePublicKeyHash=digest(devicePublicKey);
    let pending:Pending;
    const saved=this.activation.db.prepare('SELECT registration_id AS registrationId,branch_id AS branchId,owner_cloud_id AS ownerId,instance_id AS instanceId,device_public_key_hash AS devicePublicKeyHash,nonce FROM activation_pending WHERE singleton=1').get() as Omit<Pending,'version'>|undefined;
    if(saved){
      pending={version:1,...saved};
      requireCondition(pending.version===1&&pending.ownerId===flow.ownerId&&pending.instanceId===instance.id&&pending.devicePublicKeyHash===devicePublicKeyHash&&uuidPattern.test(pending.registrationId)&&/^[A-Za-z0-9_-]{43}$/.test(pending.nonce),'ACTIVATION_PENDING_INVALID',503);
      requireCondition(pending.branchId===b.branchId,'ACTIVATION_PENDING_DIFFERENT_BRANCH',409);
    }else{
      pending={version:1,registrationId:randomUUID(),branchId:b.branchId,ownerId:flow.ownerId,instanceId:instance.id,devicePublicKeyHash,nonce:randomBytes(32).toString('base64url')};
      this.activation.db.transaction(()=>{
        this.storageGuard();
        this.activation.db.prepare('INSERT INTO activation_pending VALUES(1,?,?,?,?,?,?)').run(pending.registrationId,pending.branchId,pending.ownerId,pending.instanceId,pending.devicePublicKeyHash,pending.nonce);
      }).immediate(); // FULL SQLite commit BEFORE the network reservation.
    }
    this.storageGuard();
    const proof={version:1,registrationId:pending.registrationId,branchId:pending.branchId,instanceId:instance.id,devicePublicKeyHash,nonce:pending.nonce};
    const {devicePublicKeyHash:_,...fields}=proof;
    const receipt=await this.remote('/functions/v1/register-server',flow.token,{...fields,devicePublicKey,deviceSignature:this.device.sign(canonical(proof))});
    requireCondition(receipt.claims?.ownerCloudId===flow.ownerId&&receipt.claims?.branchId===pending.branchId&&receipt.claims?.registrationId===pending.registrationId,'ACTIVATION_BINDING_MISMATCH',503);
    this.storageGuard();
    const result=await this.activation.activateCloudOwner(receipt,{email:flow.email,ownerCloudId:flow.ownerId},pending.nonce);
    const name=flow.branches.find(branch=>branch.id===pending.branchId)?.name;
    if(typeof name==='string'&&name.trim()&&name.length<=120){try{const path=join(this.dir,'branch-display.json'),temp=path+'.new';writeFileSync(temp,JSON.stringify({branchId:pending.branchId,registrationId:pending.registrationId,name:name.trim()}),{mode:0o600,flush:true});renameSync(temp,path);}catch{/* Display metadata cannot undo a completed activation. */}}
    this.flow=undefined;this.enable();return result;
  });}
}
