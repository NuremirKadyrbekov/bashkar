'use strict';
// All dismissal paths use the dialog's cancel event, preserving existing guards.
const POSDialogs=(()=>{
 const initialized=new WeakSet();
 const label=()=>document.getElementById('language')?.value==='ky'?'Терезени жабуу':'Закрыть окно';
 function dismiss(dialog){if(!dialog.open)return;const event=new Event('cancel',{cancelable:true});if(dialog.dispatchEvent(event)&&dialog.open)dialog.close();}
 function decorate(dialog){
  dialog.classList.add('pos-dialog');
  if(!dialog.querySelector(':scope > .pos-dialog-close')){const close=document.createElement('button');close.type='button';close.className='pos-dialog-close';close.textContent='×';close.setAttribute('aria-label',label());close.title=label();close.onclick=()=>dismiss(dialog);dialog.prepend(close);}
  if(initialized.has(dialog))return;initialized.add(dialog);
  let outsideDown=false;
  const outside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;};
  dialog.addEventListener('pointerdown',event=>{outsideDown=event.target===dialog&&outside(event);});
  dialog.addEventListener('click',event=>{if(event.target===dialog&&outsideDown&&outside(event))dismiss(dialog);outsideDown=false;});
 }
 function guard(dialog,check){let pending=false;dialog.addEventListener('cancel',event=>{event.preventDefault();if(pending)return;pending=true;Promise.resolve().then(check).then(ok=>{if(ok&&dialog.open)dialog.close();}).catch(error=>{if(typeof handleError==='function')handleError(error);}).finally(()=>pending=false);});}
 const observer=new MutationObserver(records=>{for(const record of records){if(record.target instanceof HTMLDialogElement&&record.target.isConnected)decorate(record.target);for(const node of record.addedNodes)if(node.nodeType===1){if(node instanceof HTMLDialogElement)decorate(node);node.querySelectorAll?.('dialog').forEach(decorate);}}});
 observer.observe(document.documentElement,{childList:true,subtree:true});
 document.getElementById('language')?.addEventListener('change',()=>document.querySelectorAll('.pos-dialog-close').forEach(button=>{button.setAttribute('aria-label',label());button.title=label();}));
 return {decorate,dismiss,guard};
})();
