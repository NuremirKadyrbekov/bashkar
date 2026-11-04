'use strict';
// Terminal-only layout preference. Orders, prices and access remain owned by Local POS Server.
let fastState={actor:null,mode:'COUNTER',lines:[],category:'',search:'',tableId:null,waiterId:null,waiterName:null,discount:0,scope:crypto.randomUUID(),sessionId:null,quote:null,quoteVersion:0,menu:null,shift:null,tables:null,active:null,sales:null,serverTime:0};
let fastRefreshBusy=false,cashDisplay='tables',cashRefreshScope='full';
function isCashView(kind){if(typeof tableQuickSession!=='undefined'&&tableQuickSession)return kind==='fastSales'&&!tableQuickSession.closing;return screen==='cashRegister'&&(cashDisplay===kind||kind==='fastSales'&&cashDisplay==='tables'&&!!tableCartSelection);}
function cashQuery(selector){return (typeof tableQuickSession!=='undefined'&&tableQuickSession?tableQuickSession.dialog:document.getElementById('screen')??document).querySelector(selector);}
function cashBlockingDialog(){return [...document.querySelectorAll('dialog[open]')].some(dialog=>!dialog.classList.contains('table-quick-modal'))||!!document.querySelector('.order-first-assign-popover:popover-open,.cash-line-actions-popover:popover-open');}
async function cashRegisterView(){const p=me?.permissions??[],next=posSalesPreference()==='FAST_FIRST'||!p.includes('table.view_status')?'fastSales':'tables';if(next!=='tables'||fastState.actor&&fastState.actor!==me.branchId+':'+me.id){tableCartSelection=null;tableFirstSideTab='sales';}cashDisplay=next;if(!p.some(k=>['counter.view','table.view_status'].includes(k)))throw new Error('PERMISSION_DENIED');return cashDisplay==='fastSales'?fastSalesView():tablesView();}
function initFastSalesUi(ru,ky){
 Object.assign(ru,{fastSales:'Быстрая продажа',posSettings:'Основные',fastCurrent:'Текущий заказ',fastHall:'Зал',fastTakeaway:'На вынос',fastRecent:'Последние продажи',fastActive:'Активные заказы',fastAll:'Все категории',fastSearch:'Поиск блюд и напитков…',fastEmptyCart:'Добавьте блюда из каталога',fastChooseTable:'Назначить стол',fastChooseWaiter:'Ответственный официант',fastSelectTable:'Выберите свободный стол',fastSubtotal:'Сумма товаров',fastDiscount:'Скидка',fastTotal:'Итого',fastCreate:'Создать заказ',fastClear:'Очистить',fastNote:'Добавить примечание к заказу',fastNoteUnavailable:'Примечание к заказу пока не поддерживается сервером. Комментарий к блюду доступен при добавлении.',fastNoSales:'Пока нет завершённых продаж',fastNoActive:'Активных заказов нет',fastNoMenu:'Опубликованное меню пока пусто',fastPhoto:'Фото блюда пока не добавлено',fastTableFirst:'Столы сначала',fastOrderFirst:'Продажа сначала',fastSettingsHint:'Выберите главный экран продаж для этого кассового терминала. Настройка сохраняется на устройстве.',fastTableFirstHint:'Экран столов и действующий редактор заказов',fastOrderFirstHint:'Три колонки: продажи, каталог и корзина',fastSaved:'Вид экрана продаж сохранён',fastShiftRequired:'Откройте кассовую смену для создания заказа',fastCheck:'Проверить заказ',fastChanged:'Меню или условия изменились. Проверьте корзину и подтвердите снова.',fastUnknown:'Результат отправки неизвестен. Проверьте исходное действие в списке неподтверждённых операций.',fastOpenedVisit:'Посещение открыто. Заказ можно продолжить в редакторе стола.',fastAdd:'Добавить',fastEdit:'Изменить',fastPositions:'позиций',fastNoImage:'Фото блюд сервером пока не предоставляются',fastPricePending:'Расчёт на сервере…',fastPriceUnavailable:'Проверьте связь или состав корзины',fastModeChange:'Смена режима сбросит выбор стола. Продолжить?'});
 Object.assign(ky,{fastSales:'Ыкчам сатуу',posSettings:'Негизги',fastCurrent:'Учурдагы буйрутма',fastHall:'Зал',fastTakeaway:'Алып кетүү',fastRecent:'Акыркы сатуулар',fastActive:'Активдүү буйрутмалар',fastAll:'Бардык категориялар',fastSearch:'Тамактарды издөө…',fastEmptyCart:'Каталогдон тамак кошуңуз',fastChooseTable:'Столду тандоо',fastChooseWaiter:'Жооптуу официант',fastSelectTable:'Бош столду тандаңыз',fastSubtotal:'Товарлар',fastDiscount:'Арзандатуу',fastTotal:'Жыйынтык',fastCreate:'Буйрутма түзүү',fastClear:'Тазалоо',fastNote:'Буйрутмага эскертүү кошуу',fastNoteUnavailable:'Буйрутма эскертүүсүн сервер азырынча колдобойт. Тамак комментарийин кошо аласыз.',fastNoSales:'Аяктаган сатуулар жок',fastNoActive:'Активдүү буйрутмалар жок',fastNoMenu:'Жарыяланган меню бош',fastPhoto:'Тамак сүрөтү жок',fastTableFirst:'Адегенде столдор',fastOrderFirst:'Адегенде сатуу',fastSettingsHint:'Бул терминалдын башкы сатуу экранын тандаңыз.',fastTableFirstHint:'Столдор жана учурдагы буйрутма редактору',fastOrderFirstHint:'Сатуулар, каталог жана себет',fastSaved:'Экран көрүнүшү сакталды',fastShiftRequired:'Буйрутма түзүү үчүн нөөмөттү ачыңыз',fastCheck:'Буйрутманы текшерүү',fastChanged:'Меню же шарттар өзгөрдү. Себетти кайра текшериңиз.',fastUnknown:'Жөнөтүүнүн жыйынтыгы белгисиз. Ырасталбаган аракеттерди текшериңиз.',fastOpenedVisit:'Баруу ачылды. Буйрутманы стол редакторунан улантыңыз.',fastAdd:'Кошуу',fastEdit:'Өзгөртүү',fastPositions:'позиция',fastNoImage:'Сервер тамак сүрөттөрүн азырынча бербейт',fastPricePending:'Сервер эсептөөдө…',fastPriceUnavailable:'Байланышты же себетти текшериңиз',fastModeChange:'Режим алмашса стол тандоосу өчөт. Улантасызбы?'});
 Object.assign(ru,{cashDiscountApplied:'Скидка применена',cashRegister:'Касса',cashSaveView:'Сохранить вид экрана',cashViewTitle:'Как вам удобнее продавать?',cashViewHint:'Выберите рабочий экран кассы. Настройка применяется на этом устройстве для текущего филиала.',cashSelected:'Выбрано',cashStorageError:'Не удалось сохранить вид экрана. Попробуйте снова.',cashApplyDiscount:'Применить скидку',cashChooseWaiter:'Выбрать официанта',cashNoNumber:'Номер не присвоен',cashNoFree:'В этой зоне нет свободных столов',cashOrder:'Заказ',cashDiscountTooLarge:'Скидка не должна превышать сумму товаров.',cashDiscountHint:'Фиксированная сумма в сомах',cashClearDiscount:'Очистить',cashTableRequired:'Выберите стол',cashWaiterRequired:'Выберите ответственного официанта'});
 Object.assign(ky,{cashDiscountApplied:'Арзандатуу колдонулду',cashRegister:'Касса',cashSaveView:'Экран көрүнүшүн сактоо',cashViewTitle:'Кайсы сатуу экраны ыңгайлуу?',cashViewHint:'Бул түзмөк жана учурдагы филиал үчүн кассанын көрүнүшүн тандаңыз.',cashSelected:'Тандалды',cashStorageError:'Экран көрүнүшү сакталган жок. Кайра аракет кылыңыз.',cashApplyDiscount:'Арзандатууну колдонуу',cashChooseWaiter:'Официант тандоо',cashNoNumber:'Номер берилген эмес',cashNoFree:'Бул зонада бош стол жок',cashOrder:'Буйрутма',cashDiscountTooLarge:'Арзандатуу товарлардын суммасынан ашпашы керек.',cashDiscountHint:'Сом менен туруктуу сумма',cashClearDiscount:'Тазалоо',cashTableRequired:'Столду тандаңыз',cashWaiterRequired:'Жооптуу официантты тандаңыз'});
 Object.assign(ru,{posTableModeScope:'Режим действует во всём филиале: на кассе и телефонах официантов, в том числе для уже открытых столов.',posTableModeCurrent:'Текущий режим',posTableModeUnset:'Режим ещё не настроен',posTableModeOwner:'Изменить режим может сотрудник с правом «Настройка STRICT / SHARED».',posTableModeSaved:'Режим доступа к столам сохранён'});
 Object.assign(ky,{posTableModeScope:'Режим бүт филиалда иштейт: кассада жана официант телефондорунда, мурда ачылган үстөлдөргө да тиешелүү.',posTableModeCurrent:'Учурдагы режим',posTableModeUnset:'Режим али жөндөлө элек',posTableModeOwner:'Режимди «STRICT / SHARED жөндөө» укугу бар кызматкер өзгөртө алат.',posTableModeSaved:'Үстөлдөргө жетүү режими сакталды'});
 Object.assign(ru,{salesCatalogEdit:'Изменить закрепления блюд',salesCatalogDone:'Завершить закрепление',salesCatalogPin:'Закрепить',salesCatalogUnpin:'Открепить'});
 Object.assign(ky,{salesCatalogEdit:'Тамактарды бекитүүнү өзгөртүү',salesCatalogDone:'Бекитүүнү бүтүрүү',salesCatalogPin:'Бекитүү',salesCatalogUnpin:'Бекитүүнү алып салуу'});
}
function posSalesPreference(person=me){try{return localStorage.getItem('bashkar.pos.sales-view.'+person.branchId)==='FAST_FIRST'?'FAST_FIRST':'TABLE_FIRST';}catch{return 'TABLE_FIRST';}}
function posSalesHome(person=me){return person.permissions?.some(p=>['counter.view','table.view_status'].includes(p))?'cashRegister':'shift';}
async function posSettingsView(){
 me=await api('me');if(!me.permissions.some(p=>['counter.view','table.view_status'].includes(p)))throw new Error('PERMISSION_DENIED');
 const section=shell(t('posSettings'));section.classList.add('fast-settings');
 const intro=el('div',undefined,{className:'cash-settings-intro'});intro.append(el('span','BASHKAR POS',{className:'cash-settings-eyebrow'}),el('h2',t('cashViewTitle')),el('p',t('cashViewHint')));section.append(intro);
 if(me.permissions.includes('table.view_status')&&me.permissions.includes('table.manage'))button(section,'tableConfig',async()=>{screen='tableConfig';await render();},true);
 let selected=posSalesPreference();const choices=el('div',undefined,{className:'fast-settings-choices',role:'group'});choices.setAttribute('aria-label',t('posSettings'));
 const draw=()=>{choices.replaceChildren();for(const [value,label,hint]of [['TABLE_FIRST','fastTableFirst','fastTableFirstHint'],['FAST_FIRST','fastOrderFirst','fastOrderFirstHint']]){
  const card=el('button',undefined,{type:'button',className:'fast-settings-card'+(selected===value?' selected':'')});card.dataset.view=value;card.setAttribute('aria-pressed',String(selected===value));
  const preview=el('div',undefined,{className:'cash-layout-preview '+value.toLowerCase()});preview.setAttribute('aria-hidden','true');const header=el('span',undefined,{className:'preview-header'}),body=el('div',undefined,{className:'preview-body'});for(let i=0;i<(value==='TABLE_FIRST'?9:3);i++){const block=el('span');if(value==='FAST_FIRST'&&i===1)for(let j=0;j<6;j++)block.append(el('i'));body.append(block);}preview.append(header,body);
  const caption=el('div',undefined,{className:'cash-choice-caption'});caption.append(el('strong',t(label)),el('span',t(hint)),el('b',selected===value?'✓ '+t('cashSelected'):'○',{className:'cash-choice-mark'}));card.append(preview,caption);card.onclick=()=>{selected=value;draw();};choices.append(card);
 }};draw();section.append(choices);
 const footer=el('div',undefined,{className:'cash-settings-footer'});footer.append(el('p',t('branchWorkspace')+' · '+(me.branchName??me.branchId.slice(0,8)),{className:'muted'}));fastButton(footer,t('cashSaveView'),async()=>{
  const key='bashkar.pos.sales-view.'+me.branchId;let previous;try{previous=localStorage.getItem(key);localStorage.setItem(key,selected);if(localStorage.getItem(key)!==selected)throw new Error('STORAGE_WRITE_FAILED');toast('success',t('fastSaved'));}catch{try{if(previous===null)localStorage.removeItem(key);else if(previous!==undefined)localStorage.setItem(key,previous);}catch{}toast('error',t('cashStorageError'));}
 },'primary');section.append(footer);
}

const fastTime=value=>new Date(value).toLocaleTimeString(lang==='ky'?'ky-KG':'ru-RU',{timeZone:'Asia/Bishkek',hour:'2-digit',minute:'2-digit'});
function fastIcon(type){return tablePanelIcon(type,false);}
function fastDishIcon(){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#icon-menu');svg.append(use);svg.setAttribute('aria-hidden','true');return svg;}
function fastLineItem(line){return fastState.menu?.catalog?.items.find(item=>item.id===line.itemId);}
function fastLineTitle(line){if(line.kind==='CUSTOM_AMOUNT')return t('cashCustomItem');const snapshot=!tableQuickSession&&fastState.localDraft?.preview?.[line.lineId];if(snapshot)return snapshot.name;const item=fastLineItem(line);return item?orderName(item):line.itemId;}
function fastQuoteLines(lines){return lines.map(({itemId,variantId,modifierIds,quantity,comment,kind,unitPrice})=>({itemId,variantId,modifierIds,quantity,comment,...(kind==='CUSTOM_AMOUNT'?{kind,unitPrice}:{})}));}
function fastButton(parent,label,action,cls=''){const b=el('button',label,{type:'button',className:cls});b.onclick=()=>run(async()=>{try{await action();}catch(error){cashActionError(error);}},b);parent.append(b);return b;}
let cashViewPending=null,cashViewRepeat=false,cashViewForceCart=false;
async function fastSalesView(allowCartPatch=false){if(typeof tableQuickSession!=='undefined'&&tableQuickSession)return tableQuickRefresh();if(cashViewPending){cashViewRepeat=true;if(!allowCartPatch)cashViewForceCart=true;return cashViewPending;}cashViewForceCart=!allowCartPatch;cashViewPending=(async()=>{do{cashViewRepeat=false;const patch=!cashViewForceCart;cashViewForceCart=false;await fastSalesViewNow(patch);}while(cashViewRepeat&&isCashView('fastSales'));})();try{return await cashViewPending;}finally{cashViewPending=null;}}
function fastCatalogKey(){
 const menu=fastState.menu;if(!menu||!Number.isSafeInteger(menu.revision)||!menu.catalog||!menu.availability||!me?.id||!Array.isArray(me.permissions))return null;
 return JSON.stringify([fastState.actor,menu.revision,menu.availability,lang,[...me.permissions].sort(),fastState.completedSaleId,!!fastState.serverDraftConflict,!!fastState.serverDraftOutdated]);
}
function fastSearchFocus(){
 const input=document.activeElement;if(!input?.matches('#screen .fast-catalog .fast-search'))return null;
 const section=input.closest('section.fast-sales');if(section?.dataset.actor!==fastState.actor||section.dataset.permissions!==me.permissions.join(','))return null;
 return {actor:fastState.actor,permissions:me.permissions.join(','),start:input.selectionStart,end:input.selectionEnd};
}
function fastRestoreSearchFocus(saved){
 if(!saved||saved.actor!==fastState.actor||saved.permissions!==me.permissions.join(','))return;
 const input=cashQuery('.fast-catalog .fast-search');if(!input||input.disabled)return;
 input.focus({preventScroll:true});if(Number.isInteger(saved.start)&&Number.isInteger(saved.end))try{input.setSelectionRange(saved.start,saved.end);}catch{}
}
function fastCartStateKey(){
 return JSON.stringify([fastState.actor,fastState.orderId,fastState.sessionId,fastState.completedSaleId,fastState.mode,fastState.tableId,fastState.waiterId,fastState.closed,fastState.frozen,fastState.serverDraftConflict,fastState.serverDraftOutdated,fastState.order,fastState.visit,fastState.shift,fastState.lines,fastState.localDraft,fastState.quote,fastState.discount,fastState.fulfillmentPending,fastState.cancelPending,me?.permissions,lang]);
}
async function fastSalesViewNow(allowCartPatch=false){
 const realtimeTicket=cashRealtimeTicket;
 const priorHistory=fastState.history,priorCartKey=fastCartStateKey(),priorCatalogKey=fastCatalogKey();
 me=await api('me');if(!me.permissions.some(p=>['counter.view','table.view_status'].includes(p)))throw new Error('PERMISSION_DENIED');
 if(fastState.actor!==me.branchId+':'+me.id){Object.assign(fastState,{actor:me.branchId+':'+me.id,completedSale:null,completedSaleId:null,mode:me.permissions.includes('table.view_status')?'TABLE':'COUNTER',lines:[],category:'',search:'',salesCatalogLayout:null,pinEditMode:false,tableId:null,waiterId:null,waiterName:null,discount:0,scope:crypto.randomUUID(),sessionId:null,quote:null,pricedLines:{}});}
 const [menu,shift,active,tables,sales]=await Promise.all([api('menu'),api('shift'),api('activeOrders'),me.permissions.includes('table.view_status')?api('tables'):Promise.resolve(null),me.permissions.includes('sales.view_24h')?api('salesList',{limit:12}):Promise.resolve(null)]);
 Object.assign(fastState,{menu,shift,active,tables,sales,serverTime:active.serverTime});
 try{await cashLoadWorkspace();}catch(error){if(error.message==='HISTORY_CHANGED'){fastRequestRefresh('full');return;}throw error;}if(!isCashView('fastSales'))return;
 fastState.fulfillmentPending=(await api('pending')).filter(p=>p.action==='fulfillmentMark');
 fastState.cancelPending=(await api('pending')).find(p=>p.action==='correctCommit'&&p.payload.orderId===fastState.orderId)??null;if(fastState.cancelPending)fastState.frozen=true;
 if(fastState.completedSaleId){try{fastState.completedSale=await api('saleDetails',{orderId:fastState.completedSaleId});fastState.completedRefundPending=(await api('pending')).some(p=>p.action==='orderRefundCommit'&&p.payload.orderId===fastState.completedSaleId||p.action==='refundCommit'&&fastState.completedSale.payments.some(payment=>payment.id===p.payload.paymentId));}catch(error){fastState.completedSaleId=null;fastState.completedSale=null;cashActionError(error);}}
 fastState.parked=await api('serverDraftList');
 if(realtimeTicket!==cashRealtimeTicket){fastRequestRefresh('full');return;}
 if(fastState.mode==='TABLE'&&!tables)fastState.mode='COUNTER';
 if(cashDisplay==='tables'&&!tableQuickSession)return tablesView({data:tables,shift,active,sales});
 const existing=document.querySelector('#screen > section.fast-sales'),catalog=existing?.querySelector('.fast-catalog'),key=fastCatalogKey();
 const oldRecent=existing?.querySelector('.fast-recent'),oldCenter=existing?.querySelector('.fast-center'),oldCart=existing?.querySelector('.fast-cart');
 if(existing&&oldRecent&&oldCenter&&oldCart&&catalog&&key&&catalog.dataset.catalogKey===key){
  fastDrawRecent(oldRecent);
  if(allowCartPatch&&priorCatalogKey===key&&oldCart.cashRenderKey===priorCartKey&&priorCartKey===fastCartStateKey()&&cashPatchAcceptedHistory(oldCart,priorHistory,fastState.history)){oldCart.cashRenderKey=fastCartStateKey();fastRefreshActive(oldCenter);}
  else fastDrawCart(oldCart);
  void catalog.refreshLayout?.();return;
 }
 const searchFocus=fastSearchFocus();
 const section=shell(t('fastSales'));section.classList.add('fast-sales');section.dataset.actor=fastState.actor;section.dataset.permissions=me.permissions.join(',');section.querySelector('h1').remove();
 const left=el('aside',undefined,{className:'fast-panel fast-recent'}),center=el('div',undefined,{className:'fast-center'}),right=el('aside',undefined,{className:'fast-panel fast-cart'});section.append(left,center,right);
 fastDrawRecent(left);fastDrawActive(center);fastDrawCatalog(center);fastDrawCart(right);fastRestoreSearchFocus(searchFocus);
}
function fastDrawRecent(parent){
 parent.replaceChildren(el('h2',t('fastRecent')));if(!fastState.sales){parent.append(el('p',t('permissionDenied'),{className:'muted'}));return;}
 if(!fastState.sales.sales.length)parent.append(el('p',t('fastNoSales'),{className:'muted'}));
 for(const sale of fastState.sales.sales){const row=el('button',undefined,{type:'button',className:'fast-sale-row '+sale.type.toLowerCase()+(fastState.completedSaleId===sale.id?' selected':'')});row.append(fastIcon(sale.type),el('strong',fastOrderLabel(sale)),el('span',sale.type==='TABLE'?t('fastHall')+' · '+fastTableTitle(sale.tableName):t('fastTakeaway')),el('small',fastTime(sale.financialFactTime)),el('b',tableMoney(sale.total)));row.setAttribute('aria-pressed',String(fastState.completedSaleId===sale.id));row.onclick=()=>run(()=>orderFirstSelectSale(sale.id),row);parent.append(row);}
 fastButton(parent,t('allSales'),async()=>{screen='sales';await render();},'fast-more');
}

function fastOrderLabel(order){const number=order.orderNumber??order.counterNumber;return Number.isSafeInteger(number)?t('cashOrder')+' №'+String(number).padStart(3,'0'):t('cashNoNumber');}
function fastTableTitle(name){if(!name||name==='Без стола')return t('cashHallUnassigned');const value=String(name);return /^\d+$/.test(value)?'С'+value:value;}
function fastCardStatusIcon(status){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',status==='waiting'?'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2':status==='takeaway'?'M5 8h14l1 13H4L5 8ZM8 9V6a4 4 0 0 1 8 0v3':'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8 12l3 3 5-6');svg.append(path);return svg;
}
function fastOrderElapsed(createdAt,now=Date.now()){
 const minutes=Math.max(0,Math.floor((now-createdAt)/60000));return minutes<60?minutes+' '+t('cashElapsedMinutes'):Math.floor(minutes/60)+' '+t('cashElapsedHours')+' '+String(minutes%60).padStart(2,'0')+' '+t('cashElapsedMinutes');
}
function fastUpdateOrderElapsed(){
 if(document.hidden||!isCashView('fastSales')&&!isCashView('tables'))return;
 for(const node of document.querySelectorAll('.fast-active-card[data-order-id] .fast-order-elapsed,.table-first-card.takeaway .fast-order-elapsed')){node.textContent=fastOrderElapsed(Number(node.dataset.createdAt));node.setAttribute('aria-label',t('cashElapsed')+' '+node.textContent);}
}
setInterval(fastUpdateOrderElapsed,30000);
document.addEventListener('visibilitychange',fastUpdateOrderElapsed);
function fastDrawActive(parent){
 const panel=el('section',undefined,{className:'fast-panel fast-active'}),head=el('div',undefined,{className:'fast-active-head'});head.append(el('h2',t('fastActive')),el('span',String(fastState.active.orders.length),{className:'fast-count'}));if(!tableQuickSession){const add=fastButton(head,'+ '+t(!fastState.completedSaleId&&fastState.lines.length&&!fastState.order?'cashParkAndNew':'cashNewOrder'),orderFirstNewOrder,'order-first-new');add.disabled=!!fastState.frozen||!!fastState.busy||!!fastState.serverDraftConflict;}panel.append(head);
 const entries=[...(tableQuickSession?[]:(fastState.parked??[]).filter(row=>row.draft.lines.length).map(row=>({draft:true,row,key:'draft:'+row.id,createdAt:row.createdAt??row.updatedAt}))),...fastState.active.orders.map(row=>({draft:false,row,key:'order:'+row.id,createdAt:row.createdAt}))].sort((a,b)=>a.createdAt-b.createdAt||a.key.localeCompare(b.key));
 const list=el('div',undefined,{className:'fast-active-list'+(!tableQuickSession?' fast-identity-list':'')});if(!entries.length)list.append(el('p',t('fastNoActive'),{className:'muted'}));
 for(const entry of entries){
  const row=entry.row,mode=entry.draft?row.draft.cashMeta.mode:row.type,selected=!fastState.completedSaleId&&(entry.draft?!fastState.orderId&&!fastState.sessionId&&row.id===fastState.scope:row.id===fastState.orderId),status=entry.draft?'waiting':'sent';
  const table=entry.draft?fastState.tables?.tables.find(table=>table.id===row.draft.cashMeta.tableId):null,tableId=entry.draft?table?.id:row.tableId,tableTitle=tableId?fastTableTitle(entry.draft?table?.name:row.tableName):null,orderLabel=entry.draft?t('cashOrder')+' №'+String(row.number).padStart(3,'0'):fastOrderLabel(row),title=mode==='TABLE'?fastTableTitle(entry.draft?table?.name:row.tableName):t('fastTakeaway');
  const card=el('button',undefined,{type:'button',className:'fast-active-card '+(entry.draft?'cash-parked-card waiting':mode.toLowerCase()+' sent')+(selected?' selected':'')+(!tableQuickSession?' fast-identity-card':'')});card.dataset.createdAt=String(entry.createdAt);card.dataset.mode=mode;card.dataset[entry.draft?'draftId':'orderId']=row.id;card.setAttribute('aria-pressed',String(selected));
  const badge=el('span',undefined,{className:'fast-order-badge '+status});badge.append(fastCardStatusIcon(status),document.createTextNode(t(entry.draft?'cashParked':'cashCardSent')));
  if(tableQuickSession)card.append(el('strong',title,{title}),badge,el('small',entry.draft?t('cashDraftNumber')+' №'+row.number:orderLabel));
  else{
   const heading=tableTitle??orderLabel,typeLabel=t(mode==='TABLE'?'fastHall':'fastTakeaway'),typeBadge=el('span',typeLabel,{className:'fast-type-badge '+(mode==='TABLE'?'hall':'takeaway')});
   const fullLabel=(tableTitle?tableTitle+' · ':'')+(entry.draft?t('cashDraftNumber')+' №'+row.number:orderLabel)+' · '+typeLabel+' · '+t(entry.draft?'cashParked':'cashCardSent');card.setAttribute('aria-label',fullLabel);card.title=fullLabel;
   card.append(el('strong',heading,{title:heading}));if(tableTitle)card.append(el('small',orderLabel,{className:'fast-card-order-number'}));card.append(typeBadge,badge);
  }
  card.append(el('span',(entry.draft?row.draft.lines.length:row.positionCount)+' '+t('fastPositions'),{className:'fast-card-count'}));
  if(!entry.draft)card.append(el('b',tableMoney(row.total),{title:tableMoney(row.total)}));card.append(el('time',fastTime(entry.createdAt)));
  if(!entry.draft){const elapsed=el('span',fastOrderElapsed(entry.createdAt),{className:'fast-order-elapsed'});elapsed.dataset.createdAt=String(entry.createdAt);elapsed.setAttribute('aria-label',t('cashElapsed')+' '+elapsed.textContent);card.append(elapsed);}
  if(entry.draft){card.onclick=()=>{if(!selected)return run(()=>orderFirstSelectDraft(row.id),card);};const wrap=el('div',undefined,{className:'cash-parked-wrap'}),remove=fastButton(wrap,'×',()=>cashDiscardParked(row),'cash-parked-discard');remove.setAttribute('aria-label',t('cashDiscardDraft'));wrap.prepend(card);list.append(wrap);}
  else{card.onclick=()=>run(()=>cashSelectOrder(row.id),card);list.append(card);}
 }
 panel.append(list);parent.append(panel);
}
function fastRefreshActive(center){const active=center?.querySelector('.fast-active');if(!active)return;const holder=el('div');fastDrawActive(holder);active.replaceWith(holder.firstElementChild);}

function fastDrawCatalog(parent){
 const panel=el('section',undefined,{className:'fast-panel fast-catalog'}),search=el('input',undefined,{type:'search',placeholder:t('fastSearch'),value:fastState.search,className:'fast-search'});search.setAttribute('aria-label',t('fastSearch'));
 const key=fastCatalogKey();if(key)panel.dataset.catalogKey=key;
 const toolbar=el('div',undefined,{className:'sales-catalog-toolbar'});toolbar.append(search);
 const canPin=me.permissions.includes('menu.edit');let pencil;
 if(canPin){pencil=fastButton(toolbar,'✎',()=>{fastState.pinEditMode=!fastState.pinEditMode;draw(true);},'sales-catalog-pencil');pencil.setAttribute('aria-label',t('salesCatalogEdit'));pencil.title=t('salesCatalogEdit');}
 panel.append(toolbar);
 const categories=el('div',undefined,{className:'fast-categories',role:'group'}),grid=el('div',undefined,{className:'fast-products'});categories.setAttribute('aria-label',t('chooseCategory'));panel.append(categories,grid);
 const catalog=fastState.menu.catalog,categoryRows=catalog?.categories.filter(c=>!c.archived&&catalog.items.some(item=>item.categoryId===c.id&&!item.archived))??[];
 if(!categoryRows.some(c=>c.id===fastState.category))fastState.category=categoryRows[0]?.id??'';
 categories.classList.toggle('single-row',categoryRows.length<2);
 for(const category of categoryRows){const tab=fastButton(categories,orderName(category),()=>{fastState.category=category.id;draw();});tab.dataset.categoryId=category.id;}
 const state=fastState;let request=0;
 async function loadLayout(){const current=++request;try{const layout=await api('salesCatalogLayout');if(current!==request||state!==fastState||!panel.isConnected)return;if(JSON.stringify(state.salesCatalogLayout)===JSON.stringify(layout))return;state.salesCatalogLayout=layout;draw(true);}catch(error){if(current===request&&panel.isConnected)cashActionError(error);}}
 panel.refreshLayout=loadLayout;
 function draw(rebuild=false){
  for(const tab of categories.children){const selected=tab.dataset.categoryId===fastState.category;tab.classList.toggle('selected',selected);tab.setAttribute('aria-pressed',String(selected));}
  if(pencil){pencil.classList.toggle('selected',!!fastState.pinEditMode);pencil.setAttribute('aria-pressed',String(!!fastState.pinEditMode));pencil.setAttribute('aria-label',t(fastState.pinEditMode?'salesCatalogDone':'salesCatalogEdit'));pencil.title=pencil.getAttribute('aria-label');}
  const reusable=new Map(rebuild?[]:[...grid.children].filter(card=>card.classList.contains('fast-product')).map(card=>[card.dataset.itemId,card])),next=document.createDocumentFragment();const pins=(fastState.salesCatalogLayout?.pins??[]).filter(row=>row.categoryId===fastState.category),pinOrder=new Map(pins.map((row,index)=>[row.itemId,index])),sold=new Map((fastState.salesCatalogLayout?.ranking??[]).map(row=>[row.itemId,row.units]));
  const items=catalog?.items.filter(item=>!item.archived&&item.categoryId===fastState.category&&orderName(item).toLocaleLowerCase().includes(fastState.search.trim().toLocaleLowerCase())).sort((a,b)=>{const ap=pinOrder.get(a.id),bp=pinOrder.get(b.id);return ap!==undefined&&bp!==undefined?ap-bp:ap!==undefined?-1:bp!==undefined?1:(sold.get(b.id)??0)-(sold.get(a.id)??0);})??[];
  if(!items.length)next.append(el('p',t(fastState.search?'cashNoSearchResults':'fastNoMenu'),{className:'muted'}));
  for(const item of items){
   const saved=reusable.get(item.id);if(saved){next.append(saved);continue;}
   const card=el('article',undefined,{className:'fast-product'+(pinOrder.has(item.id)?' sales-catalog-pinned':'')});card.dataset.itemId=item.id;if(canPin&&fastState.pinEditMode){const pinned=pinOrder.has(item.id),pin=fastButton(card,'📌',async()=>{const latest=fastState.salesCatalogLayout;if(!latest)return;try{await api('salesCatalogPin',{categoryId:item.categoryId,itemId:item.id,pinned:!pinned,expectedRevision:latest.revision});await loadLayout();}catch(error){if(error.message==='SALES_CATALOG_PIN_CONFLICT')await loadLayout();throw error;}},'sales-catalog-pin'+(pinned?' selected':''));pin.setAttribute('aria-label',t(pinned?'salesCatalogUnpin':'salesCatalogPin')+' '+orderName(item));pin.setAttribute('aria-pressed',String(pinned));pin.title=pin.getAttribute('aria-label');pin.disabled=!fastState.salesCatalogLayout;}fastButton(card,orderName(item),()=>fastAddItem(item),'fast-product-title');const variants=item.variants?.filter(v=>fastState.menu.availability[v.id]?.available??v.available)??[];if(variants.length)card.append(el('small',variants.map(v=>orderName(v)).join(' · ')));
   const prices=item.pricingMode==='MATRIX'?item.combinationPrices?.filter(c=>fastState.menu.availability[c.id]?.available??c.available).map(c=>c.price)??[]:variants.length?variants.map(v=>v.price):[item.price],valid=prices.filter(Number.isSafeInteger);
   const footer=el('div',undefined,{className:'fast-product-footer'});footer.append(el('b',valid.length?(valid.length>1?t('cashPriceFrom')+' ':'')+tableMoney(Math.min(...valid)):'—'));
   const add=fastButton(footer,'+',()=>fastAddItem(item),'fast-add'),blocked=orderSetBlocker(item,catalog,fastState.menu.availability);add.disabled=!!fastState.completedSaleId&&!tableQuickSession||!(fastState.menu.availability[item.id]?.available??item.available)||!!blocked||(item.variants.length&&!variants.length)||!!fastState.serverDraftConflict||!!fastState.serverDraftOutdated;add.setAttribute('aria-label',t('fastAdd')+' '+orderName(item));card.querySelector('.fast-product-title').disabled=add.disabled;
   card.onclick=event=>{if(!add.disabled&&!event.target.closest('button'))void fastAddItem(item);};card.append(footer);const reason=orderAvailabilityReason(item,fastState.menu.availability);if(reason)card.append(el('small',reason,{className:'fast-product-availability'}));next.append(card);
  }
  grid.replaceChildren(next);
 }
 search.oninput=()=>{fastState.search=search.value;draw();};draw();parent.append(panel);void loadLayout();
}
async function fastAddItem(item,existing=null){
 const state=fastState;try{
  if(fastState.busy||fastState.completedSaleId&&!tableQuickSession)return;if(fastState.frozen){if(tableQuickSession)return tableQuickRecovery();orderSession=fastState.sessionId;screen='order';await render();return;}const actor=me.id,shift=await api('shift');if(state!==fastState||!isCashView('fastSales'))return;fastState.shift=shift;
  if(!shift){if(!me.permissions.includes('shift.open')){toast('warning',t('permissionDenied'));return;}const opened=await shiftOpenDialog();if(!opened||state!==fastState||me?.id!==actor||!isCashView('fastSales'))return;fastState.shift=await api('shift');fastState.menu=await api('menu');item=fastState.menu.catalog?.items.find(row=>row.id===item.id);if(!item)throw new Error('ITEM_UNAVAILABLE');}
  if(cashHasChoices(item))await cashChoiceDialog(item,existing);else await cashAddSimple(item);
 }catch(error){cashActionError(error);}
}

function fastRenderTotals(box,quote){
 if(!tableQuickSession)return orderFirstTotals(box,quote);
 box.replaceChildren();if(fastState.order){const accepted=el('div',undefined,{className:'fast-total-row cash-accepted-amount'});accepted.append(el('span',t('cashAcceptedAmount')),el('strong',tableMoney(fastState.order.total)));box.append(accepted);if(fastState.lines.length){const batch=el('div',undefined,{className:'fast-total-row'});batch.append(el('span',t('cashNewBatch')),el('strong',tableMoney((quote.lines??[]).reduce((s,l)=>s+l.total,0))));box.append(batch);}}const subtotal=el('div',undefined,{className:'fast-total-row'});subtotal.append(el('span',t('fastSubtotal')),el('strong',tableMoney(quote.subtotal)));box.append(subtotal);
 const discount=fastButton(box,'',fastDiscountDialog,'fast-discount-action');discount.append(el('span',t('fastDiscount')+' ›'),el('strong',tableMoney(quote.discount)));discount.disabled=(!fastState.lines.length&&!fastState.order)||fastState.closed||!me.permissions.includes('order.discount.set');if(!me.permissions.includes('order.discount.set'))discount.title=t('permissionDenied');
 for(const fee of quote.fees??[]){const row=el('div',undefined,{className:'fast-total-row'});row.append(el('span',fee.name),el('strong',tableMoney(fee.amount)));box.append(row);}
 const grand=el('div',undefined,{className:'fast-grand'});grand.append(el('span',t('fastTotal')),el('strong',tableMoney(quote.total)));box.append(grand);
}
async function fastDiscountDialog(){
 if(fastState.completedSaleId&&!tableQuickSession)return;
 await cashCartIdle();if(!me.permissions.includes('order.discount.set'))throw new Error('PERMISSION_DENIED');if(!fastState.lines.length&&!fastState.order)return;
 const dialog=financeModal(t('fastDiscount'));dialog.classList.add('cash-discount-modal');dialog.append(el('p',t('cashDiscountHint'),{className:'muted'}));
 const input=el('input',undefined,{type:'text',inputMode:'none',value:fastState.discount?cents(fastState.discount):'',className:'cash-discount-input'});input.setAttribute('aria-label',t('fastDiscount'));dialog.append(input);const error=el('p','',{className:'cash-modal-error',role:'status'}),keys=el('div',undefined,{className:'cash-number-pad'});for(const key of ['1','2','3','4','5','6','7','8','9',',','0','⌫'])fastButton(keys,key,()=>{const value=key==='⌫'?input.value.slice(0,-1):input.value+key;if(/^\d{0,7}([.,]\d{0,2})?$/.test(value))input.value=value;error.textContent='';});dialog.append(keys);fastButton(dialog,t('cashClearDiscount'),()=>{input.value='';error.textContent='';},'cash-discount-clear');dialog.append(error);
 fastButton(dialog,t('cashApplyDiscount'),async()=>{try{const amount=parseCents(input.value||'0');const actor=await api('me');if(!actor.permissions.includes('order.discount.set'))throw new Error('PERMISSION_DENIED');me=actor;if(fastState.order){await api('orderDiscount',{orderId:fastState.orderId,expectedRevision:fastState.order.revision,amount});fastState.order=await api('financeGet',{orderId:fastState.orderId});fastState.discount=amount;await cashPersistDraft();}else await cashMutateCart(lines=>lines,{discount:amount});dialog.close();await fastSalesView();message();toast('success',t('cashDiscountApplied'));}catch(e){if(e.message===t('invalidMoney')){error.textContent=t('invalidMoney');return;}error.textContent=e.message==='INVALID_DISCOUNT'?t('cashDiscountTooLarge'):t('fastPriceUnavailable');cashActionError(e);}},'primary cash-discount-apply');cashFitDialog(dialog);input.focus();
}

async function fastQuote(){
 if(fastState.completedSaleId&&!tableQuickSession)return;
 const state=fastState,version=++fastState.quoteVersion;fastState.quote=null;const box=cashQuery('.fast-totals');if(!box)return;
  if(!fastState.lines.length){fastState.pricedLines={};fastRenderTotals(box,fastState.order??{subtotal:0,discount:0,total:0,fees:[]});return;}
 box.replaceChildren(el('p',t('fastPricePending'),{className:'muted'}));
  try{const quote=await cashWorkspaceQuote(fastState.lines,fastState.discount);if(state!==fastState||version!==fastState.quoteVersion||fastState.completedSaleId&&!tableQuickSession||!isCashView('fastSales'))return;fastState.draftIssues={};fastState.quote=quote;cashQuoteSnapshot(fastState.lines,quote);cashDrawLines(cashQuery('.fast-cart-list'),!tableQuickSession);fastRenderTotals(box,quote);if(!tableQuickSession)orderFirstPaymentState(quote);const submit=cashQuery('.fast-submit');if(submit)submit.disabled=cashLinePending>0||fastState.closed||fastState.frozen||fastState.serverDraftConflict||fastState.serverDraftOutdated||!fastState.shift||!me.permissions.includes(fastState.mode==='TABLE'?'table.batch.submit':'counter.batch.submit');const cart=cashQuery('.fast-cart');if(!tableQuickSession&&cart)cart.cashRenderKey=fastCartStateKey();}
 catch(error){if(state!==fastState||version!==fastState.quoteVersion||fastState.completedSaleId&&!tableQuickSession)return;if(!tableQuickSession&&cashDraftItemError(error)){await cashDraftMarkUnavailable(version);if(version!==fastState.quoteVersion)return;cashDrawLines(cashQuery('.fast-cart-list'),true);}box.replaceChildren(el('p',t('fastPriceUnavailable'),{className:'print-warning'}));const submit=cashQuery('.fast-submit');if(submit)submit.disabled=true;if(!tableQuickSession)orderFirstPaymentState(null);const cart=cashQuery('.fast-cart');if(!tableQuickSession&&cart)cart.cashRenderKey=fastCartStateKey();cashActionError(error);}
}

function fastDrawCart(parent,validated=false){
 if(!tableQuickSession){fastRefreshActive(cashQuery('.fast-center'));return orderFirstDrawCart(parent,validated);}
 if(!parent)return;if(!validated){fastState.quote=null;fastState.pricedLines={};}(tableQuickSession?.dialog??document.getElementById('app-shell')).dataset.saleMode=fastState.mode;parent.replaceChildren();const head=el('div',undefined,{className:'fast-cart-head'}),cartTitle=el('h2',t('fastCurrent'));
 if(fastState.mode==='COUNTER')cartTitle.append(el('small',' · '+t('fastTakeaway'),{className:'cash-mode-label'}));head.append(cartTitle);
 const clear=fastButton(head,'',async()=>{await cashCartIdle();if(fastState.lines.length&&await confirmAction(t('clearOrderConfirm')))await cashMutateCart(()=>[]).catch(cashActionError);},'fast-clear');clear.append(cashActionIcon('reset'));clear.setAttribute('aria-label',t('fastClear'));clear.title=t('fastClear');clear.disabled=!fastState.lines.length||fastState.frozen;const custom=fastButton(head,'',cashCustomDialog,'cash-custom-add');custom.append(cashActionIcon('plus'));custom.title=t('cashCustomItem');custom.setAttribute('aria-label',t('cashCustomItem'));custom.disabled=fastState.frozen||fastState.closed||!me.permissions.includes('order.custom_item.create');parent.append(head);
 const modes=el('div',undefined,{className:'fast-modes'});for(const [mode,label]of [['TABLE','fastHall'],['COUNTER','fastTakeaway']]){
  if(mode==='TABLE'&&(!fastState.tables||tableQuickSession)||mode==='COUNTER'&&!me.permissions.includes('counter.view'))continue;
  const b=fastButton(modes,'',()=>cashSwitchMode(mode),fastState.mode===mode?'selected':'');b.append(fastIcon(mode),el('span',t(label)));b.setAttribute('aria-pressed',String(fastState.mode===mode));
 }
 parent.append(modes);cashDrawAccepted(parent);const list=el('div',undefined,{className:'fast-cart-list'});cashDrawLines(list);list.inert=!!fastState.frozen||!!fastState.closed;parent.append(list);
 const foot=el('div',undefined,{className:'fast-cart-foot'});if(fastState.frozen&&!tableQuickSession){foot.append(el('p',t('fastUnknown'),{className:'print-warning'}));fastButton(foot,t('checkOriginal'),async()=>{if(tableQuickSession)return tableQuickRecovery();orderSession=fastState.sessionId;screen='order';await render();});}
 const note=fastButton(foot,t('fastNote'),()=>{},'fast-note');note.disabled=true;note.title=t('fastNoteUnavailable');if(fastState.mode==='TABLE')fastCartAssignments(foot);
 cashDrawOrderActions(foot);const totals=el('div',undefined,{className:'fast-totals'});foot.append(totals);const submit=fastButton(foot,t(fastState.orderId?'cashSendBatch':'fastCreate'),()=>fastSubmit(),'primary fast-submit');submit.disabled=true;if(!fastState.shift)foot.append(el('p',t('fastShiftRequired'),{className:'print-warning'}));parent.append(foot);
 if(validated&&fastState.quote){fastRenderTotals(totals,fastState.quote);submit.disabled=cashLinePending>0||fastState.closed||fastState.frozen||!fastState.lines.length||!fastState.shift||!me.permissions.includes(fastState.mode==='TABLE'?'table.batch.submit':'counter.batch.submit');}else void fastQuote();
}

function fastCartAssignments(parent){
 const group=el('div',undefined,{className:'cash-assignments'}),table=fastState.tables?.tables.find(row=>row.id===fastState.tableId);fastButton(group,table?fastTableTitle(table.name):t('fastChooseTable'),fastTableDialog,'cash-assignment-table');fastButton(group,fastState.waiterName??(me.role==='WAITER'?me.name:t('cashChooseWaiter')),fastWaiterDialog,'cash-assignment-waiter');parent.append(group);
}
function cashPickerViewKey(){return 'bashkar.pos.table-picker-view.'+me.branchId+'.'+me.id;}
function cashPickerPreferredView(){try{return localStorage.getItem(cashPickerViewKey())==='map'?'map':'cards';}catch{return 'cards';}}
function cashPickerRememberView(view){try{localStorage.setItem(cashPickerViewKey(),view);}catch{toast('warning',t('cashStorageError'));}}
function cashPickerMapBounds(zones,tables){
 if(!zones.length)return '0 0 1000 700';const pad=42,points=[...zones.flatMap(zone=>[[zone.x,zone.y],[zone.x+zone.width,zone.y+zone.height]]),...tables.flatMap(table=>[[table.x-42,table.y-42],[table.x+42,table.y+42]])];
 let left=Math.min(...points.map(point=>point[0]))-pad,top=Math.min(...points.map(point=>point[1]))-pad,width=Math.max(...points.map(point=>point[0]))-left+pad,height=Math.max(...points.map(point=>point[1]))-top+pad;
 const aspect=1.6;if(width/height<aspect){const extra=height*aspect-width;left-=extra/2;width+=extra;}else{const extra=width/aspect-height;top-=extra/2;height+=extra;}
 return `${left} ${top} ${width} ${height}`;
}
function cashPickerMap(parent,data,plan,choose,zoomState){
 const activeZones=new Map(data.zones.filter(zone=>zone.active).map(zone=>[zone.id,zone])),tableById=new Map(data.tables.map(row=>[row.id,row])),placedZones=new Set(plan.zones.filter(model=>activeZones.has(model.zoneId)).map(model=>model.zoneId));
 const eligible=data.tables.filter(row=>row.active&&activeZones.has(row.zoneId)&&(row.state==='FREE'||row.id===fastState.tableId)),eligibleIds=new Set(eligible.map(row=>row.id));
 const placed=new Set(),zoneModels=plan.zones.filter(model=>activeZones.has(model.zoneId)),tableModels=plan.tables.filter(model=>{const row=tableById.get(model.tableId);return row?.active&&placedZones.has(row.zoneId);});
 if(zoneModels.length){const toolbar=el('div',undefined,{className:'cash-picker-map-toolbar'}),scale=el('span',undefined,{className:'cash-picker-map-scale'}),scroll=el('div',undefined,{className:'cash-picker-map-scroll'}),svg=tableMapSvg('svg',{viewBox:cashPickerMapBounds(zoneModels,tableModels),role:'group','aria-label':t('mapTitle')});
  const paintZoom=()=>{svg.style.width=zoomState.value*100+'%';svg.style.height=zoomState.value*100+'%';scale.textContent=Math.round(zoomState.value*100)+'%';};
  const zoomButton=(label,value,description)=>{const button=fastButton(toolbar,label,()=>{zoomState.value=value===0?1:Math.max(.75,Math.min(2,Math.round((zoomState.value+value)*4)/4));paintZoom();},'cash-picker-map-zoom-button');button.setAttribute('aria-label',description);};
  zoomButton('−',-.25,t('mapZoomOut'));toolbar.append(scale);zoomButton('+',.25,t('mapZoomIn'));zoomButton('⤢',0,t('mapPickerFit'));parent.append(toolbar,scroll);scroll.append(svg);paintZoom();
  for(const model of zoneModels){const zone=activeZones.get(model.zoneId),group=tableMapSvg('g',{transform:`translate(${model.x} ${model.y})`,class:'table-map-zone'});group.append(tableMapSvg('rect',{width:model.width,height:model.height,rx:19,class:'table-map-zone-floor'}),tableMapSvg('text',{x:model.width/2,y:36,'text-anchor':'middle',class:'table-map-zone-label'},zone.name));svg.append(group);}
  for(const model of tableModels){const row=tableById.get(model.tableId);placed.add(row.id);const available=eligibleIds.has(row.id),group=tableMapSvg('g',{transform:`translate(${model.x} ${model.y}) rotate(${model.rotation})`,class:'table-map-table '+(row.state==='OCCUPIED'?'occupied':'free')+(row.id===fastState.tableId?' selected':'')});tableMapFurniture(group,model,fastTableTitle(row.name));group.setAttribute('role','button');group.setAttribute('tabindex',available?'0':'-1');group.setAttribute('aria-disabled',String(!available));group.setAttribute('aria-label',fastTableTitle(row.name)+' · '+t(row.state==='FREE'?'tableFree':'tableOccupied'));if(available){group.addEventListener('click',()=>run(()=>choose(row)));group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();run(()=>choose(row));}});}svg.append(group);}
  const legend=el('div',undefined,{className:'cash-picker-map-legend'});for(const [kind,label] of [['free',t('tableFree')],['occupied',t('tableOccupied')],['selected',t('mapPickerSelected')]]){const item=el('span',undefined,{className:'cash-picker-map-legend-item '+kind});item.append(el('i',undefined,{ariaHidden:'true'}),document.createTextNode(label));legend.append(item);}parent.append(legend);
 }else parent.append(el('p',t('mapNoPlan'),{className:'cash-picker-map-status'}));
 const unplaced=eligible.filter(row=>!placed.has(row.id));if(unplaced.length){parent.append(el('h3',t('mapPickerUnplaced'),{className:'cash-picker-map-heading'}));const grid=el('div',undefined,{className:'cash-picker-grid cash-picker-unplaced'});parent.append(grid);for(const row of unplaced){const card=fastButton(grid,'',()=>choose(row),'cash-picker-card'+(row.id===fastState.tableId?' selected':''));card.append(orderFirstModeIcon('TABLE'),el('strong',fastTableTitle(row.name)));}}
}
async function fastTableDialog(){
 if(fastState.sessionId&&fastState.tableId&&tableQuickSession)return;
 const data=await api('tables');fastState.tables=data;const dialog=financeModal(t('fastChooseTable'));dialog.classList.add('cash-picker');if(!tableQuickSession&&fastState.sessionId&&fastState.lines.length)dialog.append(el('p',t('ofPrivateDraft'),{className:'muted'}));
 const zones=data.zones.filter(zone=>zone.active),tabs=el('div',undefined,{className:'cash-picker-tabs',role:'tablist'}),content=el('div',undefined,{className:'cash-picker-content'}),zoomState={value:1};dialog.append(tabs,content);let zoneId=zones.find(zone=>data.tables.some(row=>row.id===fastState.tableId&&row.zoneId===zone.id))?.id??zones[0]?.id,view=tableQuickSession?'cards':cashPickerPreferredView(),planPromise=null,drawVersion=0,selecting=false;
 const choose=async row=>{if(selecting)return;selecting=true;try{if(!tableQuickSession&&fastState.sessionId){if(row.id!==fastState.tableId){const visit=await api('visitGet',{id:fastState.sessionId});await api('tableMove',{sessionId:visit.id,tableId:row.id,revision:visit.revision});}dialog.close();await fastSalesView();toast('success',t('ofAssignmentSaved'));}else{await cashAssignTable(row.id);dialog.close();fastDrawCart(cashQuery('.fast-cart'));}}catch(error){selecting=false;throw error;}};
 const drawCards=()=>{tabs.hidden=false;tabs.replaceChildren();for(const zone of zones){const tab=fastButton(tabs,zone.name,()=>{zoneId=zone.id;draw();},zoneId===zone.id?'selected':'');tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(zoneId===zone.id));}content.replaceChildren();const grid=el('div',undefined,{className:'cash-picker-grid'});content.append(grid);const tables=data.tables.filter(row=>row.active&&(row.state==='FREE'||row.id===fastState.tableId)&&row.zoneId===zoneId);if(!tables.length)grid.append(el('p',t('cashNoFree'),{className:'muted'}));for(const row of tables){const card=fastButton(grid,'',()=>choose(row),'cash-picker-card'+(row.id===fastState.tableId?' selected':''));card.append(tableQuickSession?fastIcon('TABLE'):orderFirstModeIcon('TABLE'),el('strong',fastTableTitle(row.name)));}};
 const draw=()=>{const version=++drawVersion;if(view==='cards'){drawCards();return;}tabs.hidden=true;content.replaceChildren(el('p',t('mapPickerLoading'),{className:'cash-picker-map-status',role:'status'}));planPromise??=api('floorPlan');planPromise.then(result=>{if(!dialog.open||view!=='map'||version!==drawVersion)return;content.replaceChildren();cashPickerMap(content,data,result.plan,choose,zoomState);}).catch(()=>{if(!dialog.open||view!=='map'||version!==drawVersion)return;content.replaceChildren(el('p',t('mapPickerUnavailable'),{className:'cash-picker-map-status',role:'status'}));const grid=el('div',undefined,{className:'cash-picker-grid'});content.append(grid);for(const row of data.tables.filter(table=>table.active&&(table.state==='FREE'||table.id===fastState.tableId)&&zones.some(zone=>zone.id===table.zoneId))){const card=fastButton(grid,'',()=>choose(row),'cash-picker-card'+(row.id===fastState.tableId?' selected':''));card.append(orderFirstModeIcon('TABLE'),el('strong',fastTableTitle(row.name)));}});};
 if(!tableQuickSession){const heading=dialog.querySelector('h2'),bar=el('div',undefined,{className:'cash-picker-header'}),switcher=el('div',undefined,{className:'cash-picker-view-switch',role:'group','aria-label':t('fastChooseTable')});heading.replaceWith(bar);bar.append(heading,switcher);const buttons=new Map();for(const [mode,label] of [['cards',t('mapPickerCards')],['map',t('mapPickerMap')]]){const button=fastButton(switcher,label,()=>{if(view===mode)return;view=mode;cashPickerRememberView(mode);for(const [key,node] of buttons){node.classList.toggle('selected',key===mode);node.setAttribute('aria-pressed',String(key===mode));}draw();},'cash-picker-view-button'+(view===mode?' selected':''));button.setAttribute('aria-pressed',String(view===mode));buttons.set(mode,button);}}
 draw();cashFitDialog(dialog);
}
async function fastWaiterDialog(){
 if(fastState.sessionId&&tableQuickSession){toast('warning',t('cashResponsibleFixed'));return;}
 const rows=await api('tableWaiters'),dialog=financeModal(t('cashChooseWaiter'));dialog.classList.add('cash-picker');if(!tableQuickSession&&fastState.sessionId&&fastState.lines.length)dialog.append(el('p',t('ofPrivateDraft'),{className:'muted'}));const grid=el('div',undefined,{className:'cash-picker-grid cash-waiter-grid'});const choices=me.role==='WAITER'?[{id:me.id,name:me.name}]:!fastState.sessionId?[{id:null,name:me.name},...rows]:rows;
 for(const row of choices){const card=fastButton(grid,'',async()=>{if(fastState.sessionId&&!tableQuickSession){const visit=await api('visitGet',{id:fastState.sessionId});if(row.id!==visit.responsibleWaiter?.id)await api('tableResponsible',{sessionId:visit.id,responsibleWaiterId:row.id,revision:visit.revision});dialog.close();await fastSalesView();toast('success',t('ofAssignmentSaved'));}else{fastState.waiterId=row.id;fastState.waiterName=row.name;await cashPersistDraft();dialog.close();fastDrawCart(cashQuery('.fast-cart'));}},'cash-picker-card'+(fastState.waiterId===row.id?' selected':''));card.setAttribute('aria-label',row.name);card.append(el('span',row.name.trim().charAt(0).toUpperCase(),{className:'cash-waiter-avatar'}),el('strong',row.name));}dialog.append(grid);cashFitDialog(dialog);
}

async function fastRealtimeRefresh(scope,ticket){
 if(scope==='full'||scope==='orders'||scope==='sales'||cashDisplay==='tables'||tableQuickSession||!cashQuery('.fast-sales'))return fastSalesView(scope==='orders');
 const current=fastState,center=cashQuery('.fast-center'),cart=cashQuery('.fast-cart');if(!center||!cart)return fastSalesView();
 if(scope==='drafts'){
  if(!fastState.orderId&&!fastState.sessionId&&!fastState.completedSaleId){
   let remote;try{remote=await api('serverDraftGet',{draftId:fastState.scope});}catch(error){if(error.message!=='DRAFT_NOT_FOUND')throw error;}
   if(ticket!==cashRealtimeTicket||current!==fastState)return;
   if((remote?.revision??0)!==(fastState.serverDraftRevision??0))return fastSalesView();
  }
  const parked=await api('serverDraftList');if(ticket!==cashRealtimeTicket||current!==fastState)return;fastState.parked=parked;
  const previous=center.querySelector('.fast-active'),next=previous?.nextSibling;previous?.remove();fastDrawActive(center);if(next)center.insertBefore(center.lastChild,next);
 }else if(scope==='menu'){
  const priorKey=fastCatalogKey(),menu=await api('menu');if(ticket!==cashRealtimeTicket||current!==fastState)return;fastState.menu=menu;
  const panel=center.querySelector('.fast-catalog'),key=fastCatalogKey();
  if(panel&&key&&key===priorKey&&panel.dataset.catalogKey===key)void panel.refreshLayout?.();
  else{panel?.remove();fastDrawCatalog(center);fastDrawCart(cart);}
 }else if(scope==='tables'){
  const tables=await api('tables');if(ticket!==cashRealtimeTicket||current!==fastState)return;fastState.tables=tables;fastDrawCart(cart);
 }else if(scope==='print'&&fastState.orderId&&fastState.order){
  const prior=fastState.history,history=await cashReadOrderHistory(fastState.order);
  if(ticket!==cashRealtimeTicket||current!==fastState)return;fastState.history=history;
  if(!cashPatchAcceptedHistory(cart,prior,history))return fastSalesView();
 }
}
function fastRequestRefresh(scope='full'){if(!isCashView('fastSales'))return;cashRefreshScope=cashRefreshAfterItems&&cashRefreshScope!==scope?'full':scope;cashRefreshAfterItems=true;cashRefreshQueued();}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)fastRequestRefresh();});
let fastLastFallbackAt=Date.now();
function fastPollFallback(now=Date.now()){if(!isCashView('fastSales')||document.hidden)return;const period=cashRealtimeConnected?300000:30000;if(now-fastLastFallbackAt<period)return;fastLastFallbackAt=now;fastRequestRefresh();}
setInterval(fastPollFallback,30000);
