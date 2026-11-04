'use strict';
const { app, BrowserWindow, ipcMain, safeStorage, session, dialog, clipboard, shell, nativeImage } = require('electron');
const { join, basename, extname } = require('node:path');
const { readFileSync, writeFileSync, renameSync, existsSync } = require('node:fs');
const {createReadStream,statSync}=require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
app.setName('Bashkar POS');
if(!app.requestSingleInstanceLock())app.exit(0);
const draftStore=require('./draft-store.cjs');
const menuImport=require('./menu-import-file.cjs');
const {createRequestQueue}=require('./ipc-request-queue.cjs');
const {forgetRejectedShiftOpen,validShiftOpenReceipt}=require('./pending-policy.cjs');
const port=Number(process.env.BASHKAR_DESKTOP_PORT??'3210');
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('INVALID_DESKTOP_PORT');
const base = 'http://127.0.0.1:'+port;
const endpoints = {
 version:['GET','/system/version'], health:['GET','/system/health/ready'], me:['GET','/auth/me'], login:['POST','/auth/login'], ownerLogin:['POST','/auth/owner-cloud'], logout:['POST','/auth/logout'], activity:['POST','/auth/activity'], password:['POST','/auth/password'],
 employees:['GET','/employees'], employeesArchive:['GET','/employees?archive=true'], employeeStatistics:['GET','/employees/'], employeeCreate:['POST','/employees'], employeeUpdate:['POST','/employees/update'], employeeReset:['POST','/employees/reset-password'], employeePermission:['POST','/employees/permission'], employeeDelegation:['POST','/employees/delegation'], roleMatrix:['GET','/roles/permissions'], rolePermission:['POST','/roles/permissions'],
 shift:['GET','/shifts/current'], shiftOpen:['POST','/shifts/open'], menu:['GET','/menu'], drafts:['GET','/menu/drafts'], draftGet:['GET','/menu/drafts/'], feeGet:['GET','/menu/fees'], draftSave:['POST','/menu/drafts'], publish:['POST','/menu/publish'], availability:['POST','/menu/availability'], availabilityCategory:['POST','/menu/availability/category'], fees:['POST','/menu/fees'], quote:['POST','/menu/quote'], activation:['POST','/activation/start'],activationStatus:['GET','/activation/status'],activationComplete:['POST','/activation/complete']
};
Object.assign(endpoints,{tables:['GET','/tables'],tablePublicLinks:['GET','/tables/public-links'],tablePublicLinksRefresh:['GET','/tables/public-links/refresh'],tablePublicQr:['POST','/tables/public-qr'],tableCloudSyncStatus:['GET','/tables/cloud-sync/status'],tableWaiters:['GET','/tables/waiters'],visitGet:['GET','/tables/visits/'],zoneSave:['POST','/tables/zones/save'],tableSave:['POST','/tables/save'],tableMode:['POST','/tables/settings'],tableOpen:['POST','/tables/open'],tableClose:['POST','/tables/close-empty']});
endpoints.tablePublicQrBatch=['POST','/tables/public-qr/batch'];
Object.assign(endpoints,{floorPlan:['GET','/tables/floor-plan'],floorPlanSave:['POST','/tables/floor-plan/save']});
endpoints.waiterShiftSummary=['GET','/tables/waiters/shift-summary'];
Object.assign(endpoints,{menuRevisions:['GET','/menu/revisions'],menuRevisionGet:['GET','/menu/revisions/']});
Object.assign(endpoints,{draftContext:['GET','/tables/visits/'],orderGet:['GET','/tables/visits/'],orderHistory:['GET','/tables/visits/'],kitchenJobs:['GET','/tables/visits/'],batchPrepare:['POST','/tables/visits/'],batchSubmit:['POST','/tables/visits/'],orderDiscount:['POST','/orders/']});
Object.assign(endpoints,{pinLogin:['POST','/auth/pin'],pinIssue:['POST','/employees/pin/issue'],pinReset:['POST','/employees/pin/reset'],pinList:['GET','/employees/pin'],pinReveal:['POST','/employees/pin/reveal']});
Object.assign(endpoints,{financeGet:['GET','/orders/'],financeEvents:['GET','/orders/'],settlePrepare:['POST','/orders/'],settleCommit:['POST','/orders/'],correctPrepare:['POST','/orders/'],correctCommit:['POST','/orders/'],counterContext:['POST','/counter/draft-context'],counterList:['GET','/counter/orders'],counterWorklist:['GET','/counter/worklist'],counterPrepare:['POST','/counter/orders'],counterSubmit:['POST','/counter/orders'],counterHide:['POST','/counter/orders/'],salesList:['GET','/sales'],saleDetails:['GET','/sales/'],incidentCreate:['POST','/payment-incidents'],incidentList:['GET','/payment-incidents']});
endpoints.activeOrders=['GET','/orders/active'];Object.assign(endpoints,{cashVisitOpen:['POST','/tables/open'],tableAssign:['POST','/tables/assign'],cashDraftContext:['POST','/cash/draft-context'],cashFulfillmentEvents:['GET','/orders/'],cashBatches:['GET','/orders/'],cashHistoryState:['GET','/orders/'],fulfillmentMark:['POST','/orders/']});
Object.assign(endpoints,{orderRefundPrepare:['POST','/sales/'],orderRefundCommit:['POST','/sales/'],refundContext:['GET','/payments/'],refundPrepare:['POST','/payments/'],refundCommit:['POST','/payments/'],refundLookup:['POST','/refunds/history-lookup'],incidentDetails:['GET','/payment-incidents/'],resolvePrepare:['POST','/payment-incidents/'],resolveCommit:['POST','/payment-incidents/'],caseRecord:['POST','/financial-cases'],caseList:['GET','/financial-cases'],closeContext:['GET','/shifts/'],closePrepare:['POST','/shifts/'],shiftClose:['POST','/shifts/close'],shiftReport:['GET','/shifts/'],reportList:['GET','/shift-reports']});
Object.assign(endpoints,{printInventory:['GET','/printing/inventory'],printDevices:['GET','/printing/devices'],printKitchenPreview:['POST','/printing/kitchen-preview'],printDevicePrepare:['POST','/printing/devices/prepare'],printDeviceSave:['POST','/printing/devices/commit'],printRoutes:['GET','/printing/routes'],printRoutePrepare:['POST','/printing/routes/prepare'],printRouteSave:['POST','/printing/routes/commit'],printQueue:['GET','/printing/queue'],printTargets:['GET','/printing/jobs/'],printDetails:['GET','/printing/jobs/'],printActionPrepare:['POST','/printing/jobs/'],printActionCommit:['POST','/printing/jobs/'],printDiagnostics:['GET','/printing/diagnostics'],printTest:['POST','/printing/diagnostics'],printDiagnosticResolve:['POST','/printing/diagnostics/'],waiterNetwork:['GET','/waiter/network-status'],waiterNetworkHttp:['POST','/waiter/network/http'],waiterNetworkPrepare:['POST','/waiter/network/prepare'],waiterNetworkCommit:['POST','/waiter/network/commit']});
Object.assign(endpoints,{menuSyncVersion:['GET','/menu/sync/versions/'],menuSyncStatus:['GET','/menu/sync/status'],menuSyncRetry:['POST','/menu/sync/retry'],menuSyncLease:['POST','/menu/sync/lease'],menuSyncHistory:['GET','/menu/sync/history'],menuSyncApply:['POST','/menu/sync/apply'],menuSyncResolve:['POST','/menu/sync/resolve'],menuSyncFinishDraft:['POST','/menu/sync/finish-draft']});
Object.assign(endpoints,{publicMenuStatus:['GET','/menu/public/status'],publicMenuSet:['POST','/menu/public/set'],publicMenuDesignStatus:['GET','/menu/public/design'],publicMenuDesignSet:['POST','/menu/public/design']});
endpoints.menuPhotoGrant=['POST','/menu/photo/grant'];
Object.assign(endpoints,{salesCatalogLayout:['GET','/menu/sales-layout'],salesCatalogPin:['POST','/menu/sales-layout/pin']});
Object.assign(endpoints,{tableMove:['POST','/tables/move'],tableResponsible:['POST','/tables/responsible'],checkoutPrepare:['POST','/cash/checkout/prepare'],checkoutCommit:['POST','/cash/checkout/commit']});
endpoints.cashReleaseEmpty=['POST','/tables/close-empty'];
endpoints.analyticsOverview=['GET','/analytics/overview'];
endpoints.analyticsProducts=['GET','/analytics/products'];
Object.assign(endpoints,{serverDraftList:['GET','/cash/drafts'],serverDraftGet:['GET','/cash/drafts/'],serverDraftSave:['POST','/cash/drafts/save'],serverDraftDiscard:['POST','/cash/drafts/'],serverDraftResume:['POST','/cash/drafts/']});
const mutations=new Set(['salesCatalogPin','orderRefundCommit','cashReleaseEmpty','checkoutCommit','tableMove','tableResponsible','cashVisitOpen','tableAssign','fulfillmentMark','menuSyncApply','menuSyncResolve','menuSyncFinishDraft','printDeviceSave','printRouteSave','printActionCommit','printTest','printDiagnosticResolve','waiterNetworkCommit','refundCommit','resolveCommit','caseRecord','shiftClose','pinIssue','pinReset','password','employeeCreate','employeeUpdate','employeeReset','employeePermission','employeeDelegation','rolePermission','shiftOpen','draftSave','publish','availability','availabilityCategory','fees','zoneSave','tableSave','floorPlanSave','tableMode','tableOpen','tableClose','batchSubmit','orderDiscount','settleCommit','correctCommit','counterSubmit','counterHide','incidentCreate']);
const draftContexts=new Map();
const importSessions=new Map();
function localContext(sessionId){const cached=draftContexts.get(sessionId);if(!cached||cached.token!==state.token||performance.now()>=cached.deadline)throw new Error('SESSION_EXPIRED');return cached.context;}
let window, state={token:null,actorId:null,pending:{}};
let realtimeSocket,realtimeRetry,realtimeToken;
let realtimeGeneration=0;
function realtimeStatus(){return {connected:realtimeSocket?.readyState===WebSocket.OPEN,generation:realtimeGeneration};}
function sendRealtimeStatus(){realtimeGeneration++;if(window&&!window.isDestroyed())window.webContents.send('pos:realtime-status',realtimeStatus());}
function connectRealtime(){
 clearTimeout(realtimeRetry);if(!state.token||typeof WebSocket==='undefined')return;
 if(realtimeSocket&&realtimeToken===state.token&&[WebSocket.CONNECTING,WebSocket.OPEN].includes(realtimeSocket.readyState))return;
 realtimeSocket?.close();realtimeToken=state.token;
 const socket=new WebSocket('ws://127.0.0.1:'+port+'/api/v1/events',['bashkar.events','token.'+state.token]);realtimeSocket=socket;
 socket.addEventListener('open',()=>{if(socket===realtimeSocket){sendRealtimeStatus();if(window&&!window.isDestroyed())window.webContents.send('pos:changed',{type:'sync'});}});
 socket.addEventListener('message',event=>{if(socket!==realtimeSocket||!window||window.isDestroyed())return;let change;try{change=JSON.parse(event.data);}catch{change={type:'unknown'};}window.webContents.send('pos:changed',change);});
 socket.addEventListener('error',()=>{});
 socket.addEventListener('close',()=>{if(socket!==realtimeSocket)return;realtimeSocket=null;sendRealtimeStatus();if(state.token===realtimeToken)realtimeRetry=setTimeout(connectRealtime,3000);});
}
function protectedStorage() {
 if(!safeStorage.isEncryptionAvailable() || process.platform==='linux' && safeStorage.getSelectedStorageBackend()==='basic_text') throw new Error('PROTECTED_STORAGE_UNAVAILABLE');
}
function stateFile(){return join(app.getPath('userData'),'protected-session.bin');}
function save(){protectedStorage();const path=stateFile(),tmp=path+'.new';writeFileSync(tmp,safeStorage.encryptString(JSON.stringify(state)),{mode:0o600,flush:true});renameSync(tmp,path);}
function commit(fn){const previous=structuredClone(state);try{const result=fn();save();return result;}catch(error){state=previous;throw error;}}
function load(){protectedStorage();if(existsSync(stateFile())){const loaded=JSON.parse(safeStorage.decryptString(readFileSync(stateFile())));draftStore.validatePersisted(loaded);state=loaded;}}
function payloadKey(action,payload){const safe={...payload};for(const key of ['password','oldPassword','newPassword','pin'])delete safe[key];return createHash('sha256').update(JSON.stringify({actorId:state.actorId,action,payload:safe})).digest('hex');}
function photoCloud(response){const url=new URL(response.mediaUrl);if(url.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(url.hostname)||url.pathname!=='/functions/v1/menu-photo'||url.search||url.hash||url.username||typeof response.publishableKey!=='string'||response.publishableKey.length>2048)throw Error('PHOTO_CLOUD_UNAVAILABLE');return {url:url.toString(),apikey:response.publishableKey};}
async function call(action,payload={},pendingKey) {
 if(action==='menuImportTemplate'){
  if(Object.keys(payload).length)throw Error('INVALID_DESKTOP_ACTION');
  await call('me');
  const choice=await dialog.showSaveDialog(window,{title:'Скачать шаблон меню',defaultPath:'bashkar-menu-template.xlsx',filters:[{name:'Excel',extensions:['xlsx']}]});
  if(choice.canceled||!choice.filePath)return {cancelled:true};
  if(extname(choice.filePath).toLowerCase()!=='.xlsx')throw Error('MENU_IMPORT_INVALID_FILE');
  await menuImport.writeTemplate(choice.filePath);return {saved:true};
 }
 if(action==='menuImportChoose'){
  if(Object.keys(payload).length)throw Error('INVALID_DESKTOP_ACTION');
  const actor=await call('me');if(!actor.permissions?.includes('menu.edit'))throw Error('PERMISSION_DENIED');
  const choice=await dialog.showOpenDialog(window,{title:'Импортировать меню из Excel',properties:['openFile'],filters:[{name:'Excel',extensions:['xlsx']}]});
  if(choice.canceled||!choice.filePaths?.[0])return {cancelled:true};
  const path=choice.filePaths[0];if(extname(path).toLowerCase()!=='.xlsx')throw Error('MENU_IMPORT_INVALID_FILE');
  const parsed=await menuImport.readWorkbook(path),id=randomUUID();
  importSessions.clear();importSessions.set(id,{actorId:actor.id,deadline:Date.now()+10*60*1000,parsed});
  return {id,fileName:basename(path),rowCount:parsed.rowCount};
 }
 if(action==='menuImportPlan'){
  if(!payload||Object.keys(payload).sort().join(',')!=='catalog,id'||typeof payload.id!=='string'||!payload.catalog||typeof payload.catalog!=='object')throw Error('INVALID_DESKTOP_ACTION');
  const actor=await call('me');if(!actor.permissions?.includes('menu.edit'))throw Error('PERMISSION_DENIED');
  const entry=importSessions.get(payload.id);if(!entry||entry.actorId!==actor.id||Date.now()>entry.deadline)throw Error('MENU_IMPORT_EXPIRED');
  return menuImport.planImport(entry.parsed.rows,payload.catalog,entry.parsed.issues);
 }
 if(action==='publicMenuOpen'){if(!payload||Object.keys(payload).join(',')!=='url'||typeof payload.url!=='string')throw Error('INVALID_DESKTOP_ACTION');const links=await call('tablePublicLinksRefresh');if(!links.some(row=>row.publicUrl===payload.url))throw Error('PUBLIC_LINK_UNAVAILABLE');await shell.openExternal(payload.url);return {opened:true};}
 if(action==='menuPhotoRemove'){
  if(!payload||Object.keys(payload).some(key=>!['itemId','expectedRevision'].includes(key))||typeof payload.itemId!=='string'||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<1)throw Error('INVALID_DESKTOP_ACTION');
  const receipt=await call('menuPhotoGrant',{...payload,operation:'REMOVE'}),{grant}=receipt,cloud=photoCloud(receipt),mediaUrl=cloud.url;
  let response;try{response=await fetch(mediaUrl,{method:'DELETE',redirect:'error',headers:{apikey:cloud.apikey,'x-photo-grant':grant},signal:AbortSignal.timeout(12000)});}catch{throw Error('PHOTO_CLOUD_UNAVAILABLE');}
  let result;try{result=await response.json();}catch{throw Error('PHOTO_CLOUD_UNAVAILABLE');}
  if(!response.ok)throw Error(typeof result.code==='string'&&/^PHOTO_[A-Z_]+$/.test(result.code)?result.code:'PHOTO_CLOUD_UNAVAILABLE');
  return result;
 }
 if(action==='menuPhotoStatus'){
  if(!payload||Object.keys(payload).some(key=>key!=='itemId')||typeof payload.itemId!=='string')throw Error('INVALID_DESKTOP_ACTION');
  const receipt=await call('menuPhotoGrant',{itemId:payload.itemId,expectedRevision:0,operation:'READ'}),{grant}=receipt,cloud=photoCloud(receipt),mediaUrl=cloud.url;
  let response;try{response=await fetch(mediaUrl,{method:'GET',redirect:'error',headers:{apikey:cloud.apikey,'x-photo-grant':grant},signal:AbortSignal.timeout(12000)});}catch{throw Error('PHOTO_CLOUD_UNAVAILABLE');}
  let result;try{result=await response.json();}catch{throw Error('PHOTO_CLOUD_UNAVAILABLE');}
  if(!response.ok)throw Error(typeof result.code==='string'&&/^PHOTO_[A-Z_]+$/.test(result.code)?result.code:'PHOTO_CLOUD_UNAVAILABLE');
  return result;
 }
 if(action==='menuPhotoUpload'){
  if(!payload||Object.keys(payload).some(key=>!['itemId','expectedRevision'].includes(key))||typeof payload.itemId!=='string'||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0)throw Error('INVALID_DESKTOP_ACTION');
  const principal=await call('me');if(payload.itemId.startsWith('public_')?principal.role!=='OWNER':!principal.permissions?.includes('menu.edit'))throw Error('PERMISSION_DENIED');
  const siteMedia=payload.itemId==='public_logo'||payload.itemId==='public_banner'||payload.itemId.startsWith('public_cat_');const choice=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:siteMedia?'Изображения сайта':'Фотографии блюд',extensions:['jpg','jpeg','png','webp']}]});if(choice.canceled)return {cancelled:true};
  const path=choice.filePaths[0],size=statSync(path).size;if(size<1||size>10485760)throw Error('PHOTO_TOO_LARGE');
  const mime={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[extname(path).toLowerCase()];if(!mime)throw Error('PHOTO_TYPE_UNSUPPORTED');
  let uploadMime=mime,uploadBody=siteMedia?null:createReadStream(path);if(siteMedia){let image=nativeImage.createFromPath(path);if(image.isEmpty())throw Error('PHOTO_INVALID_IMAGE');const size=image.getSize(),maxWidth=payload.itemId==='public_banner'?2400:payload.itemId.startsWith('public_cat_')?1600:600,maxHeight=payload.itemId==='public_banner'?1600:payload.itemId.startsWith('public_cat_')?1000:600;if(size.width<1||size.height<1)throw Error('PHOTO_INVALID_IMAGE');if(size.width>maxWidth||size.height>maxHeight)image=image.resize({width:Math.max(1,Math.round(size.width*Math.min(maxWidth/size.width,maxHeight/size.height,1))),height:Math.max(1,Math.round(size.height*Math.min(maxWidth/size.width,maxHeight/size.height,1)))});uploadMime=payload.itemId==='public_logo'?'image/png':'image/jpeg';uploadBody=uploadMime==='image/png'?image.toPNG():image.toJPEG(85);if(uploadBody.length>10485760)throw Error('PHOTO_TOO_LARGE');}
  const receipt=await call('menuPhotoGrant',{...payload,operation:'UPLOAD'}),{grant}=receipt,cloud=photoCloud(receipt),mediaUrl=cloud.url;
  let response;try{response=await fetch(mediaUrl,{method:'POST',redirect:'error',headers:{apikey:cloud.apikey,'content-type':uploadMime,'x-photo-grant':grant},body:uploadBody,duplex:'half',signal:AbortSignal.timeout(45000)});}catch{throw Error('PHOTO_CLOUD_UNAVAILABLE');}
  let result;try{result=await response.json();}catch{throw Error('PHOTO_CLOUD_UNAVAILABLE');}
  if(!response.ok)throw Error(typeof result.code==='string'&&/^PHOTO_[A-Z_]+$/.test(result.code)?result.code:'PHOTO_CLOUD_UNAVAILABLE');
  return result;
 }
 if(action==='waiterCopyUrl'){const data=await call('waiterNetwork');if(!data.listening||!data.url)throw new Error('WEB_UNAVAILABLE');clipboard.writeText(data.url);return {copied:true};}
 if(action==='tableCopyUrl'){if(typeof payload.tableId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(payload.tableId))throw Error('INVALID_TABLE_ID');const links=await call('tablePublicLinks'),link=links.find(row=>row.tableId===payload.tableId);if(!link?.publicUrl)throw Error('TABLE_PUBLIC_LINK_UNAVAILABLE');clipboard.writeText(link.publicUrl);return {copied:true};}
 if(action==='waiterNetworkImport'){
  await call('me');const selection=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'TLS bundle',extensions:['json']}]});if(selection.canceled)return {cancelled:true};const path=selection.filePaths[0];if(require('node:fs').statSync(path).size>65536)throw new Error('INVALID_CERTIFICATE');const bundle=JSON.parse(readFileSync(path,'utf8'));const allowed=['ip','port','leafCertificate','rootCertificate','privateKey'];if(Object.keys(bundle).some(k=>!allowed.includes(k)))throw new Error('INVALID_CERTIFICATE');return call('waiterNetworkPrepare',{...bundle,expectedRevision:payload.expectedRevision,acknowledgeOriginChange:payload.acknowledgeOriginChange===true});
 }
 if(action==='waiterRootExport'){const data=await call('waiterNetwork');if(!data.rootCertificate)throw new Error('WEB_UNCONFIGURED');const choice=await dialog.showSaveDialog(window,{defaultPath:'bashkar-root-ca.crt',filters:[{name:'Root certificate',extensions:['crt']}]});if(choice.canceled)return {cancelled:true};writeFileSync(choice.filePath,data.rootCertificate,{mode:0o600});return {saved:true};}
 if(action==='cashWorkspaceGet'||action==='cashWorkspaceSet'){
  if(payload.surface!==undefined&&payload.surface!=='TABLE_QUICK')throw Error('INVALID_DESKTOP_ACTION');const principal=await call('me'),key=principal.branchId+':'+principal.id+(payload.surface==='TABLE_QUICK'?':table-quick':'');
  const existing=state.cashWorkspaces?.[key]??{scope:randomUUID(),orderId:null};
  if(action==='cashWorkspaceSet'){
   if(payload.orderId!==null)await call('financeGet',{orderId:payload.orderId});if(payload.sessionId)await call('visitGet',{id:payload.sessionId});
   commit(()=>{state.cashWorkspaces??={};state.cashWorkspaces[key]={...existing,orderId:payload.orderId,sessionId:payload.sessionId??null};});
  }else if(!state.cashWorkspaces?.[key])commit(()=>{state.cashWorkspaces??={};state.cashWorkspaces[key]=existing;});
  return structuredClone(state.cashWorkspaces[key]);
 }
 if(action==='cashWorkspaceSwitch'){
  const principal=await call('me');const key=principal.branchId+':'+principal.id;const existing=state.cashWorkspaces?.[key];if(!existing||typeof payload.scope!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(payload.scope))throw Error('INVALID_DRAFT_ID');
  const remote=await call('serverDraftGet',{draftId:payload.scope});
  commit(()=>{state.cashWorkspaces[key]={scope:payload.scope,orderId:null,sessionId:null,serverRevision:remote.revision};});return structuredClone(state.cashWorkspaces[key]);
 }
 if(action==='cashWorkspaceSync'){
  const principal=await call('me'),key=principal.branchId+':'+principal.id,workspace=state.cashWorkspaces?.[key];
  if(!workspace||workspace.scope!==payload.scope||!Number.isSafeInteger(payload.revision)||payload.revision<1)throw Error('INVALID_DRAFT');
  commit(()=>{workspace.serverRevision=payload.revision;});return {scope:payload.scope,revision:payload.revision};
 }
 if(action==='localDraftRestoreServer'){
  const principal=await call('me'),workspace=state.cashWorkspaces?.[principal.branchId+':'+principal.id];if(!workspace||workspace.scope!==payload.scope)throw Error('INVALID_DRAFT');
  const remote=await call('serverDraftGet',{draftId:payload.scope}),scope=draftStore.key(localContext(payload.scope));
  const draft=commit(()=>{const saved=draftStore.replace(state,scope,remote.draft);workspace.serverRevision=remote.revision;return saved;});return {draft,revision:remote.revision};
 }
 if(action==='cashDraftForgetLocal'){
  const remote=await call('serverDraftGet',{draftId:payload.scope}),context=await call('cashDraftContext',{draftId:payload.scope,type:remote.draft.cashMeta.mode}),scope=draftStore.key(context);
  commit(()=>{if(state.drafts?.[scope]?.frozen)throw Error('DRAFT_FROZEN');delete state.drafts?.[scope];});return {forgotten:true};
 }
 if(action==='counterOpen'){const row=await call('financeGet',{orderId:payload.orderId});if(row.type!=='COUNTER')throw new Error('ORDER_NOT_OPEN');const prior=Object.entries(state.counterIndex??{}).find(([,r])=>r.actorId===state.actorId&&r.orderId===row.id);if(row.status!=='OPEN'&&!prior)return null;const scopeId=prior?.[0]??randomUUID();if(row.status==='OPEN')await call('counterContext',{draftId:scopeId});else await call('cashDraftContext',{draftId:scopeId,type:'COUNTER'});if(row.status==='OPEN')commit(()=>{state.counterIndex[scopeId].orderId=row.id;});return {scopeId,orderId:row.id};}
 if(action==='counterLocalList'){const principal=await call('me');return Object.entries(state.counterIndex??{}).filter(([,r])=>r.actorId===principal.id&&r.branchId===principal.branchId).map(([scopeId,r])=>({scopeId,orderId:r.orderId??null}));}
 if(action==='localDraftRead'||action==='localDraftSave'){
  const context=localContext(payload.sessionId),scope=draftStore.key(context);
  if(action==='localDraftRead')return draftStore.read(state,scope);
  if(!context.canSubmit)throw new Error('PERMISSION_DENIED');if(!context.open)throw new Error('VISIT_CLOSED');
  return commit(()=>draftStore.put(state,scope,payload.expectedRevision,payload.draft));
 }
 if(action==='pending'){const principal=await call('me');if(principal.mustChangePassword)throw new Error('PASSWORD_CHANGE_REQUIRED');return Object.entries(state.pending).filter(([,p])=>p.actorId===principal.id).map(([key,p])=>({key,id:p.id,action:p.action,payload:p.payload,...(p.action==='shiftOpen'?{outcome:p.outcome??'UNKNOWN'}:{})}));}
 if(action==='retryPending') {
  const principal=await call('me');if(principal.mustChangePassword)throw new Error('PASSWORD_CHANGE_REQUIRED');
  const record=state.pending[payload.key];
  if(!record || record.actorId!==state.actorId)throw new Error('PENDING_COMMAND_UNAVAILABLE');
  const secrets={};for(const key of ['password','oldPassword','newPassword','pin'])if(typeof payload[key]==='string')secrets[key]=payload[key];
  const retryPayload={...record.payload,...secrets};if(record.action==='shiftOpen'){if(typeof payload.pin==='string'){delete retryPayload.login;delete retryPayload.password;}else if(typeof payload.login==='string'){retryPayload.login=payload.login;delete retryPayload.pin;}}return call(record.action,retryPayload,payload.key);
 }

 if(!Object.hasOwn(endpoints,action) || !payload || typeof payload!=='object' || Array.isArray(payload))throw new Error('INVALID_DESKTOP_ACTION');
 if(action==='login'||action==='pinLogin'||action==='ownerLogin')protectedStorage();
 let [method,path]=endpoints[action];const body={...payload};let key,draftScope,openVisitRequest,releaseTargetScope,releasePriorDraft,releaseDraft,hadPriorPending=false;
 if(action==='employeeStatistics'){if(typeof payload.employeeId!=='string'||!/^[-a-f0-9]{36}$/.test(payload.employeeId))throw new Error('INVALID_ID');path+=payload.employeeId+'/statistics';delete body.employeeId;}
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 if(action==='menuSyncVersion'){if(Object.keys(payload).some(k=>k!=='versionId')||!uuid.test(payload.versionId))throw Error('INVALID_ID');path+=payload.versionId;}
 if(['serverDraftGet','serverDraftDiscard','serverDraftResume'].includes(action)){if(!uuid.test(payload.draftId))throw Error('INVALID_ID');path+=payload.draftId+(action==='serverDraftDiscard'?'/discard':action==='serverDraftResume'?'/resume':'');delete body.draftId;}
 if(action==='menuSyncHistory'){if(Object.keys(payload).some(k=>k!=='before')||payload.before!==undefined&&(!Number.isSafeInteger(payload.before)||payload.before<0))throw Error('INVALID_QUERY');path+='?before='+Number(payload.before??0);}
 if(action==='menuRevisions'){const params=new URLSearchParams();for(const [key,value]of Object.entries(payload)){if(!['before','limit'].includes(key)||!Number.isSafeInteger(value)||value<0)throw new Error('INVALID_QUERY');params.set(key,String(value));}path+='?'+params;}
 if(action==='menuRevisionGet'){if(!Number.isSafeInteger(payload.revision)||payload.revision<1||Object.keys(payload).some(key=>key!=='revision'))throw new Error('INVALID_QUERY');path+=payload.revision;}
 if(['printTargets','printDetails','printActionPrepare','printActionCommit','printDiagnosticResolve'].includes(action)){if(!uuid.test(payload.dispatchId))throw new Error('INVALID_ID');path+=payload.dispatchId+({printTargets:'/targets',printDetails:'',printActionPrepare:'/prepare',printActionCommit:'/commit',printDiagnosticResolve:'/resolve'}[action]);delete body.dispatchId;}
 if(action==='printQueue'){const query=new URLSearchParams();for(const [name,value]of Object.entries(payload)){if(!['after','limit','state','role'].includes(name))throw new Error('INVALID_QUERY');query.set(name,String(value));}path+='?'+query;}
 if(['orderRefundPrepare','orderRefundCommit'].includes(action)){if(typeof payload.orderId!=='string'||!uuid.test(payload.orderId))throw Error('INVALID_ID');path+=payload.orderId+(action==='orderRefundPrepare'?'/refunds/prepare':'/refunds/commit');delete body.orderId;}
 if(['refundContext','refundPrepare','refundCommit','incidentDetails','resolvePrepare','resolveCommit','closeContext','closePrepare','shiftReport'].includes(action)){const key=['refundContext','refundPrepare','refundCommit'].includes(action)?'paymentId':['incidentDetails','resolvePrepare','resolveCommit'].includes(action)?'incidentId':'shiftId';const value=payload[key];if(typeof value!=='string'||!uuid.test(value))throw new Error('INVALID_ID');path+=value+({refundContext:'/refund-context',refundPrepare:'/refunds/prepare',refundCommit:'/refunds/commit',incidentDetails:'',resolvePrepare:'/resolutions/prepare',resolveCommit:'/resolutions/commit',closeContext:'/close-context',closePrepare:'/close/prepare',shiftReport:'/report'}[action]);delete body[key];}
 if(['incidentList','caseList','reportList'].includes(action)){const params=new URLSearchParams();for(const [key,value]of Object.entries(payload)){if(!['after','limit',...(action==='incidentList'?['state']:[])].includes(key)||!['string','number'].includes(typeof value))throw new Error('INVALID_QUERY');params.set(key,String(value));}path+='?'+params;}
 if(['cashFulfillmentEvents','cashBatches','cashHistoryState','fulfillmentMark'].includes(action)){if(!uuid.test(payload.orderId))throw Error('INVALID_ID');if(action==='cashBatches'){const after=payload.after??0,limit=payload.limit??20;if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('INVALID_QUERY');path+=payload.orderId+'/batches?after='+after+'&limit='+limit;}else{if(action==='cashHistoryState'&&Object.keys(payload).some(key=>key!=='orderId'))throw Error('INVALID_QUERY');path+=payload.orderId+(action==='cashHistoryState'?'/history-state':action==='cashFulfillmentEvents'?'/fulfillment/events?after='+Number(payload.after??0):'/fulfillment');}delete body.orderId;delete body.after;delete body.limit;}
 if(['financeGet','financeEvents','settlePrepare','settleCommit','correctPrepare','correctCommit','counterHide','saleDetails'].includes(action)){
  const id=payload.orderId;if(typeof id!=='string'||!uuid.test(id))throw new Error('INVALID_ID');
  const suffix={financeGet:'',financeEvents:'/events',settlePrepare:'/settlements/prepare',settleCommit:'/settlements/commit',correctPrepare:'/corrections/prepare',correctCommit:'/corrections/commit',counterHide:'/hide',saleDetails:''}[action];path+=id+suffix;delete body.orderId;delete body.sessionId;
  if(action==='financeEvents'){path+='?after='+Number(payload.after??0);delete body.after;}
  if(action==='saleDetails'&&payload.history===true){path+='?history=true';delete body.history;}
 }
 if(['counterList','counterWorklist','salesList'].includes(action)){const parameters=new URLSearchParams();const allowed=action==='salesList'?['afterTime','afterId','type','method','query','limit','fromTime','history']:action==='counterWorklist'?['after','limit','all']:['after','limit'];for(const [name,value] of Object.entries(payload)){if(!allowed.includes(name)||!['string','number','boolean'].includes(typeof value))throw new Error('INVALID_QUERY');parameters.set(name,String(value));}path+='?'+parameters;}
 if(action==='analyticsOverview'||action==='analyticsProducts'){if(Object.keys(payload).some(key=>!['from','to'].includes(key))||!['from','to'].every(key=>typeof payload[key]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(payload[key])))throw Error('INVALID_QUERY');path+='?'+new URLSearchParams({from:payload.from,to:payload.to});}
 if(action==='counterPrepare'||action==='counterSubmit'){
  if(payload.orderId){if(!uuid.test(payload.orderId))throw new Error('INVALID_ID');path+='/'+payload.orderId+'/batches/'+(action==='counterPrepare'?'prepare':'submit');}else path+=action==='counterPrepare'?'/prepare':'/commit';
  delete body.orderId;delete body.localScopeId;
 }

 if(['draftContext','orderGet','orderHistory','kitchenJobs','batchPrepare','batchSubmit','orderDiscount'].includes(action)){
  const id=action==='orderDiscount'?payload.orderId:payload.sessionId;if(typeof id!=='string'||!/^[-a-f0-9]{36}$/.test(id))throw new Error('INVALID_ID');
  const suffix={draftContext:'/draft-context',orderGet:'/order',orderHistory:'/batches',kitchenJobs:'/kitchen-jobs',batchPrepare:'/batches/prepare',batchSubmit:'/batches/submit',orderDiscount:'/discount'}[action];path+=id+suffix;
  if(action==='orderHistory'){const after=payload.after??0;if(!Number.isSafeInteger(after)||after<0)throw new Error('INVALID_QUERY');path+='?after='+after;}
  delete body.sessionId;delete body.orderId;delete body.after;
 }
 if(action==='checkoutPrepare'||action==='checkoutCommit')delete body.localScopeId;
 if(action==='checkoutCommit'&&payload.draft){
  if(!uuid.test(payload.localScopeId))throw Error('INVALID_DRAFT_ID');
  const context=pendingKey?null:payload.sessionId?await call('draftContext',{sessionId:payload.sessionId}):await call('cashDraftContext',{draftId:payload.localScopeId,type:payload.type});
  draftScope=pendingKey?state.pending[pendingKey]?.draftScope:draftStore.key(context);
 }
 if(action==='cashReleaseEmpty'){
  if(!uuid.test(payload.sessionId)||!uuid.test(payload.localScopeId)||!Number.isSafeInteger(payload.revision))throw Error('INVALID_ID');
  if(pendingKey){draftScope=state.pending[pendingKey]?.draftScope;releaseTargetScope=state.pending[pendingKey]?.releaseTargetScope;}
  else{
   const context=await call('draftContext',{sessionId:payload.sessionId}),workspace=state.cashWorkspaces?.[context.branchId+':'+context.employeeId];
   if(workspace?.scope!==payload.localScopeId||workspace.sessionId!==payload.sessionId)throw Error('INVALID_DRAFT');
   if(await call('orderGet',{sessionId:payload.sessionId}))throw Error('ORDER_REVISION_CONFLICT');
   draftScope=draftStore.key(context);const targetContext=await call('cashDraftContext',{draftId:payload.localScopeId,type:'COUNTER'});if(!targetContext.open||!targetContext.canSubmit)throw Error('PERMISSION_DENIED');releaseTargetScope=draftStore.key(targetContext);
  }
  const source=draftStore.read(state,draftScope),target=draftStore.read(state,releaseTargetScope);
  if(!source||target?.frozen)throw Error('DRAFT_REVISION_CONFLICT');
  if(pendingKey){if(!target||target.cashMeta?.mode!=='COUNTER'||JSON.stringify(source.lines)!==JSON.stringify(target.lines)||source.discount!==target.discount||source.menuRevision!==target.menuRevision)throw Error('DRAFT_REVISION_CONFLICT');}
  else{releasePriorDraft=target;releaseDraft={...source,id:target?.id??randomUUID(),cashMeta:{mode:'COUNTER',tableId:source.cashMeta?.tableId??null,waiterId:source.cashMeta?.waiterId??null}};}
  openVisitRequest={draftId:source.id,draftRevision:source.revision,lines:source.lines,discount:source.discount,menuRevision:source.menuRevision};delete body.localScopeId;
 }
 if(action==='cashVisitOpen'){draftScope=pendingKey?state.pending[pendingKey]?.draftScope:draftStore.key(await call('cashDraftContext',{draftId:payload.localScopeId,type:'TABLE'}));const draft=draftStore.read(state,draftScope);if(!draft)throw Error('INVALID_DRAFT');openVisitRequest={draftId:draft.id,draftRevision:draft.revision,lines:draft.lines,discount:draft.discount,menuRevision:draft.menuRevision};delete body.localScopeId;}
 if(action==='tableClose'){const context=await call('draftContext',{sessionId:payload.sessionId});if(draftStore.read(state,draftStore.key(context))?.frozen)throw new Error('DRAFT_FROZEN');}
 if(action==='batchSubmit')draftScope=pendingKey?state.pending[pendingKey]?.draftScope:draftStore.key(await call('draftContext',{sessionId:payload.sessionId}));
 if(action==='draftGet'){if(typeof payload.id!=='string'||!/^[-a-f0-9]{36}$/.test(payload.id))throw new Error('INVALID_DRAFT_ID');path+=payload.id;}
 if(action==='visitGet'){if(typeof payload.id!=='string'||!/^[-a-f0-9]{36}$/.test(payload.id))throw new Error('INVALID_VISIT_ID');path+=payload.id;}
 if(action==='counterSubmit')draftScope=pendingKey?state.pending[pendingKey]?.draftScope:draftStore.key(await call('counterContext',{draftId:payload.localScopeId}));
 if(mutations.has(action)) {
  protectedStorage();key=pendingKey??payloadKey(action,payload);hadPriorPending=!!state.pending[key];
  for(const [otherKey,p] of Object.entries(state.pending)){if(action==='fulfillmentMark'||p.action==='fulfillmentMark'){if(action===p.action&&otherKey!==key&&p.actorId===state.actorId&&p.payload.itemId===payload.itemId)throw new Error('RESULT_UNKNOWN_RETRY_SAME_ACTION');continue;}if(action==='shiftOpen'&&!pendingKey&&p.action==='shiftOpen'&&otherKey!==key&&p.actorId===state.actorId)throw new Error('RESULT_UNKNOWN_RETRY_SAME_ACTION');if(!['incidentCreate','caseRecord'].includes(action)&&otherKey!==key&&p.actorId===state.actorId&&((action==='shiftClose')||(payload.paymentId&&p.payload.paymentId===payload.paymentId)||(payload.incidentId&&p.payload.incidentId===payload.incidentId)||(payload.orderId&&p.payload.orderId===payload.orderId)||(payload.sessionId&&p.payload.sessionId===payload.sessionId)||(payload.localScopeId&&p.payload.localScopeId===payload.localScopeId)))throw new Error('RESULT_UNKNOWN_RETRY_SAME_ACTION');}const safe={...payload};for(const field of ['password','oldPassword','newPassword','pin'])delete safe[field];
  commit(()=>{state.pending[key]??={id:randomUUID(),action,payload:safe,actorId:state.actorId,...(action==='shiftOpen'?{outcome:'IN_FLIGHT'}:{}),...(draftScope?{draftScope}:{}),...(releaseTargetScope?{releaseTargetScope,releasePriorDraft:releasePriorDraft??null}:{})};if(action==='cashReleaseEmpty'&&!hadPriorPending)draftStore.put(state,releaseTargetScope,releasePriorDraft?.revision??0,releaseDraft);body.commandId=state.pending[key].id;if(action==='cashVisitOpen'||action==='cashReleaseEmpty')draftStore.freeze(state,draftScope,openVisitRequest,body.commandId);if(action==='checkoutCommit'&&payload.draft)draftStore.freeze(state,draftScope,payload.draft,body.commandId);if(['batchSubmit','counterSubmit'].includes(action))draftStore.freeze(state,draftScope,body,body.commandId);});
 }
 let response,result;
 try {response=await fetch(base+'/api/v1'+path,{method,redirect:'error',signal:AbortSignal.timeout(['tablePublicLinksRefresh','tablePublicQr','publicMenuStatus'].includes(action)?25000:15000),headers:{...(method!=='GET'?{'Content-Type':'application/json'}:{}),...(state.token&&!['login','pinLogin','ownerLogin'].includes(action)?{Authorization:'Bearer '+state.token}:{})},...(method!=='GET'?{body:JSON.stringify(body)}:{})});}
 catch {if(action==='shiftOpen'){commit(()=>{if(state.pending[key])state.pending[key].outcome='UNKNOWN';});}throw new Error(mutations.has(action)?'RESULT_UNKNOWN_RETRY_SAME_ACTION':'SERVER_UNAVAILABLE');}
 try{result=await response.json();}catch{if(action==='shiftOpen'){commit(()=>{if(state.pending[key])state.pending[key].outcome='UNKNOWN';});}throw new Error(mutations.has(action)?'RESULT_UNKNOWN_RETRY_SAME_ACTION':'SERVER_UNAVAILABLE');}
 if(action==='cashReleaseEmpty'&&response.ok&&(!result||result.sessionId!==payload.sessionId||result.status!=='CLOSED'||result.closeReason!=='EMPTY'||result.revision!==payload.revision+1))throw Error('RESULT_UNKNOWN_RETRY_SAME_ACTION');
 if(action==='fulfillmentMark'&&payload.issuedQuantity!==undefined&&response.ok&&(!result||result.orderId!==payload.orderId||result.itemId!==payload.itemId||result.revision!==payload.expectedRevision+1||result.issuedQuantity!==payload.issuedQuantity))throw Error('RESULT_UNKNOWN_RETRY_SAME_ACTION');
 if(action==='correctCommit'&&payload.kitchenPrint==='DEFERRED'&&response.ok&&(!result||result.orderId!==payload.orderId||result.commandId!==body.commandId||!uuid.test(result.correctionId)||!Number.isSafeInteger(result.revision)||result.revision<1||!['OPEN','CANCELLED'].includes(result.result)||!Array.isArray(result.printJobIds)||result.printJobIds.length))throw Error('RESULT_UNKNOWN_RETRY_SAME_ACTION');
 if(action==='orderRefundCommit'&&response.ok&&(!result||result.orderId!==payload.orderId||result.commandId!==body.commandId||result.result!=='ORDER_REFUND_REGISTERED'||!Array.isArray(result.refundIds)||!result.refundIds.length||result.refundIds.some(id=>!uuid.test(id))))throw Error('RESULT_UNKNOWN_RETRY_SAME_ACTION');
 if(action==='checkoutCommit'&&response.ok&&(!result||!uuid.test(result.orderId)||!uuid.test(result.settlementId)||!['PAID','ZERO_SETTLED'].includes(result.result)||result.commandId!==body.commandId))throw Error('RESULT_UNKNOWN_RETRY_SAME_ACTION');
 if(action==='shiftOpen'){if(response.ok&&!validShiftOpenReceipt(result)){commit(()=>{if(state.pending[key])state.pending[key].outcome='UNKNOWN';});throw new Error('RESULT_UNKNOWN_RETRY_SAME_ACTION');}}
 if(action==='health' && process.env.BASHKAR_TEST_CLIENT==='1'){result.testClient=true;if(/^[a-z0-9][a-z0-9-]{0,31}$/.test(process.env.BASHKAR_TEST_PROFILE??''))result.testProfile=process.env.BASHKAR_TEST_PROFILE;}
 // Readiness 503 is a valid diagnostic state, not a transport failure.
 if(action==='health' && response.status===503 && result.ready===false)return result;
 if(action==='cashDraftContext'&&response.ok)draftContexts.set(payload.draftId,{token:state.token,context:result,deadline:performance.now()+Math.max(0,result.validUntil-result.serverTime)});
 if(action==='draftContext'&&response.ok)draftContexts.set(payload.sessionId,{token:state.token,context:result,deadline:performance.now()+Math.max(0,result.validUntil-result.serverTime)});
 if(action==='counterContext'&&response.ok){draftContexts.set(payload.draftId,{token:state.token,context:result,deadline:performance.now()+Math.max(0,result.validUntil-result.serverTime)});commit(()=>{state.counterIndex??={};state.counterIndex[payload.draftId]??={scope:draftStore.key(result),actorId:result.employeeId,branchId:result.branchId};});}
 if(!response.ok){
  const code=result.error?.code??'REQUEST_FAILED';if([401,403].includes(response.status))draftContexts.clear();
  if(key && (forgetRejectedShiftOpen({action,hadPriorPending,status:response.status,code})||response.status<500 && ![401,403,429].includes(response.status) && code!=='STORAGE_BUSY')){commit(()=>{if(['cashVisitOpen','cashReleaseEmpty','batchSubmit','counterSubmit'].includes(action)||action==='checkoutCommit'&&payload.draft)draftStore.resolve(state,draftScope,body.commandId,false);if(action==='cashReleaseEmpty'){const prior=state.pending[key]?.releasePriorDraft;if(prior)state.drafts[releaseTargetScope]=prior;else delete state.drafts[releaseTargetScope];}delete state.pending[key];});}
  if(action==='shiftOpen'&&state.pending[key])commit(()=>{state.pending[key].outcome='UNKNOWN';});
  // Keep the protected token on uncertain transport errors, but the renderer
  // locks itself. No fetch/activity polling refreshes the server idle timer.
  const error=new Error(code);error.retryAfterSeconds=result.error?.retryAfterSeconds;throw error;
 }
 if(key)commit(()=>{
  if(action==='cashReleaseEmpty'){
   draftStore.resolve(state,draftScope,body.commandId,true);
   for(const workspace of Object.values(state.cashWorkspaces??{}))if(workspace.scope===payload.localScopeId&&workspace.sessionId===payload.sessionId){workspace.sessionId=null;workspace.orderId=null;}
  }

  if(action==='checkoutCommit'){
   if(payload.draft)draftStore.resolve(state,draftScope,body.commandId,true);
   for(const [scopeId,entry]of Object.entries(state.counterIndex??{}))if(entry.actorId===state.actorId&&entry.orderId===result.orderId)delete state.counterIndex[scopeId];
   for(const workspace of Object.values(state.cashWorkspaces??{}))if(workspace.scope===payload.localScopeId||payload.orderId&&workspace.orderId===payload.orderId||payload.sessionId&&workspace.sessionId===payload.sessionId){workspace.scope=randomUUID();workspace.orderId=null;workspace.sessionId=null;}
  }
if(action==='cashVisitOpen'){draftStore.resolve(state,draftScope,body.commandId,false);for(const workspace of Object.values(state.cashWorkspaces??{}))if(workspace.scope===payload.localScopeId){workspace.sessionId=result.sessionId;workspace.orderId=null;}}if(['batchSubmit','counterSubmit'].includes(action))draftStore.resolve(state,draftScope,body.commandId,true);if(action==='settleCommit'||action==='correctCommit'){if(['PAID','ZERO_SETTLED','CANCELLED'].includes(result.result)){for(const [scopeId,entry]of Object.entries(state.counterIndex??{}))if(entry.actorId===state.actorId&&entry.orderId===result.orderId)delete state.counterIndex[scopeId];}}if(action==='counterSubmit'){if(payload.mode==='CHECKOUT')delete state.counterIndex[payload.localScopeId];else state.counterIndex[payload.localScopeId].orderId=result.orderId;for(const workspace of Object.values(state.cashWorkspaces??{}))if(workspace.scope===payload.localScopeId){workspace.scope=randomUUID();workspace.orderId=payload.mode==='CHECKOUT'?null:result.orderId;workspace.sessionId=null;}}if(action==='batchSubmit')for(const workspace of Object.values(state.cashWorkspaces??{}))if(workspace.sessionId===payload.sessionId)workspace.orderId=result.orderId;delete state.pending[key];});
 if(action==='me'){state.actorId=result.id;save();}
 if(action==='login'||action==='pinLogin'||action==='ownerLogin'){draftContexts.clear();commit(()=>{state.token=result.token;state.actorId=result.employeeId;});connectRealtime();return {employeeId:result.employeeId,mustChangePassword:result.mustChangePassword};}
 if(action==='logout'){draftContexts.clear();importSessions.clear();state.token=null;state.actorId=null;save();clearTimeout(realtimeRetry);realtimeSocket?.close();realtimeSocket=null;sendRealtimeStatus();}
 return result;
}
app.whenReady().then(()=>{
 session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 let storageError;try{load();}catch(error){storageError=error.message==='PROTECTED_STORAGE_UNAVAILABLE'?error.message:'PROTECTED_STORAGE_INVALID';state={token:null,actorId:null,pending:{}};}
 const enqueueRequest=createRequestQueue(new Set(['menu','shift','tables','activeOrders','salesList']));
 ipcMain.handle('pos:realtime-status',event=>event.sender===window?.webContents&&event.senderFrame===window?.webContents.mainFrame?realtimeStatus():{connected:false,generation:-1});
 ipcMain.handle('pos:request',(event,{action,payload})=>{const execute=async()=>{
  if(!window || event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame) return {ok:false,code:'INVALID_SENDER'};
  if(storageError && !['health','activationStatus'].includes(action))return {ok:false,code:storageError};
  try{return {ok:true,value:await call(action,payload)};}catch(error){return {ok:false,code:/^[A-Z_]+$/.test(error.message)?error.message:'DESKTOP_REQUEST_FAILED',...(Number.isSafeInteger(error.retryAfterSeconds)?{retryAfterSeconds:error.retryAfterSeconds}:{})};}
  };if(['tablePublicLinksRefresh','tablePublicQr','tablePublicQrBatch','publicMenuStatus','publicMenuSet','publicMenuDesignStatus','publicMenuDesignSet','publicMenuOpen','menuPhotoStatus','menuPhotoUpload','menuPhotoRemove','menuSyncHistory','menuSyncVersion'].includes(action))return execute();return enqueueRequest(action,execute);});
 window=new BrowserWindow({width:1200,height:820,minWidth:800,minHeight:600,webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
 window.loadFile(join(__dirname,'index.html'));
 connectRealtime();
});
app.on('window-all-closed',()=>app.quit());
