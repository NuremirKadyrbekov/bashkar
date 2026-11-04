import {MenuSyncService} from './modules/menu/menu-sync-service';
import {CloudMenuTransport,type MenuTransport} from './modules/menu/cloud-menu-transport';
import {PrintService} from './modules/printing/print-service';
import type {PrintAdapter} from './modules/printing/windows-adapter';
import {NetworkService} from './modules/waiter/network-service';
import {WaiterService} from './modules/waiter/waiter-service';
import {createWaiterServer} from './modules/waiter/web-server';
import Fastify from 'fastify';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
import { join } from 'node:path';
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

export async function createServer(dir: string, port: number, listen = true, trust?: {authority:ActivationAuthority;device:ProtectedDeviceIdentity;cloud?:CloudConfig;network?:typeof fetch;pinKeys?:PinKeys;webKeys?:PinKeys;tlsKeys?:PinKeys;printAdapter?:PrintAdapter;fixtureLoopback?:boolean;menuSyncTransport?:MenuTransport;tableSyncTransport?:MenuTransport;analyticsSyncTransport?:MenuTransport;shiftCloudTransport?:MenuTransport;waiterHttp?:{ip:string;port:number}}) {
  const log = pino({ base: { component: 'local-server' }, level: 'info' });
  const storage = new Storage(dir);
  const status: { state: State | 'STOPPING'; reason: string; schemaVersion: number | null } = storage.open();
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
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
  const reloadWeb=()=>{clients=clients.catch(()=>{}).then(async()=>{web?.server.closeAllConnections();await web?.close();web=undefined;if(stopping||!operations?.waiterNetwork)return;const n=operations.waiterNetwork;try{if(n.httpConfigInvalid){n.runtimeStatus={listening:false,code:'WEB_HTTP_CONFIG_INVALID'};return;}if(!n.http&&!n.current()){n.runtimeStatus={listening:false,code:'WEB_UNCONFIGURED'};return;}web=await createWaiterServer(operations,new WaiterService(operations,trust?.webKeys??new PlatformPinKeys(dir,'web')),n,{listen,printStatus:(t,id)=>operations!.printing!.statusForOrder(t,id)});n.runtimeStatus={listening:listen,code:listen?(n.http?'WEB_HTTP_READY':'WEB_READY'):'WEB_TEST_LISTENER'};}catch(error){const code=error instanceof PosError&&['CERTIFICATE_EXPIRED','PROTECTED_WEB_KEY_INVALID','PIN_KEYS_UNAVAILABLE'].includes(error.code)?error.code:(error as {code?:string}).code==='EADDRNOTAVAIL'?'WEB_INTERFACE_UNAVAILABLE':(error as {code?:string}).code==='EADDRINUSE'?'WEB_PORT_IN_USE':'WEB_LISTENER_UNAVAILABLE';n.runtimeStatus={listening:false,code};}});return clients;};
  const enable=()=>{
    storage.assertIdentity();const binding=activation!.binding();
    if(binding&&!operations){bus=new CommandBus(storage.connection(),Date.now,64,()=>storage.assertIdentity());bus.onCommit=(branchId,type)=>{realtime.publish(branchId,scopeForCommand(type));web?.server.emit('bashkar:changed',branchId);shiftCloudRuntime?.wake();};const auth=new AuthService(storage.connection(),bus,binding.branchId,Date.now,()=>storage.assertIdentity());const menu=new MenuService(storage.connection(),bus,auth),tables=new TableService(storage.connection(),bus,auth);const orders=new OrderService(storage.connection(),bus,auth,menu,tables);operations={finance:new FinanceService(orders),auth,cashDraftChanged:()=>realtime.publish(binding.branchId,'drafts'),pins:new PinService(auth,trust?.pinKeys??new PlatformPinKeys(dir)),menu,tables,shifts:new ShiftService(storage.connection(),bus,auth),orders};if(trust?.cloud){const ownerCloud=new CloudOwnerAuth(auth,trust.cloud,trust.network);operations.ownerCloud=ownerCloud;auth.cloudOwnerProve=(email,password,employee)=>ownerCloud.prove(email,password,employee);}const identity=storage.connection().prepare('SELECT branch_id AS branchId,instance_id AS instanceId,registration_id AS registrationId FROM activation WHERE singleton=1').get() as {branchId:string;instanceId:string;registrationId:string};try{const display=JSON.parse(readFileSync(join(dir,'branch-display.json'),'utf8'));if(display.branchId===identity.branchId&&display.registrationId===identity.registrationId&&typeof display.name==='string'&&display.name.trim()&&display.name.length<=120)operations.branchDisplayName=display.name.trim();operations.finance.branchDisplayName=display.name.trim();}catch{/* Existing installations keep the verified branch ID fallback. */}const config=trust?.cloud?.menuSync;const remote=trust?.menuSyncTransport??(config&&config.enabled!==false&&typeof (trust?.device as SigningDeviceIdentity)?.sign==='function'?new CloudMenuTransport({url:trust!.cloud!.url,publishableKey:trust!.cloud!.publishableKey,publicKey:config.publicKey,keyId:config.keyId},identity,trust!.device as SigningDeviceIdentity,trust?.network):undefined);if(trust?.cloud&&typeof (trust.device as SigningDeviceIdentity).sign==='function')operations.menuPhotoGrant=(token,itemId,expectedRevision,operation)=>{const categoryMedia=typeof itemId==='string'&&itemId.startsWith('public_cat_');const siteMedia=itemId==='public_logo'||itemId==='public_banner'||categoryMedia;const actor=auth.current(token,siteMedia?undefined:'menu.edit');if(categoryMedia)entityId(itemId.slice(11));else entityId(itemId);requireCondition(!siteMedia||operation==='READ'||actor.role==='OWNER','PERMISSION_DENIED',403);requireCondition(operation==='READ'||operation==='UPLOAD'||operation==='REMOVE','INVALID_OPERATION');requireCondition(Number.isSafeInteger(expectedRevision)&&expectedRevision>=0,'INVALID_REVISION');requireCondition(!categoryMedia||menu.active(token).catalog?.categories.some(category=>category.id===itemId.slice(11)&&!category.archived),'PHOTO_ITEM_UNPUBLISHED',409);requireCondition(siteMedia||menu.active(token).catalog?.items.some(item=>item.id===itemId&&!item.archived),'PHOTO_ITEM_UNPUBLISHED',409);const device=trust.device as SigningDeviceIdentity;device.assertAvailable();const payload={branchId:actor.branchId,instanceId:identity.instanceId,registrationId:identity.registrationId,actorId:actor.id,itemId,expectedRevision,operation,nonce:randomUUID(),expiresAt:Date.now()+60000};const grant=Buffer.from(JSON.stringify({payload,publicKey:device.publicKey(),signature:device.sign(JSON.stringify(payload))})).toString('base64url');return {grant,mediaUrl:trust.cloud!.url+'/functions/v1/menu-photo',publishableKey:trust.cloud!.publishableKey};};menuSyncRuntime=operations.menuSync=new MenuSyncService(menu,remote);menuSyncRuntime.onApplied=()=>{realtime.publish(binding.branchId,'menu');web?.server.emit('bashkar:changed',binding.branchId);};menuSyncRuntime.start();const tableRemote=trust?.tableSyncTransport??(trust?.cloud&&config&&config.enabled!==false&&typeof (trust.device as SigningDeviceIdentity).sign==='function'?new CloudMenuTransport({url:trust.cloud.url,publishableKey:trust.cloud.publishableKey,publicKey:config.publicKey,keyId:config.keyId},identity,trust.device as SigningDeviceIdentity,trust.network):undefined);tableSyncRuntime=operations.tableCloudSync=new TableCloudSyncService(tables,tableRemote,Date.now,trust?.cloud?.publicMenuBaseUrl);tableSyncRuntime.start();analyticsSyncRuntime=new AnalyticsSyncService(storage.connection(),bus!,binding.branchId,trust?.analyticsSyncTransport??remote);operations.analyticsOverview=(from,to,granularity)=>buildOverviewMetrics(storage.connection(),binding.branchId,{from,to,timeZone:'Asia/Bishkek',granularity});operations.analyticsProducts=(from,to)=>buildProductMetrics(storage.connection(),binding.branchId,{from,to});operations.analyticsSyncStatus=()=>analyticsSyncRuntime!.status();analyticsSyncRuntime.start();shiftCloudRuntime=new ShiftCloudDelivery(storage.connection(),bus!,binding.branchId,trust?.shiftCloudTransport??remote);operations.shiftCloudStatus=()=>shiftCloudRuntime!.status();shiftCloudRuntime.start();printRuntime=operations.printing=new PrintService(operations.finance,trust?.printAdapter);printRuntime.onStatusChanged=()=>realtime.publish(binding.branchId,'print');let savedHttp:{ip:string;port:number}|undefined;const httpPath=join(dir,'waiter-http.json');if(!trust?.waiterHttp)try{const saved=JSON.parse(readFileSync(httpPath,'utf8'));if(saved.branchId===identity.branchId)savedHttp={ip:saved.ip,port:saved.port};}catch{/* An absent configuration keeps the waiter listener disabled. */}const saveHttp=trust?.waiterHttp?undefined:(value:{ip:string;port:number}|null)=>{if(!value)return;const temp=httpPath+'.new';writeFileSync(temp,JSON.stringify({branchId:identity.branchId,...value}),{mode:0o600,flush:true});renameSync(temp,httpPath);};operations.waiterNetwork=new NetworkService(auth,trust?.tlsKeys??new PlatformPinKeys(dir,'tls'),trust?.fixtureLoopback,trust?.waiterHttp??savedHttp,saveHttp);operations.waiterNetwork.onChange=reloadWeb;clients=clients.then(()=>operations!.printing!.start());void reloadWeb();}
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
  app.get('/api/v1/system/version', async () => ({ server: '0.16.0-order-cards', api: 'v1', schema: status.schemaVersion, capabilities: status.schemaVersion!==null&&status.schemaVersion>=12?['settlements','counter','corrections','sales24h','paymentIncidents','refunds','shiftClose','shiftReports','financialCases','waiterWeb','printDispatch','ownerCloudLogin','menuSync',...(status.schemaVersion>=13?['sharedOrderNumbers']:[]),...(status.schemaVersion>=14?['unassignedHall','customAmountItems','itemFulfillment']:[]),...(status.schemaVersion>=15?['visitAssignments','atomicCheckout']:[]),...(status.schemaVersion>=16?['cashDrafts']:[]),...(status.schemaVersion>=17?['cashDraftCreationTime']:[]),...(status.schemaVersion>=19?['rolePermissionMatrix']:[])]:[] }));
  app.addHook('preClose',async()=>{realtime.close();});
  app.addHook('onClose', async () => { status.state = 'STOPPING';stopping=true;await clients;await web?.close();await printRuntime?.stop();await menuSyncRuntime?.stop();await tableSyncRuntime?.stop();await analyticsSyncRuntime?.stop();await shiftCloudRuntime?.stop();await bus?.drain(); storage.close(); log.info({ event: 'stopped' }); });
  await clients;
  try { if (listen) await app.listen({ host: '127.0.0.1', port }); }
  catch (error) { storage.close(); throw error; }
  log.info({ event: 'started', state: operations?'READY':status.state, code: operations?'OPERATIONAL':status.reason });
  return app;
}
