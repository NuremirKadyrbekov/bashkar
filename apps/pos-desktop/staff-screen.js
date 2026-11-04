'use strict';
const StaffScreen=(()=>{
 const state={rows:[],selected:null,query:'',role:'ALL',status:'ALL',sort:'recent',stats:null,loading:false,listScroll:0,pinHide:null};
 const words=(ruText,kyText)=>lang==='ky'?kyText:ruText;
 const initials=name=>name.trim().split(/\s+/).slice(0,2).map(word=>word[0]?.toLocaleUpperCase()||'').join('');
 const icon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#icon-'+name);svg.append(use);svg.setAttribute('aria-hidden','true');return svg;};
 const time=value=>value?new Date(value).toLocaleString(lang==='ky'?'ky-KG':'ru-RU',{timeZone:'Asia/Bishkek',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):words('Нет данных','Маалымат жок');
 const fullName=form=>[form.first.value.trim(),form.last.value.trim()].filter(Boolean).join(' ');
 const money=cents=>new Intl.NumberFormat(lang==='ky'?'ky-KG':'ru-RU',{minimumFractionDigits:cents%100===0?0:2,maximumFractionDigits:2}).format(cents/100)+' '+words('сом','сом');
 const splitName=name=>{const parts=name.trim().split(/\s+/);return [parts.shift()||'',parts.join(' ')];};
 const allowed=key=>me.permissions?.includes(key);
 const current=()=>state.rows.find(row=>row.id===state.selected);
 const targetAllowed=row=>row.role!=='OWNER'&&!(me.role==='MANAGER'&&row.id===me.id)&&!(me.role==='CASHIER'&&(row.id===me.id||!['CASHIER','WAITER'].includes(row.role)));
 function badge(text,kind){return el('span',text,{className:'staff-badge '+kind});}
 function avatar(row,large=false){return el('span',initials(row.name),{className:'staff-avatar'+(large?' large':'')});}
 function hidePin(){const hide=state.pinHide;state.pinHide=null;hide?.();}
 document.addEventListener('visibilitychange',()=>{if(document.hidden)hidePin();});
 function notify(text){message('');toast('success',text);}
 function showCreated(result,role){
  const dialog=el('dialog',undefined,{className:'staff-secret-dialog'});
  dialog.append(el('h2',words('Сотрудник создан','Кызматкер түзүлдү')),el('p',result.name||'',{className:'staff-muted'}));
  if(role==='CASHIER'||role==='WAITER'){
   const pin=el('div',undefined,{className:'staff-secret-block'});
   pin.append(el('span',words('Личный PIN','Жеке PIN'),{className:'staff-secret-label'}));
   if(/^\d{4}$/.test(result.temporaryPin||''))pin.append(el('code',result.temporaryPin,{className:'staff-secret-pin'}),el('small',words('Передайте PIN сотруднику сейчас. После закрытия карточки он не будет показан повторно.','PIN кодду кызматкерге азыр бериңиз. Бул терезе жабылгандан кийин ал кайра көрсөтүлбөйт.')));
   else pin.append(el('p',result.secretAlreadyIssued?words('PIN уже был выдан. Если он утрачен, выполните отдельный сброс.','PIN мурда берилген. Жоголсо өзүнчө жаңылаңыз.'):words('PIN не получен от сервера. Проверьте выдачу перед передачей доступа.','PIN серверден келген жок. Кирүүгө уруксат берерден мурда текшериңиз.'),{className:'staff-muted'}));
   dialog.append(pin);
  }
  const password=el('div',undefined,{className:'staff-secret-block'});password.append(el('span',words('Временный пароль','Убактылуу сырсөз'),{className:'staff-secret-label'}));
  if(result.temporaryPassword)password.append(el('code',result.temporaryPassword,{className:'staff-secret-password'}),el('small',words('При входе с этим паролем сотрудник установит личный пароль.','Бул сырсөз менен киргенде кызматкер жеке сырсөз орнотот.')));
  else password.append(el('p',words('Пароль уже выдавался. Для нового временного пароля используйте отдельный сброс.','Сырсөз мурда берилген. Жаңысын алуу үчүн өзүнчө жаңылаңыз.'),{className:'staff-muted'}));
  dialog.append(password);
  const done=el('button',t('done'),{type:'button',className:'staff-primary'});done.onclick=()=>dialog.close();dialog.append(done);
  dialog.onclose=()=>{dialog.replaceChildren();dialog.remove();result.temporaryPin=undefined;result.temporaryPassword=undefined;};
  document.body.append(dialog);dialog.showModal();
 }
 function showPasswordReset(result){
  const dialog=el('dialog',undefined,{className:'staff-secret-dialog'}),block=el('div',undefined,{className:'staff-secret-block'});
  dialog.append(el('h2',words('Новый временный пароль','Жаңы убактылуу сырсөз')));
  if(result.temporaryPassword)block.append(el('code',result.temporaryPassword,{className:'staff-secret-password'}),el('small',words('Покажите пароль сотруднику сейчас. При следующем входе он установит личный пароль.','Сырсөздү кызматкерге азыр көрсөтүңүз. Кийинки киргенде ал жеке сырсөзүн орнотот.')));
  else block.append(el('p',words('Пароль уже выдавался. Если ответ был утрачен, выполните отдельный сброс.','Сырсөз мурда берилген. Жооп жоголсо, өзүнчө жаңылаңыз.'),{className:'staff-muted'}));
  dialog.append(block);const done=el('button',t('done'),{type:'button',className:'staff-primary'});done.onclick=()=>dialog.close();dialog.append(done);
  dialog.onclose=()=>{dialog.replaceChildren();dialog.remove();result.temporaryPassword=undefined;};document.body.append(dialog);dialog.showModal();
 }
 async function refresh(selectId=state.selected){
  me=await api('me');
  state.rows=await api(allowed('employee.archive.view')?'employeesArchive':'employees');
  state.selected=state.rows.some(row=>row.id===selectId)?selectId:null;
  if(state.selected)await loadStats(state.selected);else state.stats=null;
  draw();
 }
 async function loadStats(id){
  state.stats=null;
  if(me.role==='CASHIER')return;
  try{state.stats=await api('employeeStatistics',{employeeId:id});}
  catch(error){if(error.message==='SERVER_UNAVAILABLE')throw error;state.stats={error:true};}
 }
 async function show(){
  state.loading=true;
  const section=shell(t('employees'));section.className='staff-screen';
  section.append(el('p',words('Загрузка сотрудников…','Кызматкерлер жүктөлүүдө…'),{className:'staff-loading'}));
  try{await refresh(state.selected);}catch(error){section.replaceChildren(el('h1',t('employees')),el('p',words('Не удалось загрузить сотрудников. Проверьте Local POS Server.','Кызматкерлер жүктөлгөн жок. Local POS Server текшериңиз.')));button(section,'retry',show,true);throw error;}
  finally{state.loading=false;}
 }
 function draw(){
  if(screen!=='employees')return;
  const section=shell(t('employees'));section.className='staff-screen';
  const top=el('div',undefined,{className:'staff-heading'}),title=el('div');
  title.append(el('h1',t('employees')),el('p',words('Управление сотрудниками, их ролями и доступом к системе.','Кызматкерлерди, ролдорду жана системага кирүү укугун башкаруу.'),{className:'staff-subtitle'}));
  top.append(title);
  if(allowed('employee.create')){const create=button(top,'staffAdd',()=>openForm());create.textContent=words('＋ Добавить сотрудника','＋ Кызматкер кошуу');create.classList.add('staff-primary');}
  section.replaceChildren(top);
  state.listScroll=document.querySelector('.staff-list')?.scrollTop??state.listScroll;
  const cols=el('div',undefined,{className:'staff-columns'}),left=el('div',undefined,{className:'staff-left'}),right=el('div',undefined,{className:'staff-right'});
  cols.append(left,right);section.append(cols);
  const filters=el('div',undefined,{className:'staff-filters'});
  const search=el('input',undefined,{type:'search',value:state.query,placeholder:words('Поиск по имени или логину…','Аты же логини боюнча издөө…')});search.setAttribute('aria-label',words('Поиск сотрудников','Кызматкерлерди издөө'));search.oninput=()=>{state.query=search.value;drawList(left);};
  filters.append(search);
  const select=(value,options,onchange,label)=>{const input=el('select');input.setAttribute('aria-label',label);for(const [key,text] of options)input.append(el('option',text,{value:key,selected:key===value}));input.onchange=()=>{onchange(input.value);drawList(left);};filters.append(input);};
  select(state.role,[['ALL',words('Все роли','Бардык ролдор')],...['OWNER','MANAGER','CASHIER','WAITER'].map(role=>[role,roleText(role)])],value=>state.role=value,words('Роль','Роль'));
  select(state.status,[['ALL',words('Все статусы','Бардык абалдар')],...['ACTIVE','SUSPENDED','DEACTIVATED'].map(status=>[status,statusText(status)])],value=>state.status=value,words('Статус','Абалы'));
  select(state.sort,[['recent',words('По дате активности','Активдүүлүк боюнча')],['name',words('По имени','Аты боюнча')],['oldest',words('Давно не заходили','Көптөн бери кирбегендер')]],value=>state.sort=value,words('Сортировка','Иреттөө'));
  left.append(filters,el('div',undefined,{className:'staff-list'}));drawList(left);left.querySelector('.staff-list').scrollTop=state.listScroll;left.querySelector('.staff-list').onscroll=event=>state.listScroll=event.currentTarget.scrollTop;drawDetail(right);
 }
 function filtered(){
  const query=state.query.trim().toLocaleLowerCase();
  return state.rows.filter(row=>(state.role==='ALL'||row.role===state.role)&&(state.status==='ALL'||row.status===state.status)&&(!query||[row.name,row.login].some(value=>value?.toLocaleLowerCase().includes(query)))).sort((a,b)=>state.sort==='name'?a.name.localeCompare(b.name,lang==='ky'?'ky':'ru'):state.sort==='oldest'?(a.lastActivity||0)-(b.lastActivity||0): (b.lastActivity||0)-(a.lastActivity||0)||a.name.localeCompare(b.name));
 }
 function drawList(left){
  const list=left.querySelector('.staff-list');if(!list)return;list.replaceChildren();
  const rows=filtered();
  if(!state.rows.length){list.append(el('p',words('Сотрудников пока нет.','Кызматкерлер азырынча жок.'),{className:'staff-empty'}));return;}
  if(!rows.length){list.append(el('p',words('Ничего не найдено. Измените поиск или фильтры.','Эч нерсе табылган жок. Издөөнү же чыпкаларды өзгөртүңүз.'),{className:'staff-empty'}));return;}
  for(const row of rows){
   const card=el('button',undefined,{type:'button',className:'staff-row'+(row.id===state.selected?' selected':'')});
   card.setAttribute('aria-pressed',String(row.id===state.selected));
   const identity=el('span',undefined,{className:'staff-row-name'});identity.append(el('strong',row.name),el('small',row.login));
   const role=badge(roleText(row.role),'role-'+row.role.toLowerCase()),status=badge(statusText(row.status),'status-'+row.status.toLowerCase());
   const recent=el('span',undefined,{className:'staff-recent'});recent.append(el('small',words('Активность','Активдүүлүк')),el('span',time(row.lastActivity)));
   card.append(avatar(row),identity,role,status,recent,el('span','›',{className:'staff-chevron'}));
   card.onclick=()=>run(async()=>{state.selected=row.id;draw();await loadStats(row.id);drawDetail(document.querySelector('.staff-right'));});
   list.append(card);
  }
 }
 function drawDetail(right){
  hidePin();if(!right)return;right.replaceChildren();const row=current();
  if(!row){right.append(el('p',words('Выберите сотрудника для просмотра информации','Маалыматты көрүү үчүн кызматкерди тандаңыз'),{className:'staff-empty staff-detail-empty'}));return;}
  const card=el('article',undefined,{className:'staff-detail'});
  const header=el('div',undefined,{className:'staff-detail-head'}),person=el('div',undefined,{className:'staff-detail-person'}),names=el('div');
  names.append(el('h2',row.name),badge(roleText(row.role),'role-'+row.role.toLowerCase()),badge(statusText(row.status),'status-'+row.status.toLowerCase()));person.append(avatar(row,true),names);
  const close=el('button','×',{type:'button',className:'staff-close'});close.setAttribute('aria-label',words('Закрыть карточку','Карточканы жабуу'));close.onclick=()=>{state.selected=null;state.stats=null;draw();};
  header.append(person,close);card.append(header);
  const info=el('dl',undefined,{className:'staff-info'});
  const fields=[[words('Имя и фамилия','Аты-жөнү'),row.name],[words('Логин','Логин'),row.login],[words('Роль','Роль'),roleText(row.role)],[words('Телефон','Телефон'),row.phone||'—'],[words('Статус учётной записи','Аккаунт абалы'),statusText(row.status)],[words('Последняя активность','Акыркы активдүүлүк'),time(row.lastActivity)]];
  for(const [index,[label,value]] of fields.entries()){
   info.append(el('dt',label),el('dd',value));
   if(index===3){
    const pinRow=el('dd',undefined,{className:'staff-pin-row'}),pinValue=el('span',row.pinIssued?'••••':['MANAGER','OWNER'].includes(row.role)?words('Не предусмотрен','Каралган эмес'):words('Не выдан','Берилген эмес'),{className:'staff-pin-value'});
    pinRow.append(pinValue);
    if(row.pinIssued&&row.status==='ACTIVE'&&['CASHIER','WAITER'].includes(row.role)&&(me.role!=='CASHIER'||row.role==='WAITER'||row.id===me.id)&&allowed('employee.pin.view')){
     const reveal=el('button',words('Показать','Көрсөтүү'),{type:'button',className:'staff-pin-reveal'});
     reveal.setAttribute('aria-label',words('Показать PIN-код сотрудника','Кызматкердин PIN кодун көрсөтүү'));
     reveal.onclick=()=>run(async()=>{
      if(state.pinHide){hidePin();return;}
      const viewer=me.id,selected=state.selected;const result=await api('pinReveal',{employeeId:row.id});
      if(screen!=='employees'||me?.id!==viewer||state.selected!==selected||!pinRow.isConnected)return;
      if(!/^\d{4}$/.test(result.pin||''))throw new Error('PIN_RESPONSE_INVALID');
      pinValue.textContent=result.pin;reveal.textContent=words('Скрыть','Жашыруу');
      let timer;const hide=()=>{clearTimeout(timer);pinValue.textContent='••••';reveal.textContent=words('Показать','Көрсөтүү');};
      state.pinHide=hide;timer=setTimeout(()=>{if(state.pinHide===hide)hidePin();},3000);
     },reveal);
     pinRow.append(reveal);
    }
    info.append(el('dt',words('PIN-код','PIN коду')),pinRow);
   }
  }
  card.append(info);
  if(me.role!=='CASHIER'){
   const stats=el('div',undefined,{className:'staff-stats'});stats.append(el('h3',words('Статистика за сегодня','Бүгүнкү статистика')));
   if(state.stats?.error)stats.append(el('p',words('Статистика недоступна на этом сервере.','Бул серверде статистика жеткиликсиз.'),{className:'staff-muted'}));
   else if(!state.stats)stats.append(el('p',words('Загрузка статистики…','Статистика жүктөлүүдө…'),{className:'staff-muted'}));
   else{const grid=el('div',undefined,{className:'staff-stat-grid'});for(const [symbol,label,key] of [['tables',words('Открыто столов','Ачылган үстөлдөр'),'openedTables'],['counter',words('Отправлено пакетов','Жөнөтүлгөн топтор'),'submittedBatches'],['sales',words('Зарегистрировано оплат','Катталган төлөмдөр'),'registeredPayments'],['settings',words('Выполнено корректировок','Оңдоолор'),'corrections']]){const item=el('div',undefined,{className:'staff-stat'}),picture=el('span',undefined,{className:'staff-stat-icon'});picture.append(icon(symbol));item.append(picture,el('span',label,{className:'staff-stat-label'}),el('strong',String(state.stats[key])));grid.append(item);}stats.append(grid);
    const revenue=el('div',undefined,{className:'staff-revenue'}),amount=state.stats.revenueTodayCents;
    revenue.append(el('span',words('Выручка за сегодня','Бүгүнкү түшүм'),{className:'staff-revenue-label'}),el('strong',amount===null?words('Нет доступа','Уруксат жок'):Number.isSafeInteger(amount)?money(amount):words('Недоступно','Жеткиликсиз')));
    revenue.append(el('small',words('TABLE — ответственному на момент оплаты; COUNTER — зарегистрировавшему оплату. Возвраты вычтены.','TABLE — төлөм учурдагы жооптуу кызматкерге; COUNTER — төлөмдү каттаган кызматкерге. Кайтаруулар кемитилген.')));
    stats.append(revenue);
   }
   card.append(stats);
  }
  const actions=el('div',undefined,{className:'staff-actions'});actions.append(el('h3',t('actions')));
  if(targetAllowed(row)){
   if(row.status!=='DEACTIVATED'&&allowed('employee.edit')){const edit=button(actions,'edit',()=>openForm(row),true);edit.classList.add('staff-primary','staff-edit');}
   const secondary=el('div',undefined,{className:'staff-secondary'});
   if(row.status!=='DEACTIVATED'&&allowed('employee.password.reset')){const reset=button(secondary,'reset',async()=>{if(!await confirmAction(words('Выдать новый временный пароль? Текущие сессии сотрудника завершатся.','Жаңы убактылуу сырсөз берилсинби? Учурдагы сессиялар аяктайт.')))return;const result=await api('employeeReset',{employeeId:row.id,revision:row.revision});showPasswordReset(result);await refresh(row.id);notify(words('Пароль сброшен','Сырсөз жаңыланды'));});reset.prepend(icon('lock'));}
   if(row.status==='ACTIVE'&&['CASHIER','WAITER'].includes(row.role)){
    const pinAction=row.pinIssued?'pinReset':'pinIssue',permission=row.pinIssued?'employee.pin.reset':'employee.pin.issue';
    if(allowed(permission)){const control=button(secondary,pinAction,async()=>{if(!await confirmAction(words(row.pinIssued?'Выдать новый PIN? Текущие сессии сотрудника завершатся.':'Выдать PIN сотруднику?',row.pinIssued?'Жаңы PIN берилсинби? Учурдагы сессиялар аяктайт.':'Кызматкерге PIN берилсинби?')))return;const result=await api(pinAction,{employeeId:row.id,revision:row.revision});if(result.temporaryPin)showPinCard(result.temporaryPin,row.name,row.id);await refresh(row.id);notify(words('PIN выдан','PIN берилди'));});control.prepend(icon('lock'));}
   }
   if(allowed('employee.status.manage')){const menu=el('select');menu.setAttribute('aria-label',words('Изменить статус','Абалын өзгөртүү'));menu.append(el('option',words('Изменить статус','Абалын өзгөртүү'),{value:''}));for(const [value,label] of row.status==='ACTIVE'?[['SUSPENDED',t('suspend')],['DEACTIVATED',t('deactivate')]]:[['ACTIVE',t('restore')],['DEACTIVATED',t('deactivate')]])menu.append(el('option',label,{value}));menu.onchange=()=>run(async()=>{const status=menu.value;menu.value='';if(!status||!await confirmAction(t('confirmChange')))return;await api('employeeUpdate',{employeeId:row.id,revision:row.revision,status});await refresh(row.id);notify(words('Статус изменён','Абал өзгөрдү'));});secondary.append(menu);}
   actions.append(secondary);
  }
  card.append(actions);
  right.append(card);
 }
 function openForm(row){
  const dialog=el('dialog',undefined,{className:'staff-dialog'}),form=el('form');form.onsubmit=event=>event.preventDefault();
  dialog.append(el('h2',row?words('Редактировать сотрудника','Кызматкерди өзгөртүү'):words('Добавить сотрудника','Кызматкер кошуу')));
  const [firstName,lastName]=splitName(row?.name||'');
  const first=field(form,'staffFirst',firstName),last=field(form,'staffLast',lastName,'text',false),login=field(form,'user',row?.login||''),phone=field(form,'staffPhone',row?.phone||'','tel',false);
  first.parentElement.firstChild.textContent=words('Имя','Аты');last.parentElement.firstChild.textContent=words('Фамилия','Фамилиясы');phone.parentElement.firstChild.textContent=words('Телефон','Телефон');
  if(row){login.disabled=true;login.parentElement.append(el('small',words('Логин нельзя изменить','Логинди өзгөртүү мүмкүн эмес')));}
  const roleLabel=el('label',t('role')),role=el('select',undefined,{required:true});for(const code of (me.role==='CASHIER'?['CASHIER','WAITER']:['MANAGER','CASHIER','WAITER']))role.append(el('option',roleText(code),{value:code,selected:code===row?.role}));roleLabel.append(role);form.append(roleLabel);
  const note=el('p',undefined,{className:'staff-muted'}),updateNote=()=>{note.textContent=row?words('При смене роли действующий PIN может быть отозван. Новый PIN выдаётся отдельным действием.','Роль өзгөргөндө учурдагы PIN жокко чыгарылышы мүмкүн. Жаңы PIN өзүнчө берилет.'):role.value==='MANAGER'?words('Менеджер создаётся без PIN. Временный пароль показывается один раз.','Менеджер PINсиз түзүлөт. Убактылуу сырсөз бир жолу көрсөтүлөт.'):words('Личный PIN создаётся автоматически и показывается вместе с временным паролем один раз.','Жеке PIN автоматтык түрдө түзүлүп, убактылуу сырсөз менен бир жолу көрсөтүлөт.');};role.onchange=updateNote;updateNote();form.append(note);
  const footer=el('div',undefined,{className:'staff-dialog-footer'}),cancel=el('button',t('cancel'),{type:'button'}),submit=el('button',row?t('edit'):t('create'),{type:'submit',className:'staff-primary'});
  cancel.onclick=()=>dialog.close();footer.append(cancel,submit);form.append(footer);dialog.append(form);document.body.append(dialog);dialog.showModal();dialog.onclose=()=>dialog.remove();
  form.onsubmit=event=>{event.preventDefault();run(async()=>{if(!form.reportValidity())return;const name=fullName({first,last});if(!name)return;submit.disabled=true;try{if(row){await api('employeeUpdate',{employeeId:row.id,revision:row.revision,name,phone:phone.value,role:role.value});dialog.close();await refresh(row.id);notify(words('Сотрудник сохранён','Кызматкер сакталды'));}else{const createdRole=role.value,result=await api('employeeCreate',{name,login:login.value.trim(),phone:phone.value,role:createdRole});dialog.close();showCreated(result,createdRole);await refresh(result.id);notify(words('Сотрудник создан','Кызматкер түзүлдү'));}}finally{submit.disabled=false;}},submit);};
 }
 return {show,refresh,hidePin};
})();
