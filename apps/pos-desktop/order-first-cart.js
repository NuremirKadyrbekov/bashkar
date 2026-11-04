'use strict';
// Unified FAST_FIRST cart. TABLE_QUICK keeps the shared legacy presentation.
function initOrderFirstUi(ru,ky){
 Object.assign(ru,{ofCancelOne:'Отменить всё блюдо',ofCancelDish:'Отменить блюдо',ofCancelOneQuestion:'Отменить 1 ×',ofCancelOneReason:'Отмена одной единицы с кассы',ofCancelAllQuestion:'Отменить всё оставшееся количество',ofCancelClosesOrder:'Это последнее блюдо: заказ будет отменён, стол освободится.',ofOrderCancelled:'Заказ отменён',ofCancelBack:'Назад'});
 Object.assign(ky,{ofCancelOne:'Тамактын баарын жокко чыгаруу',ofCancelDish:'Тамакты жокко чыгаруу',ofCancelOneQuestion:'1 × жокко чыгарылсынбы:',ofCancelOneReason:'Кассадан бир даананы жокко чыгаруу',ofCancelAllQuestion:'Калган сандын баарын жокко чыгаруу:',ofCancelClosesOrder:'Бул акыркы тамак: буйрутма жокко чыгарылып, үстөл бошойт.',ofOrderCancelled:'Буйрутма жокко чыгарылды',ofCancelBack:'Артка'});
 const rows={ofTypeChanged:['Тип заказа изменён','Буйрутманын түрү өзгөртүлдү'],ofTypeUnknown:['Проверьте результат смены типа заказа','Буйрутма түрүн өзгөртүүнүн жыйынтыгын текшериңиз'],ofTable:['Стол:','Стол:'],ofUnassigned:['не назначен','дайындалган эмес'],ofOrderType:['Тип заказа','Буйрутманын түрү'],ofShowHistory:['Принятые пакеты','Кабыл алынган топтомдор'],ofBackToDraft:['Вернуться к новому пакету','Жаңы топтомго кайтуу'],ofMovePermission:['Перенос посещения на другой стол','Барууну башка столго көчүрүү'],ofResponsiblePermission:['Смена ответственного официанта','Жооптуу официантты өзгөртүү'],ofOpened:['Открыл:','Ачкан:'],ofResponsible:['Ответственный:','Жооптуу:'],ofAssignmentSaved:['Назначение изменено','Дайындоо өзгөртүлдү'],ofAccessLost:['Доступ к заказу изменился. Ваш дозаказ сохранён лично за вами.','Буйрутмага кирүү өзгөрдү. Кошумча топтомуңуз жеке сакталды.'],ofPrivateDraft:['Неотправленный пакет останется вашим личным черновиком.','Жөнөтүлбөгөн топтом жеке чийме бойдон калат.'],ofTransfer:['Перевод','Которуу'],ofCash:['Наличные','Накталай'],ofMixed:['Смешанная','Аралаш'],ofFirstAmount:['Первая сумма, сом','Биринчи сумма, сом'],ofRemainder:['Остаток','Калдык'],ofPay:['Оплатить','Төлөө'],ofZero:['Завершить без оплаты','Төлөмсүз бүтүрүү'],ofUnknown:['Результат оплаты требует проверки','Төлөм жыйынтыгын текшерүү керек'],ofPaid:['Расчёт сохранён','Эсептешүү сакталды'],ofMenu:['Действия с принятыми позициями','Кабыл алынган позициялар'],ofChooseMode:['Новый заказ','Жаңы буйрутма'],ofSplitInvalid:['Введите положительную сумму меньше итога. Методы должны различаться.','Жыйынтыктан аз оң сумманы киргизиңиз. Ыкмалар ар башка болсун.']};
 rows.ofCompleted=['Завершён','Аяктады'];rows.ofRefunded=['Возвращён','Кайтарылды'];rows.ofPartialRefund=['Частичный возврат','Жарым-жартылай кайтарылды'];rows.ofRefundOrder=['Оформить возврат','Кайтарууну каттоо'];rows.ofReturnToCart=['Вернуться к текущему заказу','Учурдагы буйрутмага кайтуу'];rows.ofRefundRemaining=['Осталось вернуть','Кайтарылуучу калдык'];rows.ofNoRefund=['Возврат недоступен: заказ завершён без оплаты','Кайтаруу жеткиликсиз: буйрутма төлөмсүз аяктаган'];rows.ofSettledBy=['Завершил:','Аяктаган:'];
 rows.ofAssignWaiter=['Назначить официанта','Официантты дайындоо'];rows.ofDraftActions=['Назначения заказа','Буйрутманы дайындоо'];rows.ofOrderActions=['Действия с заказом','Буйрутма аракеттери'];rows.ofNewPositions=['Новые позиции','Жаңы позициялар'];rows.ofAccepted=['Принято','Кабыл алынды'];rows.ofSendOrder=['Отправить заказ','Буйрутманы жөнөтүү'];rows.ofCancelOrderHint=['Отменить весь заказ с указанием причины','Себебин көрсөтүп, бүт буйрутманы жокко чыгаруу'];
 rows.ofCancelAvailable=['Доступно для отмены:','Жокко чыгарууга болот:'];rows.ofCancelLess=['Уменьшить отменяемое количество','Жокко чыгарылуучу санды азайтуу'];rows.ofCancelMore=['Увеличить отменяемое количество','Жокко чыгарылуучу санды көбөйтүү'];rows.ofCancelAmount=['Сумма отмены:','Жокко чыгаруу суммасы:'];rows.ofCancelNewTotal=['Новый итог заказа:','Буйрутманын жаңы жалпы суммасы:'];rows.ofCancelCheck=['Проверить отмену','Жокко чыгарууну текшерүү'];rows.ofCancelConfirm=['Подтвердить отмену','Жокко чыгарууну ырастоо'];rows.ofReasonChanged=['Гость передумал','Конок оюн өзгөрттү'];rows.ofReasonMistake=['Добавлено по ошибке','Жаңылыш кошулган'];rows.ofReasonUnavailable=['Блюдо недоступно','Тамак жок'];rows.ofReasonOther=['Другое','Башка'];
 for(const [key,[r,k]]of Object.entries(rows)){ru[key]=r;ky[key]=k;}
}
function orderFirstBusy(value){fastState.busy=value;document.getElementById('app-shell').inert=value;if(!value&&isCashView('fastSales')&&!tableQuickSession){const add=cashQuery('.order-first-new');if(add)add.disabled=!!fastState.frozen;orderFirstDrawCart(cashQuery('.fast-cart'),true);}}
function orderFirstButton(parent,text,handler,cls){const b=fastButton(parent,text,handler,cls);b.disabled=!!fastState.busy||!!fastState.frozen;return b;}
async function orderFirstNewOrder(){
 if(fastState.frozen||fastState.busy)throw Error('DRAFT_FROZEN');
 fastState.newDraftDefaultMode=me.permissions.includes('table.view_status')?'TABLE':'COUNTER';
 orderFirstBusy(true);try{await cashCartIdle();await cashSelectNew();}finally{delete fastState.newDraftDefaultMode;orderFirstBusy(false);}
}
async function orderFirstSelectDraft(scope){if(fastState.frozen||fastState.busy)throw Error('DRAFT_FROZEN');fastState.switchingDraft=true;orderFirstBusy(true);try{await cashCartIdle();await cashSelectDraft(scope);}finally{delete fastState.switchingDraft;orderFirstBusy(false);}}
function orderFirstModeIcon(mode){return mode==='TABLE'?el('img',undefined,{src:'./assets/table-outline.png',alt:'',className:'order-first-table-icon'}):fastIcon(mode);}
function orderFirstPersonIcon(){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','order-first-person-icon');svg.setAttribute('aria-hidden','true');path.setAttribute('d','M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a8 8 0 0 1 16 0v2Z');svg.append(path);return svg;}
function orderFirstDraftActions(parent){
 if(fastState.order||fastState.closed||fastState.mode!=='TABLE')return;
 const table=fastState.tables?.tables.find(row=>row.id===fastState.tableId);
 for(const [label,value,display,handler,cls,icon]of [[t('fastChooseTable'),table?fastTableTitle(table.name):t('ofUnassigned'),table?fastTableTitle(table.name):t('ofTable'),fastTableDialog,'table',orderFirstModeIcon('TABLE')],[t('ofResponsible'),fastState.waiterName??me.name,fastState.waiterName??me.name,fastWaiterDialog,'waiter',orderFirstPersonIcon()]]){
  const button=orderFirstButton(parent,'',handler,'order-first-head-assignment '+cls);button.append(icon,el('span',display));button.setAttribute('aria-label',label+': '+value);button.title=label+': '+value;button.disabled||=!me.permissions.includes(fastState.sessionId?(cls==='table'?'table.move':'table.responsible.change'):'table.open');
 }
}
function orderFirstModes(parent){
 if(fastState.orderId||fastState.order||fastState.closed)return;
 const tabs=el('div',undefined,{className:'fast-modes order-first-modes',role:'tablist'});tabs.setAttribute('aria-label',t('ofOrderType'));
 for(const [mode,label]of [['TABLE','fastHall'],['COUNTER','fastTakeaway']])if(me.permissions.includes(mode==='TABLE'?'table.view_status':'counter.view')){
  const tab=orderFirstButton(tabs,'',()=>orderFirstSwitchMode(mode),fastState.mode===mode?'selected':'');tab.append(orderFirstModeIcon(mode),el('span',t(label)));tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(fastState.mode===mode));tab.dataset.mode=mode;
 }
 parent.append(tabs);
}
async function orderFirstSwitchMode(mode){
 await cashCartIdle();if(fastState.orderId||fastState.order)throw Error('INVALID_ORDER_TYPE');if(fastState.busy||fastState.frozen)throw Error('DRAFT_FROZEN');
 if(mode===fastState.mode)return;
 if(!fastState.sessionId)return cashSwitchMode(mode);
 orderFirstBusy(true);
 try{
  // A failed first submission may leave a real empty visit. Save its exact private draft
  // in the new-order scope before closing it; native pending binds recovery to that close.
  const visit=await api('visitGet',{id:fastState.sessionId});if(await api('orderGet',{sessionId:visit.id}))throw Error('ORDER_REVISION_CONFLICT');
  await cashPersistDraft();
  await api('cashReleaseEmpty',{sessionId:visit.id,revision:visit.revision,localScopeId:fastState.newScope});
  await fastSalesView();
 }catch(error){await orderFirstFailure(error,'ofTypeUnknown');}finally{orderFirstBusy(false);cashRefreshQueued();}
}
function orderFirstAssignments(parent){
 const order=fastState.order,visit=fastState.visit;if(!order)return;const group=el('div',undefined,{className:'order-first-assignments'});parent.append(group);
 const creator=visit?.openedBy?.name??fastState.history?.batches?.[0]?.sender_name;
 if(fastState.mode==='TABLE'){
  const table=fastState.tables?.tables.find(t=>t.id===fastState.tableId),tableName=table?fastTableTitle(table.name):t('ofUnassigned');
  const line=(label,value,handler,permission,cls)=>{
   const allowed=me.permissions.includes(permission)&&!fastState.closed;
   const content=()=>{if(cls==='waiter'){const text=el('span',undefined,{className:'order-first-waiter-text'});text.append(el('span',t('ofResponsible')),el('small',value));return [orderFirstPersonIcon(),text,el('span','›',{className:'order-first-assignment-arrow','aria-hidden':'true'})];}return [orderFirstModeIcon('TABLE'),el('span',label+' '+value),el('span','›',{className:'order-first-assignment-arrow','aria-hidden':'true'})];};
   if(allowed){const b=orderFirstButton(group,'',handler,'order-first-assignment '+cls);b.append(...content());}
   else{const text=el('div',undefined,{className:'order-first-assignment readonly '+cls});text.append(...content());group.append(text);}
  };
  line(t('ofTable'),tableName,fastTableDialog,fastState.sessionId?'table.move':'table.open','table');
  line(t('ofResponsible'),fastState.waiterName??(me.role==='WAITER'?me.name:t('noWaiter')),fastWaiterDialog,fastState.sessionId?'table.responsible.change':'table.open','waiter');
  if(order&&creator)group.append(el('div',t('ofOpened')+' '+creator,{className:'order-first-creator'}));
 }else if(order){
  group.append(el('div',t('ofOrderType')+': '+t('fastTakeaway'),{className:'order-first-type'}));
  if(creator)group.append(el('div',t('ofOpened')+' '+creator,{className:'order-first-creator'}));
 }
}
function orderFirstDrawCart(parent,validated=false){
 if(!parent)return;
 if(fastState.completedSaleId)return orderFirstDrawSale(parent);
 parent.classList.remove('order-first-completed');
 const context=fastState.orderId??fastState.sessionId??fastState.scope,prior=parent.querySelector('.order-first-timeline'),changed=fastState.timelineContext!==context,scroll=prior?.scrollTop??(!changed?fastState.timelineScroll??0:0),oldIds=fastState.timelineDraftIds??[],ids=fastState.lines.map(line=>line.lineId),added=ids.filter(id=>!oldIds.includes(id));
 const revealId=fastState.timelineRevealLineId,scrollToLatest=fastState.timelineScrollToLatest===context;delete fastState.timelineRevealLineId;fastState.timelineContext=context;fastState.timelineDraftIds=ids;
 if(!validated){fastState.quote=null;fastState.pricedLines={};}document.getElementById('app-shell').dataset.saleMode=fastState.mode;
 parent.replaceChildren();parent.classList.add('order-first-cart');
 const head=el('div',undefined,{className:'fast-cart-head'}),tableFirstTable=typeof tableCartSelection!=='undefined'&&tableCartSelection?.kind==='table'&&cashDisplay==='tables'?fastState.tables?.tables.find(row=>row.id===tableCartSelection.id):null;
 head.append(el('h2',fastState.checkoutPending?t('ofUnknown'):tableFirstTable?fastTableTitle(tableFirstTable.name)+(fastState.order?' · '+fastOrderLabel(fastState.order):''):fastState.order?fastOrderLabel(fastState.order):t('cashNewOrder')));
 if(!fastState.order)orderFirstDraftActions(head);else orderFirstCorrectionMenu(head);
 const clear=orderFirstButton(head,'',async()=>{await cashCartIdle();if(fastState.lines.length&&await confirmAction(t('clearOrderConfirm')))await cashMutateCart(()=>[]);},'fast-clear');clear.append(cashActionIcon('reset'));clear.setAttribute('aria-label',t('fastClear'));clear.title=t('fastClear');clear.disabled||=!fastState.lines.length||fastState.closed;
 const custom=orderFirstButton(head,'',cashCustomDialog,'cash-custom-add');custom.append(cashActionIcon('plus'));custom.setAttribute('aria-label',t('cashCustomItem'));custom.title=t('cashCustomItem');custom.disabled||=fastState.closed||!me.permissions.includes('order.custom_item.create');parent.append(head);
 orderFirstModes(parent);orderFirstAssignments(parent);
 if(fastState.serverDraftConflict){parent.append(el('p',t('cashDraftConflict'),{className:'print-warning'}));const actions=el('div',undefined,{className:'cash-draft-recovery'});fastButton(actions,t('cashForkDraft'),cashForkDraft);fastButton(actions,t('cashUseServerDraft'),cashUseServerDraft);parent.append(actions);}else if(fastState.serverDraftOutdated){parent.append(el('p',t('cashOldShift'),{className:'print-warning'}));fastButton(parent,t('cashResumeDraft'),cashResumeDraft,'cash-draft-resume');}
 const body=el('div',undefined,{className:'order-first-body order-first-timeline'});body.setAttribute('aria-label',t('cashOrder'));body.addEventListener('scroll',()=>{if(body.isConnected&&fastState.timelineContext===context)fastState.timelineScroll=body.scrollTop;});parent.append(body);
 if(fastState.closed){body.append(el('p',t(fastState.order?.status==='CANCELLED'&&!fastState.lines.length?'ofOrderCancelled':'cashOrderClosed'),{className:'print-warning'}));if(fastState.lines.length)fastButton(body,t('cashTransferDraft'),async()=>{const lines=structuredClone(fastState.lines);await cashSelectNew(fastState.mode);await cashMutateCart(current=>[...current,...lines.map(line=>({...line,lineId:crypto.randomUUID()}))]);});}
 cashAppendPackages(body,fastState.history?.batches??[],true,true);
 let draft=null;
 if(fastState.lines.length&&!fastState.checkoutPending){
  draft=el('div',undefined,{className:'order-first-draft'});draft.append(el('div',t('ofNewPositions'),{className:'order-first-batch-rule draft'}));
  const list=el('div',undefined,{className:'fast-cart-list'});cashDrawLines(list,true);list.inert=!!fastState.frozen||!!fastState.closed||!!fastState.serverDraftConflict||!!fastState.serverDraftOutdated;draft.append(list);body.append(draft);
 }else if(!fastState.order&&!fastState.checkoutPending)body.append(el('p',t('fastEmptyCart'),{className:'order-first-empty muted'}));
 const foot=el('div',undefined,{className:'fast-cart-foot'});parent.append(foot);
 if(fastState.frozen){foot.append(el('p',t('fastUnknown'),{className:'print-warning'}));fastButton(foot,t('checkOriginal'),orderFirstRecovery,'order-first-recovery');}
 const totals=el('div',undefined,{className:'fast-totals'}),payments=el('div',undefined,{className:'order-first-payments'});foot.append(totals,payments);
 if(!fastState.shift)foot.append(el('p',t('fastShiftRequired'),{className:'print-warning'}));
 if(fastState.checkoutPending)orderFirstTotals(totals,{subtotal:0,total:0,discount:0,fees:[]});
 else if(!fastState.lines.length){fastState.quote=null;fastState.quoteVersion++;fastRenderTotals(totals,fastState.order??{subtotal:0,discount:0,total:0,fees:[]});}
 else if(validated&&fastState.quote)fastRenderTotals(totals,fastState.quote);else void fastQuote();
 requestAnimationFrame(()=>{
  if(!body.isConnected)return;
  if(scrollToLatest&&!draft){body.scrollTop=body.scrollHeight;fastState.timelineScrollToLatest=false;}
  else if(draft&&(changed||!oldIds.length&&ids.length)){body.scrollTop=draft.offsetTop;}
  else if(draft&&(added.length||revealId)){const target=[...draft.querySelectorAll('[data-line-id]')].find(node=>node.dataset.lineId===(revealId??added.at(-1)));body.scrollTop=scroll;if(target){const rect=target.getBoundingClientRect(),viewport=body.getBoundingClientRect();if(rect.bottom>viewport.bottom)body.scrollTop+=rect.bottom-viewport.bottom+8;else if(rect.top<viewport.top)body.scrollTop+=rect.top-viewport.top-8;}}
  else body.scrollTop=changed?body.scrollHeight:scroll;fastState.timelineScroll=body.scrollTop;
 });
 parent.cashRenderKey=fastCartStateKey();
}
function orderFirstTotals(box,q){
 box.replaceChildren();fastState.displayedQuote=q;fastState.displayedVisitRevision=fastState.mode==='TABLE'?(fastState.visit?.revision??null):null;
 const discount=orderFirstButton(box,'',fastDiscountDialog,'fast-discount-action');discount.append(el('span',t('fastDiscount')+' ›'),el('strong',tableMoney(q.discount)));discount.disabled||=fastState.closed||!me.permissions.includes('order.discount.set')||!fastState.lines.length&&!fastState.order;
 if(fastState.lines.length){const row=el('div',undefined,{className:'fast-grand order-first-batch-total'});row.append(el('span',t('cashNewBatch')),el('strong',tableMoney(q.batchSubtotal??(q.lines??[]).reduce((sum,line)=>sum+line.total,0))));box.append(row);}
 const total=el('div',undefined,{className:'fast-grand'});total.append(el('span',t('fastTotal')),el('strong',tableMoney(q.total)));box.append(total);orderFirstPaymentState(q);
}
function orderFirstPaymentState(q){
 const group=cashQuery('.order-first-payments');if(!group)return;group.replaceChildren();
 if(fastState.completedSaleId||fastState.frozen||fastState.checkoutPending||fastState.closed)return;
 const blocked=!q||cashLinePending>0||fastState.busy||fastState.serverDraftConflict||fastState.serverDraftOutdated||!fastState.shift;
 if(fastState.lines.length){const send=orderFirstButton(group,t('ofSendOrder'),fastSubmit,'primary fast-submit');send.disabled||=blocked||!me.permissions.includes(fastState.mode==='TABLE'?'table.batch.submit':'counter.batch.submit');return;}
 if(!fastState.order)return;
 const choices=q?.total===0?[['ofZero',{kind:'ZERO'}]]:[['ofCash',{kind:'SINGLE',method:'CASH'}],['ofTransfer',{kind:'SINGLE',method:'QR_TRANSFER_MANUAL'}],['ofMixed',null]];
 for(const [label,payment]of choices){const button=orderFirstButton(group,t(label),()=>payment?orderFirstCheckout(payment):orderFirstMixed(),'primary order-first-pay');button.dataset.method=payment?.method??payment?.kind??'MIXED';button.disabled||=blocked||!me.permissions.includes(fastState.mode==='TABLE'?'order.settle.table':'order.settle.counter');}
}
async function orderFirstSend(){
 const state=fastState;await cashCartIdle();if(state!==fastState||state.completedSaleId||state.busy||state.frozen||state.closed)throw Error('DRAFT_FROZEN');
 if(!state.lines.length||!state.quote)throw Error('INVALID_LINES');let displayed=structuredClone(state.quote);orderFirstBusy(true);
 try{
  const menu=await api('menu');state.menu=menu;const q=await cashWorkspaceQuote(state.lines,state.discount);
  const changes=cashDraftChanges(q);if(changes.length){if(!await cashDraftConfirmChanges(changes,displayed,q))return;await cashPersistDraft(state.lines,state.discount,{quote:q,acceptAll:true});displayed=q;}else if(displayed.menuRevision!==q.menuRevision){if(cashDraftQuoteKey(displayed)!==cashDraftQuoteKey(q))throw Error('CONFIRMATION_STALE');displayed=q;}
  else cashAssertProposal(q,displayed);
  const result=state.mode==='TABLE'?await fastCommitTable(structuredClone(state.lines),state.menu.revision,state.discount,displayed):await fastCommitCounter(structuredClone(state.lines),state.menu.revision,state.discount,displayed);
  state.timelineScrollToLatest=result.orderId;await cashWorkspaceAction('cashWorkspaceSet',{orderId:result.orderId,sessionId:state.mode==='TABLE'?state.sessionId:null});if(typeof tableCartSelection!=='undefined'&&tableCartSelection&&cashDisplay==='tables')tableCartSelection=state.mode==='TABLE'?{kind:'table',id:state.tableId}:{kind:'order',id:result.orderId};await fastSalesView();message();toast('success',t('batchAccepted'));
 }catch(error){await orderFirstFailure(error);}finally{orderFirstBusy(false);cashRefreshQueued();}
}
async function orderFirstCheckout(payment,dialog=null){
 const state=fastState;await cashCartIdle();if(state!==fastState||state.completedSaleId||state.busy||state.frozen||state.closed)throw Error('DRAFT_FROZEN');
 if(state.lines.length)throw Error('UNSENT_POSITIONS');
 const displayed=structuredClone(state.displayedQuote),displayedVisitRevision=state.displayedVisitRevision;if(!displayed||!state.lines.length&&!state.order)throw Error('INVALID_LINES');
 orderFirstBusy(true);if(dialog)for(const control of dialog.querySelectorAll('button,input,select'))control.disabled=true;
 try{
  if(state.lines.length)await cashPersistDraft();
  const d=state.localDraft,draft=state.lines.length?{draftId:d.id,draftRevision:d.revision,menuRevision:d.menuRevision,lines:d.lines,discount:state.discount}:null;
  const input={orderId:state.orderId??null,type:state.mode,sessionId:state.sessionId??null,opening:state.mode==='TABLE'&&!state.sessionId?{tableId:state.tableId??null,responsibleWaiterId:state.waiterId??null}:null,draft,payment};
  const q=await api('checkoutPrepare',input);
  if(draft)cashAssertProposal(q,displayed);
  else if(q.total!==displayed.total||q.discount!==displayed.discount||q.expectedOrderRevision!==displayed.revision)throw Error('CONFIRMATION_STALE');
  if(q.expectedVisitRevision!==displayedVisitRevision)throw Error('CONFIRMATION_STALE');
  if(q.menuChanged)throw Error('MENU_REVISION_CONFLICT');
  await api('checkoutCommit',{...input,...financeConfirmation(q),localScopeId:state.scope});
  if(dialog)dialog.close();await fastSalesView();message();toast('success',t('ofPaid'));
 }catch(error){if(dialog)dialog.close();await orderFirstFailure(error);}finally{orderFirstBusy(false);cashRefreshQueued();}
}
async function orderFirstFailure(error,unknownLabel='ofUnknown'){
 if(error.message==='RESULT_UNKNOWN_RETRY_SAME_ACTION'){fastState.frozen=true;await fastSalesView();toast('warning',t(unknownLabel));return;}
 if(['CONFIRMATION_STALE','MENU_REVISION_CONFLICT','ORDER_REVISION_CONFLICT','REVISION_CONFLICT','TABLE_OCCUPIED','ORDER_NOT_OPEN'].includes(error.message)){await fastSalesView();toast('warning',t('fastChanged'));return;}
 cashActionError(error);
}
async function orderFirstRecovery(){
 await cashCartIdle();if(fastState.busy)return;orderFirstBusy(true);
 try{
  const pending=await api('pending'),p=fastState.checkoutPending??fastState.cancelPending??pending.find(p=>['batchSubmit','counterSubmit','cashVisitOpen','cashReleaseEmpty'].includes(p.action)&&(p.payload.sessionId===fastState.sessionId||p.payload.localScopeId===fastState.scope));
  if(!p)throw Error('PENDING_COMMAND_UNAVAILABLE');const result=await api('retryPending',{key:p.key});if(['batchSubmit','counterSubmit'].includes(p.action))fastState.timelineScrollToLatest=result.orderId;await fastSalesView();message();toast('success',t(p.action==='checkoutCommit'?'ofPaid':p.action==='cashReleaseEmpty'?'ofTypeChanged':p.action==='correctCommit'?'corrected':'batchAccepted'));
 }catch(error){cashActionError(error);}finally{orderFirstBusy(false);}
}
async function orderFirstMixed(){
 await cashCartIdle();if(fastState.lines.length)throw Error('UNSENT_POSITIONS');const total=fastState.displayedQuote?.total;if(!total||fastState.busy||fastState.frozen)return;
 const dialog=financeModal(t('ofMixed'));dialog.classList.add('cash-discount-modal','order-first-mixed');
 const choices=el('div',undefined,{className:'order-first-split-methods'}),first=el('select'),second=el('select');
 first.setAttribute('aria-label',t('mixedFirst'));second.setAttribute('aria-label',t('mixedSecond'));
 for(const method of ['CASH','QR_TRANSFER_MANUAL','CARD_MANUAL']){first.append(el('option',financeMethod(method),{value:method}));second.append(el('option',financeMethod(method),{value:method}));}second.value='QR_TRANSFER_MANUAL';choices.append(first,second);dialog.append(choices);
 const input=el('input',undefined,{type:'text',inputMode:'decimal',className:'cash-discount-input'});input.setAttribute('aria-label',t('ofFirstAmount'));input.placeholder=t('ofFirstAmount');const remainder=el('p',''),error=el('p','',{className:'cash-modal-error',role:'status'}),keys=el('div',undefined,{className:'cash-number-pad'});dialog.append(input,keys,remainder,error);
 const update=()=>{try{const n=parseCents(input.value);remainder.textContent=t('ofRemainder')+': '+tableMoney(Math.max(0,total-n));}catch{remainder.textContent=t('ofRemainder')+': '+tableMoney(total);}error.textContent='';};input.oninput=update;first.onchange=second.onchange=update;
 for(const key of ['1','2','3','4','5','6','7','8','9',',','0','⌫'])fastButton(keys,key,()=>{const value=key==='⌫'?input.value.slice(0,-1):input.value+key;if(/^\d{0,7}([.,]\d{0,2})?$/.test(value))input.value=value;update();});update();
 fastButton(dialog,t('ofPay'),async()=>{let amount;try{amount=parseCents(input.value);}catch{error.textContent=t('ofSplitInvalid');return;}if(amount<=0||amount>=total||first.value===second.value){error.textContent=t('ofSplitInvalid');return;}await orderFirstCheckout({kind:'MIXED',firstMethod:first.value,firstAmount:amount,secondMethod:second.value},dialog);},'primary cash-discount-apply');financeClose(dialog);dialog.addEventListener('cancel',e=>{if(fastState.busy)e.preventDefault();});cashFitDialog(dialog);
}
function orderFirstCorrectionMenu(parent){
 if(fastState.closed||!me.permissions.some(p=>['order.correct','order.cancel'].includes(p)))return;
 const b=orderFirstButton(parent,'⋯',async()=>{await cashCartIdle();if(fastState.frozen)throw Error('DRAFT_FROZEN');const dialog=financeModal(t('ofOrderActions'));dialog.classList.add('order-first-actions-dialog');const close=fastButton(dialog,'×',()=>dialog.close(),'order-first-actions-close');close.setAttribute('aria-label',t('cancel'));try{await financeOrderActions(dialog,fastState.orderId,{orderFirst:true});cashFitDialog(dialog);}catch(error){dialog.close();throw error;}},'order-first-corrections');b.setAttribute('aria-label',t('ofOrderActions'));
}
function orderFirstLineCorrections(parent,line){
 if(fastState.closed||!line.currentQuantity||!me.permissions.includes('order.correct'))return;
 const trigger=orderFirstButton(parent,'⋯',()=>{if(menu.matches(':popover-open'))menu.hidePopover();else{menu.showPopover();const rect=trigger.getBoundingClientRect(),width=menu.offsetWidth||110,height=menu.offsetHeight||56;menu.style.left=Math.max(8,Math.min(innerWidth-width-8,rect.right-width))+'px';menu.style.top=(rect.bottom+height+8<innerHeight?rect.bottom+5:Math.max(8,rect.top-height-5))+'px';}},'order-first-line-more');
 trigger.setAttribute('aria-label',t('ofMenu')+' · '+orderName(line));trigger.setAttribute('aria-expanded','false');
 const menu=el('div',undefined,{popover:'auto',className:'order-first-line-popover'});menu.setAttribute('role','menu');
 const cancel=fastButton(menu,'×',()=>{menu.hidePopover();return orderFirstCancelOne(line);},'order-first-popover-action cancel');cancel.setAttribute('aria-label',t('cancelQuantity')+' · '+orderName(line));cancel.title=t('cancelQuantity');cancel.disabled=fastState.frozen||fastState.busy;
 if(line.kind!=='CUSTOM_AMOUNT'){
  const edit=fastButton(menu,'✎',()=>{menu.hidePopover();return orderFirstCommentDialog(line);},'order-first-popover-action comment');edit.setAttribute('aria-label',t('changeComment')+' · '+orderName(line));edit.title=t('changeComment');edit.disabled=fastState.frozen||fastState.busy;
 }
 menu.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));
 parent.append(menu);
}
async function orderFirstCommentDialog(line){
 await cashCartIdle();if(fastState.frozen||fastState.closed)throw Error('DRAFT_FROZEN');
 const order=await api('financeGet',{orderId:fastState.orderId}),portions=order.lines.filter(p=>p.itemId===line.id&&p.quantity>0);
 if(order.status!=='OPEN'||!portions.length)throw Error('ORDER_NOT_OPEN');
 const dialog=financeModal(t('changeComment'));dialog.classList.add('order-first-comment-select');
 dialog.append(el('p',orderName(line)));
 for(const portion of portions){const row=el('div',undefined,{className:'order-first-comment-portion'}),label=el('span',portion.quantity+' × '+(portion.comment||'—'));row.append(label);let edit;const qty=cashCommentQuantityCounter(row,portion.quantity,count=>{if(edit)edit.disabled=count===0;});edit=fastButton(row,t('changeComment'),()=>{const count=qty.value();if(count<1)return;dialog.close();return correctionDialog(order,'CHANGE_COMMENT',[{itemId:line.id,portionId:portion.id,quantity:count}]);});edit.disabled=qty.value()===0;dialog.append(row);}
 financeClose(dialog);cashFitDialog(dialog);
}

// Completed-sale viewing overlays the cart without changing its durable workspace.
async function orderFirstSelectSale(orderId){
 await cashCartIdle();if(fastState.busy||fastState.frozen)throw Error('DRAFT_FROZEN');
 const actor=fastState.actor;orderFirstBusy(true);
 try{
  if(!fastState.closed&&fastState.shift&&!fastState.serverDraftOutdated)await cashPersistDraft();
  const sale=await api('saleDetails',{orderId});if(actor!==fastState.actor||!isCashView('fastSales'))return;
  fastState.completedSaleId=orderId;fastState.completedSale=sale;fastState.quoteVersion++;await fastSalesView();
 }finally{orderFirstBusy(false);cashRefreshQueued();}
}
async function orderFirstReturnToCart(){if(fastState.busy)return;fastState.completedSaleId=null;fastState.completedSale=null;await fastSalesView();}
function orderFirstSaleState(sale){return t(sale.refundState==='ALL_PAYMENTS'?'ofRefunded':sale.refundState==='SOME_PAYMENTS'?'ofPartialRefund':'ofCompleted');}
function orderFirstDrawSale(parent){
 const sale=fastState.completedSale;if(!sale)return;parent.replaceChildren();parent.classList.add('order-first-cart','order-first-completed');document.getElementById('app-shell').dataset.saleMode=sale.type;
 const head=el('div',undefined,{className:'fast-cart-head'});head.append(el('h2',fastOrderLabel(sale)));parent.append(head);
 const identity=el('div',undefined,{className:'order-first-sale-identity'}),status=el('strong',orderFirstSaleState(sale),{className:'order-first-sale-status'+(sale.refundState==='ALL_PAYMENTS'?' refunded':'')});
 identity.append(status,el('span',(sale.type==='TABLE'?fastTableTitle(sale.tableName):t('fastTakeaway'))+' · '+shiftDate(sale.settledAt)));
 if(sale.type==='TABLE'){const assignment=el('span',t('ofResponsible')+' '+(sale.responsibleWaiter?.name??t('noWaiter')));identity.append(assignment);}
 if(sale.openedBy)identity.append(el('small',t('ofOpened')+' '+sale.openedBy.name));identity.append(el('small',t('ofSettledBy')+' '+sale.actor.name));if(sale.guestLabel)identity.append(el('span',sale.guestLabel));parent.append(identity);
 const body=el('div',undefined,{className:'order-first-body order-first-timeline order-first-sale-lines'});body.setAttribute('aria-label',t('saleDetails'));parent.append(body);
 for(const line of sale.lines){
  const row=el('article',undefined,{className:'order-first-sale-line'}),details=el('div');details.append(el('strong',orderName(line)));
  const selection=line.combination?orderName(line.combination):[line.variant?orderName(line.variant):'',...(line.modifiers??[]).map(orderName)].filter(Boolean).join(' · ');if(selection)details.append(el('small',selection));
  for(const component of line.components??[])details.append(el('small',component.quantity*line.quantity+' × '+orderName(component)+(orderSnapshotSelection(component)?' · '+orderSnapshotSelection(component):'')));
  if(line.comment)details.append(el('small',line.comment,{className:'order-comment'}));row.append(details,el('span',tableMoney(line.unitPrice)+' × '+line.quantity),el('b',tableMoney(line.total)));body.append(row);
 }
 const payments=el('div',undefined,{className:'order-first-sale-payment-info'});for(const payment of sale.payments){payments.append(el('p',financeMethod(payment.method)+' · '+tableMoney(payment.amount)));if(payment.refundId)payments.append(el('small',t('refundRegistered')+' · '+payment.refundReason+' · '+payment.refundedBy+' · '+shiftDate(payment.refundedAt)));}body.append(payments);if(serverSchema>=14)cashSaleFulfillment(body,sale.id);
 const foot=el('div',undefined,{className:'fast-cart-foot'});parent.append(foot);const totalRow=(label,amount,cls='fast-total-row')=>{const row=el('div',undefined,{className:cls});row.append(el('span',label),el('strong',tableMoney(amount)));foot.append(row);};
 totalRow(t('fastSubtotal'),sale.subtotal);totalRow(t('fastDiscount'),sale.discount);for(const fee of sale.fees??[])totalRow(fee.name,fee.amount);totalRow(t('fastTotal'),sale.total,'fast-grand');
 const remaining=sale.payments.filter(p=>!p.refundId).reduce((sum,p)=>sum+p.amount,0);if(sale.refundState==='SOME_PAYMENTS')totalRow(t('ofRefundRemaining'),remaining);
 const refund=fastButton(foot,t(fastState.completedRefundPending?'checkOriginal':'ofRefundOrder'),()=>orderFirstRefundSale(sale.id),'order-first-refund');refund.disabled=fastState.busy||!remaining&&!fastState.completedRefundPending||!me.permissions.includes('payment.refund');if(!me.permissions.includes('payment.refund'))refund.title=t('permissionDenied');if(!sale.payments.length)foot.append(el('small',t('ofNoRefund'),{className:'muted'}));
 fastButton(foot,t('ofReturnToCart'),orderFirstReturnToCart,'order-first-return');
}
async function orderFirstRefundSale(orderId){
 if(fastState.busy||fastState.completedSaleId!==orderId)return;me=await api('me');if(!me.permissions.includes('payment.refund'))throw Error('PERMISSION_DENIED');
 const sale=await api('saleDetails',{orderId});if(fastState.completedSaleId!==orderId)return;fastState.completedSale=sale;
 const pending=await api('pending');if(pending.some(p=>p.action==='orderRefundCommit'&&p.payload.orderId===orderId||p.action==='refundCommit'&&sale.payments.some(payment=>payment.id===p.payload.paymentId))){await pendingPanel();return;}
 if(!sale.payments.some(p=>!p.refundId)){orderFirstDrawSale(cashQuery('.fast-cart'));return;}
 const m=shiftModal('ofRefundOrder');m.dialog.dataset.permission='payment.refund';m.dialog.classList.add('order-first-refund-dialog');
 m.body.append(el('strong',fastOrderLabel(sale)),el('p',t('ofRefundRemaining')+' · '+tableMoney(sale.payments.filter(p=>!p.refundId).reduce((sum,p)=>sum+p.amount,0))));
 for(const p of sale.payments.filter(p=>!p.refundId))m.body.append(el('p',financeMethod(p.method)+' · '+tableMoney(p.amount)));
 m.body.append(el('p',t('refundExternal')));const reason=field(m.body,'refundReason'),label=el('label'),actual=el('input',undefined,{type:'checkbox'});actual.setAttribute('aria-label',t('refundActual'));label.append(actual,document.createTextNode(t('refundActual')));m.body.append(label);reason.maxLength=300;
 let uncertain=false;
 const submit=shiftCommit(m,'refundRegister',async()=>{
  if(uncertain||!reason.value.trim()||!actual.checked)throw Error('INVALID_REASON');
  try{const q=await api('orderRefundPrepare',{orderId,reason:reason.value});await api('orderRefundCommit',{orderId,reason:q.reason,currentShiftId:q.currentShiftId,confirmedExternalReturn:true,confirmationHash:q.confirmationHash});}
  catch(error){if(error.message==='RESULT_UNKNOWN_RETRY_SAME_ACTION'){uncertain=true;submit.disabled=true;requestAnimationFrame(validate);fastButton(m.footer,t('checkOriginal'),async()=>{m.dialog.close();await pendingPanel();});}throw error;}
  m.dialog.close();await fastSalesView();message();toast('success',t('refundRegistered'));
 });
 submit.disabled=true;const validate=()=>{submit.disabled=uncertain||!reason.value.trim()||!actual.checked;};reason.oninput=validate;actual.onchange=validate;m.dialog.addEventListener('close',cashRefreshQueued,{once:true});reason.focus();
}

async function orderFirstCancelOne(line){
 await cashCartIdle();const state=fastState,actor=state.actor,orderId=state.orderId;if(!orderId||state.busy||state.frozen||state.closed||state.completedSaleId)throw Error('DRAFT_FROZEN');
 orderFirstBusy(true);let failure=null,committed=false;
 try{
  if(state.lines.length)await cashPersistDraft();
  const order=await api('financeGet',{orderId});if(actor!==fastState.actor||!isCashView('fastSales'))return;
  const portions=order.lines.filter(p=>p.itemId===line.id&&p.quantity>0);if(order.status!=='OPEN')throw Error('ORDER_NOT_OPEN');if(!portions.length)throw Error('INVALID_PORTION');
  const available=portions.reduce((sum,p)=>sum+p.quantity,0),orderQuantity=order.lines.reduce((sum,p)=>sum+p.quantity,0),unit=portions[0].unitPrice;
  await new Promise(resolve=>{
   const dialog=financeModal(t('ofCancelDish'));dialog.classList.add('order-first-cancel-dialog');dialog.dataset.permission='order.correct';dialog.dataset.activeOrder=orderId;
   dialog.append(el('strong',orderName(portions[0])),el('p',t('ofCancelAvailable')+' '+available+' · '+tableMoney(unit)));
   const counter=el('div',undefined,{className:'order-first-cancel-counter'}),minus=fastButton(counter,'−',()=>change(-1)),number=el('strong','1'),plus=fastButton(counter,'+',()=>change(1));minus.setAttribute('aria-label',t('ofCancelLess'));plus.setAttribute('aria-label',t('ofCancelMore'));counter.insertBefore(number,plus);dialog.append(counter);
   const impact=el('p','',{className:'order-first-cancel-impact'}),warning=el('p','',{className:'order-first-cancel-warning'});dialog.append(impact,warning);
   const reason=field(dialog,'reason');reason.maxLength=300;reason.required=true;
   const chips=el('div',undefined,{className:'order-first-cancel-reasons'});for(const key of ['ofReasonChanged','ofReasonMistake','ofReasonUnavailable','ofReasonOther'])fastButton(chips,t(key),()=>{reason.value=key==='ofReasonOther'?'':t(key);reset();reason.focus();});dialog.append(chips);
   const quoteBox=el('div',undefined,{className:'order-first-cancel-quote'});quoteBox.hidden=true;dialog.append(quoteBox);
   const back=fastButton(dialog,t('ofCancelBack'),()=>dialog.close()),submit=fastButton(dialog,t('ofCancelCheck'),async()=>{
    if(submitting||!reason.value.trim())return;submitting=true;submit.disabled=true;
    try{
     if(!proposal){const targets=[];let left=selected;for(const portion of portions){if(!left)break;const quantity=Math.min(left,portion.quantity);targets.push({itemId:line.id,portionId:portion.id,quantity});left-=quantity;}if(left)throw Error('INVALID_QUANTITY');request={orderId,action:targets.length>1?'GROUP_CANCEL':'CANCEL_QUANTITY',targets,reason:reason.value.trim()};proposal=await api('correctPrepare',request);quoteBox.replaceChildren(el('p',t('ofCancelAmount')+' '+tableMoney(selected*unit)),el('strong',t('ofCancelNewTotal')+' '+tableMoney(proposal.total)));quoteBox.hidden=false;submit.textContent=t('ofCancelConfirm');}
     else{await api('correctCommit',{...request,...financeConfirmation(proposal)});committed=true;dialog.close();}
    }catch(error){failure=error;dialog.close();}
    finally{submitting=false;submit.disabled=false;}
   },'order-first-cancel-confirm');let submitting=false,selected=1,proposal=null,request=null;
   const reset=()=>{proposal=null;request=null;quoteBox.hidden=true;submit.textContent=t('ofCancelCheck');submit.disabled=!reason.value.trim()||selected===orderQuantity&&!me.permissions.includes('order.cancel');};
   const change=delta=>{selected=Math.max(1,Math.min(available,selected+delta));number.textContent=String(selected);minus.disabled=selected===1;plus.disabled=selected===available;impact.textContent=t('ofCancelAmount')+' '+tableMoney(selected*unit);warning.textContent=selected===orderQuantity?t('ofCancelClosesOrder'):'';reset();};
   reason.oninput=reset;change(0);
   dialog.addEventListener('cancel',event=>{if(submitting)event.preventDefault();});dialog.addEventListener('close',resolve,{once:true});cashFitDialog(dialog);reason.focus();
  });
  if(committed||failure)await fastSalesView();if(committed){message();toast('success',t('corrected'));}
  if(failure){cashActionError(failure);if(fastState.cancelPending)await pendingPanel();}
 }catch(error){await orderFirstFailure(error);}
 finally{orderFirstBusy(false);cashRefreshQueued();}
}
