import {MenuSyncService} from './modules/menu/menu-sync-service';
import {CloudMenuTransport,type MenuTransport} from './modules/menu/cloud-menu-transport';
import {PrintService} from './modules/printing/print-service';
import type {PrintAdapter} from './modules/printing/windows-adapter';
import {NetworkService} from './modules/waiter/network-service';
import {WaiterService} from './modules/waiter/waiter-service';
import {createWaiterServer} from './modules/waiter/web-server';
import Fastify from 'fastify';
import { readFileSync, writeFileSync, renameSync, lstatSync, realpathSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
import { join, resolve } from 'node:path';
import pino from 'pino';
import { Storage, type State } from './storage';
import { registerApi, type OperationalServices } from './api';
import { PosError, requireCondition } from './errors';
import { CommandBus } from './command-bus';
import { AuthService } from './modules/auth/auth-service';
import { MenuService } from './modules/menu/menu-service';
import {entityId} from './modules/menu/catalog';
import { ShiftService } from './modules/shifts/shift-service';
import { ActivationService, type ActivationAuthority, type ProtectedDeviceIdentity } from './modules/activation/activation-service';
import { CloudActivation, type CloudConfig } from './modules/activation/cloud-activation';
import type { SigningDeviceIdentity } from './modules/activation/platform-device';
import { FinanceService } from './modules/orders/finance-service';
import { OrderService } from './modules/orders/order-service';
import { PinService } from './modules/auth/pin-service';
import { CloudOwnerAuth } from './modules/auth/cloud-owner-auth';
import { PlatformPinKeys, type PinKeys } from './modules/auth/pin-crypto';
import { TableService } from './modules/tables/table-service';
import { TableCloudSyncService } from './modules/tables/table-cloud-sync-service';
import { AnalyticsSyncService } from './modules/analytics/analytics-sync-service';
import { ShiftCloudDelivery } from './modules/shifts/shift-cloud-delivery';
import {buildOverviewMetrics} from './modules/analytics/overview-metrics';
import {buildProductMetrics} from './modules/analytics/product-metrics';
import {createRealtime} from './realtime';
import {scopeForCommand} from './realtime-scope';
import { MaintenanceGate } from './recovery/maintenance-gate';
import { createBackupSet, verifyBackupSet, windowsBackupProtector, type KeyProtector } from './recovery/backup-set';
import { startUpdateControl } from './recovery/update-control';
import { UpdateJournal } from './recovery/update-journal';
import { verifyBackupRestore, withVerifiedBackupRestore } from './recovery/backup-acceptance';
import { assertBusinessUnchanged } from './recovery/update-data-restore';

type MaintenanceBackup = { backupRoot: string; softwareVersion: string; protector?: KeyProtector; testMemoryHelper?: string };
export type MaintenanceResult = { state: 'MAINTENANCE_READY'; schemaVersion: number | null; backupCandidate: { operationId: string; path: string; verified: true }; restoreChecked?: { operationId: string; instanceId: string; registrationId: string | null; schemaVersion: number; pinCount: number; verified: true } };

export async function createServer(dir: string, port: number, listen = true, trust?: {authority:ActivationAuthority;device:ProtectedDeviceIdentity;cloud?:CloudConfig;network?:typeof fetch;pinKeys?:PinKeys;webKeys?:PinKeys;tlsKeys?:PinKeys;printAdapter?:PrintAdapter;fixtureLoopback?:boolean;menuSyncTransport?:MenuTransport;tableSyncTransport?:MenuTransport;analyticsSyncTransport?:MenuTransport;shiftCloudTransport?:MenuTransport;waiterHttp?:{ip:string;port:number};maintenanceGate?:MaintenanceGate;maintenanceBackup?:MaintenanceBackup;updateControl?:{configDir:string;socketPath:string};recoveryQuarantine?:boolean;registerMaintenanceControl?:(prepare:()=>Promise<MaintenanceResult>)=>void}) {
  const log = pino({ base: { component: 'local-server' }, level: 'info' });
  const storage = new Storage(dir);
  const status: { state: State | 'STOPPING'; reason: string; schemaVersion: number | null } = storage.open();
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const maintenance = trust?.maintenanceGate ?? new MaintenanceGate();
  if (trust?.recoveryQuarantine) maintenance.enterRecoveryQuarantine();
  maintenance.install(app);
  let operations:OperationalServices|undefined;
  const realtime=createRealtime(app.server,()=>operations?.auth);
  let bus:CommandBus|undefined;
  let activation:ActivationService|undefined;
  let cloud:CloudActivation|undefined;
  let menuSyncRuntime:MenuSyncService|undefined;
  let tableSyncRuntime:TableCloudSyncService|undefined;
  let analyticsSyncRuntime:AnalyticsSyncService|undefined;
  let shiftCloudRuntime:ShiftCloudDelivery|undefined;
  let printRuntime:PrintService|undefined;
  let web:Awaited<ReturnType<typeof createWaiterServer>>|undefined;
  let clients=Promise.resolve();let stopping=false;
  let control: Awaited<ReturnType<typeof startUpdateControl>> | undefined;
  const reloadWeb=()=>{clients=clients.catch(()=>{}).then(async()=>{web?.server.closeAllConnections();await web?.close();web=undefined;if(stopping||trust?.recoveryQuarantine||!operations?.waiterNetwork)return;const n=operations.waiterNetwork;try{if(n.httpConfigInvalid){n.runtimeStatus={listening:false,code:'WEB_HTTP_CONFIG_INVALID'};return;}if(!n.http&&!n.current()){n.runtimeStatus={listening:false,code:'WEB_UNCONFIGURED'};return;}web=await createWaiterServer(operations,new WaiterService(operations,trust?.webKeys??new PlatformPinKeys(dir,'web')),n,{listen,printStatus:(t,id)=>operations!.printing!.statusForOrder(t,id),maintenanceGate:maintenance});n.runtimeStatus={listening:listen,code:listen?(n.http?'WEB_HTTP_READY':'WEB_READY'):'WEB_TEST_LISTENER'};}catch(error){const code=error instanceof PosError&&['CERTIFICATE_EXPIRED','PROTECTED_WEB_KEY_INVALID','PIN_KEYS_UNAVAILABLE'].includes(error.code)?error.code:(error as {code?:string}).code==='EADDRNOTAVAIL'?'WEB_INTERFACE_UNAVAILABLE':(error as {code?:string}).code==='EADDRINUSE'?'WEB_PORT_IN_USE':'WEB_LISTENER_UNAVAILABLE';n.runtimeStatus={listening:false,code};}});return clients;};
  const enable=()=>{
    storage.assertIdentity();const binding=activation!.binding();
    if(binding&&!operations){bus=new CommandBus(storage.connection(),Date.now,64,()=>storage.assertIdentity());bus.onCommit=(branchId,type)=>{realtime.publish(branchId,scopeForCommand(type));web?.server.emit('bashkar:changed',branchId);shiftCloudRuntime?.wake();};const auth=new AuthService(storage.connection(),bus,binding.branchId,Date.now,()=>storage.assertIdentity());const menu=new MenuService(storage.connection(),bus,auth),tables=new TableService(storage.connection(),bus,auth);const orders=new OrderService(storage.connection(),bus,auth,menu,tables);operations={finance:new FinanceService(orders),auth,cashDraftChanged:()=>realtime.publish(binding.branchId,'drafts'),pins:new PinService(auth,trust?.pinKeys??new PlatformPinKeys(dir)),menu,tables,shifts:new ShiftService(storage.connection(),bus,auth),orders};if(trust?.cloud){const ownerCloud=new CloudOwnerAuth(auth,trust.cloud,trust.network);operations.ownerCloud=ownerCloud;auth.cloudOwnerProve=(email,password,employee)=>ownerCloud.prove(email,password,employee);}const identity=storage.connection().prepare('SELECT branch_id AS branchId,instance_id AS instanceId,registration_id AS registrationId FROM activation WHERE singleton=1').get() as {branchId:string;instanceId:string;registrationId:string};try{const display=JSON.parse(readFileSync(join(dir,'branch-display.json'),'utf8'));if(display.branchId===identity.branchId&&display.registrationId===identity.registrationId&&typeof display.name==='string'&&display.name.trim()&&display.name.length<=120)operations.branchDisplayName=display.name.trim();operations.finance.branchDisplayName=display.name.trim();}catch{/* Existing installations keep the verified branch ID fallback. */}const config=trust?.cloud?.menuSync;const remote=trust?.menuSyncTransport??(config&&config.enabled!==false&&typeof (trust?.device as SigningDeviceIdentity)?.sign==='function'?new CloudMenuTransport({url:trust!.cloud!.url,publishableKey:trust!.cloud!.publishableKey,publicKey:config.publicKey,keyId:config.keyId},identity,trust!.device as SigningDeviceIdentity,trust?.network):undefined);if(trust?.cloud&&typeof (trust.device as SigningDeviceIdentity).sign==='function')operations.menuPhotoGrant=(token,itemId,expectedRevision,operation)=>{const categoryMedia=typeof itemId==='string'&&itemId.startsWith('public_cat_');const siteMedia=itemId==='public_logo'||itemId==='public_banner'||categoryMedia;const actor=auth.current(token,siteMedia?undefined:'menu.edit');if(categoryMedia)entityId(itemId.slice(11));else entityId(itemId);requireCondition(!siteMedia||operation==='READ'||actor.role==='OWNER','PERMISSION_DENIED',403);requireCondition(operation==='READ'||operation==='UPLOAD'||operation==='REMOVE','INVALID_OPERATION');requireCondition(Number.isSafeInteger(expectedRevision)&&expectedRevision>=0,'INVALID_REVISION');requireCondition(!categoryMedia||menu.active(token).catalog?.categories.some(category=>category.id===itemId.slice(11)&&!category.archived),'PHOTO_ITEM_UNPUBLISHED',409);requireCondition(siteMedia||menu.active(token).catalog?.items.some(item=>item.id===itemId&&!item.archived),'PHOTO_ITEM_UNPUBLISHED',409);const device=trust.device as SigningDeviceIdentity;device.assertAvailable();const payload={branchId:actor.branchId,instanceId:identity.instanceId,registrationId:identity.registrationId,actorId:actor.id,itemId,expectedRevision,operation,nonce:randomUUID(),expiresAt:Date.now()+60000};const grant=Buffer.from(JSON.stringify({payload,publicKey:device.publicKey(),signature:device.sign(JSON.stringify(payload))})).toString('base64url');return {grant,mediaUrl:trust.cloud!.url+'/functions/v1/menu-photo',publishableKey:trust.cloud!.publishableKey};};menuSyncRuntime=operations.menuSync=new MenuSyncService(menu,remote);menuSyncRuntime.onApplied=()=>{realtime.publish(binding.branchId,'menu');web?.server.emit('bashkar:changed',binding.branchId);};if(!trust?.recoveryQuarantine)menuSyncRuntime.start();const tableRemote=trust?.tableSyncTransport??(trust?.cloud&&config&&config.enabled!==false&&typeof (trust.device as SigningDeviceIdentity).sign==='function'?new CloudMenuTransport({url:trust.cloud.url,publishableKey:trust.cloud.publishableKey,publicKey:config.publicKey,keyId:config.keyId},identity,trust.device as SigningDeviceIdentity,trust.network):undefined);tableSyncRuntime=operations.tableCloudSync=new TableCloudSyncService(tables,tableRemote,Date.now,trust?.cloud?.publicMenuBaseUrl);if(!trust?.recoveryQuarantine)tableSyncRuntime.start();analyticsSyncRuntime=new AnalyticsSyncService(storage.connection(),bus!,binding.branchId,trust?.analyticsSyncTransport??remote);operations.analyticsOverview=(from,to,granularity)=>buildOverviewMetrics(storage.connection(),binding.branchId,{from,to,timeZone:'Asia/Bishkek',granularity});operations.analyticsProducts=(from,to)=>buildProductMetrics(storage.connection(),binding.branchId,{from,to});operations.analyticsSyncStatus=()=>analyticsSyncRuntime!.status();if(!trust?.recoveryQuarantine)analyticsSyncRuntime.start();shiftCloudRuntime=new ShiftCloudDelivery(storage.connection(),bus!,binding.branchId,trust?.shiftCloudTransport??remote);operations.shiftCloudStatus=()=>shiftCloudRuntime!.status();if(!trust?.recoveryQuarantine)shiftCloudRuntime.start();printRuntime=operations.printing=new PrintService(operations.finance,trust?.printAdapter);printRuntime.onStatusChanged=()=>realtime.publish(binding.branchId,'print');let savedHttp:{ip:string;port:number}|undefined;const httpPath=join(dir,'waiter-http.json');if(!trust?.waiterHttp)try{const saved=JSON.parse(readFileSync(httpPath,'utf8'));if(saved.branchId===identity.branchId)savedHttp={ip:saved.ip,port:saved.port};}catch{/* An absent configuration keeps the waiter listener disabled. */}const saveHttp=trust?.waiterHttp?undefined:(value:{ip:string;port:number}|null)=>{if(!value)return;const temp=httpPath+'.new';writeFileSync(temp,JSON.stringify({branchId:identity.branchId,...value}),{mode:0o600,flush:true});renameSync(temp,httpPath);};operations.waiterNetwork=new NetworkService(auth,trust?.tlsKeys??new PlatformPinKeys(dir,'tls'),trust?.fixtureLoopback,trust?.waiterHttp??savedHttp,saveHttp);operations.waiterNetwork.onChange=reloadWeb;if(!trust?.recoveryQuarantine){clients=clients.then(()=>operations!.printing!.start());void reloadWeb();}}
  };
  if(status.state==='NEEDS_ACTIVATION' && trust) {
    activation=new ActivationService(storage.connection(),trust.authority,trust.device);
    try {
      enable();
      if(trust.cloud)cloud=new CloudActivation(trust.cloud,trust.device as SigningDeviceIdentity,activation,dir,()=>{requireCondition(status.state!=='BLOCKED','SERVER_BLOCKED',503);storage.assertIdentity();},enable,trust.network);
    } catch {status.state='BLOCKED';status.reason='ACTIVATION_VALIDATION_FAILED';}
  }
  registerApi(app,()=>{if(operations){try{storage.assertIdentity();}catch{operations=undefined;status.state='BLOCKED';status.reason='STORAGE_IDENTITY_CHANGED';}}if(!operations)throw new PosError(status.state==='BLOCKED'?'SERVER_BLOCKED':'ACTIVATION_REQUIRED',503);return operations;},(code)=>{operations=undefined;status.state='BLOCKED';status.reason=code;});
  app.get('/api/v1/activation/status',async()=>({configured:!!cloud&&status.state!=='BLOCKED',activated:!!operations}));
  app.post('/api/v1/activation/start',async request=>{if(!cloud)throw new PosError('CLOUD_REGISTRATION_UNAVAILABLE',503);return cloud.login(request.body);});
  app.post('/api/v1/activation/complete',async request=>{if(!cloud)throw new PosError('CLOUD_REGISTRATION_UNAVAILABLE',503);return cloud.complete(request.body);});
  app.get('/api/v1/system/health/live', async () => ({ status: 'live' }));
  app.get('/api/v1/system/health/ready', async (_request, reply) => {
    if(operations)try{storage.assertIdentity();}catch{operations=undefined;status.state='BLOCKED';status.reason='STORAGE_IDENTITY_CHANGED';}
    return reply.code(operations?200:503).send({ ready: !!operations, state: operations?'READY':status.state, code: operations?'OPERATIONAL':status.reason });
  });
  app.get('/api/v1/system/version', async () => ({ server: '0.16.0-order-cards', releaseVersion: trust?.maintenanceBackup?.softwareVersion ?? null, api: 'v1', schema: status.schemaVersion, capabilities: status.schemaVersion!==null&&status.schemaVersion>=12?['settlements','counter','corrections','sales24h','paymentIncidents','refunds','shiftClose','shiftReports','financialCases','waiterWeb','printDispatch','ownerCloudLogin','menuSync',...(status.schemaVersion>=13?['sharedOrderNumbers']:[]),...(status.schemaVersion>=14?['unassignedHall','customAmountItems','itemFulfillment']:[]),...(status.schemaVersion>=15?['visitAssignments','atomicCheckout']:[]),...(status.schemaVersion>=16?['cashDrafts']:[]),...(status.schemaVersion>=17?['cashDraftCreationTime']:[]),...(status.schemaVersion>=19?['rolePermissionMatrix']:[])]:[] }));
  app.addHook('preClose',async()=>{realtime.close();});
  app.addHook('onClose', async () => { status.state = 'STOPPING';stopping=true;await control?.close();await clients;await web?.close();await printRuntime?.stop();await menuSyncRuntime?.stop();await tableSyncRuntime?.stop();await analyticsSyncRuntime?.stop();await shiftCloudRuntime?.stop();await bus?.drain(); storage.close(); log.info({ event: 'stopped' }); });
  // Called in-process by a future authenticated Update Manager transport.
  // It does not create the startup guard or authorize an installer by itself.
  const prepareMaintenance = async () => {
    if (!trust?.maintenanceBackup) throw new PosError('MAINTENANCE_BACKUP_UNAVAILABLE', 503);
    const backupConfig = trust.maintenanceBackup;
    if (process.platform === 'win32' && (backupConfig.protector || backupConfig.testMemoryHelper)) throw new PosError('RECOVERY_PROTECTION_REQUIRED', 503);
    const protector = backupConfig.protector ?? windowsBackupProtector();
    const idle = maintenance.begin();
    let stoppingBackground = false;
    try {
      await idle;
      if (status.state === 'BLOCKED') throw new PosError('SERVER_BLOCKED', 503);
      const db = storage.connection();
      storage.assertIdentity();
      if (db.prepare("SELECT 1 FROM shifts WHERE status='OPEN' LIMIT 1").get()) throw new PosError('MAINTENANCE_OPEN_SHIFT', 409);
      await clients;
      stoppingBackground = true;
      await web?.close(); web = undefined;
      realtime.close();
      await printRuntime?.stop();
      await menuSyncRuntime?.stop();
      await tableSyncRuntime?.stop();
      await analyticsSyncRuntime?.stop();
      await shiftCloudRuntime?.stop();
      await bus?.drain();
      storage.assertIdentity();
      if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new PosError('MAINTENANCE_DATABASE_INVALID', 503);
      if (db.prepare("SELECT 1 FROM shifts WHERE status='OPEN' LIMIT 1").get()) throw new PosError('MAINTENANCE_OPEN_SHIFT', 409);
      const candidate = await createBackupSet(dir, backupConfig.backupRoot, db, protector, backupConfig.softwareVersion, backupConfig.testMemoryHelper);
      const verified = await verifyBackupSet(candidate.path, protector);
      if (!verified.verified || verified.operationId !== candidate.operationId) throw new PosError('RECOVERY_BACKUP_INVALID', 503);
      const instance = db.prepare('SELECT id FROM bootstrap_instance').get() as { id: string };
      const registration = db.prepare('SELECT registration_id AS registrationId FROM activation WHERE singleton=1').get() as { registrationId: string } | undefined;
      const restoreChecked = await verifyBackupRestore({ path: candidate.path, backupOperationId: candidate.operationId,
        schemaVersion: status.schemaVersion!, expectedIdentity: { instanceId: instance.id, registrationId: registration?.registrationId ?? null }, protector });
      await maintenance.ready();
      return { state: 'MAINTENANCE_READY' as const, schemaVersion: status.schemaVersion, backupCandidate: { operationId: candidate.operationId, path: candidate.path, verified: true as const }, restoreChecked };
    } catch (error) {
      // A failed preflight can reopen normally. Once stopping begins, retain
      // the gate and require a service restart instead of assuming recovery.
      if (!stoppingBackground) maintenance.cancel();
      throw error;
    }
  };
  trust?.registerMaintenanceControl?.(prepareMaintenance);
  await clients;
  try {
    if (trust?.updateControl) {
      if (!trust.maintenanceBackup) throw new Error('MAINTENANCE_BACKUP_UNAVAILABLE');
      control = await startUpdateControl(trust.updateControl.configDir, trust.updateControl.socketPath, operationId => {
        const row = new UpdateJournal(trust.updateControl!.configDir, trust.maintenanceBackup!.backupRoot).read();
        if (!row || row.operationId !== operationId || row.phase !== 'WAITING_FOR_MAINTENANCE')
          throw new Error('UPDATE_OPERATION_STATE_INVALID');
        return prepareMaintenance();
      }, async (operationId, result) => {
        const row = new UpdateJournal(trust.updateControl!.configDir, trust.maintenanceBackup!.backupRoot).read();
        if (!row || row.operationId !== operationId || row.phase !== 'WAITING_FOR_MAINTENANCE')
          throw new Error('UPDATE_OPERATION_STATE_INVALID');
        const backupConfig = trust.maintenanceBackup!;
        if (process.platform === 'win32' && (backupConfig.protector || backupConfig.testMemoryHelper)) throw new Error('RECOVERY_PROTECTION_REQUIRED');
        if (resolve(realpathSync(result.backupCandidate.path), '..') !== resolve(realpathSync(backupConfig.backupRoot)))
          throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID');
        const protector = backupConfig.protector ?? windowsBackupProtector();
        const gate = maintenance.isPending ? maintenance.waitForIdle() : maintenance.begin();
        await gate;
        await clients;
        await web?.close(); web = undefined;
        realtime.close();
        await printRuntime?.stop();
        await menuSyncRuntime?.stop();
        await tableSyncRuntime?.stop();
        await analyticsSyncRuntime?.stop();
        await shiftCloudRuntime?.stop();
        await bus?.drain();
        storage.assertIdentity();
        const db = storage.connection();
        if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length)
          throw new Error('MAINTENANCE_DATABASE_INVALID');
        if (status.schemaVersion !== result.schemaVersion || db.prepare("SELECT 1 FROM shifts WHERE status='OPEN' LIMIT 1").get())
          throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID');
        const instance = db.prepare('SELECT id FROM bootstrap_instance').get() as { id: string };
        const registration = db.prepare('SELECT registration_id AS registrationId FROM activation WHERE singleton=1').get() as { registrationId: string } | undefined;
        const expectedIdentity = { instanceId: instance.id, registrationId: registration?.registrationId ?? null };
        if (!result.restoreChecked || result.restoreChecked.instanceId !== expectedIdentity.instanceId ||
            result.restoreChecked.registrationId !== expectedIdentity.registrationId) throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID');
        const checked = await withVerifiedBackupRestore({ path: result.backupCandidate.path,
          backupOperationId: result.backupCandidate.operationId, schemaVersion: result.schemaVersion!, expectedIdentity, protector }, files => {
          const sqlite = files.get('pos.sqlite');
          if (!sqlite) throw new Error('RECOVERY_PREREQUISITE_MISSING');
          assertBusinessUnchanged(dir, sqlite);
          for (const [name, bytes] of files) {
            if (name === 'pos.sqlite') continue;
            const file = join(dir, name), stat = lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !readFileSync(file).equals(bytes))
              throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID');
          }
        });
        if (checked.pinCount !== result.restoreChecked.pinCount) throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID');
      });
    }
    if (listen) await app.listen({ host: '127.0.0.1', port });
  } catch (error) { await control?.close(); storage.close(); throw error; }
  log.info({ event: 'started', state: operations?'READY':status.state, code: operations?'OPERATIONAL':status.reason });
  return app;
}
