'use strict';
// Persistent cashier workspace. Accepted packages never share the editable draft.
function initCashWorkspaceUi(ru,ky,errors){
 Object.assign(ru,{cashIssuedIncrease:'Выдать одну единицу',cashIssuedDecrease:'Уменьшить выданное на одну единицу'});
 Object.assign(ky,{cashIssuedIncrease:'Бир даананы берүү',cashIssuedDecrease:'Берилгенден бир даананы азайтуу'});
 const labels={cashCustomPermission:['Продажа товара с произвольной ценой','Эркин баа менен товар сатуу'],cashIssuedPermission:['Отметки выдачи позиций','Позицияларды берүү белгилери'],cashCustomItem:['Неизвестный товар','Белгисиз товар'],cashCustomHint:['Цена единицы, сом','Бирдик баасы, сом'],cashContinue:['Продолжить','Улантуу'],cashHallUnassigned:['Зал · Без стола','Зал · Столсуз'],cashSendBatch:['Отправить пакет','Топтомду жөнөтүү'],cashNewBatch:['Новый пакет','Жаңы топтом'],cashAcceptedAmount:['Принято сервером','Сервер кабыл алган'],cashAcceptedPackages:['Принятые пакеты','Кабыл алынган топтомдор'],cashBatch:['Пакет','Топтом'],cashIssued:['Выдано','Берилди'],cashUndoIssued:['Снять отметку выдачи?','Берүү белгисин алып саласызбы?'],cashKitchenPrinting:['Печать кухни','Ашкананын басмасы'],cashNoKitchen:['Без отправки на кухню','Ашканага жөнөтүлбөйт'],cashMorePackages:['Ещё пакеты','Дагы топтомдор'],cashResponsibleFixed:['Ответственный сохраняется у открытого посещения','Ачык баруунун жооптуусу сакталат'],cashOrderClosed:['Заказ уже закрыт. Дозаказ сохранён.','Буйрутма жабылган. Кошумча топтом сакталды.'],cashTransferDraft:['Перенести дозаказ в новый заказ','Кошумчаны жаңы буйрутмага көчүрүү'],cashNewOrder:['Новый заказ','Жаңы буйрутма'],cashUnsentBeforePay:['Сначала отправьте новый пакет или очистите его.','Адегенде жаңы топтомду жөнөтүңүз же тазалаңыз.'],cashCancelledLine:['Отменено','Жокко чыгарылган'],cashOrderActions:['Действия с заказом','Буйрутма аракеттери'],cashIssuedSaved:['Отметка выдачи сохранена','Берүү белгиси сакталды'],cashAmountInvalid:['Введите сумму больше нуля в пределах лимита','Лимиттин ичинде нөлдөн чоң сумма киргизиңиз']};
 for(const [key,[r,k]]of Object.entries(labels)){ru[key]=r;ky[key]=k;}
 Object.assign(ru,{cashCardSent:'Отправлен',cashElapsed:'Прошло',cashElapsedMinutes:'мин',cashElapsedHours:'ч',cashDraftNumber:'Черновик',cashParkAndNew:'Отложить и новый заказ',cashParked:'Ожидает',cashDiscardDraft:'Удалить черновик',cashDiscardDraftConfirm:'Удалить эту отложенную корзину?',cashDraftConflict:'Черновик изменён на другой кассе. Ваш локальный вариант сохранён.',cashForkDraft:'Сохранить мой вариант отдельно',cashUseServerDraft:'Открыть серверный вариант',cashOldShift:'Черновик остался с прошлой смены. Проверьте состав и перенесите его в текущую смену.',cashResumeDraft:'Перенести в текущую смену'});
 Object.assign(ky,{cashCardSent:'Жөнөтүлдү',cashElapsed:'Өткөн убакыт',cashElapsedMinutes:'мүн',cashElapsedHours:'с',cashDraftNumber:'Каралама',cashParkAndNew:'Кийинкиге калтырып, жаңы буйрутма',cashParked:'Күтүүдө',cashDiscardDraft:'Караламаны өчүрүү',cashDiscardDraftConfirm:'Бул күтүүдөгү корзинаны өчүрөсүзбү?',cashDraftConflict:'Каралама башка кассада өзгөргөн. Жергиликтүү нуска сакталды.',cashForkDraft:'Менин нускамды өзүнчө сактоо',cashUseServerDraft:'Сервердеги нусканы ачуу',cashOldShift:'Каралама мурунку нөөмөттө калган. Курамын текшерип, учурдагы нөөмөткө өткөрүңүз.',cashResumeDraft:'Учурдагы нөөмөткө өткөрүү'});
 Object.assign(errors,{INVALID_CUSTOM_ITEM:['У неизвестного товара нельзя выбирать варианты или добавлять комментарий.','Белгисиз товарга вариант же комментарий кошууга болбойт.'],INVALID_CUSTOM_AMOUNT:labels.cashAmountInvalid,CUSTOM_ITEM_COMMENT_FORBIDDEN:['Комментарий к неизвестному товару недоступен.','Белгисиз товарга комментарий жеткиликсиз.'],TABLE_ALREADY_ASSIGNED:['У заказа уже назначен стол. Обновите данные.','Буйрутмага стол дайындалган. Маалыматты жаңыртыңыз.']});
}
function cashActionIcon(kind){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',kind==='trash'?'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7':kind==='reset'?'M4 7v5h5M5.6 15a7 7 0 1 0 .5-7.5L4 12':kind==='cancel'?'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM6 18 18 6':'M12 5v14M5 12h14');svg.append(path);return svg;
}
function cashWorkspaceAction(action,payload={}){return api(action,{...payload,...(tableQuickSession?{surface:'TABLE_QUICK'}:{})});}
function cashDraftSame(a,b){return !!a&&!!b&&a.id===b.id&&a.discount===b.discount&&a.menuRevision===b.menuRevision&&JSON.stringify(a.lines)===JSON.stringify(b.lines)&&JSON.stringify(a.cashMeta)===JSON.stringify(b.cashMeta)&&JSON.stringify(a.preview??{})===JSON.stringify(b.preview??{})&&String(a.guestLabel??'')===String(b.guestLabel??'');}
let cashHistoryCache=null,cashHistoryPending=null,cashHistoryVersion=0,cashHistoryForceFull=false;
function cashClearHistoryCache(){cashHistoryVersion++;cashHistoryCache=null;cashHistoryForceFull=true;}
async function cashHistoryPages(orderId,after=0,limit=20){
 const first=await api('cashBatches',{orderId,after,limit}),batches=[...first.batches];let next=first.next;
 while(next!==null&&next!==undefined){const page=await api('cashBatches',{orderId,after:next,limit});if(page.next!==null&&page.next<=next)throw Error('INVALID_HISTORY');if(page.orderRevision!==first.orderRevision)throw Error('HISTORY_CHANGED');batches.push(...page.batches);next=page.next;}
 return {...first,batches,next:null};
}
function cashHistoryApplyPrint(history,state){
 const jobs=new Map();for(const job of state.jobs){const list=jobs.get(job.sequence)??[];list.push({id:job.id,status:job.status});jobs.set(job.sequence,list);}
 for(const batch of history.batches)batch.kitchenJobs=jobs.get(batch.sequence)??[];
}
function cashHistoryMatches(history,state){
 if(history.orderRevision!==state.orderRevision||history.batches.at(-1)?.sequence!==state.maxSequence)return false;
 const revisions=new Map(history.batches.flatMap(batch=>batch.lines.map(line=>[line.id,{sequence:batch.sequence,revision:line.fulfillment.revision}])));
 return revisions.size===state.items.length&&state.items.every(item=>{const prior=revisions.get(item.itemId);return prior?.sequence===item.sequence&&prior.revision===item.fulfillmentRevision;});
}
async function cashHistoryFull(orderId){
 for(let attempt=0;attempt<2;attempt++){
  let history;try{history=await cashHistoryPages(orderId);}catch(error){if(error.message==='HISTORY_CHANGED')continue;throw error;}
  if(history.batches.length<=20)return {history,state:null};
  const state=await api('cashHistoryState',{orderId});
  if(cashHistoryMatches(history,state)){cashHistoryApplyPrint(history,state);return {history,state};}
 }
 throw Error('HISTORY_CHANGED');
}
async function cashHistoryIncremental(orderId,prior){
 const state=await api('cashHistoryState',{orderId}),old=prior.state,history=structuredClone(prior.history),oldMax=old.maxSequence,added=state.maxSequence-oldMax;
 if(state.orderId!==orderId||state.maxSequence<oldMax||state.orderRevision<old.orderRevision||state.orderRevision-old.orderRevision!==added)throw Error('HISTORY_CHANGED');
 const oldItems=new Map(old.items.map(item=>[item.itemId,item])),changed=new Set();
 for(const item of state.items){if(item.sequence>oldMax)continue;const before=oldItems.get(item.itemId);if(!before||before.sequence!==item.sequence)throw Error('HISTORY_CHANGED');if(before.fulfillmentRevision!==item.fulfillmentRevision)changed.add(item.sequence);oldItems.delete(item.itemId);}
 if(oldItems.size)throw Error('HISTORY_CHANGED');
 const fullPages=Math.ceil(history.batches.length/20);if(1+changed.size+(added>0?1:0)>=fullPages)throw Error('HISTORY_CHANGED');
 if(added){const fresh=await cashHistoryPages(orderId,oldMax);if(fresh.orderRevision!==state.orderRevision||fresh.batches.length!==added||fresh.batches[0]?.sequence!==oldMax+1||fresh.batches.at(-1)?.sequence!==state.maxSequence)throw Error('HISTORY_CHANGED');history.batches.push(...fresh.batches);}
 for(const sequence of changed){const page=await api('cashBatches',{orderId,after:sequence-1,limit:1});if(page.orderRevision!==state.orderRevision||page.batches[0]?.sequence!==sequence)throw Error('HISTORY_CHANGED');const index=history.batches.findIndex(batch=>batch.sequence===sequence);if(index<0)throw Error('HISTORY_CHANGED');history.batches[index]=page.batches[0];}
 history.orderRevision=state.orderRevision;cashHistoryApplyPrint(history,state);
 if(!cashHistoryMatches(history,state))throw Error('HISTORY_CHANGED');
 return {history,state};
}
async function cashReadOrderHistory(order,force=false){
 if(tableQuickSession)return api('cashBatches',{orderId:order.id});
 const key=me.branchId+':'+me.id+':'+order.shiftId+':'+order.id;
 if(cashHistoryPending?.key!==key&&cashHistoryPending)cashClearHistoryCache();
 if(cashHistoryCache?.key!==key&&cashHistoryCache)cashClearHistoryCache();
 while(cashHistoryPending){const pending=cashHistoryPending;if(pending.key===key&&!force&&!cashHistoryForceFull)return pending.promise;try{await pending.promise;}catch{/* retry with the current identity */}}
 const version=cashHistoryVersion,ticket=cashRealtimeTicket;
 const job=(async()=>{
  let result;if(force||cashHistoryForceFull||!cashHistoryCache?.state||cashHistoryCache.key!==key)result=await cashHistoryFull(order.id);
  else try{result=await cashHistoryIncremental(order.id,cashHistoryCache);}catch(error){if(['PERMISSION_DENIED','VISIT_ACCESS_DENIED','SESSION_INVALID','SESSION_EXPIRED','SALE_NOT_FOUND'].includes(error.message))throw error;result=await cashHistoryFull(order.id);}
  if(version!==cashHistoryVersion||ticket!==cashRealtimeTicket||me?.branchId+':'+me?.id+':'+order.shiftId+':'+order.id!==key)throw Error('HISTORY_CHANGED');
  cashHistoryCache=result.state?{key,...result}:null;cashHistoryForceFull=false;return result.history;
 })();cashHistoryPending={key,promise:job};try{return await job;}catch(error){if(['PERMISSION_DENIED','VISIT_ACCESS_DENIED','SESSION_INVALID','SESSION_EXPIRED','SALE_NOT_FOUND'].includes(error.message))cashClearHistoryCache();throw error;}finally{if(cashHistoryPending?.promise===job)cashHistoryPending=null;}
}
async function cashLoadWorkspace(){
 const workspace=await cashWorkspaceAction('cashWorkspaceGet');fastState.newScope=workspace.scope;
 if(!tableQuickSession){fastState.checkoutPending=(await api('pending')).find(p=>p.action==='checkoutCommit'&&(p.payload.localScopeId===workspace.scope||workspace.orderId&&p.payload.orderId===workspace.orderId||workspace.sessionId&&p.payload.sessionId===workspace.sessionId))??null;if(fastState.checkoutPending){const input=fastState.checkoutPending.payload;Object.assign(fastState,{order:null,orderId:input.orderId,sessionId:input.sessionId,scope:input.localScopeId,lines:input.draft?.lines??[],discount:input.draft?.discount??0,mode:input.type,visit:null,closed:false,frozen:true,history:null,localDraft:null});return;}}
 if(!tableQuickSession){const release=(await api('pending')).find(p=>p.action==='cashReleaseEmpty'&&p.payload.localScopeId===workspace.scope);if(release){const input=release.payload;await api('cashDraftContext',{draftId:workspace.scope,type:'COUNTER'});const draft=await api('localDraftRead',{sessionId:workspace.scope});Object.assign(fastState,{order:null,orderId:null,sessionId:input.sessionId,scope:workspace.scope,mode:'TABLE',lines:draft?.lines??[],discount:draft?.discount??0,visit:null,closed:false,frozen:true,history:null,localDraft:null});return;}}
 let order=null,sessionId=workspace.sessionId??null;
 if(workspace.orderId){try{order=await api('financeGet',{orderId:workspace.orderId});}catch(error){if(!tableQuickSession&&['VISIT_ACCESS_DENIED','PERMISSION_DENIED','SALE_NOT_FOUND'].includes(error.message)){cashClearHistoryCache();const scope=crypto.randomUUID(),mode=me.permissions.includes('table.view_status')?'TABLE':'COUNTER',draft={id:crypto.randomUUID(),lines:[],discount:0,menuRevision:fastState.menu.revision,preview:{},cashMeta:{mode,tableId:null,waiterId:null}};await api('serverDraftSave',{id:scope,expectedRevision:0,commandId:crypto.randomUUID(),draft});await api('cashWorkspaceSwitch',{scope});fastState.sessionId=null;fastState.orderId=null;fastState.lines=[];fastState.localDraft=null;fastState.active=await api('activeOrders');if(me.permissions.includes('table.view_status'))fastState.tables=await api('tables');toast('warning',t('ofAccessLost'));return cashLoadWorkspace();}throw error;}}
 else if(sessionId){const row=await api('orderGet',{sessionId});if(row)order=await api('financeGet',{orderId:row.id});}
 else{const accepted=(await api('counterLocalList')).find(r=>r.scopeId===workspace.scope&&r.orderId);if(accepted)order=await api('financeGet',{orderId:accepted.orderId});}
 fastState.order=order;fastState.orderId=order?.id??null;fastState.closed=!!order&&order.status!=='OPEN';fastState.frozen=false;fastState.history=null;
 if(order?.type==='TABLE')sessionId=order.sessionId;
 fastState.sessionId=sessionId;
 if(sessionId){
  const visit=await api('visitGet',{id:sessionId});if(visit.status!=='OPEN')fastState.closed=true;fastState.mode='TABLE';fastState.tableId=visit.tableId;fastState.waiterId=visit.responsibleWaiter?.id??null;fastState.waiterName=visit.responsibleWaiter?.name??null;fastState.visit=visit;
  await api('draftContext',{sessionId});fastState.scope=sessionId;
 }else if(order){
  const local=await api('counterOpen',{orderId:order.id});fastState.scope=null;
  if(local)fastState.scope=local.scopeId;fastState.mode='COUNTER';fastState.tableId=null;fastState.waiterId=null;fastState.waiterName=null;fastState.visit=null;
 }else{
  fastState.scope=workspace.scope;fastState.tableId=null;fastState.waiterId=null;fastState.waiterName=null;fastState.visit=null;await api('cashDraftContext',{draftId:workspace.scope,type:fastState.mode});
 }
 let draft=null;
 if(!fastState.closed||sessionId||order?.type==='COUNTER'&&fastState.scope)draft=await api('localDraftRead',{sessionId:fastState.scope});
 // A closed COUNTER cannot obtain a writable context; keep only this actor's existing in-memory draft.
 if(fastState.closed&&!sessionId&&!fastState.scope)draft=null;
 if(sessionId&&!order&&!draft){await api('cashDraftContext',{draftId:workspace.scope,type:'TABLE'});const source=await api('localDraftRead',{sessionId:workspace.scope});if(source?.lines.length&&fastState.shift){await cashPersistDraft(source.lines,source.discount);draft=fastState.localDraft;}}
 fastState.localDraft=draft;fastState.lines=draft?.lines??[];fastState.discount=order?.discount??draft?.discount??0;fastState.frozen=!!draft?.frozen;
 if(!sessionId&&!order&&draft?.cashMeta){fastState.mode=draft.cashMeta.mode;fastState.tableId=draft.cashMeta.tableId;fastState.waiterId=draft.cashMeta.waiterId;fastState.waiterName=null;if(fastState.waiterId&&me.permissions.includes('table.open')){const rows=await api('tableWaiters');fastState.waiterName=rows.find(row=>row.id===fastState.waiterId)?.name??null;}}
 let remote=null;if(!tableQuickSession&&!order&&!sessionId){
  try{remote=await api('serverDraftGet',{draftId:workspace.scope});}catch(error){if(error.message!=='DRAFT_NOT_FOUND')throw error;}
  fastState.serverDraftRevision=remote?.revision??0;fastState.serverDraftConflict=!!remote&&!!draft&&workspace.serverRevision!==undefined&&workspace.serverRevision<remote.revision&&!cashDraftSame(draft,remote.draft);fastState.serverDraftOutdated=!!remote&&!!fastState.shift&&remote.shiftId!==fastState.shift.id;
  if(remote&&draft&&workspace.serverRevision<remote.revision&&!fastState.serverDraftConflict)await api('cashWorkspaceSync',{scope:workspace.scope,revision:remote.revision});
  if(remote&&!draft){draft=await api('localDraftSave',{sessionId:workspace.scope,expectedRevision:0,draft:remote.draft});fastState.localDraft=draft;fastState.lines=draft.lines;fastState.discount=draft.discount;fastState.mode=draft.cashMeta?.mode??fastState.mode;}
 }else{fastState.serverDraftRevision=0;fastState.serverDraftConflict=false;fastState.serverDraftOutdated=false;}
 if(!sessionId&&!order&&!remote&&fastState.newDraftDefaultMode&&!fastState.lines.length){fastState.mode=fastState.newDraftDefaultMode;if(fastState.shift)await cashPersistDraft();}
 if(order){fastState.history=await cashReadOrderHistory(order);if(workspace.orderId!==order.id)await cashWorkspaceAction('cashWorkspaceSet',{orderId:order.id,sessionId});}
 else if(cashHistoryCache)cashClearHistoryCache();
}
async function cashPersistDraft(lines=fastState.lines,discount=fastState.discount,review={}){
 if(fastState.serverDraftConflict)throw Error('DRAFT_REVISION_CONFLICT');
 if(fastState.serverDraftOutdated)throw Error('DRAFT_SHIFT_CHANGED');
 if(fastState.closed)throw Error('ORDER_NOT_OPEN');
 if(fastState.sessionId)await api('draftContext',{sessionId:fastState.sessionId});
 else if(fastState.orderId)await api('counterContext',{draftId:fastState.scope});
 else await api('cashDraftContext',{draftId:fastState.scope,type:fastState.mode});
 const old=await api('localDraftRead',{sessionId:fastState.scope});
 if(!fastState.shift&&!lines.length)return;
 let seedId=null;if(!old&&fastState.sessionId&&!fastState.orderId&&!tableQuickSession){const source=await api('localDraftRead',{sessionId:fastState.newScope});seedId=source?.id??null;}
 const draft={id:old?.id??seedId??crypto.randomUUID(),lines,discount,menuRevision:fastState.menu.revision,preview:tableQuickSession?(old?.preview??{}):cashDraftPreview(lines,review.quote,old?.preview??fastState.localDraft?.preview??{},review.acceptAll),cashMeta:{mode:fastState.mode,tableId:fastState.tableId??null,waiterId:fastState.waiterId??null}};
 fastState.localDraft=await api('localDraftSave',{sessionId:fastState.scope,expectedRevision:old?.revision??0,draft});
 if(!tableQuickSession&&fastState.sessionId&&!fastState.orderId)await cashSyncOpeningDraft(draft);
 if(!tableQuickSession&&!fastState.orderId&&!fastState.sessionId){
  let remote;try{remote=await api('serverDraftSave',{id:fastState.scope,expectedRevision:fastState.serverDraftRevision??0,commandId:crypto.randomUUID(),draft});}
  catch(error){try{const existing=await api('serverDraftGet',{draftId:fastState.scope});if(cashDraftSame(existing.draft,draft))remote=existing;}catch{}if(!remote)throw error;}
  fastState.serverDraftRevision=remote.revision;await api('cashWorkspaceSync',{scope:fastState.scope,revision:remote.revision});
  fastState.parked=[...(fastState.parked??[]).filter(row=>row.id!==remote.id),remote];
 }
}
async function cashSyncOpeningDraft(draft){
 const workspace=await cashWorkspaceAction('cashWorkspaceGet');let remote;
 try{remote=await api('serverDraftGet',{draftId:workspace.scope});}catch(error){if(error.message==='DRAFT_NOT_FOUND')return;throw error;}
 if(remote.draft.id!==draft.id)return;
 if(remote.revision!==(workspace.serverRevision??0))throw Error('DRAFT_REVISION_CONFLICT');
 if(cashDraftSame(remote.draft,draft))return;
 const result=await api('serverDraftSave',{id:workspace.scope,expectedRevision:remote.revision,commandId:crypto.randomUUID(),draft});
 await api('cashWorkspaceSync',{scope:workspace.scope,revision:result.revision});
}
async function cashForkDraft(){const source=fastState.localDraft;if(!source)throw Error('INVALID_DRAFT');const scope=crypto.randomUUID(),draft={...source,id:crypto.randomUUID()};delete draft.revision;delete draft.frozen;await api('serverDraftSave',{id:scope,expectedRevision:0,commandId:crypto.randomUUID(),draft});await api('cashWorkspaceSwitch',{scope});await fastSalesViewNow();}
async function cashUseServerDraft(){await api('localDraftRestoreServer',{scope:fastState.scope});await fastSalesViewNow();}
async function cashResumeDraft(){const result=await api('serverDraftResume',{draftId:fastState.scope,expectedRevision:fastState.serverDraftRevision});await api('cashWorkspaceSync',{scope:fastState.scope,revision:result.revision});await fastSalesViewNow();}
async function cashWorkspaceQuote(lines,discount){
 if(!fastState.orderId)return api('quote',{menuRevision:fastState.menu.revision,type:fastState.mode,lines:fastQuoteLines(lines),discount});
 const input={draftId:fastState.localDraft?.id??crypto.randomUUID(),draftRevision:Math.max(1,fastState.localDraft?.revision??1),menuRevision:fastState.menu.revision,lines,discount};
 const quote=fastState.mode==='TABLE'?await api('batchPrepare',{sessionId:fastState.sessionId,...input}):await api('counterPrepare',{orderId:fastState.orderId,...input,guestLabel:'',mode:'ACCEPT'});
 if(quote.menuChanged)throw Error('MENU_REVISION_CONFLICT');return quote;
}
async function cashSelectOrder(orderId){
 await cashCartIdle();if(fastState.frozen||fastState.busy)throw Error('DRAFT_FROZEN');
 if(!fastState.closed&&fastState.shift)await cashPersistDraft();
 await cashWorkspaceAction('cashWorkspaceSet',{orderId});fastState.completedSaleId=null;fastState.completedSale=null;await fastSalesView();
}
async function cashSelectNew(mode){
 await cashCartIdle();if(fastState.frozen||fastState.busy&&!fastState.newDraftDefaultMode)throw Error('DRAFT_FROZEN');
 if(!tableQuickSession&&!fastState.orderId&&!fastState.sessionId&&!fastState.lines.length&&fastState.serverDraftRevision){await api('cashDraftForgetLocal',{scope:fastState.scope});await api('serverDraftDiscard',{draftId:fastState.scope,expectedRevision:fastState.serverDraftRevision});}
 else if(!fastState.closed&&fastState.shift&&!fastState.serverDraftOutdated&&(fastState.lines.length||fastState.orderId||fastState.sessionId))await cashPersistDraft();
 if(!tableQuickSession){
  const scope=crypto.randomUUID(),draft={id:crypto.randomUUID(),lines:[],discount:0,menuRevision:fastState.menu.revision,preview:{},cashMeta:{mode:mode??fastState.newDraftDefaultMode??(me.permissions.includes('table.view_status')?'TABLE':'COUNTER'),tableId:null,waiterId:null}};
  await api('serverDraftSave',{id:scope,expectedRevision:0,commandId:crypto.randomUUID(),draft});
  await api('cashWorkspaceSwitch',{scope});fastState.completedSaleId=null;fastState.completedSale=null;fastState.mode=draft.cashMeta.mode;fastState.localDraft=null;await fastSalesView();await fastSalesViewNow();return;
 }
 await cashWorkspaceAction('cashWorkspaceSet',{orderId:null});if(mode)fastState.mode=mode;fastState.localDraft=null;await fastSalesView();
 if(mode&&fastState.mode!==mode){fastState.mode=mode;await cashPersistDraft();fastDrawCart(cashQuery('.fast-cart'));}
}
async function cashSelectDraft(scope){
 await cashCartIdle();if(fastState.frozen||fastState.busy&&!fastState.switchingDraft)throw Error('DRAFT_FROZEN');
 if(!fastState.orderId&&!fastState.sessionId&&scope===fastState.scope){fastState.completedSaleId=null;fastState.completedSale=null;return fastSalesView();}
 if(!fastState.closed&&fastState.shift)await cashPersistDraft();
 await api('cashWorkspaceSwitch',{scope});fastState.completedSaleId=null;fastState.completedSale=null;await fastSalesView();await fastSalesViewNow();
}
async function cashDiscardParked(row){if(!await confirmAction(t('cashDiscardDraftConfirm')))return;await cashCartIdle();const selected=!fastState.orderId&&!fastState.sessionId&&row.id===fastState.scope;await api('cashDraftForgetLocal',{scope:row.id});await api('serverDraftDiscard',{draftId:row.id,expectedRevision:row.revision});if(selected){fastState.lines=[];fastState.localDraft=null;fastState.serverDraftRevision=0;await cashSelectNew(fastState.mode);return;}await fastSalesViewNow();}
async function cashSwitchMode(mode){
 await cashCartIdle();if(mode===fastState.mode)return;if(fastState.frozen||fastState.busy)throw Error('DRAFT_FROZEN');
 if(fastState.orderId||fastState.sessionId)return cashSelectNew(mode);
 const previous=fastState.mode,lock=!tableQuickSession;if(lock)orderFirstBusy(true);
 fastState.quote=null;fastState.quoteVersion++;fastState.pricedLines={};
 try{fastState.mode=mode;if(fastState.shift)await cashPersistDraft();fastDrawCart(cashQuery('.fast-cart'));}
 catch(error){fastState.mode=previous;throw error;}
 finally{if(lock)orderFirstBusy(false);}
}
async function cashAssignTable(tableId){
 await cashCartIdle();if(fastState.sessionId){const visit=await api('visitGet',{id:fastState.sessionId});await api('tableAssign',{sessionId:visit.id,tableId,revision:visit.revision});fastState.visit=await api('visitGet',{id:visit.id});}
 fastState.tableId=tableId;await cashPersistDraft();
}
async function cashEnsureShift(){
 const state=fastState,actor=me.id,shift=await api('shift');if(state!==fastState||!isCashView('fastSales'))return false;fastState.shift=shift;if(shift)return true;
 if(!me.permissions.includes('shift.open'))throw Error('PERMISSION_DENIED');
 if(!await shiftOpenDialog()||state!==fastState||me?.id!==actor||!isCashView('fastSales'))return false;
 fastState.shift=await api('shift');fastState.menu=await api('menu');return !!fastState.shift;
}
async function cashCustomDialog(){
 if(fastState.completedSaleId&&!tableQuickSession)return;
 await cashCartIdle();if(fastState.frozen||fastState.closed)throw Error('DRAFT_FROZEN');if(!me.permissions.includes('order.custom_item.create'))throw Error('PERMISSION_DENIED');if(!await cashEnsureShift())return;
 const dialog=financeModal(t('cashCustomItem'));dialog.classList.add('cash-discount-modal','cash-custom-modal');dialog.append(el('p',t('cashCustomHint'),{className:'muted'}));
 const input=el('input',undefined,{type:'text',inputMode:'none',className:'cash-discount-input'});input.setAttribute('aria-label',t('cashCustomHint'));dialog.append(input);
 const keys=el('div',undefined,{className:'cash-number-pad'}),error=el('p','',{className:'cash-modal-error',role:'status'});
 for(const key of ['1','2','3','4','5','6','7','8','9',',','0','⌫'])fastButton(keys,key,()=>{const value=key==='⌫'?input.value.slice(0,-1):input.value+key;if(/^\d{0,7}([.,]\d{0,2})?$/.test(value))input.value=value;error.textContent='';});dialog.append(keys,error);let busy=false;
 fastButton(dialog,t('cashContinue'),async()=>{if(busy)return;let unitPrice;try{unitPrice=parseCents(input.value);if(unitPrice<=0||unitPrice>999999999)throw Error('INVALID_CUSTOM_AMOUNT');}catch{error.textContent=t('cashAmountInvalid');return;}busy=true;try{await cashMutateCart(lines=>[...lines,{lineId:crypto.randomUUID(),kind:'CUSTOM_AMOUNT',itemId:'CUSTOM_AMOUNT',variantId:null,modifierIds:[],quantity:1,comment:'',unitPrice}]);dialog.close();}catch(e){error.textContent=t('fastPriceUnavailable');cashActionError(e);}finally{busy=false;}},'primary cash-discount-apply');fastButton(dialog,t('cancel'),()=>{if(!busy)dialog.close();});dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});cashFitDialog(dialog);input.focus();
}
function cashDrawAccepted(parent,compact=false){
 const order=fastState.order;if(!order&&!fastState.sessionId)return;
 if(!compact){const identity=el('div',undefined,{className:'cash-order-identity'});identity.append(el('strong',order?fastOrderLabel(order):t('cashNewOrder')),el('span',fastState.mode==='TABLE'?fastTableTitle(fastState.visit?.tableName):t('fastTakeaway')));fastButton(identity,t('cashNewOrder'),()=>cashSelectNew(),'cash-new-order');parent.append(identity);}
 if(fastState.closed){parent.append(el('p',t('cashOrderClosed'),{className:'print-warning'}));if(fastState.lines.length)fastButton(parent,t('cashTransferDraft'),async()=>{const lines=structuredClone(fastState.lines),mode=fastState.mode;await cashSelectNew(mode);await cashMutateCart(current=>[...current,...lines.map(l=>({...l,lineId:crypto.randomUUID()}))]);});}
 if(!order)return;
 const history=el('div',undefined,{className:'cash-package-history'});history.append(el('h3',t('cashAcceptedPackages')));if(compact)orderFirstCorrectionMenu(history);parent.append(history);cashAppendPackages(history,fastState.history?.batches??[],compact);
 let next=fastState.history?.next;if(next!==null&&next!==undefined)fastButton(history,t('cashMorePackages'),async()=>{const page=await api('cashBatches',{orderId:order.id,after:next});cashAppendPackages(history,page.batches);next=page.next;if(next===null)history.querySelector('.cash-load-packages')?.remove();},'cash-load-packages');
 if(!compact)parent.append(el('h3',t('cashNewBatch'),{className:'cash-new-batch-title'}));
}
function cashAppendPackages(parent,batches,compact=false,flat=false){
 for(const batch of batches){
  if(flat&&!batch.lines.some(line=>line.currentQuantity>0))continue;
  const details=el(flat?'div':'details',undefined,{className:flat?'order-first-accepted':'cash-package'}),summary=el(flat?'div':'summary',undefined,{className:flat?'order-first-batch-rule accepted':''});details.dataset.batchId=batch.id;if(flat){const time=el('time',fastTime(batch.submitted_at),{dateTime:new Date(batch.submitted_at).toISOString()}),sender=batch.sender_name?.trim();summary.append(el('span',t('ofAccepted')+(sender?' · '+sender:'')),time);}else summary.append(el('strong',t('cashBatch')+' №'+batch.sequence),el('span',fastTime(batch.submitted_at)+' · '+batch.sender_name),el('small',batch.lines.length+' '+t('fastPositions')+' · '+tableMoney(batch.subtotal)));details.append(summary);
  if(compact&&!flat){details.name='order-first-packages';details.open=fastState.expandedBatchId===batch.id||!fastState.expandedBatchId&&!fastState.lines.length&&batches.length===1;details.ontoggle=()=>{if(details.open){fastState.expandedBatchId=batch.id;for(const other of parent.querySelectorAll('.cash-package'))if(other!==details)other.open=false;}else if(fastState.expandedBatchId===batch.id)fastState.expandedBatchId=null;};}
  const body=el('div',undefined,{className:'cash-package-lines'});
  for(const line of batch.lines){
   if(flat&&!line.currentQuantity)continue;
   const row=el('div',undefined,{className:'cash-package-line'+(!line.currentQuantity?' cancelled':'')}),text=el('div');text.append(el('strong',orderName(line)),el('small',line.currentQuantity?line.currentQuantity+' × '+tableMoney(line.unitPrice)+' · '+tableMoney(line.currentTotal):t('cashCancelledLine')));
   const options=[line.variant?.name,...(line.modifiers??[]).map(m=>m.name)].filter(Boolean);if(options.length)text.append(el('small',options.join(' · ')));
   for(const portion of line.portions??[])if(portion.comment)text.append(el('small',t('cashCommentPrefix')+' '+portion.comment));row.append(text);
   cashFulfillmentCounter(row,line);if(!tableQuickSession)orderFirstLineCorrections(row,line);
   body.append(row);
  }
   if(!batch.kitchenJobs.length)body.append(el('small',t('cashNoKitchen'),{className:'muted'}));else for(const job of batch.kitchenJobs){const status=el('small',t('cashKitchenPrinting')+' · '+job.status,{className:'muted'});status.dataset.printJobId=job.id;body.append(status);}details.append(body);parent.append(details);
 }
}
function cashHistoryPresentationKey(history){
 if(!history?.batches)return null;
 return JSON.stringify([history.orderId,history.orderRevision,history.next,history.batches.map(batch=>{const {lines,kitchenJobs,...data}=batch;return [data,lines.map(({fulfillment,...line})=>line),kitchenJobs.map(job=>job.id)];})]);
}
function cashPatchAcceptedHistory(cart,previous,next){
 if(!cart||cashHistoryPresentationKey(previous)!==cashHistoryPresentationKey(next))return false;
 if(!next?.batches?.length)return !cart.querySelector('.order-first-accepted');
 const expectedLines=next.batches.flatMap(batch=>batch.lines.filter(line=>line.currentQuantity>0)),expectedJobs=next.batches.flatMap(batch=>batch.kitchenJobs);
 const counters=[...cart.querySelectorAll('.order-first-accepted .cash-fulfillment-counter')],statuses=[...cart.querySelectorAll('.order-first-accepted [data-print-job-id]')];
 const byLine=new Map(counters.map(node=>[node.dataset.itemId,node])),byJob=new Map(statuses.map(node=>[node.dataset.printJobId,node]));
 if(counters.length!==expectedLines.length||statuses.length!==expectedJobs.length||byLine.size!==expectedLines.length||byJob.size!==expectedJobs.length||expectedLines.some(line=>!byLine.get(line.id)?.updateFulfillment)||expectedJobs.some(job=>!byJob.has(job.id)))return false;
 for(const line of expectedLines)byLine.get(line.id).updateFulfillment(line);
 for(const job of expectedJobs){const node=byJob.get(job.id),label=t('cashKitchenPrinting')+' · '+job.status;if(node.textContent!==label)node.textContent=label;}
 return true;
}
function cashDrawOrderActions(parent){
 if(!fastState.orderId||fastState.closed)return;
 const row=fastState.order,group=el('div',undefined,{className:'cash-order-actions'});parent.append(group);
 if(me.permissions.includes(row.type==='TABLE'?'order.settle.table':'order.settle.counter'))fastButton(group,t('settle'),async()=>{await cashCartIdle();if(fastState.lines.length){toast('warning',t('cashUnsentBeforePay'));return;}if(fastState.frozen||fastState.busy)throw Error('DRAFT_FROZEN');await paymentDialog(await api('financeGet',{orderId:row.id}));},'cash-pay-order');
 fastButton(group,t('cashOrderActions'),async()=>{await cashCartIdle();const dialog=financeModal(t('cashOrderActions'));await financeOrderActions(dialog,row.id);if(fastState.lines.length)for(const button of dialog.querySelectorAll('button'))if(button.textContent===t('settle'))button.remove();financeClose(dialog);});
}
function cashAssertProposal(quote,displayed){
 const key=q=>JSON.stringify({menuRevision:q.menuRevision,lines:q.lines.map(({lineId,...line})=>line),subtotal:q.subtotal,discount:q.discount,fees:q.fees,total:q.total,revision:q.orderRevision??q.expectedOrderRevision??0});
 if(key(quote)!==key(displayed)||(quote.sessionId&&displayed.sessionId&&(quote.visitRevision??quote.expectedVisitRevision)!==(displayed.visitRevision??displayed.expectedVisitRevision)))throw Error('CONFIRMATION_STALE');
}
async function fastSubmit(){
 if(!tableQuickSession)return orderFirstSend();
 const session=tableQuickSession,state=fastState;if(session.submitting)return;
 await cashCartIdle();if(session.submitting||state!==fastState||!tableQuickIsActive(session)||!isCashView('fastSales'))return;
 if(state.closed||state.frozen)throw Error('ORDER_NOT_OPEN');if(!state.lines.length||!state.quote||!state.shift)throw Error('INVALID_LINES');
 if(!me.permissions.includes('counter.batch.submit'))throw Error('PERMISSION_DENIED');
 session.submitting=true;
 try{
  const lines=structuredClone(state.lines),discount=state.discount,menuRevision=state.menu.revision,proposal=await cashWorkspaceQuote(lines,discount);
  if(state!==fastState||!tableQuickIsActive(session))return;
  cashAssertProposal(proposal,state.quote);
  const result=await fastCommitCounter(lines,menuRevision,discount,proposal);await tableQuickAccepted(result.orderId);
 }catch(error){
  if(error.message==='RESULT_UNKNOWN_RETRY_SAME_ACTION'){cashActionError(error);state.frozen=true;fastDrawCart(cashQuery('.fast-cart'));await tableQuickRecovery();}
  else if(['MENU_REVISION_CONFLICT','CONFIRMATION_STALE','ORDER_REVISION_CONFLICT','ORDER_NOT_OPEN'].includes(error.message)){await tableQuickRefresh();toast('warning',t('fastChanged'));}
  else cashActionError(error);
 }finally{session.submitting=false;}
}
async function fastCommitCounter(lines,menuRevision,discount,proposal){
 await cashPersistDraft(lines,discount);const scope=fastState.scope;await api('counterContext',{draftId:scope});const draft=await api('localDraftRead',{sessionId:scope});if(draft.frozen)throw Error('DRAFT_FROZEN');
 const input={draftId:draft.id,draftRevision:draft.revision,menuRevision,discount,lines:draft.lines,guestLabel:'',mode:'ACCEPT'},orderId=fastState.orderId,q=await api('counterPrepare',{orderId,...input});if(q.menuChanged)throw Error('MENU_REVISION_CONFLICT');cashAssertProposal(q,proposal);
 return api('counterSubmit',{orderId,localScopeId:scope,...input,...financeConfirmation(q)});
}
async function fastCommitTable(lines,menuRevision,discount,proposal){
 if(!fastState.sessionId){
  await cashPersistDraft(lines,discount);
  const opened=await api('cashVisitOpen',{tableId:fastState.tableId??null,responsibleWaiterId:fastState.waiterId??null,localScopeId:fastState.newScope});fastState.sessionId=opened.sessionId;
  await cashWorkspaceAction('cashWorkspaceSet',{orderId:null,sessionId:opened.sessionId});fastState.scope=opened.sessionId;
 }
 await cashPersistDraft(lines,discount);const draft=await api('localDraftRead',{sessionId:fastState.sessionId});if(draft.frozen)throw Error('DRAFT_FROZEN');
 const input={sessionId:fastState.sessionId,draftId:draft.id,draftRevision:draft.revision,menuRevision,discount,lines:draft.lines},q=await api('batchPrepare',input);if(q.menuChanged)throw Error('MENU_REVISION_CONFLICT');cashAssertProposal(q,proposal);
 const result=await api('batchSubmit',{...input,orderRevision:q.orderRevision,confirmationHash:q.confirmationHash});
 // Clear the original local source only after the server accepted the package.
 if(!fastState.orderId){await api('cashDraftContext',{draftId:fastState.newScope,type:'TABLE'});const source=await api('localDraftRead',{sessionId:fastState.newScope});if(source?.lines.length)await api('localDraftSave',{sessionId:fastState.newScope,expectedRevision:source.revision,draft:{...source,lines:[],discount:0,cashMeta:{mode:'TABLE',tableId:null,waiterId:null}}});}
 return result;
}

function cashSaleFulfillment(dialog,orderId){
 const details=el('details',undefined,{className:'cash-sale-issued'});details.append(el('summary',t('cashAcceptedPackages')+' · '+t('cashIssued')));dialog.append(details);let loaded=false;
 details.ontoggle=()=>{if(!details.open||loaded)return;loaded=true;void run(async()=>{try{let after=0;const body=el('div');details.append(body);const load=async()=>{const page=await api('cashBatches',{orderId,after});for(const batch of page.batches){const card=el('section',undefined,{className:'cash-package-lines'});card.append(el('h3',t('cashBatch')+' №'+batch.sequence));for(const line of batch.lines){const row=el('div',undefined,{className:'cash-package-line'});row.append(el('strong',orderName(line)),el('span',line.currentQuantity?(t('cashIssued')+' '+line.fulfillment.issuedQuantity+' / '+line.currentQuantity):t('cashCancelledLine')));if(line.fulfillment.actor)row.append(el('small',line.fulfillment.actor+' · '+fastTime(line.fulfillment.at)));card.append(row);}body.append(card);}after=page.next;more.hidden=after===null;};const more=fastButton(details,t('cashMorePackages'),load);await load();}catch(error){loaded=false;cashActionError(error);}});};
}

const cashFulfillmentBusy=new Set();
function cashFulfillmentCounter(parent,line){
 const orderId=fastState.orderId,actor=fastState.actor,key=actor+':'+line.id,group=el('div',undefined,{className:'cash-fulfillment-counter'}),label=el('small',t('cashIssued')),controls=el('div',undefined,{className:'cash-fulfillment-controls'}),minus=el('button','−',{type:'button'}),count=el('span'),plus=el('button','+',{type:'button'});
 group.dataset.itemId=line.id;
 minus.setAttribute('aria-label',t('cashIssuedDecrease')+' · '+orderName(line));plus.setAttribute('aria-label',t('cashIssuedIncrease')+' · '+orderName(line));group.append(label,controls);controls.append(minus,count,plus);parent.append(group);
 function reflect(){
  const quantity=line.fulfillment.issuedQuantity??(line.fulfillment.issued?line.currentQuantity:0),pending=fastState.fulfillmentPending?.some(p=>p.payload.itemId===line.id),blocked=fastState.closed||fastState.frozen||fastState.busy||!line.currentQuantity||!me.permissions.includes('order.fulfillment.mark')||cashFulfillmentBusy.has(key)||pending;
  count.textContent=quantity+' / '+line.currentQuantity;count.setAttribute('aria-label',t('cashIssued')+' '+quantity+' / '+line.currentQuantity);group.classList.toggle('complete',quantity===line.currentQuantity&&quantity>0);minus.disabled=blocked||quantity===0;plus.disabled=blocked||quantity>=line.currentQuantity;
  if(line.fulfillment.actor)group.title=line.fulfillment.actor+' · '+fastTime(line.fulfillment.at);else group.removeAttribute('title');
  if(pending&&!group.querySelector('.cash-fulfillment-recovery'))fastButton(group,t('checkOriginal'),pendingPanel,'cash-fulfillment-recovery');
 }
 const change=async delta=>{
  if(cashFulfillmentBusy.has(key)||actor!==fastState.actor||orderId!==fastState.orderId)return;
  const quantity=line.fulfillment.issuedQuantity??(line.fulfillment.issued?line.currentQuantity:0),target=quantity+delta;if(target<0||target>line.currentQuantity)return;
  cashFulfillmentBusy.add(key);reflect();
  try{
   await api('fulfillmentMark',{orderId,itemId:line.id,issuedQuantity:target,expectedRevision:line.fulfillment.revision,expectedOrderRevision:fastState.order.revision});
   if(actor===fastState.actor&&isCashView('fastSales')){if(tableQuickSession)await tableQuickRefresh();else await fastSalesView(true);}
  }catch(error){cashActionError(error);if(actor===fastState.actor&&isCashView('fastSales')){try{fastState.fulfillmentPending=(await api('pending')).filter(p=>p.action==='fulfillmentMark');if(tableQuickSession)await tableQuickRefresh();else await fastSalesView();}catch(refreshError){cashActionError(refreshError);}}if(error.message==='RESULT_UNKNOWN_RETRY_SAME_ACTION')await pendingPanel();}
  finally{cashFulfillmentBusy.delete(key);if(group.isConnected)reflect();else for(const counter of cashQuery('.fast-cart')?.querySelectorAll('.cash-fulfillment-counter')??[])counter.dispatchEvent(new Event('fulfillmentidle'));}
 };
 minus.onclick=()=>run(()=>change(-1),minus).finally(()=>{if(group.isConnected)reflect();});plus.onclick=()=>run(()=>change(1),plus).finally(()=>{if(group.isConnected)reflect();});group.addEventListener('fulfillmentidle',reflect);reflect();
 group.updateFulfillment=next=>{line=next;reflect();};
}
