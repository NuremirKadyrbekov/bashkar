'use strict';
// The Electron renderer has one persistent shell. Screens replace only #screen.
const POSLayout=(()=>{
 const root=document.getElementById('app-shell'),nav=document.getElementById('nav');
 const identity=document.getElementById('identity'),branch=document.getElementById('branch-label');
 const shift=document.getElementById('shift-indicator'),switcher=document.getElementById('switch'),back=document.getElementById('header-back');
 const header=document.getElementById('pos-header'),reveal=document.getElementById('header-reveal'),toggle=document.getElementById('header-toggle');
 const settingsGroup=document.getElementById('settings-nav-group');
 const settingsButtons=[...settingsGroup.querySelectorAll('[data-screen]')];
 let headerEnabled=false,headerOpen=false,hideTimer=null;
 function cancelHeaderHide(){clearTimeout(hideTimer);hideTimer=null;}
 function headerLabel(){
  const ky=document.getElementById('language').value==='ky',label=headerOpen?(ky?'Панелди дагы 4 секунд көрсөтүү':'Показать панель ещё на 4 секунды'):(ky?'Жогорку панелди 4 секунд көрсөтүү':'Показать верхнюю панель на 4 секунды');
  toggle.setAttribute('aria-label',label);toggle.title=label;toggle.querySelector('[data-header-label]').textContent='Панель';
 }
 function setHeaderOpen(value){
  cancelHeaderHide();headerOpen=headerEnabled&&value;
  if(headerEnabled&&!headerOpen&&header.contains(document.activeElement))toggle.focus({preventScroll:true});
  root.classList.toggle('is-header-open',headerOpen);header.inert=headerEnabled&&!headerOpen;
  if(headerEnabled)header.setAttribute('aria-hidden',String(!headerOpen));else header.removeAttribute('aria-hidden');
  toggle.setAttribute('aria-expanded',String(headerOpen));headerLabel();
 }
 function updateHeader(autoHide){
  const changed=headerEnabled!==autoHide;headerEnabled=autoHide;root.classList.toggle('has-auto-header',autoHide);reveal.hidden=!autoHide;
  if(changed)setHeaderOpen(false);else headerLabel();
 }
 toggle.addEventListener('click',()=>{if(!headerEnabled)return;setHeaderOpen(true);hideTimer=setTimeout(()=>setHeaderOpen(false),4000);});
 document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!headerEnabled||!headerOpen||document.querySelector('dialog[open]'))return;
  toggle.focus({preventScroll:true});setHeaderOpen(false);event.preventDefault();
 });
 const visible=(button,person,schema)=>{
  if(!person)return false;
  const permission=person.permissions??[],route=button.dataset.screen;
  if(route==='cashRegister')return permission.some(p=>['counter.view','table.view_status'].includes(p));
  if(route==='tables')return permission.includes('table.view_status');
  if(route==='tableConfig')return schema>=4&&permission.includes('table.view_status')&&permission.includes('table.manage');
  if(route==='fastSales')return schema>=7&&permission.some(p=>['counter.view','table.view_status'].includes(p));
  if(route==='posSettings')return schema>=7&&permission.some(p=>['counter.view','table.view_status'].includes(p));
  if(route==='counter')return schema>=7&&permission.includes('counter.view');
  if(route==='sales')return schema>=7&&permission.includes('sales.view_24h');
  if(route==='analyticsOverview')return schema>=24&&person.role==='OWNER';
  if(route==='analyticsProducts')return schema>=25&&person.role==='OWNER';
  if(route==='stopList')return permission.includes('menu.stoplist.manage');
  if(route==='employees')return permission.includes('employee.edit');
  if(route==='roleMatrix')return schema>=19&&person.role==='OWNER'&&permission.includes('employee.permissions.manage');
  if(route==='printing')return schema>=10&&permission.some(p=>['print.queue.view','print.settings.manage'].includes(p));
  if(route==='waiterNetwork')return schema>=10&&permission.includes('network.waiter.manage');
  return true;
 };
 const selectedRoute=route=>route==='shiftHistory'?'shift':['order','counterEditor','counter','tables','fastSales'].includes(route)?'cashRegister':route;
 function show(person,route,schema,translate,roleText){
  const authenticated=!!person;
  root.classList.toggle('is-authenticated',authenticated);
  updateHeader(authenticated&&['cashRegister','fastSales','tables'].includes(route));
  root.classList.toggle('is-fast-sales',authenticated&&(route==='fastSales'||route==='cashRegister'&&typeof cashDisplay!=='undefined'&&cashDisplay==='fastSales'));
  nav.hidden=!authenticated;switcher.hidden=!authenticated;shift.hidden=!authenticated;back.hidden=!authenticated;
  const settings=document.getElementById('header-settings');settings.hidden=!authenticated||!person.permissions.some(p=>['counter.view','table.view_status'].includes(p));settings.title=translate('settingsSection');settings.setAttribute('aria-label',translate('settingsSection'));
  identity.replaceChildren();branch.textContent=authenticated?translate('branchWorkspace')+' · '+(person.branchName??person.branchId.slice(0,8)): 'Bashkar POS';if(authenticated)branch.title=person.branchName??person.branchId;
  if(authenticated)shift.textContent=translate('shiftChecking');
  settingsGroup.hidden=!authenticated||!settingsButtons.some(button=>visible(button,person,schema));
  if(!authenticated)settingsGroup.open=false;
  if(settingsButtons.some(button=>button.dataset.screen===route))settingsGroup.open=true;
  settingsGroup.querySelector('[data-settings-nav-label]').textContent=translate('settingsSection');
  if(authenticated){
   const avatar=document.createElement('span');avatar.className='pos-avatar';avatar.textContent=(person.name||'?').trim().charAt(0).toLocaleUpperCase();
   const names=document.createElement('span');names.className='pos-identity-names';
   const name=document.createElement('strong');name.textContent=person.name;
   const role=document.createElement('small');role.textContent=roleText(person.role);
   names.append(name,role);identity.append(avatar,names);
  }else branch.removeAttribute('title');
  for(const button of nav.querySelectorAll('[data-screen]')){
   button.hidden=!visible(button,person,schema);
   const active=button.dataset.screen===selectedRoute(route);button.classList.toggle('is-active',active);
   if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
   button.querySelector('[data-nav-label]').textContent=translate(button.dataset.screen);
   if(button.dataset.screen==='financialOperations')button.title=translate('financialOperationsUnavailable');
   if(button.dataset.screen==='roleMatrix')button.title=translate('roleMatrixClosed');
  }
  back.setAttribute('aria-label',translate('back'));back.title=translate('back');switcher.setAttribute('aria-label',translate('exit'));switcher.title=translate('exit');
 }
 function shiftStatus(current,translate,language){
  if(!root.classList.contains('is-authenticated'))return;
  shift.classList.toggle('is-open',!!current);
  shift.textContent=current?translate('opened')+' · '+new Date(current.openedAt).toLocaleTimeString(language==='ky'?'ky-KG':'ru-RU',{timeZone:'Asia/Bishkek',hour:'2-digit',minute:'2-digit'}):translate('noShift');
 }
 function testProfile(profile){document.getElementById('test-client').dataset.profile=profile??'';}
 return {show,shiftStatus,testProfile};
})();
