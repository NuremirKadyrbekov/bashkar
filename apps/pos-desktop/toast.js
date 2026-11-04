'use strict';
// Shared Bashkar short-message presentation. Persistent recovery/error state
// stays in the originating screen; a toast never confirms an unknown command.
let toastTimer=null;
function toast(kind,text){
 clearTimeout(toastTimer);document.getElementById('pos-toast')?.remove();
 const panel=document.createElement('div');panel.id='pos-toast';panel.className='pos-toast '+(['success','warning','error'].includes(kind)?kind:'warning');
 panel.setAttribute('role',kind==='error'?'alert':'status');panel.setAttribute('aria-live',kind==='error'?'assertive':'polite');
 const icon=document.createElement('span');icon.className='pos-toast-icon';icon.textContent=kind==='success'?'✓':kind==='error'?'!':'!';icon.setAttribute('aria-hidden','true');
 const label=document.createElement('span');label.textContent=text;panel.append(icon,label);([...document.querySelectorAll('dialog[open]')].at(-1)??document.body).append(panel);
 toastTimer=setTimeout(()=>{panel.remove();toastTimer=null;},1500);
}
