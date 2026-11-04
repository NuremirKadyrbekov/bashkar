import { expect,it } from 'vitest';
import { blankFixture,password } from './fixtures/operations';
import { createServer } from '../src/server';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonical } from '../src/command-bus';
import { ActivationService } from '../src/modules/activation/activation-service';
it('waits for a signed near-future issue time without relaxing expiry or accepting a large clock mismatch',async()=>{
 const f=blankFixture(),keys=generateKeyPairSync('ed25519');try{
  const service=new ActivationService(f.db,{publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString()},f.trust.device);
  const receipt=(issuedAt:number,expiresAt:number)=>{const claims={...f.claims,issuedAt,expiresAt};return {claims,signature:sign(null,Buffer.from(canonical(claims)),keys.privateKey).toString('base64url')};};
  await expect(service.activate(receipt(Date.now()+60000,Date.now()+120000),{login:'owner',name:'Owner',password},f.claims.nonce)).rejects.toThrow('ACTIVATION_CLOCK_MISMATCH');
  await expect(service.activate(receipt(Date.now()-2000,Date.now()-1000),{login:'owner',name:'Owner',password},f.claims.nonce)).rejects.toThrow('ACTIVATION_PROOF_EXPIRED');
  const started=Date.now();await service.activate(receipt(started+150,started+60000),{login:'owner',name:'Owner',password},f.claims.nonce);
  expect(Date.now()-started).toBeGreaterThanOrEqual(150);expect(service.binding()).not.toBeNull();
 }finally{f.close();}
});
it('verifies signed device-bound registration and creates a separate local Owner atomically',async()=>{
 const f=blankFixture();try {
  await expect(f.activation.activate({...f.receipt,claims:{...f.claims,branchId:'foreign'}},{login:'owner',name:'Owner',password},f.claims.nonce)).rejects.toThrow('ACTIVATION_SIGNATURE_INVALID');
  expect(f.db.prepare('SELECT count(*) AS n FROM employees').get()).toEqual({n:0});
  await expect(f.activation.activate(f.receipt,{login:'owner',name:'Owner',password},'bad-nonce')).rejects.toThrow('ACTIVATION_NONCE_MISMATCH');
  await f.activation.activate(f.receipt,{login:'owner',name:'Owner',password},f.claims.nonce);
  expect(f.activation.binding()?.branchId).toBe(f.claims.branchId);
  f.advance(86400000);expect(f.activation.binding()).not.toBeNull(); // no online lease
  const saved=f.db.prepare('SELECT password_hash FROM employees').get();expect(JSON.stringify(saved)).not.toContain(password);
 } finally {f.close();}
});
it('rolls back activation, Owner and audit on an obligatory persistence failure',async()=>{
 const f=blankFixture();try {
  f.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'disk-test'); END;");
  await expect(f.activation.activate(f.receipt,{login:'owner',name:'Owner',password},f.claims.nonce)).rejects.toThrow('disk-test');
  expect(f.activation.binding()).toBeNull();expect(f.db.prepare('SELECT count(*) AS n FROM employees').get()).toEqual({n:0});
 }finally{f.close();}
});
it('shipped server cannot turn a forged or test database binding into READY without trusted device/authority providers',async()=>{
 const f=blankFixture();try {
  await f.activation.activate(f.receipt,{login:'owner',name:'Owner',password},f.claims.nonce);f.storage.close();
  const app=await createServer(f.dir,0,false);try{expect((await app.inject('/api/v1/system/health/ready')).statusCode).toBe(503);const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{login:'owner',password}});expect(r.statusCode).toBe(503);}finally{await app.close();}
 }finally{f.close();}
});
