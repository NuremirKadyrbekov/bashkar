'use strict';
// Cashier presentation and local basket edits. The existing selectionControls
// validates choices; Local POS Server remains the only pricing authority.
function initCashItemsUi(ru,ky){
 Object.assign(ru,{cashDraftReview:'Изменились условия заказа',cashDraftReviewHint:'Проверьте изменения перед отправкой.',cashDraftAccept:'Подтвердить изменения и отправить',cashDraftComposition:'Изменился состав или условия блюда',cashDraftUnavailable:'Позиция недоступна — измените выбор или удалите её',cashDraftLegacy:'Проверьте актуальные условия старого черновика'});
 Object.assign(ky,{cashDraftReview:'Буйрутманын шарттары өзгөрдү',cashDraftReviewHint:'Жөнөтүүдөн мурун өзгөртүүлөрдү текшериңиз.',cashDraftAccept:'Өзгөртүүлөрдү ырастап жөнөтүү',cashDraftComposition:'Тамактын курамы же шарттары өзгөрдү',cashDraftUnavailable:'Позиция жеткиликсиз — тандоону өзгөртүңүз же өчүрүңүз',cashDraftLegacy:'Эски караламанын учурдагы шарттарын текшериңиз'});
 const rows={cashChooseVariant:['Выберите вариант','Вариантты тандаңыз'],cashApplyVariant:['Применить','Колдонуу'],cashVariantApplied:['Вариант изменён','Вариант өзгөртүлдү'],cashChoiceUnavailable:['Сочетание недоступно. Измените выбор.','Айкалыш жеткиликсиз. Башкасын тандаңыз.'],cashChoicePrice:['Цена блюда','Тамактын баасы'],cashDishComment:['Комментарий к блюду','Тамакка комментарий'],cashSaveComment:['Сохранить комментарий','Комментарийди сактоо'],cashCommentSaved:['Комментарий сохранён','Комментарий сакталды'],cashCommentInvalid:['До 300 символов, без управляющих знаков.','300 белгиге чейин, башкаруу белгилерисиз.'],cashCommentPrefix:['Комментарий:','Комментарий:'],cashLineTotal:['Сумма строки','Саптын суммасы'],cashDecrease:['Уменьшить количество','Санын азайтуу'],cashIncrease:['Увеличить количество','Санын көбөйтүү'],cashChangeVariant:['Изменить размер или вариант','Өлчөмүн же вариантын өзгөртүү'],cashNoSearchResults:['В этой категории ничего не найдено','Бул категорияда эч нерсе табылган жок'],cashPriceFrom:['от','баштап']};
 for(const [key,[r,k]]of Object.entries(rows)){ru[key]=r;ky[key]=k;}
}
let cashLineQueue=Promise.resolve(),cashLinePending=0,cashRefreshAfterItems=false,cashRefreshPending=null;
function cashHasChoices(item){return !!(item?.variants?.length||item?.groups?.length);}
async function cashCartIdle(){await cashLineQueue;while(cashRefreshPending){try{await cashRefreshPending;}catch{/* the refresh reports its own failure */}}}
function cashQuoteSnapshot(lines,quote){fastState.draftIssues={};fastState.pricedLines=Object.fromEntries(lines.map((line,index)=>[line.lineId,quote.lines?.[index]]));}
function cashActionError(error){
 handleError(error);if(typeof tableQuickSession!=='undefined'&&tableQuickSession&&error.message==='SERVER_UNAVAILABLE')tableQuickConnectionWarning();const label=document.getElementById('status')?.textContent||t('fastPriceUnavailable');
 toast(['INVALID_QUANTITY','INVALID_COMMENT','MODIFIER_SELECTION_LIMIT'].includes(error.message)?'warning':'error',label);
 if(!error.message.startsWith('OWNER_CLOUD_')&&!['SERVER_UNAVAILABLE','RESULT_UNKNOWN_RETRY_SAME_ACTION','DRAFT_FROZEN','SESSION_INVALID','SESSION_EXPIRED','PERMISSION_DENIED','VISIT_ACCESS_DENIED','VISIT_NOT_FOUND'].includes(error.message))message();
}
function cashRefreshQueued(){
 if(!cashRefreshAfterItems||fastRefreshBusy||cashLinePending||fastState.busy||cashBlockingDialog()||!isCashView('fastSales')||document.hidden)return;
 cashRefreshAfterItems=false;fastRefreshBusy=true;const scope=cashRefreshScope,ticket=cashRealtimeTicket;cashRefreshScope='full';const job=fastRealtimeRefresh(scope,ticket).catch(error=>{if(error.message!=='HISTORY_CHANGED')cashActionError(error);if(scope!=='full')fastRequestRefresh('full');});const settled=job.finally(()=>{if(cashRefreshPending===settled)cashRefreshPending=null;fastRefreshBusy=false;cashRefreshQueued();});cashRefreshPending=settled;void settled;
}
document.addEventListener('close',()=>queueMicrotask(cashRefreshQueued),true);
function cashMutateCart(change,options={}){
 if(fastState.busy||fastState.completedSaleId&&!tableQuickSession)return Promise.reject(Error('DRAFT_FROZEN'));
 const scope=fastState.actor;cashLinePending++;if(!tableQuickSession)orderFirstPaymentState(null);const submit=cashQuery('.fast-submit');if(submit)submit.disabled=true;
 const job=cashLineQueue.then(async()=>{
  if(!tableQuickSession&&cashViewPending)await cashViewPending;
  if(scope!==fastState.actor||!me||fastState.frozen)throw new Error('DRAFT_FROZEN');
  const previous=fastState.lines,lines=change(structuredClone(previous));if(!lines)return;
  const discount=fastState.order?.discount??(lines.length?(options.discount??fastState.discount):0),mode=fastState.mode,revision=fastState.menu.revision;
  let quote;try{quote=lines.length?await cashWorkspaceQuote(lines,discount):(fastState.order??{lines:[],subtotal:0,discount:0,total:0,fees:[]});}catch(error){if(tableQuickSession||!cashDraftItemError(error)||lines.some(line=>!previous.some(old=>old.lineId===line.lineId&&cashDraftChoice(old)===cashDraftChoice(line))))throw error;quote=null;}
  if(scope!==fastState.actor||fastState.lines!==previous||fastState.mode!==mode||fastState.menu.revision!==revision)throw new Error('CONFIRMATION_STALE');
  await cashPersistDraft(lines,discount,{quote});fastState.quoteVersion++;fastState.lines=lines;fastState.discount=discount;fastState.quote=quote;if(quote)cashQuoteSnapshot(lines,quote);if(options.revealAdded&&!tableQuickSession)fastState.timelineRevealLineId=lines.find(line=>{const before=previous.find(row=>row.lineId===line.lineId);return !before||line.quantity>before.quantity;})?.lineId;message();
  if(isCashView('fastSales'))fastDrawCart(cashQuery('.fast-cart'),!!quote);
  if(options.success)toast('success',options.success);
 });
 cashLineQueue=job.catch(()=>{});
 return job.finally(()=>{cashLinePending--;if(!tableQuickSession)orderFirstPaymentState(fastState.quote??fastState.order);const button=cashQuery('.fast-submit');if(button&&!cashLinePending)button.disabled=!fastState.lines.length||!fastState.quote||!fastState.shift||fastState.frozen||fastState.closed||fastState.serverDraftConflict||fastState.serverDraftOutdated||!me?.permissions.includes(fastState.mode==='TABLE'?'table.batch.submit':'counter.batch.submit');cashRefreshQueued();});
}
async function cashAddSimple(item){
 let added;
 await cashMutateCart(lines=>{
  const existing=lines.find(line=>line.itemId===item.id&&line.variantId===null&&!line.modifierIds.length&&!line.comment);
  if(existing){if(existing.quantity>=9999)throw new Error('INVALID_QUANTITY');existing.quantity++;added=existing;}
  else{added={lineId:crypto.randomUUID(),itemId:item.id,variantId:null,modifierIds:[],quantity:1,comment:''};lines.push(added);}
  return lines;
 },{revealAdded:true});
 if(added)await cashOfferContainer(item,1);
}
async function cashOfferContainer(item,quantity){
 if(fastState.mode!=='COUNTER'||item.isPackaging||!item.containerId||fastState.closed||fastState.frozen)return;
 const menu=fastState.menu,container=menu.catalog?.items.find(row=>row.id===item.containerId&&row.isPackaging&&!row.archived);
 const prices=container?.pricingMode==='MATRIX'?container.combinationPrices.map(row=>orderUnitPrice(container,row.variantId,row.optionIds,menu.availability)).filter(Number.isSafeInteger):[];
 if(!container||!(menu.availability[container.id]?.available??container.available)||container.pricingMode==='MATRIX'&&!prices.length||container.variants.length&&!container.variants.some(row=>menu.availability[row.id]?.available??row.available)||container.groups.some(group=>group.options.filter(row=>menu.availability[row.id]?.available??row.available).length<group.min)){toast('warning',t('containerUnavailable'));return;}
 containerOfferDialog(menu,container,null,quantity,false,selected=>cashMutateCart(lines=>[...lines,selected],{revealAdded:true}));
}
// Enhance the canonical controls rather than duplicating their selection rules.
function cashEnhanceSelection(parent,item,menu){
 parent.querySelector('input[type=number]')?.closest('label')?.setAttribute('hidden','');
 parent.querySelector('textarea')?.closest('label')?.setAttribute('hidden','');
 parent.querySelector('.container-price-preview')?.setAttribute('hidden','');
 for(const [selectIndex,select]of [...parent.querySelectorAll('select')].entries()){
  const label=select.closest('label');label.classList.add('cash-choice-field');select.hidden=true;select.tabIndex=-1;
  const group=el('div',undefined,{className:'cash-choice-tiles',role:'radiogroup'});group.setAttribute('aria-label',select.getAttribute('aria-label')||t('lineVariant'));
  const buttons=[];for(const option of select.options){if(!option.value)continue;const tileText=item.variants.length&&selectIndex===0?orderName(item.variants.find(value=>value.id===option.value)):option.textContent;const tile=el('button',tileText,{type:'button',className:'cash-choice-tile',disabled:option.disabled||(item.pricingMode==='MATRIX'&&!item.combinationPrices.some(combination=>(menu.availability[combination.id]?.available??combination.available)&&(item.variants.length&&selectIndex===0?combination.variantId===option.value:combination.optionIds[selectIndex-(item.variants.length?1:0)]===option.value)))});tile.setAttribute('role','radio');tile.dataset.value=option.value;tile.setAttribute('aria-label',tileText);tile.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));};buttons.push(tile);group.append(tile);}
  const reflect=()=>{for(const tile of buttons){const selected=tile.dataset.value===select.value;tile.classList.toggle('selected',selected);tile.setAttribute('aria-checked',String(selected));tile.tabIndex=selected||!select.value&&tile===buttons.find(b=>!b.disabled)?0:-1;}};group.onkeydown=event=>{const available=buttons.filter(button=>!button.disabled),index=available.indexOf(document.activeElement);if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?available.length-1:(index+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+available.length)%available.length;available[next]?.focus();available[next]?.click();}};select.addEventListener('change',reflect);reflect();label.append(group);
 }
 for(const [index,set]of [...parent.querySelectorAll('fieldset')].entries()){
  const definition=item.groups.filter(group=>item.pricingMode!=='MATRIX')[index],radioName='cash-option-'+crypto.randomUUID();set.classList.add('cash-choice-field','cash-choice-checks');
  for(const [optionIndex,input]of [...set.querySelectorAll('input[type=checkbox]')].entries()){
   const label=input.closest('label'),option=definition?.options[optionIndex];if(definition?.max===1&&definition.min>0){input.type='radio';input.name=radioName;}label.classList.add('cash-option-tile');if(option)label.lastChild.textContent=orderName(option)+(option.price?' + '+tableMoney(option.price):'');
   input.addEventListener('change',()=>{if(!input.checked&&definition?.max===1&&definition.min>0)input.checked=true;if(input.checked&&definition?.max===1)for(const other of set.querySelectorAll('input[type=checkbox]'))if(other!==input)other.checked=false;});
  }
 }
}
function cashFitDialog(dialog){
 const fit=()=>dialog.style.setProperty('--cash-dialog-height',Math.max(180,(window.visualViewport?.height??innerHeight)-32)+'px');fit();window.visualViewport?.addEventListener('resize',fit);window.addEventListener('resize',fit);
 dialog.addEventListener('close',()=>{window.visualViewport?.removeEventListener('resize',fit);window.removeEventListener('resize',fit);cashRefreshQueued();},{once:true});
}
async function cashChoiceDialog(item,existing=null){
 await cashCartIdle();if(!isCashView('fastSales'))return;
 const dialog=financeModal(orderName(item));dialog.classList.add('cash-choice-dialog');dialog.append(el('p',t('cashChooseVariant'),{className:'cash-choice-subtitle'}));
 const body=el('div',undefined,{className:'cash-choice-body'});dialog.append(body);
 const read=selectionControls(body,item,fastState.menu,existing,{tiles:true});
 const footer=el('div',undefined,{className:'cash-choice-footer'}),price=el('div',undefined,{className:'cash-choice-price'}),priceLabel=el('small',t('cashChoicePrice')),amount=el('strong','—'),note=el('p','',{className:'cash-choice-note',role:'status'});price.append(priceLabel,amount);footer.append(price,note);
 const actions=el('div',undefined,{className:'cash-choice-actions'});fastButton(actions,t('cancel'),()=>dialog.close(),'cash-choice-cancel');let proposal=null,version=0,busy=false;
 const accept=el('button',t(existing?'cashApplyVariant':'fastAdd'),{type:'button',className:'primary cash-choice-accept',disabled:true});actions.append(accept);footer.append(actions);dialog.append(footer);cashFitDialog(dialog);
 async function preview(){
  const request=++version;proposal=null;accept.disabled=true;accept.textContent=t(existing?'cashApplyVariant':'fastAdd');amount.textContent='—';let line;
  try{line=read();}catch{note.textContent=t('cashChooseVariant');return;}
  note.textContent=t('fastPricePending');
  try{const quote=await api('quote',{menuRevision:fastState.menu.revision,type:fastState.mode,lines:fastQuoteLines([line]),discount:0});if(request!==version||!dialog.open)return;proposal=line;priceLabel.textContent=t('cashChoicePrice')+(line.quantity>1?' × '+line.quantity:'');const total=quote.lines[0].total;amount.textContent=tableMoney(total);note.textContent='';accept.textContent=t(existing?'cashApplyVariant':'fastAdd')+' · '+tableMoney(total);accept.disabled=false;}
  catch(error){if(request!==version||!dialog.open)return;note.textContent=domainMessages[error.message]?.[lang==='ky'?1:0]??t('cashChoiceUnavailable');}
 }
 body.addEventListener('change',preview);
 accept.onclick=async()=>{
  if(busy||!proposal)return;busy=true;body.inert=true;accept.disabled=true;
  try{const selected=read();await cashMutateCart(lines=>{if(existing){if(!lines.some(line=>line.lineId===existing.lineId))throw new Error('DRAFT_REVISION_CONFLICT');return lines.map(line=>line.lineId===existing.lineId?{...selected,quantity:line.quantity,comment:line.comment}:line);}return [...lines,selected];},{success:existing?t('cashVariantApplied'):undefined,revealAdded:!existing});dialog.close();if(!existing)await cashOfferContainer(item,selected.quantity);}
  catch(error){note.textContent=domainMessages[error.message]?.[lang==='ky'?1:0]??t('fastPriceUnavailable');cashActionError(error);}
  finally{busy=false;body.inert=false;if(dialog.open)void preview();}
 };
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});await preview();
}
function cashCommentIcon(){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d','M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 9h10M7 13h7');svg.append(path);return svg;}
function cashCommentQuantityCounter(parent,max,onChange=()=>{}){
 if(max<=1)return {value:()=>1,setDisabled:()=>{}};
 const group=el('div',undefined,{className:'cash-comment-quantity',role:'group'}),label=el('span',t('lineQuantity'));
 const minus=el('button','−',{type:'button','aria-label':t('lineQuantity')+' −'}),value=el('strong','0',{role:'status','aria-live':'polite'}),plus=el('button','+',{type:'button','aria-label':t('lineQuantity')+' +'});
 let count=0,locked=false;const render=()=>{value.textContent=String(count);minus.disabled=locked||count===0;plus.disabled=locked||count===max;onChange(count);};
 minus.onclick=()=>{count=Math.max(0,count-1);render();};plus.onclick=()=>{count=Math.min(max,count+1);render();};
 group.append(label,minus,value,plus);parent.append(group);render();
 return {value:()=>count,setDisabled:disabled=>{locked=disabled;render();}};
}
async function cashCommentDialog(lineId){
 await cashCartIdle();const line=fastState.lines.find(row=>row.lineId===lineId);if(!line||line.kind==='CUSTOM_AMOUNT')return;
 const dialog=financeModal(t('cashDishComment'));dialog.classList.add('cash-comment-dialog');dialog.append(el('p',fastLineTitle(line),{className:'cash-comment-dish'}));
 let save;const quantity=cashCommentQuantityCounter(dialog,line.quantity,count=>{if(save)save.disabled=count===0;});const label=el('label',t('lineComment')),input=el('textarea',undefined,{value:line.comment??'',rows:4});input.setAttribute('aria-label',t('lineComment'));label.append(input);dialog.append(label);const error=el('p','',{className:'cash-modal-error',role:'status'}),count=el('small',undefined,{className:'cash-comment-count'});dialog.append(count,error);const reflect=()=>count.textContent=[...input.value].length+' / 300';input.oninput=reflect;reflect();let busy=false;
 save=fastButton(dialog,t('cashSaveComment'),async()=>{if(busy)return;const comment=input.value.replace(/\r\n/g,'\n').normalize('NFC'),selected=quantity.value();if([...comment].length>300||/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(comment)){error.textContent=t('cashCommentInvalid');toast('warning',error.textContent);return;}if(selected<1||selected>line.quantity)return;
  busy=true;input.disabled=true;quantity.setDisabled(true);save.disabled=true;try{await cashMutateCart(lines=>{const current=lines.find(row=>row.lineId===lineId);if(!current||current.quantity<selected)throw Error('DRAFT_REVISION_CONFLICT');if(current.comment===comment)return lines;if(current.quantity===selected)return lines.map(row=>row.lineId===lineId?{...row,comment}:row);current.quantity-=selected;lines.push({...current,lineId:crypto.randomUUID(),quantity:selected,comment});return lines;},{success:t('cashCommentSaved')});dialog.close();}catch(e){error.textContent=t('fastPriceUnavailable');cashActionError(e);}finally{busy=false;input.disabled=false;quantity.setDisabled(false);save.disabled=quantity.value()===0;}
 },'primary cash-comment-save');save.disabled=quantity.value()===0;fastButton(dialog,t('cancel'),()=>dialog.close());dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});cashFitDialog(dialog);input.focus();
}
function cashDrawLines(list,compact=false){
 if(!list)return;const changes=new Map(!tableQuickSession&&fastState.quote?cashDraftChanges(fastState.quote).map(change=>[change.lineId,change]):[]),scroll=list.scrollTop;list.replaceChildren();
 if(!fastState.lines.length)list.append(el('p',t('fastEmptyCart'),{className:'muted'}));
 for(const line of fastState.lines){
  const item=fastLineItem(line),priced=fastState.pricedLines?.[line.lineId]??cashDraftStoredPrice(line),row=el('article',undefined,{className:'fast-cart-line cash-basket-row'});row.dataset.lineId=line.lineId;
  const details=el('div',undefined,{className:'cash-basket-details'});details.append(el('strong',fastLineTitle(line),{className:'cash-basket-name'}));if(item||!tableQuickSession&&fastState.localDraft?.preview?.[line.lineId]?.selection){const selection=!tableQuickSession&&fastState.localDraft?.preview?.[line.lineId]?.selection||(item?orderSelectionLabel(item,line):'');if(selection)details.append(el('small',selection,{className:'cash-basket-selection'}));}
  details.append(el('span',priced?tableMoney(priced.unitPrice)+' × '+line.quantity:t('fastPricePending'),{className:'cash-basket-unit'}));
  const total=el('b',priced?tableMoney(priced.total):'—',{className:'cash-basket-total'});total.setAttribute('aria-label',t('cashLineTotal'));row.append(details,total);
  if(!tableQuickSession){const warning=cashDraftLineWarning(line,changes.get(line.lineId));if(warning)details.append(el('small',warning,{className:'cash-draft-warning'}));}
  if(line.comment)row.append(el('p',t('cashCommentPrefix')+' '+line.comment,{className:'cash-basket-comment'}));
  const bottom=el('div',undefined,{className:'cash-basket-bottom'}),quantity=el('div',undefined,{className:'cash-basket-quantity'});
  const mutate=change=>cashMutateCart(change).catch(cashActionError);
  const minus=fastButton(quantity,'−',()=>mutate(lines=>lines.flatMap(value=>value.lineId!==line.lineId?[value]:value.quantity>1?[{...value,quantity:value.quantity-1}]:[])));minus.setAttribute('aria-label',t('cashDecrease')+' '+fastLineTitle(line));quantity.append(el('span',String(line.quantity)));
  const plus=fastButton(quantity,'+',()=>mutate(lines=>lines.map(value=>{if(value.lineId!==line.lineId)return value;if(value.quantity>=9999)throw new Error('INVALID_QUANTITY');return {...value,quantity:value.quantity+1};})));plus.setAttribute('aria-label',t('cashIncrease')+' '+fastLineTitle(line));
  bottom.append(quantity);if(compact){const more=el('button','⋯',{type:'button',className:'cash-line-more'}),popover=cashLineMorePopover(more,line,item,mutate);more.setAttribute('aria-label',t('cashOrderActions')+' · '+fastLineTitle(line));more.setAttribute('aria-controls',popover.id);more.setAttribute('aria-expanded','false');more.popoverTargetElement=popover;bottom.append(more,popover);row.append(bottom);list.append(row);continue;}
  const actions=el('div',undefined,{className:'cash-basket-actions'});if(line.kind!=='CUSTOM_AMOUNT'){const comment=fastButton(actions,'',()=>cashCommentDialog(line.lineId),'cash-comment-button');comment.append(cashCommentIcon());comment.setAttribute('aria-label',t('cashDishComment')+' · '+fastLineTitle(line));comment.title=t('cashDishComment');}
  if(cashHasChoices(item)){const edit=fastButton(actions,'⋯',()=>fastAddItem(item,line),'cash-variant-button');edit.setAttribute('aria-label',t('cashChangeVariant')+' · '+fastLineTitle(line));edit.title=t('cashChangeVariant');}
  const remove=fastButton(actions,'×',()=>mutate(lines=>lines.filter(value=>value.lineId!==line.lineId)),'cash-remove-button');remove.setAttribute('aria-label',t('removeLine')+' · '+fastLineTitle(line));remove.title=t('removeLine');bottom.append(actions);row.append(bottom);list.append(row);
 }
 list.scrollTop=scroll;
}
function cashLineMorePopover(trigger,line,item,mutate){
 const popover=el('div',undefined,{id:'cash-line-actions-'+line.lineId,popover:'auto',className:'cash-line-actions-popover'}),scope=fastState.scope,actor=fastState.actor;
 popover.setAttribute('aria-label',t('cashOrderActions')+' · '+fastLineTitle(line));
 const action=(label,icon,handler,cls)=>{const button=fastButton(popover,'',async()=>{popover.hidePopover();if(scope!==fastState.scope||actor!==fastState.actor||fastState.frozen||fastState.closed||fastState.busy||!fastState.lines.some(row=>row.lineId===line.lineId))throw Error('DRAFT_FROZEN');await handler();},'cash-line-action '+cls);button.append(icon);button.setAttribute('aria-label',label);button.title=label;};
 if(line.kind!=='CUSTOM_AMOUNT')action(t('cashDishComment'),cashCommentIcon(),()=>cashCommentDialog(line.lineId),'comment');
 if(cashHasChoices(item)){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d','M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m8 4v6');svg.append(path);action(t('cashChangeVariant'),svg,()=>fastAddItem(item,line),'variant');}
 action(t('removeLine'),cashActionIcon('trash'),()=>mutate(lines=>lines.filter(row=>row.lineId!==line.lineId)),'remove');
 popover.addEventListener('beforetoggle',event=>{if(event.newState!=='open')return;const rect=trigger.getBoundingClientRect(),width=popover.children.length*44+(popover.children.length-1)*4+14;popover.style.width=width+'px';popover.style.left=Math.max(8,Math.min(innerWidth-width-8,rect.right-width))+'px';popover.style.top=Math.max(8,rect.bottom+62<=innerHeight-8?rect.bottom+6:rect.top-62)+'px';});
 popover.addEventListener('toggle',()=>{const open=popover.matches(':popover-open');trigger.setAttribute('aria-expanded',String(open));if(!open)cashRefreshQueued();});
 return popover;
}
// Draft snapshots describe what the cashier saw; they never authorize old prices.
function cashDraftChoice(line){return JSON.stringify([line.itemId,line.variantId,[...line.modifierIds].sort(),line.kind??null,line.kind==='CUSTOM_AMOUNT'?line.unitPrice:null]);}
function cashDraftTerms(line){return JSON.stringify({unitPrice:line.unitPrice,kind:line.kind??'ITEM',kitchen:line.kitchen,pricingMode:line.pricingMode,variant:line.variant?.id??null,modifiers:(line.modifiers??[]).map(m=>[m.id,m.price??null]).sort(),combination:line.combinationId??null,components:(line.components??[]).map(c=>[c.itemId,c.quantity,c.variant?.id??null,c.combination?.id??null,(c.modifiers??[]).map(m=>m.id).sort(),c.kitchen])});}
function cashDraftSelection(line){const selection=line.combination?orderName(line.combination):[line.variant?orderName(line.variant):'',...(line.modifiers??[]).map(orderName)].filter(Boolean).join(' · ');return [selection,...(line.components??[]).map(c=>c.quantity+' × '+orderName(c)+(orderSnapshotSelection(c)?' · '+orderSnapshotSelection(c):''))].filter(Boolean).join('; ');}
function cashDraftPreview(lines,quote,previous={},acceptAll=false){
 const preview={};for(const [index,line]of lines.entries()){
  const old=previous[line.lineId],choice=cashDraftChoice(line),priced=quote?.lines?.[index];
  if(old&&!acceptAll&&(!old.choice||old.choice===choice)){preview[line.lineId]={...old,choice};continue;}
  if(priced)preview[line.lineId]={name:orderName(priced),unitPrice:priced.unitPrice,selection:cashDraftSelection(priced),choice,terms:cashDraftTerms(priced)};
 }
 return preview;
}
function cashDraftStoredPrice(line){const old=fastState.localDraft?.preview?.[line.lineId];return old?{unitPrice:old.unitPrice,total:old.unitPrice*line.quantity}:null;}
function cashDraftChanges(quote){
 const preview=fastState.localDraft?.preview??{};
 return fastState.lines.flatMap((line,index)=>{const old=preview[line.lineId],now=quote.lines?.[index];if(!now)return [];
  const price=!!old&&old.unitPrice!==now.unitPrice,terms=!!old?.terms&&old.terms!==cashDraftTerms(now),legacy=(!old||!old.terms)&&!!fastState.localDraft&&fastState.localDraft.menuRevision!==quote.menuRevision;
  return price||terms||legacy?[{lineId:line.lineId,name:old?.name??orderName(now),old,now,price,terms,legacy}]:[];
 });
}
function cashDraftLineWarning(line,change){
 if(fastState.draftIssues?.[line.lineId])return t('cashDraftUnavailable');
 if(!change)return '';
 return change.price?tableMoney(change.old.unitPrice)+' → '+tableMoney(change.now.unitPrice):t(change.legacy?'cashDraftLegacy':'cashDraftComposition');
}
function cashDraftItemError(error){return ['ITEM_UNAVAILABLE','INVALID_VARIANT','INVALID_MODIFIER','MODIFIER_SELECTION_LIMIT','MODIFIER_UNAVAILABLE','COMBINATION_UNAVAILABLE','INVALID_SET_COMPONENT','SET_COMPONENT_UNAVAILABLE','INVALID_SET_SELECTION'].includes(error.message);}
async function cashDraftMarkUnavailable(version){
 const issues={},lines=structuredClone(fastState.lines),menuRevision=fastState.menu.revision,actor=fastState.actor;
 for(const line of lines){try{await api('quote',{menuRevision,type:fastState.mode,lines:fastQuoteLines([line]),discount:0});}catch(error){if(!cashDraftItemError(error))return;issues[line.lineId]=error.message;}}
 if(version===fastState.quoteVersion&&actor===fastState.actor){fastState.draftIssues=issues;fastState.pricedLines=Object.fromEntries(lines.flatMap(line=>{const priced=cashDraftStoredPrice(line);return priced?[[line.lineId,priced]]:[];}));}
}
function cashDraftQuoteKey(q){return JSON.stringify({subtotal:q.subtotal,discount:q.discount,total:q.total,fees:(q.fees??[]).map(f=>[f.id,f.rate,f.amount]),revision:q.orderRevision??q.expectedOrderRevision??0,lines:(q.lines??[]).map(l=>[cashDraftTerms(l),l.quantity,l.comment])});}
function cashDraftConfirmChanges(changes,before,after){return new Promise(resolve=>{
 const dialog=financeModal(t('cashDraftReview'));dialog.classList.add('cash-draft-review');dialog.append(el('p',t('cashDraftReviewHint')));let accepted=false;
 for(const change of changes){const row=el('div',undefined,{className:'cash-draft-review-line'});row.append(el('strong',change.name));
  if(change.price)row.append(el('p',tableMoney(change.old.unitPrice)+' → '+tableMoney(change.now.unitPrice)));
  if(change.terms&&!change.price||change.legacy)row.append(el('p',t(change.legacy?'cashDraftLegacy':'cashDraftComposition')));
  if(change.old?.selection!==cashDraftSelection(change.now)){if(change.old?.selection)row.append(el('small',t('beforeChange')+': '+change.old.selection));row.append(el('small',t('afterChange')+': '+(cashDraftSelection(change.now)||'—')));}
  dialog.append(row);
 }
 if(after)dialog.append(el('p',t('fastTotal')+': '+(before.total!==after.total?tableMoney(before.total)+' → ':'')+tableMoney(after.total)));
 fastButton(dialog,t('cashDraftAccept'),()=>{accepted=true;dialog.close();},'primary');financeClose(dialog);cashFitDialog(dialog);dialog.addEventListener('close',()=>resolve(accepted),{once:true});
});}
