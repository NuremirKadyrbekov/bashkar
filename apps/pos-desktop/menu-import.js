'use strict';
const menuImportState={file:null,plan:null,snapshot:null,draftSnapshot:null,loading:false,saving:false,error:null};
const miText=()=>lang==='ky'?{
 title:'Excelден импорттоо',hint:'Файл менюңуздун жергиликтүү долбооруна сакталат. Жарыяланган меню өзүнчө баскыч менен жаңыртылат.',
 template:'Excel үлгүсүн жүктөө',choose:'Excel файлды импорттоо',confirm:'Импортту долбоорго сактоо',required:'* Милдеттүү талаалар',preview:'Импорттун алдын ала көрүнүшү',issues:'Файлдагы каталар',saveFirst:'Адегенде ачык товардагы өзгөртүүлөрдү сактаңыз.',changed:'Меню же долбоор өзгөрдү. Файлды кайра тандаңыз.',saved:'Импорт жергиликтүү долбоорго сакталды. Менюну өзүнчө жарыялаңыз.',cancelled:'Тандоо токтотулду.'
}:{title:'Импорт из Excel',hint:'Файл сохраняется в локальный черновик. Опубликованное меню обновляется отдельной кнопкой.',template:'Скачать шаблон Excel',choose:'Импортировать Excel',confirm:'Сохранить импорт в черновик',required:'* Обязательные поля',preview:'Предпросмотр импорта',issues:'Ошибки в файле',saveFirst:'Сначала сохраните изменения открытого товара.',changed:'Меню или черновик изменились. Выберите файл заново.',saved:'Импорт сохранён в локальный черновик. Опубликуйте меню отдельно.',cancelled:'Выбор отменён.'};
function menuImportError(code){
 const messages={MENU_IMPORT_TOO_LARGE:['Файл слишком большой или превышен допустимый объём данных.','Файл өтө чоң же маалымат чеги ашты.'],MENU_IMPORT_TOO_MANY_ROWS:['В файле больше 1000 строк.','Файлда 1000ден ашык сап бар.'],MENU_IMPORT_INVALID_FILE:['Файл повреждён или не является шаблоном .xlsx.','Файл бузулган же .xlsx үлгүсү эмес.'],MENU_IMPORT_INVALID_SHEET:['Оставьте один лист с названием «Меню».','«Меню» аттуу бир баракты калтырыңыз.'],MENU_IMPORT_INVALID_HEADERS:['Заголовки столбцов не совпадают с шаблоном.','Мамычалардын аталыштары үлгүгө дал келбейт.'],MENU_IMPORT_EXPIRED:['Время предпросмотра истекло. Выберите файл заново.','Алдын ала көрүүнүн мөөнөтү бүттү. Файлды кайра тандаңыз.']};
 if(code==='MENU_IMPORT_CHANGED')return miText().changed;
 return messages[code]?.[lang==='ky'?1:0]??code;
}
function menuImportReset(){Object.assign(menuImportState,{file:null,plan:null,snapshot:null,draftSnapshot:null,loading:false,saving:false,error:null});}
function menuImportSnapshot(){return JSON.stringify(menuState);}
async function menuImportChoose(){
 const t=miText(),s=menuImportState;
 if(menuUi.formDirty||menuUi.categoryDirty){message(t.saveFirst);return;}
 const snapshot=menuImportSnapshot(),draftSnapshot=JSON.stringify(draft),{baseRevision,...catalog}=structuredClone(menuState);
 s.loading=true;s.error=null;s.file=null;s.plan=null;s.snapshot=null;s.draftSnapshot=null;menuDrawProducts();
 try{
  const selected=await api('menuImportChoose');if(selected.cancelled)return;
  const plan=await api('menuImportPlan',{id:selected.id,catalog});
  if(snapshot!==menuImportSnapshot()||draftSnapshot!==JSON.stringify(draft))throw Error('MENU_IMPORT_CHANGED');
  s.file=selected;s.plan=plan;s.snapshot=snapshot;s.draftSnapshot=draftSnapshot;
 }catch(error){s.error=menuImportError(error.message);if(!error.message.startsWith('MENU_IMPORT_'))handleError(error);}
 finally{s.loading=false;if(menuUi.view==='import'&&menuUi.root?.isConnected)menuDrawProducts();}
}
async function menuImportSave(){
 const t=miText(),s=menuImportState;
 if(s.saving||!s.plan||s.plan.issues.length||!canMenuEdit())return;
 if(menuUi.formDirty||menuUi.categoryDirty){message(t.saveFirst);return;}
 if(s.snapshot!==menuImportSnapshot()||s.draftSnapshot!==JSON.stringify(draft)){message(t.changed);return;}
 if(!await confirmAction((lang==='ky'?'Импортту жергиликтүү долбоорго сактайсызбы? ':'Сохранить импорт в локальный черновик? ')+`${s.plan.summary.categories} / ${s.plan.summary.items} / ${s.plan.summary.variants}`))return;
 s.saving=true;menuDrawProducts();
 try{
  const latest=await api('menu');if(latest.revision!==menuState.baseRevision)throw Error('MENU_REVISION_CONFLICT');
  if(draft){const current=await api('draftGet',{id:draft.draftId});if(current.revision!==draft.draftRevision||current.baseRevision!==menuState.baseRevision)throw Error('DRAFT_CONFLICT');}
  const result=await api('draftSave',{draftId:draft?.draftId??null,draftRevision:draft?.draftRevision??0,baseRevision:menuState.baseRevision,catalog:s.plan.catalog});
  menuState={...s.plan.catalog,baseRevision:menuState.baseRevision};draft=result;dirty=false;
  try{menuUi.drafts=await api('drafts');}catch{}
  menuUi.category='all';menuUi.item=null;menuUi.form=null;menuUi.formDirty=false;menuUi.view='catalog';menuImportReset();menuDraw();message(t.saved);
 }catch(error){s.error=menuImportError(error.message);handleError(error);if(['MENU_REVISION_CONFLICT','DRAFT_CONFLICT'].includes(error.message))message(t.changed);}
 finally{s.saving=false;if(menuUi.view==='import'&&menuUi.root?.isConnected)menuDrawProducts();}
}
function menuImportDraw(panel){
 const t=miText(),s=menuImportState;
 panel.append(menuNode('h2',t.title),menuNode('p',t.hint,'muted'));
 const intro=menuNode('section',undefined,'menu-import-card');panel.append(intro);
 intro.append(menuNode('h3',lang==='ky'?'Файлдын үлгүсү':'Образец файла'),menuNode('p',t.required,'muted'));
 const wrap=menuNode('div',undefined,'menu-import-scroll'),table=menuNode('table',undefined,'menu-import-table'),head=menuNode('thead'),body=menuNode('tbody');
 const columns=[lang==='ky'?'Категория коду*':'Код категории*',lang==='ky'?'Категория RU*':'Категория RU*',lang==='ky'?'Товар коду*':'Код товара*',lang==='ky'?'Товар RU*':'Товар RU*',lang==='ky'?'Вариант RU':'Вариант RU',lang==='ky'?'Баасы, сом*':'Цена, сом*',lang==='ky'?'Жеткиликтүү':'Доступен',lang==='ky'?'Ашканага':'На кухню'];
 const tr=menuNode('tr');for(const column of columns)tr.append(menuNode('th',column));head.append(tr);
 for(const row of [['hot','Горячие блюда','plov','Плов','—','360','Да','Да'],['pizza','Пицца','pepperoni','Пепперони','25 см','490','Да','Да'],['pizza','Пицца','pepperoni','Пепперони','35 см','690','Да','Да'],['drinks','Напитки','lemonade','Лимонад','—','150,50','Да','Нет'],['salads','Салаты','seasonal_salad','Сезонный салат','—','280','Нет','Да']]){const line=menuNode('tr');for(const cell of row)line.append(menuNode('td',cell));body.append(line);}
 table.append(head,body);wrap.append(table);intro.append(wrap);
 intro.append(menuNode('p',lang==='ky'?'Жүктөлгөн файлда төрт үлгү товар бар. Өз менюңузду жүктөөдөн мурун аларды өчүрүңүз же алмаштырыңыз. Бирдей товар коду бир нече вариантты бириктирет; KY/EN котормолорун ошол тилдер менюда күйгүзүлгөндө гана толтуруңуз.':'В скачанном файле есть четыре товара-примера. Перед импортом своего меню удалите или замените их. Одинаковый код товара объединяет варианты; переводы KY/EN заполняйте только если эти языки включены в меню.','muted'));
 const actions=menuNode('div',undefined,'menu-import-actions');panel.append(actions);
 menuButton(actions,t.template,async()=>{try{const result=await api('menuImportTemplate');if(result.saved)message(lang==='ky'?'Үлгү сакталды':'Шаблон сохранён');}catch(error){handleError(error);}},'menu-add');
 if(canMenuEdit()){const choose=menuButton(actions,t.choose,menuImportChoose,'primary');choose.disabled=s.loading||s.saving;}
 else panel.append(menuNode('p',mt('readOnly'),'muted'));
 if(s.loading){panel.append(menuNode('p',mt('working'),'muted'));return;}
 if(s.error)panel.append(menuNode('p',s.error,'menu-field-error'));
 if(!s.file||!s.plan)return;
 const result=menuNode('section',undefined,'menu-import-card');panel.append(result);result.append(menuNode('h3',`${t.preview}: ${s.file.fileName}`));
 const x=s.plan.summary;result.append(menuNode('p',lang==='ky'?`${x.rows} сап · ${x.categories} категория · ${x.items} товар · ${x.variants} вариант`:`${x.rows} строк · ${x.categories} категорий · ${x.items} товаров · ${x.variants} вариантов`));
 if(s.plan.issues.length){result.append(menuNode('h4',`${t.issues}: ${s.plan.issues.length}`));const list=menuNode('ol',undefined,'menu-import-errors');for(const issue of s.plan.issues){const location=issue.row?`${lang==='ky'?'Сап':'Строка'} ${issue.row}: `:'';list.append(menuNode('li',location+issue.message));}result.append(list);}
 else {const list=menuNode('div',undefined,'menu-import-preview');for(const item of s.plan.sample)list.append(menuNode('div',`${item.category} · ${item.name} · ${cents(item.price)} ${mt('som')}`));result.append(list);const save=menuButton(result,t.confirm,menuImportSave,'primary');save.disabled=s.saving;}
}
