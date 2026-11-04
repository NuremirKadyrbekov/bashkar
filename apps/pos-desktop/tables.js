'use strict';
let tableFilter='all',tableZoneId=null,tablePanelTab='active',tableEditing=false,tableFingerprint='',tableRefreshBusy=false,activeVisit=null,tableClockOffset=0,tableCartSelection=null,tableOverviewScroll=0,tableFirstSideTab='sales',tableFirstWaiterFingerprint='',tableFirstWaiterScroll=0,tableSelectionBusy=false,tableSelectionPending=null;
let cashRealtimeConnected=false,cashRealtimeGeneration=-1;
function cashSetRealtimeStatus(status){if(!status||status.generation<cashRealtimeGeneration)return;cashRealtimeGeneration=status.generation;cashRealtimeConnected=status.connected===true;}
window.pos.onRealtimeStatus(cashSetRealtimeStatus);
void window.pos.realtimeStatus().then(cashSetRealtimeStatus);
/** @typedef {{id:string,name:string,active:boolean,zoneId:string,state:'FREE'|'OCCUPIED',canViewDetails:boolean,sessionId?:string,openedAt?:number,openedBy?:{id:string,name:string},batchCount?:number,currentTotal?:number}} TableOverviewRow */
function initTableUi(ru,ky,errors){
 Object.assign(ru,{freeTables:'Свободные',occupiedTables:'Занятые',attentionTables:'Нужно внимание',quickSale:'Быстрая продажа',activeOrders:'Активные заказы',allActiveOrders:'Все активные заказы',noActiveOrders:'Активных заказов нет',recentSales:'Последние продажи',allSales:'Все продажи',noRecentSales:'Пока нет завершённых продаж',tableReady:'Готов к приёму гостей',batchCount:'Отправок',amountDue:'К оплате',tableElapsed:'В работе',shiftClosed:'Смена закрыта',tableSearch:'Найти стол'});
 Object.assign(ky,{freeTables:'Бош',occupiedTables:'Бош эмес',attentionTables:'Көңүл буруу керек',quickSale:'Ыкчам сатуу',activeOrders:'Активдүү буйрутмалар',allActiveOrders:'Бардык активдүү буйрутмалар',noActiveOrders:'Активдүү буйрутмалар жок',recentSales:'Акыркы сатуулар',allSales:'Бардык сатуулар',noRecentSales:'Аяктаган сатуулар жок',tableReady:'Конокторду кабыл алууга даяр',batchCount:'Жөнөтүүлөр',amountDue:'Төлөөгө',tableElapsed:'Иштөөдө',shiftClosed:'Нөөмөт жабык',tableSearch:'Столду табуу'});
 Object.assign(ru,{tableTabCurrent:'Текущий заказ',tableTabWaiters:'Официанты',tableChooseOrder:'Выберите стол или заказ на вынос',tableNoWaiters:'Официантов пока нет',tableOpenTablesCount:'Открытых столов',tableAcceptedBatches:'Принято пакетов',tableAcceptedAmount:'Сумма принятых пакетов',tableInactiveWaiter:'Неактивен'});
 Object.assign(ky,{tableTabCurrent:'Учурдагы буйрутма',tableTabWaiters:'Официанттар',tableChooseOrder:'Үстөлдү же алып кетүү буйрутмасын тандаңыз',tableNoWaiters:'Официанттар азырынча жок',tableOpenTablesCount:'Ачык үстөлдөр',tableAcceptedBatches:'Кабыл алынган топтомдор',tableAcceptedAmount:'Кабыл алынган топтомдордун суммасы',tableInactiveWaiter:'Активдүү эмес'});
 Object.assign(ru,{tableSaleOpened:'Открыл',tableSaleCreated:'Создал',tableSaleSettled:'Рассчитал',tableSaleFinished:'Завершил',tableSalePositions:'Позиций',tableSaleFinalPositions:'Итоговые позиции',tableSalePackages:'Принятые пакеты',tableSalePackage:'Пакет',tableSalePackageAmount:'Сумма пакета',tableSaleAdjustments:'Изменения заказа',tableSalePayments:'Расчёт',tableSaleNoTable:'Зал · без стола',tableSaleReturned:'Возврат'});
 Object.assign(ky,{tableSaleOpened:'Ачты',tableSaleCreated:'Түздү',tableSaleSettled:'Эсептешти',tableSaleFinished:'Аяктады',tableSalePositions:'Позициялар',tableSaleFinalPositions:'Жыйынтык позициялар',tableSalePackages:'Кабыл алынган топтомдор',tableSalePackage:'Топтом',tableSalePackageAmount:'Топтомдун суммасы',tableSaleAdjustments:'Буйрутма өзгөрүүлөрү',tableSalePayments:'Эсептешүү',tableSaleNoTable:'Зал · столсуз',tableSaleReturned:'Кайтарым'});
 Object.assign(ru,{tableFreeCard:'Свободно',tableOccupiedSince:'Занят уже',tableSentSince:'Отправлен',tableWaitingSince:'Ожидает',tableCreatedBy:'Создал'});
 Object.assign(ky,{tableFreeCard:'Бош',tableOccupiedSince:'Бош эмес',tableSentSince:'Жөнөтүлдү',tableWaitingSince:'Күтүүдө',tableCreatedBy:'Түздү'});
 Object.assign(ru,{tables:'Столы',allTables:'Все',myTables:'Мои столы',tableFree:'Свободен',tableOccupied:'Занят',tableUnavailable:'Неактивен',tableSetup:'Настройка зон и столов',tableModeTitle:'Доступ к столам',tableModeHint:'STRICT — только свои посещения; SHARED — совместная работа. Ответственный сохраняется.',tableModeRequired:'Перед открытием столов Owner должен подтвердить режим доступа.',strict:'Строгая привязка',shared:'Совместная работа',saveTableMode:'Сохранить режим',confirmTableMode:'Изменить доступ к столам? Новый режим будет действовать и для уже открытых посещений.',zoneName:'Название зоны',tableActive:'Активен',saveZone:'Сохранить зону',saveTable:'Сохранить стол',newZone:'Новая зона',newTable:'Новый стол',tableSaved:'Настройки сохранены',tableOpen:'Открыть стол',tableClose:'Закрыть пустое посещение',tableDetails:'Посещение',responsible:'Ответственный официант',noWaiter:'Без официанта',openedBy:'Открыл',openedAt:'Время открытия',emptyVisit:'Пустое посещение',confirmEmpty:'Закрыть пустое посещение и освободить стол? История открытия сохранится.',noTables:'Столов пока нет',noMyTables:'У вас нет назначенных активных столов',tablePrivate:'Подробности недоступны',tablePrivateStrict:'Чужой стол · нет доступа',tableOtherDiscard:'Изменения в других формах будут потеряны. Продолжить сохранение?',tableDiscard:'Несохранённые настройки будут потеряны. Продолжить?',tableInactive:'Неактивные зоны и столы',viewTables:'Просмотр состояний столов',viewVisits:'Просмотр посещений',accessOthers:'Доступ к чужим посещениям',manageTables:'Настройка зон и столов',manageTableMode:'Настройка STRICT / SHARED'});
 Object.assign(ky,{tables:'Столдор',allTables:'Баары',myTables:'Менин столдорум',tableFree:'Бош',tableOccupied:'Бош эмес',tableUnavailable:'Активдүү эмес',tableSetup:'Зоналарды жана столдорду жөндөө',tableModeTitle:'Столдорго жетүү',tableModeHint:'STRICT — өзүңүздүн барууларыңыз; SHARED — чогуу иштөө. Жооптуу кызматкер сакталат.',tableModeRequired:'Стол ачуудан мурда ээси жетүү режимин ырасташы керек.',strict:'Жеке бекитүү',shared:'Биргелешкен иш',saveTableMode:'Режимди сактоо',confirmTableMode:'Столдорго жетүүнү өзгөртүү керекпи? Жаңы режим ачык барууларга да колдонулат.',zoneName:'Зонанын аталышы',tableName:'Столдун номери / аталышы',zone:'Зона',tableActive:'Активдүү',saveZone:'Зонаны сактоо',saveTable:'Столду сактоо',newZone:'Жаңы зона',newTable:'Жаңы стол',tableSaved:'Жөндөөлөр сакталды',tableOpen:'Столду ачуу',tableClose:'Бош барууну жабуу',tableDetails:'Баруу',responsible:'Жооптуу официант',noWaiter:'Официантсыз',openedBy:'Ачкан кызматкер',openedAt:'Ачылган убакыт',emptyVisit:'Бош баруу',confirmEmpty:'Бош барууну жаап, столду бошотуу керекпи? Ачылыш тарыхы сакталат.',noTables:'Азырынча столдор жок',noMyTables:'Сизге бекитилген активдүү столдор жок',tablePrivate:'Чоо-жайы жеткиликсиз',tablePrivateStrict:'Башканын үстөлү · жетүү жок',tableOtherDiscard:'Башка формалардагы өзгөртүүлөр жоголот. Сактоону улантуу керекпи?',tableDiscard:'Сакталбаган жөндөөлөр жоголот. Улантуу керекпи?',tableInactive:'Активдүү эмес зоналар жана столдор',viewTables:'Столдордун абалын көрүү',viewVisits:'Барууларды көрүү',accessOthers:'Башкалардын барууларына жетүү',manageTables:'Зоналарды жана столдорду жөндөө',manageTableMode:'STRICT / SHARED жөндөө'});
 const messages={TABLE_OCCUPIED:['Стол уже занят. Обновите список столов.','Стол бош эмес. Тизмени жаңыртыңыз.'],ZONE_OCCUPIED:['В зоне есть открытые посещения.','Зонада ачык баруулар бар.'],ZONE_HAS_ACTIVE_TABLES:['Сначала отключите столы этой зоны.','Адегенде бул зонанын столдорун өчүрүңүз.'],ZONE_INACTIVE:['Зона неактивна.','Зона активдүү эмес.'],TABLE_INACTIVE:['Стол недоступен.','Стол жеткиликсиз.'],TABLE_NAME_USED:['Название стола уже используется в филиале.','Столдун аталышы филиалда колдонулууда.'],ZONE_NAME_USED:['Название зоны уже используется.','Зонанын аталышы колдонулууда.'],TABLE_MODE_REQUIRED:['Сначала подтвердите режим доступа к столам.','Адегенде столдорго жетүү режимин ырастаңыз.'],SHIFT_REQUIRED:['Сначала откройте кассовую смену.','Адегенде кассалык нөөмөттү ачыңыз.'],RESPONSIBLE_WAITER_REQUIRED:['Выберите ответственного официанта.','Жооптуу официантты тандаңыз.'],INVALID_RESPONSIBLE_WAITER:['Официант больше недоступен. Обновите список.','Официант жеткиликсиз. Тизмени жаңыртыңыз.'],VISIT_ACCESS_DENIED:['Нет доступа к этому посещению.','Бул барууга жетүү укугу жок.'],VISIT_CLOSED:['Посещение уже закрыто.','Баруу жабылган.'],VISIT_NOT_EMPTY:['В посещении есть принятые пакеты или платежи. Закрытие как пустого запрещено.','Барууда кабыл алынган пакеттер же төлөмдөр бар. Бош деп жабууга болбойт.']};Object.assign(errors,messages);
}
const tablePermissionLabels={'table.view_status':'viewTables','table.view_details':'viewVisits','table.open':'tableOpen','table.close_empty':'tableClose','table.access_others':'accessOthers','table.manage':'manageTables','settings.table_access_mode.manage':'manageTableMode'};
function tablePermissionLabel(key){return tablePermissionLabels[key]?t(tablePermissionLabels[key]):undefined;}
function tableSnapshotKey(data,shift,active,sales){return JSON.stringify({settings:data.settings,zones:data.zones,tables:data.tables,shift,activeOrders:active?.orders??[],sales:sales?.sales??null,permissions:me.permissions});}
function tableDuration(openedAt){const minutes=Math.max(0,Math.floor((Date.now()+tableClockOffset-openedAt)/60000)),hours=Math.floor(minutes/60),remainder=minutes%60;
 if(lang==='ky')return hours?(hours+' саат'+(remainder?' '+remainder+' мүн':'') ):minutes+' мүн';
 const word=(count,one,few,many)=>{const mod100=count%100,mod10=count%10;return mod100>=11&&mod100<=14?many:mod10===1?one:mod10>=2&&mod10<=4?few:many;};
 return hours?hours+' '+word(hours,'час','часа','часов')+(remainder?' '+remainder+' мин':''):minutes+' мин';}
function tableMoney(tyiyn){return new Intl.NumberFormat(lang==='ky'?'ky-KG':'ru-RU',{maximumFractionDigits:2,minimumFractionDigits:tyiyn%100?2:0}).format(tyiyn/100)+' сом';}
function tableShiftMoney(tyiyn){const amount=BigInt(tyiyn),whole=amount/100n,cents=amount%100n;return new Intl.NumberFormat(lang==='ky'?'ky-KG':'ru-RU').format(whole)+(cents?','+String(cents).padStart(2,'0'):'')+' сом';}
function tableCardAction(card,label,action){card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',label);card.onclick=()=>run(action);card.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();run(action);}};}
function tableActiveDialog(orders){const dialog=el('dialog');dialog.append(el('h2',lang==='ky'?'Активдүү буйрутмалар':'Активные заказы'));for(const order of orders){const row=button(dialog,'',async()=>{dialog.close();if(order.type==='TABLE'){orderSession=order.sessionId;screen='order';await render();}else{const local=await api('counterOpen',{orderId:order.id});counterScope=local.scopeId;counterOrderId=local.orderId;screen='counterEditor';await render();}});row.textContent=(order.type==='TABLE'?order.tableName+' · '+fastOrderLabel(order):'№'+String(order.counterNumber).padStart(3,'0')+' · '+(lang==='ky'?'Алып кетүү':'На вынос'))+' · '+tableMoney(order.total);}button(dialog,'done',()=>dialog.close());dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();}
let tableOverviewCache=null,cashChangeEpoch=null,cashChangeSeq=null,cashRealtimeTicket=0;
async function tableReadOverview(scope='full'){
 if(scope==='full'||!tableOverviewCache){me=await api('me');const [data,shift,active,sales]=await Promise.all([api('tables'),api('shift'),api('activeOrders'),me.permissions.includes('sales.view_24h')?api('salesList',{limit:6}):Promise.resolve(null)]);return tableOverviewCache={data,shift,active,sales};}
 const loaded={...tableOverviewCache};
 if(scope==='tables'||scope==='orders')loaded.data=await api('tables');
 if(scope==='orders')loaded.active=await api('activeOrders');
 if(scope==='sales')loaded.sales=me.permissions.includes('sales.view_24h')?await api('salesList',{limit:6}):null;
 return loaded;
}
async function tableSelectCart(selection){
 if(tableSelectionBusy){tableSelectionPending=selection;return;}
 tableSelectionBusy=true;
 try{let next=selection;while(next){tableSelectionPending=null;await tableSelectCartNow(next);next=tableSelectionPending;}}
 finally{tableSelectionBusy=false;tableSelectionPending=null;}
}
async function tableSelectCartNow(selection){
 if(tableCartSelection?.kind===selection.kind&&tableCartSelection.id===selection.id){if(tableFirstSideTab!=='current'){tableFirstSideTab='current';return fastSalesViewNow();}tableCartSelection=null;tableFirstSideTab='sales';return tablesView();}
 if(fastState.frozen||fastState.busy)throw Error('DRAFT_FROZEN');
 tableCartSelection=selection;tableFirstSideTab='current';if(!fastState.menu||!fastState.tables)await fastSalesViewNow();else{[fastState.tables,fastState.active,fastState.parked]=await Promise.all([api('tables'),api('activeOrders'),api('serverDraftList')]);}
 if(selection.kind==='order')return cashSelectOrder(selection.id);
 if(selection.kind==='draft')return cashSelectDraft(selection.id);
 const table=fastState.tables?.tables.find(row=>row.id===selection.id);if(!table?.active){tableCartSelection=null;return tablesView();}
 const order=fastState.active?.orders.find(row=>row.type==='TABLE'&&row.tableId===table.id);
 if(order)return cashSelectOrder(order.id);
 if(table.state==='OCCUPIED'){
  if(!table.canViewDetails){tableCartSelection=null;throw Error('VISIT_ACCESS_DENIED');}
  if(!fastState.closed&&fastState.shift)await cashPersistDraft();
  await api('cashWorkspaceSet',{orderId:null,sessionId:table.sessionId});return fastSalesViewNow();
 }
 const existing=fastState.parked?.find(row=>row.draft.cashMeta?.mode==='TABLE'&&row.draft.cashMeta?.tableId===table.id);
 if(existing)return cashSelectDraft(existing.id);
 if(!fastState.shift&&!await cashEnsureShift()){tableCartSelection=null;return tablesView();}
 await cashSelectNew('TABLE');await cashAssignTable(table.id);return fastSalesViewNow();
}
function tableCartCatalogOpen(){
 const dialog=el('dialog',undefined,{className:'table-first-catalog-dialog'});dialog.append(el('h2',t('fastAll')));
 const close=fastButton(dialog,'×',()=>dialog.close(),'table-first-catalog-close');close.setAttribute('aria-label',t('cancel'));
 const body=el('div',undefined,{className:'fast-sales table-first-catalog-body'});dialog.append(body);fastDrawCatalog(body);
 dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();body.querySelector('.fast-search')?.focus();
}
function tableCardBagIcon(){
 const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('class','table-first-icon table-first-bag');icon.setAttribute('viewBox','0 0 32 32');icon.setAttribute('fill','none');icon.setAttribute('aria-hidden','true');
 const bag=document.createElementNS('http://www.w3.org/2000/svg','path');bag.setAttribute('d','M6 11h20l-1.5 17h-17L6 11Zm5 1V9a5 5 0 0 1 10 0v3');bag.setAttribute('stroke','currentColor');bag.setAttribute('stroke-width','2');bag.setAttribute('stroke-linejoin','round');bag.setAttribute('stroke-linecap','round');icon.append(bag);return icon;
}
function tableCardStatus(kind,at){const label=t(kind==='occupied'?'tableOccupiedSince':kind==='sent'?'tableSentSince':'tableWaitingSince');return label+(at?' '+tableDuration(at):'');}
function tableSaleTime(at){return at?new Date(at).toLocaleString(lang==='ky'?'ky-KG':'ru-RU',{timeZone:'Asia/Bishkek',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';}
function tableSaleHasTable(sale){return sale.type==='TABLE'&&!!sale.tableName&&sale.tableName!=='Без стола';}
function tableSaleIdentity(sale){return sale.type==='COUNTER'?{title:t('fastTakeaway'),subtitle:fastOrderLabel(sale)}:tableSaleHasTable(sale)?{title:fastTableTitle(sale.tableName),subtitle:fastOrderLabel(sale)}:{title:fastOrderLabel(sale),subtitle:t('tableSaleNoTable')};}
function tableSaleCard(parent,sale){
 const identity=tableSaleIdentity(sale),card=el('button',undefined,{type:'button',className:'table-sale-card '+(sale.type==='COUNTER'?'takeaway':'hall')});card.setAttribute('aria-label',t('saleDetails')+' · '+identity.title+' · '+identity.subtitle);card.onclick=()=>run(()=>tableSaleDialog(sale.id),card);
 const head=el('div',undefined,{className:'table-sale-card-head'}),title=el('span');title.append(el('strong',identity.title),el('small',identity.subtitle));head.append(title,sale.type==='COUNTER'?tableCardBagIcon():el('img',undefined,{src:'./assets/table-outline.png',alt:'',className:'table-first-icon'}));card.append(head);
 const openedName=sale.type==='COUNTER'?sale.createdByName:sale.openedBy?.name,openedTime=sale.type==='COUNTER'?sale.createdAt:sale.openedAt,opened=el('span',(t(sale.type==='COUNTER'?'tableSaleCreated':'tableSaleOpened')+': '+(openedName??'—')+' · '+tableSaleTime(openedTime)),{className:'table-sale-person'}),settled=el('span',t(sale.financialState==='ZERO_SETTLED'?'tableSaleFinished':'tableSaleSettled')+': '+(sale.actor?.name??'—')+' · '+tableSaleTime(sale.financialFactTime),{className:'table-sale-person'});card.append(opened,settled);
 const foot=el('div',undefined,{className:'table-sale-card-foot'});foot.append(el('span',t('tableSalePositions')+': '+(sale.positionCount??sale.lines?.length??0)),el('b',tableMoney(sale.total)));card.append(foot);parent.append(card);
}
async function tableSaleDialog(orderId){
 const sale=await api('saleDetails',{orderId}),events=[...sale.events.events];let after=sale.events.next;
 while(after!==null&&after!==undefined){const page=await api('financeEvents',{orderId,after});events.push(...page.events);if(page.next===after)throw Error('INVALID_HISTORY');after=page.next;}
 const identity=tableSaleIdentity(sale),dialog=financeModal(identity.title);dialog.classList.add('table-sale-dialog');dialog.dataset.permission='sales.view_24h';
 const intro=el('div',undefined,{className:'table-sale-dialog-intro'});intro.append(el('span',identity.subtitle),el('strong',tableMoney(sale.total)));dialog.append(intro);
 const meta=el('div',undefined,{className:'table-sale-dialog-meta'});meta.append(el('span',t(sale.type==='COUNTER'?'tableSaleCreated':'tableSaleOpened')+': '+(sale.type==='COUNTER'?sale.createdByName??'—':sale.openedBy?.name??'—')+' · '+tableSaleTime(sale.type==='COUNTER'?sale.createdAt:sale.openedAt)),el('span',t(sale.financialState==='ZERO_SETTLED'?'tableSaleFinished':'tableSaleSettled')+': '+sale.actor.name+' · '+tableSaleTime(sale.settledAt)),el('span',t('tableSalePositions')+': '+sale.positionCount));dialog.append(meta);
 const body=el('div',undefined,{className:'table-sale-dialog-body'});dialog.append(body);body.append(el('h3',t('tableSaleFinalPositions')));for(const line of sale.lines){const row=el('div',undefined,{className:'table-sale-line table-sale-final-line'}),label=el('span',orderName(line)+' × '+line.quantity);if(line.comment)label.append(el('small',line.comment));row.append(label,el('b',tableMoney(line.total)));body.append(row);}body.append(el('h3',t('tableSalePackages')));
 for(const event of events){if(event.type!=='BATCH')continue;const box=el('section',undefined,{className:'table-sale-package'}),head=el('div',undefined,{className:'table-sale-package-head'});head.append(el('strong',t('tableSalePackage')+' №'+event.sequence),el('span',(event.sender??'—')+' · '+tableSaleTime(event.submittedAt)));box.append(head);for(const line of event.lines??[]){const row=el('div',undefined,{className:'table-sale-line'});row.append(el('span',orderName(line)+' × '+line.quantity),el('b',tableMoney(line.total??line.unitPrice*line.quantity)));box.append(row);}const amount=(event.lines??[]).reduce((sum,line)=>sum+(line.total??line.unitPrice*line.quantity),0);box.append(el('div',t('tableSalePackageAmount')+' · '+tableMoney(amount),{className:'table-sale-package-amount'}));body.append(box);}
 const changes=events.filter(event=>event.type!=='BATCH');if(changes.length){body.append(el('h3',t('tableSaleAdjustments')));for(const event of changes){const row=el('div',undefined,{className:'table-sale-change'}),cancelled=['CANCEL_ORDER','CANCEL_QUANTITY','GROUP_CANCEL','REPLACE_ITEM'].includes(event.type),label=event.type==='DISCOUNT'?t('fastDiscount'):cancelled?t('cashCancelledLine'):t('tableSaleAdjustments');row.append(el('strong',label));if(cancelled)for(const line of event.snapshot?.targets??[])row.append(el('span',orderName(line)+' × '+line.quantity));if(event.type==='DISCOUNT')row.append(el('span',tableMoney(event.before)+' → '+tableMoney(event.after)));if(event.reason)row.append(el('span',event.reason));row.append(el('small',[(event.actor??''),tableSaleTime(event.createdAt)].filter(Boolean).join(' · ')));body.append(row);}}
 const totals=el('div',undefined,{className:'table-sale-dialog-totals'});totals.append(el('span',t('fastSubtotal')),el('b',tableMoney(sale.subtotal)),el('span',t('fastDiscount')),el('b',tableMoney(sale.discount)));for(const fee of sale.fees??[])totals.append(el('span',fee.name),el('b',tableMoney(fee.amount)));totals.append(el('strong',t('fastTotal')),el('strong',tableMoney(sale.total)));body.append(totals);
 body.append(el('h3',t('tableSalePayments')));if(!sale.payments.length)body.append(el('p',t('ofNoRefund')));for(const payment of sale.payments){const card=el('div',undefined,{className:'table-sale-payment'});card.append(el('span',financeMethod(payment.method)),el('b',tableMoney(payment.amount)));if(payment.refundId)card.append(el('small',t('tableSaleReturned')+' · '+payment.refundReason+' · '+payment.refundedBy));else if(me.permissions.includes('payment.refund'))button(card,'refundFull',()=>{dialog.close();return refundDialog(payment.id);});body.append(card);}
 const close=button(dialog,'done',()=>dialog.close());close.classList.add('table-sale-dialog-close');
 const timer=setInterval(async()=>{if(!dialog.isConnected){clearInterval(timer);return;}try{await api('saleDetails',{orderId});}catch(error){dialog.close();handleError(error);}},5000);
}
async function tableFirstOverview(loaded){
 if(!loaded){if(tableCartSelection)return fastSalesViewNow();$('screen').replaceChildren(el('section',lang==='ky'?'Столдор жүктөлүүдө…':'Загрузка столов…',{className:'tables-loading'}));loaded=await tableReadOverview();}
 const focused=document.activeElement,previous=focused?.closest?.('.table-first-overview'),priorSelection=tableCartSelection?.kind+':'+tableCartSelection?.id;
 const focusedTable=focused?.matches?.('.table-first-card.table')&&previous?.dataset.actor===me?.id&&previous.dataset.permissions===me.permissions.join(',')&&previous.dataset.selection===priorSelection?focused.dataset.tableId:null;
 const {data,shift,active,sales}=loaded;tableClockOffset=data.serverTime-Date.now();tableFingerprint=tableSnapshotKey(data,shift,active,sales);
 const zones=data.zones.filter(zone=>zone.active),tables=data.tables.filter(table=>table.active&&zones.some(zone=>zone.id===table.zoneId));
 const drafts=(tableCartSelection?fastState.parked:await api('serverDraftList'))??[];
 const takeaway=[...drafts.filter(row=>row.draft?.cashMeta?.mode==='COUNTER'&&row.draft.lines.length).map(row=>({kind:'draft',row,at:row.createdAt??row.updatedAt})),...active.orders.filter(row=>row.type==='COUNTER').map(row=>({kind:'order',row,at:row.createdAt}))].sort((a,b)=>a.at-b.at);
 if(tableCartSelection){const exists=tableCartSelection.kind==='table'?tables.some(row=>row.id===tableCartSelection.id&&row.state==='FREE'||row.id===tableCartSelection.id&&row.canViewDetails):takeaway.some(entry=>entry.kind===tableCartSelection.kind&&entry.row.id===tableCartSelection.id);if(!exists)tableCartSelection=null;}
 const selection=tableCartSelection?.kind+':'+tableCartSelection?.id;
 const canSeeWaiterSummary=me.permissions.includes('table.view_status')&&me.permissions.includes('shift.report.view');if(tableFirstSideTab==='waiters'&&!canSeeWaiterSummary)tableFirstSideTab='sales';
 const waiterSummary=tableFirstSideTab==='waiters'?(loaded.waiterSummary??await api('waiterShiftSummary')):null;if(waiterSummary)tableFirstWaiterFingerprint=JSON.stringify([waiterSummary.shiftId,waiterSummary.waiters]);
 const section=shell(t('tables'));section.classList.add('tables-overview','table-first-overview');section.dataset.actor=me.id;section.dataset.permissions=me.permissions.join(',');section.dataset.selection=selection;section.querySelector('h1').remove();
 const content=el('div',undefined,{className:'tables-content'}),top=el('div',undefined,{className:'tables-top'}),topActions=el('div',undefined,{className:'tables-top-actions'});top.append(el('h1',t('tables')),topActions);
 if(me.permissions.includes('table.manage'))button(topActions,'tableConfig',async()=>{screen='tableConfig';await render();});
 const quick=button(topActions,'quickSale',openTableQuickSale,true);quick.textContent='+ '+t('quickSale');quick.setAttribute('aria-disabled',String(!me.permissions.includes('counter.view')||!me.permissions.includes('counter.batch.submit')));content.append(top);
 const list=el('div',undefined,{className:'table-first-list'});list.onscroll=()=>{tableOverviewScroll=list.scrollTop;};content.append(list);
 if(takeaway.length){
  const group=el('section',undefined,{className:'table-first-group takeaway'}),heading=el('h2',lang==='ky'?'Алып кетүү буйрутмалары':'Заказы на вынос'),grid=el('div',undefined,{className:'table-first-grid'});group.append(heading);
  for(const entry of takeaway){
   const row=entry.row,waiting=entry.kind==='draft',selected=tableCartSelection?.kind===entry.kind&&tableCartSelection.id===row.id,card=el('button',undefined,{type:'button',className:'table-first-card takeaway '+(waiting?'waiting':'sent')+(selected?' selected':'')});card.dataset[waiting?'draftId':'orderId']=row.id;card.setAttribute('aria-pressed',String(selected));
   const number=waiting?t('cashDraftNumber')+' №'+row.number:fastOrderLabel(row),status=el('span',tableCardStatus(waiting?'waiting':'sent',entry.at),{className:'table-first-status'});status.dataset.statusKind=waiting?'waiting':'sent';status.dataset.startedAt=String(entry.at);
   card.append(el('strong',number),tableCardBagIcon(),status);
   const author=waiting?me.name:row.createdByName;if(author)card.append(el('span',t('tableCreatedBy')+': '+author,{className:'table-first-author',title:author}));
   if(!waiting)card.append(el('b',tableMoney(row.total),{className:'table-first-total'}));
   card.onclick=()=>run(()=>tableSelectCart({kind:entry.kind,id:row.id}),card);grid.append(card);
  }
  group.append(grid);list.append(group);
 }
 if(!zones.length)list.append(el('p',t('noTables')));
 for(const zone of zones){
  const group=el('section',undefined,{className:'table-first-group'}),grid=el('div',undefined,{className:'table-first-grid'});group.append(el('h2',zone.name));
  for(const table of tables.filter(row=>row.zoneId===zone.id).sort((a,b)=>a.name.localeCompare(b.name,lang==='ky'?'ky':'ru',{numeric:true}))){
   const selected=tableCartSelection?.kind==='table'&&tableCartSelection.id===table.id,attention=!!table.needsAttention,free=table.state==='FREE',card=el('button',undefined,{type:'button',className:'table-first-card table '+(attention?'attention':free?'free':'occupied')+(selected?' selected':'')});card.dataset.tableId=table.id;card.setAttribute('aria-pressed',String(selected));
   const status=el('span',attention?t('attentionTables'):free?t('tableFreeCard'):tableCardStatus('occupied',table.openedAt),{className:'table-first-status'});if(!attention&&!free&&table.openedAt){status.dataset.statusKind='occupied';status.dataset.startedAt=String(table.openedAt);}
   card.append(el('strong',table.name),el('img',undefined,{src:'./assets/table-outline.png',alt:'',className:'table-first-icon'}),status);
   if(table.openedBy?.name&&table.canViewDetails)card.append(el('span',t('openedBy')+': '+table.openedBy.name,{className:'table-first-author',title:table.openedBy.name}));
   if(table.canViewDetails)card.append(el('b',tableMoney(table.currentTotal??0),{className:'table-first-total'}));
   if(!free&&!table.canViewDetails){card.disabled=true;card.title=t(data.settings.mode==='STRICT'?'tablePrivateStrict':'tablePrivate');}else if(free&&(!me.permissions.includes('table.open')||!data.settings.configured)){card.disabled=true;card.title=t('permissionDenied');}else card.onclick=()=>run(()=>tableSelectCart({kind:'table',id:table.id}),card);grid.append(card);
  }
  group.append(grid);list.append(group);
 }
 const side=el('aside',undefined,{className:'recent-sales table-first-side'}),tabs=el('div',undefined,{className:'table-first-side-tabs',role:'tablist'});section.append(content,side);
 for(const [value,key] of [['current','tableTabCurrent'],...(canSeeWaiterSummary?[['waiters','tableTabWaiters']]:[]),['sales','recentSales']]){const tab=el('button',t(key),{type:'button'});tab.dataset.sideTab=value;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(tableFirstSideTab===value));tab.onclick=()=>run(async()=>{tableFirstSideTab=value;if(value==='current'&&tableCartSelection)await fastSalesViewNow();else await tablesView(await tableReadOverview());},tab);tabs.append(tab);}side.append(tabs);
 if(tableFirstSideTab==='current'){
  if(tableCartSelection&&fastState.menu){const cart=el('div',undefined,{className:'fast-panel fast-cart'});side.append(cart);orderFirstDrawCart(cart,!!fastState.quote);const add=fastButton(side,'+ '+(lang==='ky'?'Позиция кошуу':'Добавить позицию'),tableCartCatalogOpen,'table-first-add');add.disabled=!!fastState.frozen||!!fastState.closed;}
  else side.append(el('p',t('tableChooseOrder'),{className:'table-first-empty'}));
 }else if(tableFirstSideTab==='waiters'){
  const list=el('div',undefined,{className:'table-waiters-list'});list.onscroll=()=>{tableFirstWaiterScroll=list.scrollTop;};if(!waiterSummary?.shiftId)list.append(el('p',t('shiftClosed')));else if(!waiterSummary.waiters.length)list.append(el('p',t('tableNoWaiters')));
  else for(const waiter of waiterSummary.waiters){const card=el('section',undefined,{className:'table-waiter-card'}),head=el('div',undefined,{className:'table-waiter-head'}),avatar=el('span',waiter.name.trim().charAt(0).toUpperCase(),{className:'table-waiter-avatar'});head.append(avatar,el('strong',waiter.name));if(!waiter.active)head.append(el('small',t('tableInactiveWaiter')));card.append(head);for(const [key,value] of [['tableOpenTablesCount',String(waiter.openTableCount)],['tableAcceptedBatches',String(waiter.acceptedBatchCount)],['tableAcceptedAmount',tableShiftMoney(waiter.acceptedSubtotalTyiyn)]]){const metric=el('div',undefined,{className:'table-waiter-metric'});metric.append(el('span',t(key)),el('b',value));card.append(metric);}list.append(card);}side.append(list);requestAnimationFrame(()=>{if(list.isConnected)list.scrollTop=tableFirstWaiterScroll;});
 }else{
  const salesList=el('div',undefined,{className:'table-panel-list table-sale-list'});if(!sales) salesList.append(el('p',t('permissionDenied')));else if(!sales.sales?.length)salesList.append(el('p',t('noRecentSales')));for(const sale of sales?.sales??[])tableSaleCard(salesList,sale);side.append(salesList);if(sales)button(side,'allSales',async()=>{screen='sales';await render();});
 }
 if(focusedTable&&selection===priorSelection){const card=[...list.querySelectorAll('.table-first-card.table')].find(row=>row.dataset.tableId===focusedTable);if(card&&!card.disabled)card.focus({preventScroll:true});}
 requestAnimationFrame(()=>{if(list.isConnected)list.scrollTop=tableOverviewScroll;});
}
async function tablesView(loaded){return tableFirstOverview(loaded);}
function tablePanelIcon(type,photo=true){if(type==='TABLE')return el('img',undefined,{src:photo?'./assets/table-dining.png':'./assets/table-3d.svg',alt:'',className:'table-panel-icon table-panel-table'+(photo?' table-dining-panel':'')});const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');icon.setAttribute('class','table-panel-icon table-panel-counter');icon.setAttribute('aria-hidden','true');use.setAttribute('href','#icon-counter');icon.append(use);return icon;}
function tableOrdersPanel(orders,sales){
 const panel=el('aside',undefined,{className:'recent-sales'}),tabs=el('div',undefined,{className:'table-panel-tabs',role:'tablist'}),list=el('div',undefined,{className:'table-panel-list'}),footer=el('div',undefined,{className:'table-panel-footer'});
 const openOrder=async order=>{if(order.type==='TABLE'){orderSession=order.sessionId;screen='order';await render();}else{const local=await api('counterOpen',{orderId:order.id});counterScope=local.scopeId;counterOrderId=local.orderId;screen='counterEditor';await render();}};
 const redraw=()=>{list.replaceChildren();footer.replaceChildren();for(const [value,key] of [['active','activeOrders'],['sales','recentSales']]){const tab=tabs.querySelector('[data-tab="'+value+'"]');tab.setAttribute('aria-selected',String(tablePanelTab===value));tab.setAttribute('aria-pressed',String(tablePanelTab===value));}if(tablePanelTab==='active'){
  if(!orders.length)list.append(el('p',t('noActiveOrders')));
  for(const order of orders.slice(0,6)){const row=el('button',undefined,{type:'button',className:'table-panel-row'});row.setAttribute('aria-label',(order.type==='TABLE'?order.tableName:t('counter'))+' · '+tableMoney(order.total));row.append(tablePanelIcon(order.type),el('strong',order.type==='TABLE'?order.tableName:t('counter')+' · №'+String(order.counterNumber).padStart(3,'0')),el('small',(order.type==='TABLE'?fastOrderLabel(order)+' · ':'')+order.positionCount+' '+(lang==='ky'?'позиция':'позиций')+' · '+new Date(order.createdAt).toLocaleTimeString(lang==='ky'?'ky-KG':'ru-RU',{timeZone:'Asia/Bishkek',hour:'2-digit',minute:'2-digit'})),el('b',tableMoney(order.total)));row.onclick=()=>run(()=>openOrder(order),row);list.append(row);}
  button(footer,'allActiveOrders',()=>tableActiveDialog(orders));
 }else{
  if(!sales)list.append(el('p',t('permissionDenied')));else if(!sales.length)list.append(el('p',t('noRecentSales')));
  for(const sale of sales??[]){const row=el('button',undefined,{type:'button',className:'table-panel-row'});row.setAttribute('aria-label',t('saleDetails')+' · '+tableMoney(sale.total));row.append(tablePanelIcon(sale.type),el('strong',sale.type==='TABLE'?(sale.tableName??t('TABLE'))+' · '+fastOrderLabel(sale):t('counter')+' · №'+String(sale.counterNumber).padStart(3,'0')),el('small',new Date(sale.financialFactTime).toLocaleString(lang==='ky'?'ky-KG':'ru-RU',{timeZone:'Asia/Bishkek'})),el('b',tableMoney(sale.total)));row.onclick=()=>run(()=>saleDialog(sale.id),row);list.append(row);}
  if(sales)button(footer,'allSales',async()=>{screen='sales';await render();});
 }};
 for(const [value,key] of [['active','activeOrders'],['sales','recentSales']]){const tab=button(tabs,key,()=>{tablePanelTab=value;redraw();});tab.dataset.tab=value;tab.setAttribute('role','tab');if(value==='active')tab.textContent=t(key)+'  '+orders.length;}
 panel.append(tabs,list,footer);redraw();return panel;
}
async function openTableForm(table){
 if(tableEditing&&!await confirmAction(t('tableDiscard')))return;
 const actor=me.id;me=await api('me');if(me.id!==actor){await tablesView();return;}if(!me.permissions.includes('table.open'))throw Error('PERMISSION_DENIED');if(!await api('shift')){if(!await shiftOpenDialog()||me?.id!==actor||!isCashView('tables'))return;}const current=await api('tables'),fresh=current.tables.find(row=>row.id===table.id);if(!fresh?.active)throw Error('TABLE_INACTIVE');if(fresh.state!=='FREE'){await tablesView();throw Error('TABLE_OCCUPIED');}table=fresh;
 const waiters=await api('tableWaiters'),dialog=el('dialog');dialog.append(el('h2',t('tableOpen')+' · '+table.name));const form=el('form'),label=el('label',t('responsible')),select=el('select');select.setAttribute('aria-label',t('responsible'));
 if(me.role==='WAITER')select.append(el('option',me.name,{value:me.id}));else{select.append(el('option',waiters.length?'—':t('noWaiter'),{value:''}));for(const waiter of waiters)select.append(el('option',waiter.name,{value:waiter.id}));select.required=waiters.length>0;}label.append(select);form.append(label);const submit=el('button',t('tableOpen'),{type:'submit',className:'primary'});form.append(submit);dialog.append(form);button(dialog,'cancel',()=>dialog.close());dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();form.onsubmit=e=>{e.preventDefault();run(async()=>{await api('tableOpen',{tableId:table.id,responsibleWaiterId:select.value||null});dialog.close();await tablesView();},submit);};
}
async function visitDialog(id){
 const v=await api('visitGet',{id}),dialog=el('dialog');activeVisit={id,revision:v.revision,dialog};dialog.append(el('h2',t('tableDetails')+' · '+v.tableName),el('p',t('openedBy')+': '+v.openedBy.name),el('p',t('responsible')+': '+(v.responsibleWaiter?.name??t('noWaiter'))),el('p',t('openedAt')+': '+new Date(v.openedAt).toLocaleString(lang==='ky'?'ky-KG':'ru-RU',{timeZone:'Asia/Bishkek'})));
 if(v.status==='OPEN'&&!v.hasAcceptedBatch&&!v.hasRegisteredPayment){dialog.append(el('p',t('emptyVisit')));if(me.permissions.includes('table.close_empty'))button(dialog,'tableClose',async()=>{if(tableEditing&&!await confirmAction(t('tableDiscard')))return;await api('draftContext',{sessionId:v.id});const localDraft=await api('localDraftRead',{sessionId:v.id});if(localDraft?.frozen)throw new Error('DRAFT_FROZEN');if(localDraft?.lines.length&&!await confirmAction(t('closeDraftWarning')))return;if(!await confirmAction(t('confirmEmpty')))return;await api('tableClose',{sessionId:v.id,revision:v.revision});dialog.close();await tablesView();},true);}
 button(dialog,'orderWorkspace',async()=>{if(tableEditing&&!await confirmAction(t('tableDiscard')))return;dialog.close();orderSession=id;screen='order';await orderView();});
 button(dialog,'done',()=>dialog.close());dialog.onclose=()=>{dialog.remove();if(activeVisit?.dialog===dialog)activeVisit=null;};document.body.append(dialog);dialog.showModal();
}
let tableRefreshAgain=false;
async function tableRefreshNow(scope='full',ticket=cashRealtimeTicket){
 if(!me||!isCashView('tables')||tableCartSelection||document.hidden)return;
 if(tableRefreshBusy){tableRefreshAgain=true;return;}
 tableRefreshBusy=true;
 try{
  if(activeVisit){const v=await api('visitGet',{id:activeVisit.id});if(v.revision!==activeVisit.revision){activeVisit.dialog.close();await tablesView();}return;}
  if(tableEditing||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,select'))return;
  const loaded=await tableReadOverview(scope);if(ticket!==cashRealtimeTicket){tableRefreshAgain=true;return;}tableOverviewCache=loaded;const changed=scope==='drafts'||tableSnapshotKey(loaded.data,loaded.shift,loaded.active,loaded.sales)!==tableFingerprint;
  if(tableFirstSideTab==='waiters'&&me.permissions.includes('shift.report.view')){const waiterSummary=await api('waiterShiftSummary'),waiterChanged=JSON.stringify([waiterSummary.shiftId,waiterSummary.waiters])!==tableFirstWaiterFingerprint;if(changed||waiterChanged)await tablesView({...loaded,waiterSummary});else tableClockOffset=loaded.data.serverTime-Date.now();}
  else if(changed||tableFirstSideTab==='waiters'){if(tableCartSelection&&tableFirstSideTab!=='waiters')await fastSalesViewNow();else await tablesView(loaded);}else{tableClockOffset=loaded.data.serverTime-Date.now();message();}
 }catch(error){if(scope!=='full')tableRefreshAgain=true;if(['SESSION_INVALID','SESSION_EXPIRED','VISIT_ACCESS_DENIED','PERMISSION_DENIED'].includes(error.message))activeVisit?.dialog.close();if(['SERVER_UNAVAILABLE','PERMISSION_DENIED','SESSION_INVALID','SESSION_EXPIRED'].includes(error.message)){$('screen').replaceChildren(el('section',error.message==='SERVER_UNAVAILABLE'?(lang==='ky'?'Жергиликтүү сервер жеткиликсиз — аракеттер токтотулду.':'Локальный сервер недоступен — действия временно запрещены.'):t('permissionDenied')));tableFingerprint='';}handleError(error);}finally{tableRefreshBusy=false;if(tableRefreshAgain){tableRefreshAgain=false;void tableRefreshNow();}}
}
// Realtime drives normal updates; this slow poll also recovers a missed event or a disconnected socket.
let tableLastFallbackAt=Date.now();
function tablePollFallback(now=Date.now()){if(!isCashView('tables')||tableCartSelection||document.hidden)return;const period=cashRealtimeConnected?300000:30000;if(now-tableLastFallbackAt<period)return;tableLastFallbackAt=now;void tableRefreshNow();}
setInterval(tablePollFallback,30000);
function cashRealtimeChange(change){
 let scope='full';
 if(change?.type==='ready'){
  if(typeof change.epoch==='string'&&Number.isSafeInteger(change.seq)&&change.seq>=0&&cashChangeSeq===null){cashChangeEpoch=change.epoch;cashChangeSeq=change.seq;}
  return;
 }
 if(change?.type==='sync'){cashChangeEpoch=null;cashChangeSeq=null;}
 else if(change?.type==='changed'&&typeof change.epoch==='string'&&Number.isSafeInteger(change.seq)&&change.seq>0&&['full','menu','tables','orders','sales','drafts','print'].includes(change.scope)){
  if(change.epoch===cashChangeEpoch&&cashChangeSeq!==null&&change.seq<=cashChangeSeq)return;
  if(change.epoch===cashChangeEpoch&&cashChangeSeq!==null&&change.seq===cashChangeSeq+1)scope=change.scope;
  cashChangeEpoch=change.epoch;cashChangeSeq=change.seq;
 }else{cashChangeEpoch=null;cashChangeSeq=null;}
 if(scope==='full')cashClearHistoryCache();
 cashRealtimeTicket++;
 if(isCashView('tables')){if(scope==='menu'||scope==='print')return;void tableRefreshNow(scope==='sales'?'full':scope,cashRealtimeTicket);}
 else if(isCashView('fastSales'))fastRequestRefresh(scope);
}
window.pos.onChanged(cashRealtimeChange);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&isCashView('tables'))void tableRefreshNow();});
setInterval(()=>{if(!isCashView('tables')||!me)return;for(const badge of document.querySelectorAll('.table-first-status[data-started-at]'))badge.textContent=tableCardStatus(badge.dataset.statusKind,Number(badge.dataset.startedAt));},15000);

function tableScrollGroup(group){
 const key=group.classList.contains('table-filters')?'status':'zone';group.scrollLeft=tableFilterScroll[key]??0;
 group.addEventListener('scroll',()=>{tableFilterScroll[key]=group.scrollLeft;},{passive:true});
 group.addEventListener('keydown',event=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;const buttons=[...group.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();buttons[next]?.scrollIntoView({block:'nearest',inline:'nearest'});});
 requestAnimationFrame(()=>group.querySelector('[aria-selected=true],[aria-pressed=true]')?.scrollIntoView({block:'nearest',inline:'nearest'}));
}
const tableFilterScroll={status:0,zone:0};
