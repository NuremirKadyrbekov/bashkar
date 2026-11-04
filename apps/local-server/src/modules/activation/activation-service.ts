import type Database from 'better-sqlite3';
import { createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { audit, canonical, digest, outbox } from '../../command-bus';
import { requireCondition } from '../../errors';
import { object } from '../menu/catalog';
import { hashPassword, validatePassword } from '../auth/passwords';
import { normalizeLogin } from '../auth/auth-service';
// This protocol implements verification, not the cloud Owner login/registry.
// The authority key MUST be provisioned by a trusted installation channel.
// No request, renderer, command-line test switch or receipt supplies that key.
export type ActivationClaims = { version:1; instanceId:string; branchId:string; organizationId:string; ownerCloudId:string; registrationId:string; devicePublicKeyHash:string; nonce:string; issuedAt:number; expiresAt:number };
export type SignedRegistration = { claims:ActivationClaims; signature:string };
export interface ActivationAuthority { readonly publicKey:string; }
export interface ProtectedDeviceIdentity { publicKey():string; assertAvailable():void; }
export class ActivationService {
  constructor(readonly db:Database.Database, private readonly authority:ActivationAuthority, private readonly device:ProtectedDeviceIdentity, private readonly now=Date.now) {}
  private verifyReceipt(input:unknown, initial:boolean):SignedRegistration {
    const envelope=object(input,['claims','signature']);
    const claims=object(envelope.claims,['version','instanceId','branchId','organizationId','ownerCloudId','registrationId','devicePublicKeyHash','nonce','issuedAt','expiresAt']);
    requireCondition(claims.version===1 && typeof envelope.signature==='string' && /^[A-Za-z0-9_-]{86}$/.test(envelope.signature),'INVALID_ACTIVATION_PROOF');
    for(const key of ['instanceId','branchId','organizationId','ownerCloudId','registrationId','devicePublicKeyHash','nonce']) requireCondition(typeof claims[key]==='string' && (claims[key] as string).length>0 && (claims[key] as string).length<=500,'INVALID_ACTIVATION_PROOF');
    requireCondition(Number.isSafeInteger(claims.issuedAt) && Number.isSafeInteger(claims.expiresAt) && (claims.issuedAt as number)<=(claims.expiresAt as number),'INVALID_ACTIVATION_PROOF');
    const publicKey=createPublicKey(this.authority.publicKey);requireCondition(publicKey.asymmetricKeyType==='ed25519','INVALID_ACTIVATION_AUTHORITY');
    requireCondition(verify(null,Buffer.from(canonical(claims)),publicKey,Buffer.from(envelope.signature,'base64url')),'ACTIVATION_SIGNATURE_INVALID');
    const instance=this.db.prepare('SELECT id FROM bootstrap_instance').get() as {id:string};
    this.device.assertAvailable();
    requireCondition(claims.instanceId===instance.id && claims.devicePublicKeyHash===digest(this.device.publicKey()),'ACTIVATION_DEVICE_MISMATCH');
    if(initial) requireCondition((claims.issuedAt as number)<=this.now() && this.now()<(claims.expiresAt as number),'ACTIVATION_PROOF_EXPIRED');
    // The expiry is for initial consumption only. It must not stop an activated
    // offline branch. Remote revocation/replacement is the separately controlled
    // D10/D11 procedure, not an invented online lease.
    return {claims:claims as ActivationClaims,signature:envelope.signature};
  }
  binding():{branchId:string;organizationId:string}|null {
    const row=this.db.prepare('SELECT * FROM activation WHERE singleton=1').get() as {proof:string;branch_id:string;organization_id:string;instance_id:string;registration_id:string;owner_cloud_id:string}|undefined;
    if(!row)return null;
    const proof=this.verifyReceipt(JSON.parse(row.proof),false);
    requireCondition(row.branch_id===proof.claims.branchId && row.organization_id===proof.claims.organizationId && row.instance_id===proof.claims.instanceId && row.registration_id===proof.claims.registrationId && row.owner_cloud_id===proof.claims.ownerCloudId,'ACTIVATION_BINDING_MISMATCH');
    const owners=this.db.prepare("SELECT id FROM employees WHERE branch_id=? AND role='OWNER'").all(row.branch_id);
    requireCondition(owners.length===1,'ACTIVATION_OWNER_MISSING');
    return {branchId:row.branch_id,organizationId:row.organization_id};
  }
  async activate(proof:unknown,input:{login:unknown;name:string;password:unknown}, expectedNonce:string) {
    const receipt=this.verifyReceipt(proof,false);requireCondition(receipt.claims.nonce===expectedNonce,'ACTIVATION_NONCE_MISMATCH');
    // Cloud SQL and the installation clock can differ by a few milliseconds.
    // Wait for a VERIFIED issue time, never accept a future/expired proof by
    // widening the validity window. This is a bounded network handoff wait,
    // not the unresolved operational clock-jump policy D12.
    const untilIssued=receipt.claims.issuedAt-this.now();
    requireCondition(untilIssued<=5000,'ACTIVATION_CLOCK_MISMATCH',503);
    if(untilIssued>0)await new Promise(resolve=>setTimeout(resolve,untilIssued+20));
    this.verifyReceipt(receipt,true);
    const login=normalizeLogin(input.login),password=validatePassword(input.password);
    requireCondition(typeof input.name==='string' && input.name.trim().length>0 && input.name.length<=200,'INVALID_NAME');
    const hash=await hashPassword(password);
    return this.db.transaction(()=>{
      const binding=this.binding();
      if(binding) {
        requireCondition(this.db.prepare('SELECT 1 FROM activation WHERE registration_id=? AND proof=?').get(receipt.claims.registrationId,canonical(receipt)),'ALREADY_ACTIVATED');
        // A lost answer is resolved by reading the binding/login, never reset Owner.
        return {branchId:binding.branchId,alreadyActivated:true};
      }
      const fresh=this.verifyReceipt(receipt,true);const c=fresh.claims,id=randomUUID();
      requireCondition(!this.db.prepare('SELECT 1 FROM employees LIMIT 1').get(),'ACTIVATION_DATABASE_NOT_EMPTY');
      this.db.prepare('INSERT INTO activation VALUES(1,?,?,?,?,?,?,?)').run(c.instanceId,c.branchId,c.organizationId,c.ownerCloudId,c.registrationId,canonical(receipt),this.now());
      this.db.prepare("INSERT INTO employees(id,branch_id,login,name,role,status,password_hash,must_change,created_at) VALUES(?,?,?,?,'OWNER','ACTIVE',?,0,?)").run(id,c.branchId,login,input.name.trim(),hash,this.now());
      audit(this.db,{id,branchId:c.branchId},'activation.completed',c.registrationId,null,this.now(),{instanceId:c.instanceId,organizationId:c.organizationId});
      outbox(this.db,c.branchId,'activation.completed',{instanceId:c.instanceId,registrationId:c.registrationId,ownerEmployeeId:id},this.now());
      return {branchId:c.branchId,alreadyActivated:false};
    }).immediate();
  }
  async activateCloudOwner(proof:unknown,input:{email:string;ownerCloudId:string},expectedNonce:string) {
    const receipt=this.verifyReceipt(proof,false);
    requireCondition(receipt.claims.nonce===expectedNonce && receipt.claims.ownerCloudId===input.ownerCloudId,'ACTIVATION_NONCE_MISMATCH');
    const untilIssued=receipt.claims.issuedAt-this.now();
    requireCondition(untilIssued<=5000,'ACTIVATION_CLOCK_MISMATCH',503);
    if(untilIssued>0)await new Promise(resolve=>setTimeout(resolve,untilIssued+20));
    this.verifyReceipt(receipt,true);
    const email=input.email.trim().toLowerCase();
    requireCondition(email.length>3&&email.length<=320&&email.includes('@'),'INVALID_EMAIL');
    const unavailablePassword=await hashPassword(randomBytes(32).toString('base64url'));
    return this.db.transaction(()=>{
      const binding=this.binding();
      if(binding){requireCondition(this.db.prepare('SELECT 1 FROM activation WHERE registration_id=? AND proof=?').get(receipt.claims.registrationId,canonical(receipt)),'ALREADY_ACTIVATED');return {branchId:binding.branchId,alreadyActivated:true};}
      const c=this.verifyReceipt(receipt,true).claims,id=randomUUID();
      requireCondition(!this.db.prepare('SELECT 1 FROM employees LIMIT 1').get(),'ACTIVATION_DATABASE_NOT_EMPTY');
      this.db.prepare('INSERT INTO activation VALUES(1,?,?,?,?,?,?,?)').run(c.instanceId,c.branchId,c.organizationId,c.ownerCloudId,c.registrationId,canonical(receipt),this.now());
      this.db.prepare("INSERT INTO employees(id,branch_id,login,name,role,status,password_hash,must_change,created_at) VALUES(?,?,?,?,'OWNER','ACTIVE',?,0,?)").run(id,c.branchId,'owner-'+id,email,unavailablePassword,this.now());
      this.db.prepare('INSERT INTO owner_cloud_auth VALUES(?,?,?,?)').run(id,c.ownerCloudId,email,this.now());
      audit(this.db,{id,branchId:c.branchId},'activation.completed',c.registrationId,null,this.now(),{instanceId:c.instanceId,organizationId:c.organizationId});
      outbox(this.db,c.branchId,'activation.completed',{instanceId:c.instanceId,registrationId:c.registrationId,ownerEmployeeId:id},this.now());
      return {branchId:c.branchId,alreadyActivated:false};
    }).immediate();
  }
}
