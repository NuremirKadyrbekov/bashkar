import {afterEach,expect,it} from 'vitest';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical} from '../src/command-bus';
import {verifySignedRelease,type ReleaseManifest} from '../src/recovery/release-verifier';
import {verifyUpdateInstallGrant,type InstallGrantClaims} from '../src/recovery/update-authorization';
import {UpdateJournal} from '../src/recovery/update-journal';
import {prepareAuthorizedUpdate,prepareSignedUpdate,verifyWindowsAuthenticode} from '../src/recovery/update-manager';
import {readUpdateJob,writeUpdateJob} from '../src/recovery/update-job';
import {planManagerResume,runManagerStep,migrateOrRecoverBeforeIntent,reconcileMaintenanceReceipt} from '../src/recovery/manager-coordinator';
import {runDurableMaintenance} from '../src/recovery/maintenance-receipt';
import {runManagerOperation} from '../src/recovery/manager-runner';
import {productionManagerHandlers} from '../src/recovery/manager-production-handlers';
import {localServiceManagerHandlers} from '../src/recovery/manager-local-service';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'bashkar-manager-'));roots.push(root);
 const config=join(root,'config'),backups=join(root,'backups'),artifactName='Bashkar-POS-Setup-0.2.0.exe',artifactPath=join(root,artifactName),contents=Buffer.from('signed-installer-fixture');
 mkdirSync(config,{mode:0o700});mkdirSync(backups,{mode:0o700});writeFileSync(artifactPath,contents);
 const hash=createHash('sha256').update(contents).digest('hex'),publisher=generateKeyPairSync('ed25519'),cloud=generateKeyPairSync('ed25519');
 const manifest:ReleaseManifest={format:1,releaseId:'rel_manager_020',version:'0.2.0',gitCommit:'a'.repeat(40),keyId:'publisher_test',platform:{os:'win32',arch:'x64'},compatibility:{minSourceVersion:'0.1.0',maxSourceVersion:'0.1.0',minAgentVersion:'0.1.0',minSchema:26,maxSchema:26,targetSchema:26,migrationVersions:[]},artifact:{fileName:artifactName,sizeBytes:contents.length,sha256:hash},minFreeBytes:0};
 const signedRelease={manifest,signature:sign(null,Buffer.from(canonical(manifest)),publisher.privateKey).toString('base64url')};
 const releaseTrust={keyId:'publisher_test',publicKey:publisher.publicKey.export({type:'spki',format:'pem'}).toString()};
 const installed={appVersion:'0.1.0',agentVersion:'0.1.0',schemaVersion:26,os:'win32',arch:'x64',freeBytes:1};
 const release=verifySignedRelease(signedRelease,releaseTrust,installed);
 const operationId=randomUUID(),actorId=randomUUID(),branchId=randomUUID(),identity={branchId,instanceId:randomUUID(),registrationId:randomUUID()},now=Date.now();
 const actor={id:actorId,branchId,role:'OWNER',audience:'LOCAL_ADMIN',method:'CLOUD_OWNER'};
 const claims:InstallGrantClaims={format:1,action:'INSTALL',keyId:'cloud_test',operationId,...identity,actorId,releaseId:manifest.releaseId,manifestSha256:release.manifestSha256,artifactSha256:hash,issuedAt:now,expiresAt:now+60000,nonce:randomUUID(),requiresClosedShift:true,requiresBackup:true};
 const signedGrant={claims,signature:sign(null,Buffer.from(canonical(claims)),cloud.privateKey).toString('base64url')};
 const cloudTrust={keyId:'cloud_test',publicKey:cloud.publicKey.export({type:'spki',format:'pem'}).toString()};
 const authorization=verifyUpdateInstallGrant(signedGrant,cloudTrust,identity,actor,release,operationId,now);
 return {root,config,backups,artifactPath,contents,authorization,operationId,journal:new UpdateJournal(config,backups),signedRelease,signedGrant,releaseTrust,cloudTrust,identity,actor,installed};
}
const signerCertificateSha256='b'.repeat(64);
it('assigns a fixed production handler to every nonterminal Manager action',()=>{
 const f=fixture();writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);
 const handlers=productionManagerHandlers({configDir:f.config,backupRoot:f.backups,updatesDir:f.root,dataDir:join(f.root,'data'),
  versionPath:join(f.root,'Bashkar POS','server','version.json')},
  {agentVersion:'0.1.0',releaseTrust:f.releaseTrust,cloudTrust:f.cloudTrust,signerCertificateSha256},f.journal);
 for(const action of ['PREPARE_NEW_OPERATION','RECONCILE_MAINTENANCE','VERIFY_BACKUP_WITH_LOCAL_SERVICE','QUIESCE_SERVICE',
  'STAGE_AND_SWITCH_BINARY','RECOVER_BINARY_BEFORE_MIGRATION','VERIFY_PRE_MIGRATION_DATA_WITH_LOCAL_SERVICE',
  'MIGRATE_NEW_BINARY','RESTORE_DATA_WITH_LOCAL_SERVICE','RESTORE_OLD_BINARY','VERIFY_OLD_INSTALL_WITH_LOCAL_SERVICE',
  'START_GUARDED_SERVICE_PROBE','FINALIZE_RESTORED_INSTALL','VERIFY_NEW_INSTALL_PRESTART',
  'START_NEW_SERVICE_PROBE','FINALIZE_NEW_INSTALL']) expect(handlers[action as keyof typeof handlers]).toBeTypeOf('function');
});
it.skipIf(process.platform === 'win32')('resumes the same journal operation under one Manager lock after a bounded interruption',async()=>{
 const f=fixture(),backupId=randomUUID(),path=join(f.backups,backupId);mkdirSync(path,{mode:0o700});writeFileSync(join(path,'manifest.json'),'{}');
 writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);
 const job=readUpdateJob(f.config)!,lockPath=join(f.root,'manager.sock');
 let preparations=0;
 const result={state:'MAINTENANCE_READY' as const,schemaVersion:26,
  backupCandidate:{operationId:backupId,path,verified:true as const},
  restoreChecked:{operationId:backupId,instanceId:f.identity.instanceId,registrationId:f.identity.registrationId,
   schemaVersion:26,pinCount:0,verified:true as const}};
 await expect(runManagerOperation({journal:f.journal,configDir:f.config,job,lockPath,maxSteps:2,handlers:{
  PREPARE_NEW_OPERATION:async operationId=>{expect(operationId).toBe(f.operationId);f.journal.start(f.authorization);
   await runDurableMaintenance(f.config,operationId,async()=>{preparations++;return result;},async()=>{});},
  RECONCILE_MAINTENANCE:async operationId=>{await reconcileMaintenanceReceipt(f.journal,f.config,operationId,async()=>result);}
 }})).rejects.toThrow('UPDATE_MANAGER_STEP_LIMIT');
 expect(f.journal.read()?.phase).toBe('BACKUP_CANDIDATE');
 await expect(runManagerOperation({journal:f.journal,configDir:f.config,job,lockPath,maxSteps:1,handlers:{
  VERIFY_BACKUP_WITH_LOCAL_SERVICE:operationId=>{f.journal.recordBackupVerified(operationId,backupId,26);}
 }})).rejects.toThrow('UPDATE_MANAGER_STEP_LIMIT');
 expect(f.journal.read()?.phase).toBe('BACKUP_VERIFIED');
 expect(preparations).toBe(1);
});
it('reconciles a completed maintenance receipt into a candidate without repeating preparation',async()=>{
 const f=fixture(),backupId=randomUUID(),path=join(f.backups,backupId);mkdirSync(path,{mode:0o700});writeFileSync(join(path,'manifest.json'),'{}');
 writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);f.journal.start(f.authorization);
 const job=readUpdateJob(f.config)!;
 expect(planManagerResume({journal:f.journal,configDir:f.config,job}).action).toBe('MANUAL_RECONCILIATION_REQUIRED');
 let prepared=0;
 await runDurableMaintenance(f.config,f.operationId,async()=>{prepared++;return {state:'MAINTENANCE_READY',schemaVersion:26,
  backupCandidate:{operationId:backupId,path,verified:true},restoreChecked:{operationId:backupId,instanceId:f.identity.instanceId,
   registrationId:f.identity.registrationId,schemaVersion:26,pinCount:0,verified:true}};},async()=>{});
 expect(planManagerResume({journal:f.journal,configDir:f.config,job}).action).toBe('RECONCILE_MAINTENANCE');
 expect((await runManagerStep({journal:f.journal,configDir:f.config,job,
  handlers:{RECONCILE_MAINTENANCE:async operationId=>{await reconcileMaintenanceReceipt(f.journal,f.config,operationId,
   async()=>({state:'MAINTENANCE_READY',schemaVersion:26,backupCandidate:{operationId:backupId,path,verified:true},
    restoreChecked:{operationId:backupId,instanceId:f.identity.instanceId,registrationId:f.identity.registrationId,
     schemaVersion:26,pinCount:0,verified:true}}));}}})).action)
  .toBe('VERIFY_BACKUP_WITH_LOCAL_SERVICE');
 expect(prepared).toBe(1);
 expect(f.journal.read()?.phase).toBe('BACKUP_CANDIDATE');
});
it('prepares only a verified Backup Set candidate and keeps durable intent across restart',async()=>{
 const f=fixture(),backupId=randomUUID(),path=join(f.backups,backupId);mkdirSync(path,{mode:0o700});writeFileSync(join(path,'manifest.json'),'{}');
 let checked=0,requested=0;
 const result=await prepareAuthorizedUpdate({authorization:f.authorization,artifactPath:f.artifactPath,journal:f.journal,signerCertificateSha256,verifyAuthenticode:(path,cert)=>{expect(path).toBe(f.artifactPath);expect(cert).toBe(signerCertificateSha256);checked++;},requestMaintenance:async operationId=>{requested++;expect(operationId).toBe(f.operationId);expect(new UpdateJournal(f.config,f.backups).read()?.phase).toBe('WAITING_FOR_MAINTENANCE');return {state:'MAINTENANCE_READY',schemaVersion:26,backupCandidate:{operationId:backupId,path,verified:true}};}});
 expect(checked).toBe(1);expect(requested).toBe(1);expect(result.phase).toBe('BACKUP_CANDIDATE');expect(new UpdateJournal(f.config,f.backups).read()?.phase).toBe('BACKUP_CANDIDATE');
});
it('records BACKUP_VERIFIED only for a matching restored identity from the maintenance channel',async()=>{
 const f=fixture(),backupId=randomUUID(),path=join(f.backups,backupId);mkdirSync(path,{mode:0o700});writeFileSync(join(path,'manifest.json'),'{}');
 const result=await prepareAuthorizedUpdate({authorization:f.authorization,expectedIdentity:f.identity,artifactPath:f.artifactPath,journal:f.journal,signerCertificateSha256,verifyAuthenticode:()=>{},requestMaintenance:async()=>({state:'MAINTENANCE_READY',schemaVersion:26,backupCandidate:{operationId:backupId,path,verified:true},restoreChecked:{operationId:backupId,instanceId:f.identity.instanceId,registrationId:f.identity.registrationId,schemaVersion:26,pinCount:10,verified:true}})});
 expect(result.phase).toBe('BACKUP_VERIFIED');
 expect(new UpdateJournal(f.config,f.backups).read()?.phase).toBe('BACKUP_VERIFIED');
});
it('holds a mismatched restore result for explicit recovery',async()=>{
 const f=fixture(),backupId=randomUUID(),path=join(f.backups,backupId);mkdirSync(path,{mode:0o700});writeFileSync(join(path,'manifest.json'),'{}');
 await expect(prepareAuthorizedUpdate({authorization:f.authorization,expectedIdentity:f.identity,artifactPath:f.artifactPath,journal:f.journal,signerCertificateSha256,verifyAuthenticode:()=>{},requestMaintenance:async()=>({state:'MAINTENANCE_READY',schemaVersion:26,backupCandidate:{operationId:backupId,path,verified:true},restoreChecked:{operationId:backupId,instanceId:randomUUID(),registrationId:f.identity.registrationId,schemaVersion:26,pinCount:0,verified:true}})})).rejects.toThrow('UPDATE_RESTORE_PROOF_INVALID');
 expect(f.journal.read()).toMatchObject({phase:'RECOVERY_REQUIRED',errorCode:'UPDATE_RESTORE_PROOF_INVALID'});
});
it('detects an EXE changed during Authenticode verification before writing intent or requesting maintenance',async()=>{
 const f=fixture();let requested=false;
 await expect(prepareAuthorizedUpdate({authorization:f.authorization,artifactPath:f.artifactPath,journal:f.journal,signerCertificateSha256,verifyAuthenticode:()=>{writeFileSync(f.artifactPath,Buffer.alloc(f.contents.length,0x41));},requestMaintenance:async()=>{requested=true;throw Error('UNEXPECTED');}})).rejects.toThrow('UPDATE_ARTIFACT_HASH_MISMATCH');
 expect(requested).toBe(false);expect(f.journal.read()).toBeNull();
});
it('holds the operation for recovery if maintenance IPC ends ambiguously',async()=>{
 const f=fixture();
 await expect(prepareAuthorizedUpdate({authorization:f.authorization,artifactPath:f.artifactPath,journal:f.journal,signerCertificateSha256,verifyAuthenticode:()=>{},requestMaintenance:async()=>{throw Error('UPDATE_CONTROL_CLOSED');}})).rejects.toThrow('UPDATE_CONTROL_CLOSED');
 expect(f.journal.read()).toMatchObject({phase:'RECOVERY_REQUIRED',errorCode:'UPDATE_CONTROL_CLOSED'});
 await expect(prepareAuthorizedUpdate({authorization:f.authorization,artifactPath:f.artifactPath,journal:f.journal,signerCertificateSha256,verifyAuthenticode:()=>{},requestMaintenance:async()=>{throw Error('UNEXPECTED');}})).rejects.toThrow('UPDATE_OPERATION_EXISTS');
});
it('keeps a completed LocalService receipt reconcilable after the IPC response is lost',async()=>{
 const f=fixture(),backupId=randomUUID(),path=join(f.backups,backupId);mkdirSync(path,{mode:0o700});writeFileSync(join(path,'manifest.json'),'{}');
 await expect(prepareAuthorizedUpdate({authorization:f.authorization,artifactPath:f.artifactPath,journal:f.journal,
  configDir:f.config,signerCertificateSha256,verifyAuthenticode:()=>{},requestMaintenance:async operationId=>{
   await runDurableMaintenance(f.config,operationId,async()=>({state:'MAINTENANCE_READY',schemaVersion:26,
    backupCandidate:{operationId:backupId,path,verified:true},restoreChecked:{operationId:backupId,
     instanceId:f.identity.instanceId,registrationId:f.identity.registrationId,schemaVersion:26,pinCount:0,verified:true}}),async()=>{});
   throw Error('UPDATE_CONTROL_CLOSED');
  }})).rejects.toThrow('UPDATE_CONTROL_CLOSED');
 expect(f.journal.read()?.phase).toBe('WAITING_FOR_MAINTENANCE');
 expect(planManagerResume({journal:f.journal,configDir:f.config,job:null}).action).toBe('RECONCILE_MAINTENANCE');
});
it('rejects expired grants and unsupported Authenticode context before touching the journal',async()=>{
 const f=fixture();
 await expect(prepareAuthorizedUpdate({authorization:f.authorization,artifactPath:f.artifactPath,journal:f.journal,signerCertificateSha256,now:()=>f.authorization.expiresAt,verifyAuthenticode:()=>{},requestMaintenance:async()=>{throw Error('UNEXPECTED');}})).rejects.toThrow('UPDATE_AUTHORIZATION_EXPIRED');
 expect(f.journal.read()).toBeNull();
 if(process.platform!=='win32')expect(()=>verifyWindowsAuthenticode(f.artifactPath,signerCertificateSha256)).toThrow('UPDATE_WINDOWS_REQUIRED');
 expect(readFileSync(f.artifactPath)).toEqual(f.contents);
});
it('re-verifies Cloud grant and publisher manifest at the manager boundary',async()=>{
 const f=fixture();let requested=false;
 const common={releaseTrust:f.releaseTrust,cloudTrust:f.cloudTrust,installed:f.installed,identity:f.identity,actor:f.actor,operationId:f.operationId,artifactPath:f.artifactPath,journal:f.journal,signerCertificateSha256,requestMaintenance:async()=>{requested=true;throw Error('UNEXPECTED');}};
 await expect(prepareSignedUpdate({...common,signedRelease:{...f.signedRelease,signature:'x'.repeat(86)},signedGrant:f.signedGrant})).rejects.toThrow('UPDATE_SIGNATURE_INVALID');
 await expect(prepareSignedUpdate({...common,signedRelease:f.signedRelease,signedGrant:{...f.signedGrant,signature:'x'.repeat(86)}})).rejects.toThrow('UPDATE_AUTHORIZATION_SIGNATURE_INVALID');
 await expect(prepareSignedUpdate({...common,signedRelease:f.signedRelease,signedGrant:f.signedGrant,operationId:randomUUID()})).rejects.toThrow('UPDATE_AUTHORIZATION_SCOPE_MISMATCH');
 if(process.platform!=='win32')await expect(prepareSignedUpdate({...common,signedRelease:f.signedRelease,signedGrant:f.signedGrant})).rejects.toThrow('UPDATE_PLATFORM_UNSUPPORTED');
 expect(requested).toBe(false);expect(f.journal.read()).toBeNull();
});
it('transfers only signed release and grant through a one-shot restricted job',()=>{
 const f=fixture();const stored=writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);
 expect(stored).toMatchObject({operationId:f.operationId,actorId:f.actor.id,manifestSha256:f.authorization.release.manifestSha256,grantSha256:f.authorization.grantSha256});
 expect(readUpdateJob(f.config)).toEqual(stored);
 const text=readFileSync(join(f.config,'update-job.json'),'utf8');
 expect(text).not.toContain('Bearer');expect(text).not.toContain('privateKey');expect(text).not.toContain('password');
 expect(()=>writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant)).toThrow('UPDATE_JOB_EXISTS');
 expect(()=>writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant,f.authorization.expiresAt)).toThrow('UPDATE_AUTHORIZATION_EXPIRED');
});
it('rejects extra credential fields in an update job before writing it',()=>{
 const f=fixture();expect(()=>writeUpdateJob(f.config,f.authorization,f.signedRelease,{...f.signedGrant,token:'secret'} as any)).toThrow('UPDATE_JOB_INVALID');
 expect(readUpdateJob(f.config)).toBeNull();
});
it('rejects tampered or incomplete update job before manager preparation',()=>{
 const f=fixture();writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);
 const path=join(f.config,'update-job.json');writeFileSync(path,JSON.stringify({...readUpdateJob(f.config),operationId:randomUUID()}));
 expect(()=>readUpdateJob(f.config)).toThrow('UPDATE_JOB_INVALID');
 writeFileSync(join(f.config,'.update-job-interrupted.tmp'),'{}');expect(()=>readUpdateJob(f.config)).toThrow('UPDATE_JOB_INCOMPLETE');
});

it('routes a persisted operation by journal phase without starting a new grant', () => {
 const f=fixture();
 writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);
 const job=readUpdateJob(f.config)!;
 expect(planManagerResume({journal:f.journal,configDir:f.config,job})).toMatchObject({operationId:f.operationId,phase:null,action:'PREPARE_NEW_OPERATION'});
 f.journal.start(f.authorization);
 const path=join(f.config,'update-operation.json'),backupId=randomUUID(),backupPath=join(f.backups,backupId);
 mkdirSync(backupPath,{mode:0o700});
 const original=JSON.parse(readFileSync(path,'utf8'));
 const guarded=(phase:string)=>{
  writeFileSync(join(f.config,'update-intent.json'),JSON.stringify({format:1,operationId:f.operationId,backupOperationId:backupId,phase:'GUARD_REQUESTED'}));
  writeFileSync(join(f.config,'update-guard.json'),JSON.stringify({format:1,operationId:f.operationId}));
  return phase;
 };
 const phases:[string,string][]=[
  ['BACKUP_CANDIDATE','VERIFY_BACKUP_WITH_LOCAL_SERVICE'],
  ['BACKUP_VERIFIED','QUIESCE_SERVICE'],
  [guarded('SERVICE_QUIESCED'),'STAGE_AND_SWITCH_BINARY'],
  ['BINARY_SWITCH_INTENT','RECOVER_BINARY_BEFORE_MIGRATION'],
  ['PRE_MIGRATION_RECOVERY_INTENT','RECOVER_BINARY_BEFORE_MIGRATION'],
  ['PRE_MIGRATION_BINARY_RESTORED','VERIFY_PRE_MIGRATION_DATA_WITH_LOCAL_SERVICE'],
  ['PRE_MIGRATION_DATA_VERIFIED','VERIFY_OLD_INSTALL_WITH_LOCAL_SERVICE'],
  ['BINARY_SWITCHED','MIGRATE_NEW_BINARY'],
  ['MIGRATION_INTENT','RESTORE_DATA_WITH_LOCAL_SERVICE'],
  ['MIGRATED','VERIFY_NEW_INSTALL_PRESTART'],
  ['NEW_INSTALL_PRESTART_VERIFIED','START_NEW_SERVICE_PROBE'],
  ['NEW_SERVICE_PROBE_INTENT','START_NEW_SERVICE_PROBE'],
  ['NEW_SERVICE_PROBE_HEALTHY','FINALIZE_NEW_INSTALL'],
  ['NEW_FINALIZE_INTENT','FINALIZE_NEW_INSTALL'],
  ['NEW_READY_TO_START','FINALIZE_NEW_INSTALL'],
  ['NEW_QUARANTINE_HEALTHY','FINALIZE_NEW_INSTALL'],
  ['NEW_UPDATE_COMMITTED','FINALIZE_NEW_INSTALL'],
  ['NEW_UPDATE_COMPLETED','NEW_UPDATE_COMPLETED'],
  ['MIGRATION_RECOVERY_REQUIRED','RESTORE_DATA_WITH_LOCAL_SERVICE'],
  ['DATA_RESTORE_INTENT','RESTORE_DATA_WITH_LOCAL_SERVICE'],
  ['DATA_RESTORED','RESTORE_OLD_BINARY'],
  ['OLD_BINARY_RESTORE_INTENT','RESTORE_OLD_BINARY'],
  ['OLD_BINARY_RESTORED','VERIFY_OLD_INSTALL_WITH_LOCAL_SERVICE'],
  ['OLD_INSTALL_PRESTART_VERIFIED','START_GUARDED_SERVICE_PROBE'],
  ['SERVICE_PROBE_INTENT','START_GUARDED_SERVICE_PROBE'],
  ['SERVICE_PROBE_HEALTHY','FINALIZE_RESTORED_INSTALL'],
  ['RECOVERY_FINALIZE_INTENT','FINALIZE_RESTORED_INSTALL'],
  ['RECOVERY_READY_TO_START','FINALIZE_RESTORED_INSTALL'],
  ['RECOVERY_QUARANTINE_HEALTHY','FINALIZE_RESTORED_INSTALL'],
  ['RECOVERY_COMMITTED','FINALIZE_RESTORED_INSTALL'],
  ['RECOVERY_COMPLETED','RECOVERY_COMPLETED'],
  ['RECOVERY_ACTIVATION_FAILED','MANUAL_RECONCILIATION_REQUIRED']
 ];
 for(const [phase,action] of phases){
  if(phase==='NEW_QUARANTINE_HEALTHY' || phase==='RECOVERY_QUARANTINE_HEALTHY'){
   rmSync(join(f.config,'update-intent.json'));rmSync(join(f.config,'update-guard.json'));
  }
  if(phase==='MIGRATION_RECOVERY_REQUIRED') guarded(phase);
  const errorCode=phase==='MIGRATION_RECOVERY_REQUIRED'?'UPDATE_MIGRATION_FAILED':phase==='RECOVERY_ACTIVATION_FAILED'?'UPDATE_RECOVERY_HEALTH_FAILED':null;
  writeFileSync(path,JSON.stringify({...original,phase,errorCode,backup:{operationId:backupId,path:backupPath,schemaVersion:26}}));
  const before=readFileSync(path,'utf8');
  expect(planManagerResume({journal:new UpdateJournal(f.config,f.backups),configDir:f.config,job})).toMatchObject({operationId:f.operationId,phase,action});
  expect(readFileSync(path,'utf8')).toBe(before);
 }
});

it('refuses a mismatched job or guarded phase with missing markers',()=>{
 const f=fixture();f.journal.start(f.authorization);
 const job=writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);
 expect(()=>planManagerResume({journal:f.journal,configDir:f.config,job:{...job,operationId:randomUUID()}})).toThrow('UPDATE_MANAGER_JOB_JOURNAL_MISMATCH');
 const path=join(f.config,'update-operation.json'),backupId=randomUUID();
 writeFileSync(path,JSON.stringify({...JSON.parse(readFileSync(path,'utf8')),phase:'SERVICE_QUIESCED',
  backup:{operationId:backupId,path:join(f.backups,backupId),schemaVersion:26}}));
 expect(()=>planManagerResume({journal:f.journal,configDir:f.config,job})).toThrow();
});

it('runs only the selected journal step and does not repeat preparation after an interrupted IPC',async()=>{
 const f=fixture();const job=writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);
 const result=await runManagerStep({journal:f.journal,configDir:f.config,job,handlers:{
  PREPARE_NEW_OPERATION:operationId=>{expect(operationId).toBe(f.operationId);f.journal.start(f.authorization);}
 }});
 expect(result.action).toBe('MANUAL_RECONCILIATION_REQUIRED');
 let called=false;
 await expect(runManagerStep({journal:f.journal,configDir:f.config,job,handlers:{
  PREPARE_NEW_OPERATION:()=>{called=true;}
 }})).rejects.toThrow('UPDATE_MANAGER_GATE_REQUIRED');
 expect(called).toBe(false);
 expect(f.journal.read()?.phase).toBe('WAITING_FOR_MAINTENANCE');
});

it('requires a persisted allowed transition before reporting step success',async()=>{
 const f=fixture(),job=writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);
 await expect(runManagerStep({journal:f.journal,configDir:f.config,job,handlers:{
  PREPARE_NEW_OPERATION:()=>{}
 }})).rejects.toThrow('UPDATE_MANAGER_TRANSITION_UNCONFIRMED');
 expect(f.journal.read()).toBeNull();
 f.journal.start(f.authorization);
 const path=join(f.config,'update-operation.json'),backupId=randomUUID(),backupPath=join(f.backups,backupId);
 mkdirSync(backupPath,{mode:0o700});
 writeFileSync(path,JSON.stringify({...JSON.parse(readFileSync(path,'utf8')),phase:'BACKUP_CANDIDATE',
  backup:{operationId:backupId,path:backupPath,schemaVersion:26}}));
 await expect(runManagerStep({journal:f.journal,configDir:f.config,job,handlers:{
  VERIFY_BACKUP_WITH_LOCAL_SERVICE:()=>{}
 }})).rejects.toThrow('UPDATE_MANAGER_TRANSITION_UNCONFIRMED');
 const after=await runManagerStep({journal:f.journal,configDir:f.config,job,handlers:{
  VERIFY_BACKUP_WITH_LOCAL_SERVICE:()=>{f.journal.recordBackupVerified(f.operationId,backupId,26);}
 }});
 expect(after.action).toBe('QUIESCE_SERVICE');
});

it('does not finalize a new release without the guarded completion gate',async()=>{
 const f=fixture(),job=writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);
 f.journal.start(f.authorization);
 const backupId=randomUUID(),backupPath=join(f.backups,backupId);
 mkdirSync(backupPath,{mode:0o700});
 writeFileSync(join(f.config,'update-operation.json'),JSON.stringify({...f.journal.read(),phase:'NEW_SERVICE_PROBE_HEALTHY',
  backup:{operationId:backupId,path:backupPath,schemaVersion:26}}));
 writeFileSync(join(f.config,'update-intent.json'),JSON.stringify({format:1,operationId:f.operationId,backupOperationId:backupId,phase:'GUARD_REQUESTED'}));
 writeFileSync(join(f.config,'update-guard.json'),JSON.stringify({format:1,operationId:f.operationId}));
 let called=false;
 await expect(runManagerStep({journal:f.journal,configDir:f.config,job,handlers:{
  START_NEW_SERVICE_PROBE:()=>{called=true;}
 }})).rejects.toThrow('UPDATE_MANAGER_ACTION_UNAVAILABLE');
 expect(called).toBe(false);
 expect(f.journal.read()?.phase).toBe('NEW_SERVICE_PROBE_HEALTHY');
});

it('dispatches backup and pre-migration proofs to fixed LocalService actions', async () => {
 const f=fixture(),job=writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);
 f.journal.start(f.authorization);
 const backupId=randomUUID(),backupPath=join(f.backups,backupId);
 mkdirSync(backupPath,{mode:0o700});writeFileSync(join(backupPath,'manifest.json'),'{}');
 f.journal.recordCandidate(f.operationId,{state:'MAINTENANCE_READY',schemaVersion:26,
  backupCandidate:{operationId:backupId,path:backupPath,verified:true}});
 const calls:string[]=[];
 const handlers=localServiceManagerHandlers((action,operationId)=>{
  expect(operationId).toBe(f.operationId);calls.push(action);
  if(action==='verify-backup')f.journal.recordBackupVerified(operationId,backupId,26);
  if(action==='verify-pre-migration')f.journal.recordPreMigrationDataVerified(operationId);
 });
 expect((await runManagerStep({journal:f.journal,configDir:f.config,job,handlers})).action).toBe('QUIESCE_SERVICE');
 writeFileSync(join(f.config,'update-intent.json'),JSON.stringify({format:1,operationId:f.operationId,backupOperationId:backupId,phase:'GUARD_REQUESTED'}));
 writeFileSync(join(f.config,'update-guard.json'),JSON.stringify({format:1,operationId:f.operationId}));
 const path=join(f.config,'update-operation.json');
 writeFileSync(path,JSON.stringify({...f.journal.read(),phase:'PRE_MIGRATION_BINARY_RESTORED'}));
 expect((await runManagerStep({journal:f.journal,configDir:f.config,job,handlers})).action).toBe('VERIFY_OLD_INSTALL_WITH_LOCAL_SERVICE');
 expect(calls).toEqual(['verify-backup','verify-pre-migration']);
});

it('chooses old-file recovery only when migration intent was never recorded', async () => {
 const f=fixture();f.journal.start(f.authorization);
 const backupId=randomUUID(),backupPath=join(f.backups,backupId);
 mkdirSync(backupPath,{mode:0o700});
 const path=join(f.config,'update-operation.json');
 writeFileSync(path,JSON.stringify({...f.journal.read(),phase:'BINARY_SWITCHED',
  backup:{operationId:backupId,path:backupPath,schemaVersion:26}}));
 await migrateOrRecoverBeforeIntent({journal:f.journal,operationId:f.operationId,
  migrate:()=>{throw new Error('PRECHECK_FAILED');},
  restoreOldBinary:()=>{f.journal.recordPreMigrationRecoveryIntent(f.operationId);}});
 expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_RECOVERY_INTENT');
 writeFileSync(path,JSON.stringify({...f.journal.read(),phase:'BINARY_SWITCHED'}));
 let restored=false;
 await expect(migrateOrRecoverBeforeIntent({journal:f.journal,operationId:f.operationId,
  migrate:()=>{f.journal.recordMigrationIntent(f.operationId);throw new Error('MIGRATION_FAILED');},
  restoreOldBinary:()=>{restored=true;}})).rejects.toThrow('MIGRATION_FAILED');
 expect(restored).toBe(false);
 expect(f.journal.read()?.phase).toBe('MIGRATION_INTENT');
});

it('routes post-migration restore and old-install verification through LocalService', async () => {
 const f=fixture(),job=writeUpdateJob(f.config,f.authorization,f.signedRelease,f.signedGrant);
 f.journal.start(f.authorization);
 const backupId=randomUUID(),backupPath=join(f.backups,backupId);
 mkdirSync(backupPath,{mode:0o700});
 writeFileSync(join(f.config,'update-operation.json'),JSON.stringify({...f.journal.read(),phase:'MIGRATION_INTENT',
  backup:{operationId:backupId,path:backupPath,schemaVersion:26}}));
 writeFileSync(join(f.config,'update-intent.json'),JSON.stringify({format:1,operationId:f.operationId,backupOperationId:backupId,phase:'GUARD_REQUESTED'}));
 writeFileSync(join(f.config,'update-guard.json'),JSON.stringify({format:1,operationId:f.operationId}));
 const calls:string[]=[];
 const handlers={...localServiceManagerHandlers((action,operationId)=>{
  calls.push(action);
  if(action==='restore-data'){
   f.journal.recordDataRestoreIntent(operationId);f.journal.recordDataRestored(operationId);
  }else if(action==='verify-old-install')f.journal.recordOldInstallPrestartVerified(operationId);
  else throw new Error('UNEXPECTED_LOCAL_TASK');
 }),RESTORE_OLD_BINARY:()=>{
  f.journal.recordOldBinaryRestoreIntent(f.operationId);f.journal.recordOldBinaryRestored(f.operationId);
 }};
 const step=()=>runManagerStep({journal:f.journal,configDir:f.config,job,handlers});
 expect((await step()).action).toBe('RESTORE_OLD_BINARY');
 expect((await step()).action).toBe('VERIFY_OLD_INSTALL_WITH_LOCAL_SERVICE');
 expect((await step()).action).toBe('START_GUARDED_SERVICE_PROBE');
 expect(calls).toEqual(['restore-data','verify-old-install']);
});
