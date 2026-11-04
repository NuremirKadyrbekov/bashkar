'use strict';
// One active cashier surface; the fullscreen COUNTER owns an isolated protected workspace.
let tableQuickSession=null;
function tableQuickIsActive(session=tableQuickSession){return !!session&&session===tableQuickSession&&session.dialog.open;}
async function openTableQuickSale(){
 if(tableQuickSession)return tableQuickSession.dialog.querySelector('.fast-search')?.focus();
 await cashCartIdle();if(cashViewPending)await cashViewPending;
 me=await api('me');if(!me.permissions.includes('counter.view')||!me.permissions.includes('counter.batch.submit'))throw Error('PERMISSION_DENIED');
 const prior=fastState,dialog=el('dialog',undefined,{className:'table-quick-modal',role:'dialog'}),headingId='table-quick-heading';dialog.setAttribute('aria-labelledby',headingId);
 const head=el('div',undefined,{className:'table-quick-head'}),identity=el('div');identity.append(el('h1',t('quickSale'),{id:headingId}),el('span',t('fastTakeaway'),{className:'table-quick-type'}));head.append(identity);

 const warning=el('div',undefined,{className:'table-quick-warning',role:'status',hidden:true}),body=el('div',undefined,{className:'table-quick-body fast-sales'});dialog.append(head,warning,body);
 fastState={actor:me.branchId+':'+me.id,mode:'COUNTER',lines:[],category:'',search:'',tableId:null,waiterId:null,waiterName:null,discount:0,scope:null,sessionId:null,orderId:null,order:null,closed:false,frozen:false,quote:null,quoteVersion:prior.quoteVersion+1,pricedLines:{},menu:null,shift:null,tables:null,active:null,sales:null};
 const session=tableQuickSession={dialog,head,body,warning,state:fastState,prior,actor:fastState.actor,refresh:null,repeat:false,submitting:false,closing:false,acceptedOrderId:null};
 dialog.addEventListener('close',()=>{if(tableQuickSession===session){tableQuickSession=null;fastState=session.prior;session.state.quoteVersion++;dialog.remove();document.body.classList.remove('has-table-quick-sale');}});
 dialog.addEventListener('cancel',event=>{event.preventDefault();void tableQuickClose().catch(cashActionError);});
 document.body.append(dialog);dialog.showModal();document.body.classList.add('has-table-quick-sale');
 body.append(el('p',t('working')));await tableQuickRefresh();
 if(tableQuickIsActive(session))dialog.querySelector('.fast-search')?.focus();
}
async function tableQuickClose(accepted=false){
 const session=tableQuickSession;if(!session||session.closing||session.submitting&&!accepted)return;
 if(!accepted&&cashBlockingDialog())return;
 session.closing=true;await cashCartIdle();session.state.quoteVersion++;
 // Each acknowledged basket edit is already durable; closing works even after disconnect.
 if(tableQuickSession!==session)return;
 tableQuickSession=null;fastState=session.prior;cashRefreshAfterItems=false;
 session.dialog.close();session.dialog.remove();document.body.classList.remove('has-table-quick-sale');
 if(screen==='cashRegister')await tablesView();
 document.querySelector('.tables-top .primary')?.focus({preventScroll:true});
}
async function tableQuickAccepted(orderId){
 const session=tableQuickSession;if(!session)return;
 session.acceptedOrderId=orderId;
 // A persisted accepted marker survives a lost reply/restart until this surface consumes it.
 await api('financeGet',{orderId});if(!tableQuickIsActive(session))return;
 await api('cashWorkspaceSet',{surface:'TABLE_QUICK',orderId:null});
 tablePanelTab='active';await tableQuickClose(true);message();toast('success',t('batchAccepted'));
}
async function tableQuickRefresh(){
 const session=tableQuickSession;if(!session)return;
 if(session.refresh){session.repeat=true;return session.refresh;}
 session.refresh=(async()=>{do{
  session.repeat=false;
  try{
   const actor=await api('me');if(actor.branchId+':'+actor.id!==session.actor)throw Error('SESSION_INVALID');
   if(!actor.permissions.includes('counter.view')||!actor.permissions.includes('counter.batch.submit'))throw Error('PERMISSION_DENIED');me=actor;
   const [menu,shift,workspace]=await Promise.all([api('menu'),api('shift'),api('cashWorkspaceGet',{surface:'TABLE_QUICK'})]);
   if(!tableQuickIsActive(session))return;
   if(workspace.orderId){await tableQuickAccepted(workspace.orderId);return;}
   await api('cashDraftContext',{draftId:workspace.scope,type:'COUNTER'});const draft=await api('localDraftRead',{sessionId:workspace.scope});
   if(!tableQuickIsActive(session))return;
   Object.assign(fastState,{menu,shift,scope:workspace.scope,newScope:workspace.scope,localDraft:draft,lines:draft?.lines??[],discount:draft?.discount??0,mode:'COUNTER',sessionId:null,orderId:null,order:null,tables:null,closed:false,frozen:!!draft?.frozen,quote:null,pricedLines:{}});fastState.quoteVersion++;
   session.warning.hidden=true;session.body.inert=false;if(!draft?.frozen)message();session.body.replaceChildren();
   const catalog=el('div',undefined,{className:'table-quick-catalog'}),cart=el('aside',undefined,{className:'fast-panel fast-cart'});session.body.append(catalog,cart);fastDrawCatalog(catalog);fastDrawCart(cart);
   if(fastState.frozen)await tableQuickRecovery();
  }catch(error){
   if(!tableQuickIsActive(session))return;
   if(['SESSION_INVALID','SESSION_EXPIRED','PERMISSION_DENIED'].includes(error.message)){for(const d of [...document.querySelectorAll('dialog[open]')].reverse())if(d!==session.dialog)d.close();await tableQuickClose(true);cashActionError(error);return;}
   session.body.inert=true;session.warning.hidden=false;session.warning.replaceChildren(el('span',t('connection')));fastButton(session.warning,t('retry'),()=>tableQuickRefresh());cashActionError(error);
  }
 }while(session.repeat&&tableQuickIsActive(session));})();
 try{return await session.refresh;}finally{session.refresh=null;}
}
async function tableQuickRecovery(){
 if(!tableQuickSession)return;
 const submit=cashQuery('.fast-submit');if(submit)submit.disabled=true;const catalog=cashQuery('.table-quick-catalog');if(catalog)catalog.inert=true;
 const pending=(await api('pending')).filter(row=>row.action==='counterSubmit'&&row.payload.localScopeId===fastState.scope),cart=cashQuery('.fast-cart-foot');if(!cart)return;
 cart.querySelector('.table-quick-recovery')?.remove();const recovery=el('div',undefined,{className:'table-quick-recovery',role:'status'});recovery.append(el('p',t('fastUnknown')));cart.prepend(recovery);
 for(const record of pending)fastButton(recovery,t('retryOriginal'),async()=>{if(!tableQuickSession)return;const session=tableQuickSession;session.submitting=true;try{await api('retryPending',{key:record.key});await tableQuickRefresh();}finally{session.submitting=false;}});
 if(!pending.length)fastButton(recovery,t('refresh'),()=>tableQuickRefresh());
}

function tableQuickConnectionWarning(){
 const session=tableQuickSession;if(!tableQuickIsActive(session))return;
 session.body.inert=true;session.warning.hidden=false;session.warning.replaceChildren(el('span',t('connection')));fastButton(session.warning,t('retry'),()=>tableQuickRefresh());
}
