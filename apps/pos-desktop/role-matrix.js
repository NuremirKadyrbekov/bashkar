'use strict';
const RoleMatrix=(()=>{
 let rows=[],group='tables',busy=false;
 const say=(ru,ky)=>lang==='ky'?ky:ru;
 const groups=()=>[
  ['tables',say('Столы','Үстөлдөр'),key=>key.startsWith('table.')||key==='settings.table_access_mode.manage'],
  ['orders',say('Заказы','Буйрутмалар'),key=>key.startsWith('order.')],
  ['finance',say('Касса и финансы','Касса жана каржы'),key=>/^(counter\.|payment\.|financial\.|sales\.)/.test(key)],
  ['employees',say('Сотрудники','Кызматкерлер'),key=>key.startsWith('employee.')],
  ['menu',say('Меню и настройки','Меню жана жөндөөлөр'),key=>key.startsWith('menu.')||key==='settings.service_charge.manage'],
  ['shift',say('Смена и отчёты','Нөөмөт жана отчёттор'),key=>key.startsWith('shift.')||key.startsWith('audit.')],
  ['print',say('Печать и сеть','Басып чыгаруу жана тармак'),key=>key.startsWith('print.')||key.startsWith('network.')]
 ];
 function keyLabel(key){
  if(key==='order.settle.table')return say('Рассчитать заказ за столом','Үстөлдөгү буйрутманы эсептешүү');
  if(key==='order.settle.counter')return say('Рассчитать заказ без стола','Үстөлсүз буйрутманы эсептешүү');
  const name=permissionLabelText(key);return name===key?key.split('.').slice(1).join(' · ').replaceAll('_',' '):name;
 }
 function draw(){
  if(screen!=='roleMatrix')return;
  const section=shell(say('Роли и права','Ролдор жана укуктар'));
  section.className='role-matrix-screen';
  const head=el('div',undefined,{className:'role-matrix-head'}),intro=el('div');
  intro.append(el('h1',say('Роли и права','Ролдор жана укуктар')),el('p',say('Общие права сотрудников филиала. Изменения начинают действовать после подтверждения сервера.','Филиал кызматкерлеринин жалпы укуктары. Өзгөрүүлөр сервер ырастагандан кийин иштейт.')));
  const refresh=el('button',say('Обновить','Жаңыртуу'),{type:'button',className:'role-matrix-refresh'});refresh.onclick=()=>run(show,refresh);head.append(intro,refresh);section.replaceChildren(head);
  const legend=el('div',undefined,{className:'role-matrix-legend'});
  for(const [mark,label,kind] of [['✓',say('Разрешено','Уруксат'),'on'],['—',say('Выключено','Өчүк'),'off'],['🔒',say('Недоступно для роли','Рол үчүн жеткиликсиз'),'locked']]){const piece=el('span');piece.append(el('i',mark,{className:'role-matrix-mini '+kind}),document.createTextNode(label));legend.append(piece);}
  section.append(legend);
  section.append(el('p',say('Правило роли действует для всех сотрудников этой роли. Индивидуальные исключения применяются только к правам, которые здесь ещё не изменяли. Владелец защищён от изменения.','Рол эрежеси ушул ролдогу бардык кызматкерлерге колдонулат. Жеке өзгөчөлүктөр бул жерден өзгөртүлө элек укуктарга гана колдонулат. Ээсинин укуктары өзгөртүлбөйт.'),{className:'role-matrix-help'}));
  const tabs=el('div',undefined,{className:'role-matrix-tabs',role:'tablist'});
  for(const [id,label] of groups()){const tab=el('button',label,{type:'button',role:'tab',className:id===group?'active':''});tab.setAttribute('aria-selected',String(id===group));tab.onclick=()=>{group=id;draw();};tabs.append(tab);}section.append(tabs);
  if(!rows.length){section.append(el('p',say('Матрица пуста. Проверьте подключение к Local POS Server.','Матрица бош. Local POS Server туташуусун текшериңиз.'),{className:'role-matrix-help'}));return;}
  const categories=groups(),match=categories.find(entry=>entry[0]===group)?.[2]??categories[0][2];
  const columns=rows[0].permissions.filter(item=>match(item.key)).map(item=>item.key);
  const frame=el('div',undefined,{className:'role-matrix-scroll',role:'region','aria-label':say('Матрица прав','Укуктар матрицасы'),tabIndex:0}),table=el('table',undefined,{className:'role-matrix-table'}),thead=el('thead'),header=el('tr');
  header.append(el('th',say('Роль','Роль'),{scope:'col',className:'role-matrix-role'}));
  for(const key of columns){const th=el('th',undefined,{scope:'col',title:key});th.append(el('span',keyLabel(key)),el('small',key));header.append(th);}thead.append(header);table.append(thead);
  const tbody=el('tbody');
  for(const row of rows){const tr=el('tr'),first=el('th',undefined,{scope:'row',className:'role-matrix-role'});first.append(el('strong',roleText(row.role)),el('small',row.role==='OWNER'?say('Защищённая роль','Корголгон роль'):say('Редакция '+row.revision,'Редакция '+row.revision)));tr.append(first);
   for(const key of columns){const item=row.permissions.find(p=>p.key===key),td=el('td');if(!item.allowed){td.append(el('span','🔒',{className:'role-matrix-cell locked',title:say('Запрещено пределом роли','Рол чеги боюнча тыюу салынган')}));}
    else if(row.role==='OWNER'){td.append(el('span',item.enabled?'✓':'—',{className:'role-matrix-cell '+(item.enabled?'on':'off'),title:say('Роль владельца защищена','Ээсинин ролу корголгон')}));}
    else{const cell=el('button',item.enabled?'✓':'—',{type:'button',className:'role-matrix-cell '+(item.enabled?'on':'off')+(item.custom?' custom':''),disabled:busy,title:key+' · '+(item.custom?say('Правило роли','Рол эрежеси'):say('Исходный шаблон','Баштапкы үлгү'))});cell.setAttribute('aria-label',`${roleText(row.role)} · ${keyLabel(key)} · ${item.enabled?say('разрешено','уруксат'):say('выключено','өчүк')}`);cell.onclick=()=>confirmChange(row,item);td.append(cell);}tr.append(td);}
   tbody.append(tr);}
  table.append(tbody);frame.append(table);section.append(frame);
  section.append(el('p',say('Прокручивайте таблицу по горизонтали. Отдельные действия также ограничены состоянием смены, заказа и доступом к столу.','Таблицаны туурасынан жылдырыңыз. Аракеттерге нөөмөттүн, буйрутманын жана үстөлгө кирүүнүн абалы да таасир этет.'),{className:'role-matrix-foot'}));
 }
 function confirmChange(row,item){
  const next=!item.enabled,dialog=el('dialog',undefined,{className:'role-matrix-confirm'});
  dialog.append(el('h2',next?say('Разрешить право?','Уруксат бересизби?'):say('Отключить право?','Укукту өчүрөсүзбү?')),
   el('p',roleText(row.role)+' · '+keyLabel(item.key),{className:'role-matrix-confirm-target'}),
   el('p',say('Изменение коснётся всех сотрудников этой роли в текущем филиале.','Өзгөртүү учурдагы филиалдагы ушул ролдогу бардык кызматкерлерге тиешелүү болот.')));
  const actions=el('div',undefined,{className:'role-matrix-confirm-actions'}),cancel=el('button',say('Отмена','Жокко чыгаруу'),{type:'button'}),save=el('button',next?say('Разрешить','Уруксат берүү'):say('Отключить','Өчүрүү'),{type:'button',className:'primary'});cancel.onclick=()=>dialog.close();
  save.onclick=()=>run(async()=>{busy=true;save.disabled=true;try{await api('rolePermission',{role:row.role,revision:row.revision,permission:item.key,allowed:next});dialog.close();await show();toast('success',say('Права роли сохранены','Рол укуктары сакталды'));}catch(error){if(error.message==='REVISION_CONFLICT'){dialog.close();await show();}throw error;}finally{busy=false;save.disabled=false;}},save);
  actions.append(cancel,save);dialog.append(actions);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
 }
 async function show(){
  if(me?.role!=='OWNER'||!me.permissions?.includes('employee.permissions.manage'))throw Error('PERMISSION_DENIED');
  if(screen==='roleMatrix'){const section=shell(say('Роли и права','Ролдор жана укуктар'));section.className='role-matrix-screen';section.append(el('p',say('Загрузка матрицы…','Матрица жүктөлүүдө…')));}
  try{rows=await api('roleMatrix');draw();}
  catch(error){if(screen==='roleMatrix'){const section=shell(say('Роли и права','Ролдор жана укуктар'));section.className='role-matrix-screen';section.append(el('p',say('Не удалось загрузить права. Проверьте Local POS Server и повторите запрос.','Укуктар жүктөлгөн жок. Local POS Server текшерип, кайра аракет кылыңыз.'),{className:'role-matrix-help'}));const retry=el('button',say('Повторить','Кайталоо'),{type:'button',className:'role-matrix-refresh'});retry.onclick=()=>run(show,retry);section.append(retry);}throw error;}
 }
 return {show};
})();
