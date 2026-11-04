'use strict';

function initTableConfigUi(ru,ky){
Object.assign(ru,{tableConfig:'Столы и зоны',tableConfigHint:'Создавайте зоны и управляйте столами ресторана.',tableConfigZones:'Зоны',tableConfigTables:'Столы в зоне',tableConfigAddZone:'+ Добавить зону',tableConfigAddTable:'+ Добавить стол',tableConfigSearch:'Поиск стола…',tableConfigCards:'Карточки',tableConfigMap:'SVG карта',tableConfigMapLater:'План зала появится после настройки карты.',tableConfigEmptyZones:'Сначала добавьте зону.',tableConfigEmptyTables:'В этой зоне пока нет столов.',tableConfigNoResults:'Столы не найдены.',tableConfigInactive:'Неактивные',tableConfigDeactivate:'Убрать из работы',tableConfigActivate:'Вернуть в работу',tableConfigMove:'Перенести в зону',tableConfigEditZone:'Изменить зону',tableConfigEditTable:'Изменить стол',tableConfigZoneCount:'столов',tableConfigDeleteZone:'Зона останется в истории и исчезнет из рабочего зала. Продолжить?',tableConfigDeleteTable:'Стол останется в истории и исчезнет из рабочего зала. Продолжить?',tableConfigNeedsTables:'Сначала уберите из работы все столы этой зоны.',tableConfigOccupied:'Занятый стол нельзя изменить. Сначала завершите его посещение.',tableConfigRestoreZone:'Сначала восстановите зону.',tableConfigSaved:'Изменения сохранены.',tableConfigShowInactive:'Показать неактивные',tableConfigHideInactive:'Скрыть неактивные',tableConfigCancel:'Отмена',tableName:'Стол № / название',tablePublicPath:'Путь стола',tablePublicPending:'Публичный сайт ещё не подключён'});
Object.assign(ky,{tableConfig:'Столдор жана зоналар',tableConfigHint:'Ресторандын зоналарын жана столдорун башкарыңыз.',tableConfigZones:'Зоналар',tableConfigTables:'Зонадагы столдор',tableConfigAddZone:'+ Зона кошуу',tableConfigAddTable:'+ Стол кошуу',tableConfigSearch:'Столду издөө…',tableConfigCards:'Карточкалар',tableConfigMap:'SVG карта',tableConfigMapLater:'Залдын планы карта орнотулганда пайда болот.',tableConfigEmptyZones:'Алгач зона кошуңуз.',tableConfigEmptyTables:'Бул зонада азырынча стол жок.',tableConfigNoResults:'Стол табылган жок.',tableConfigInactive:'Активдүү эмес',tableConfigDeactivate:'Иштен чыгаруу',tableConfigActivate:'Ишке кайтаруу',tableConfigMove:'Зонага өткөрүү',tableConfigEditZone:'Зонаны өзгөртүү',tableConfigEditTable:'Столду өзгөртүү',tableConfigZoneCount:'стол',tableConfigDeleteZone:'Зона тарыхта калат жана иш залынан жашырылат. Улантасызбы?',tableConfigDeleteTable:'Стол тарыхта калат жана иш залынан жашырылат. Улантасызбы?',tableConfigNeedsTables:'Адегенде бул зонадагы бардык столдорду иштен чыгарыңыз.',tableConfigOccupied:'Бош эмес столду өзгөртүү мүмкүн эмес. Адегенде барууну бүтүрүңүз.',tableConfigRestoreZone:'Адегенде зонаны ишке кайтарыңыз.',tableConfigSaved:'Өзгөртүүлөр сакталды.',tableConfigShowInactive:'Активдүү эмес жазуулар',tableConfigHideInactive:'Жашыруу',tableConfigCancel:'Жокко чыгаруу',tablePublicPath:'Столдун жолу',tablePublicPending:'Жалпыга ачык сайт азырынча туташкан жок'});
Object.assign(ru,{tablePublicUrl:'Публичная ссылка стола',tablePublicReady:'Ссылка открывает меню филиала. Заказы гостя пока недоступны.',tablePublicSyncWait:'Ожидается синхронизация стола с Cloud.',tablePublicVerify:'Проверяем публикацию в Cloud в фоне.',tablePublicMenuOff:'Владелец ещё не включил меню на сайте.',tablePublicCloudOff:'Не удалось проверить публикацию в Cloud.',tablePublicInactive:'Неактивный стол не открывается на сайте.',tablePublicQr:'QR-код стола',tablePublicQrLoading:'Готовим QR…',tablePublicQrFailed:'QR недоступен',tablePublicDownloadQr:'Скачать QR',tablePublicCopy:'Скопировать ссылку',tablePublicCopied:'Ссылка скопирована.'});
Object.assign(ky,{tablePublicUrl:'Столдун жалпыга ачык шилтемеси',tablePublicReady:'Шилтеме филиалдын менюсун ачат. Коноктун буйрутмасы азырынча жеткиликсиз.',tablePublicSyncWait:'Стол Cloud менен шайкештирилүүдө.',tablePublicVerify:'Cloud ичиндеги жарыялоо фондо текшерилүүдө.',tablePublicMenuOff:'Ээси сайттагы менюну азырынча күйгүзө элек.',tablePublicCloudOff:'Cloud ичиндеги жарыялоо текшерилген жок.',tablePublicInactive:'Активдүү эмес стол сайтта ачылбайт.',tablePublicQr:'Столдун QR-коду',tablePublicQrLoading:'QR даярдалууда…',tablePublicQrFailed:'QR жеткиликсиз',tablePublicDownloadQr:'QR жүктөп алуу',tablePublicCopy:'Шилтемени көчүрүү',tablePublicCopied:'Шилтеме көчүрүлдү.'});
}

let tableConfigZoneId=null,tableConfigShowInactive=false,tableConfigSearch='',tableConfigMode='cards';
const tableConfigQrCache=new Map(),tableConfigQrLoading=new Set();

function tableConfigCount(count){if(lang==='ky')return count+' '+t('tableConfigZoneCount');const mod10=count%10,mod100=count%100,word=mod100>=11&&mod100<=14?'столов':mod10===1?'стол':mod10>=2&&mod10<=4?'стола':'столов';return count+' '+word;}
function tableConfigAction(parent,label,fn,primary=false){const action=el('button',label,{type:'button',className:primary?'primary':''});action.onclick=()=>run(fn,action);parent.append(action);return action;}
function tableConfigQrFilename(zoneName,tableName){
 const part=(value,fallback)=>[...String(value??'').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,' ').trim().replace(/\s+/g,'-').replace(/^[.-]+|[.-]+$/g,'')].slice(0,64).join('').replace(/[.-]+$/g,'')||fallback;
 return 'QR_'+part(zoneName,'zone')+'_'+part(tableName,'table')+'.png';
}
function tableConfigQrStatus(link){return t({PENDING_SYNC:'tablePublicSyncWait',PENDING_VERIFY:'tablePublicVerify',MENU_NOT_PUBLISHED:'tablePublicMenuOff',CLOUD_UNAVAILABLE:'tablePublicCloudOff',INACTIVE:'tablePublicInactive'}[link?.publicLinkStatus]??'tablePublicPending');}
function tableConfigPaintQr(grid,url,qrDataUrl){
 const target=grid.isConnected?grid:document.querySelector('.table-config-grid');
 if(screen!=='tableConfig'||!target?.isConnected)return;
 for(const card of target.querySelectorAll('.table-config-card[data-qr-url]')){
  if(card.dataset.qrUrl!==url)continue;
  const slot=card.querySelector('.table-config-card-qr');slot.replaceChildren();
  card.querySelector('.table-config-download')?.remove();
  if(!qrDataUrl){slot.append(el('span',t('tablePublicQrFailed')));continue;}
  slot.append(el('img',undefined,{src:qrDataUrl,alt:t('tablePublicQr')+' · '+card.dataset.tableName}));
  card.append(el('a',t('tablePublicDownloadQr'),{className:'table-config-download',href:qrDataUrl,download:card.dataset.qrFilename}));
 }
}
async function tableConfigLoadQr(grid,requests){
 for(let offset=0;offset<requests.length;offset+=24){
  const batch=requests.slice(offset,offset+24);
  try{
   const rows=await api('tablePublicQrBatch',{tableIds:batch.map(row=>row.id)});
   for(const requested of batch){
    const result=rows.find(row=>row.tableId===requested.id&&row.publicUrl===requested.url);
    if(result?.qrDataUrl){if(tableConfigQrCache.size>=200)tableConfigQrCache.delete(tableConfigQrCache.keys().next().value);tableConfigQrCache.set(requested.url,result.qrDataUrl);}
    tableConfigPaintQr(grid,requested.url,result?.qrDataUrl??null);
   }
  }catch{for(const requested of batch)tableConfigPaintQr(grid,requested.url,null);}
  finally{for(const requested of batch)tableConfigQrLoading.delete(requested.url);}
 }
}

async function tableConfigView(refreshLinks=true){
 me=await api('me');if(!me.permissions.includes('table.view_status')||!me.permissions.includes('table.manage'))throw new Error('PERMISSION_DENIED');
 const [data,publicLinks,cloudStatus]=await Promise.all([api('tables'),serverSchema>=21?api('tablePublicLinks'):Promise.resolve([]),serverSchema>=22?api('tableCloudSyncStatus').catch(()=>null):Promise.resolve(null)]);data.publicLinks=Object.fromEntries(publicLinks.map(link=>[link.tableId,link]));const zones=data.zones.filter(zone=>tableConfigShowInactive||zone.active);
 if(!zones.some(zone=>zone.id===tableConfigZoneId))tableConfigZoneId=zones[0]?.id??null;
 const selected=data.zones.find(zone=>zone.id===tableConfigZoneId),root=shell(t('tableConfig'));root.classList.add('table-config');root.querySelector('h1').remove();
 if(refreshLinks&&serverSchema>=22&&publicLinks.some(link=>link.publicLinkStatus==='PENDING_VERIFY'||link.publicLinkStatus==='CLOUD_UNAVAILABLE'))void api('tablePublicLinksRefresh').then(links=>{if(screen!=='tableConfig'||!root.isConnected)return;data.publicLinks=Object.fromEntries(links.map(link=>[link.tableId,link]));if(!tableEditing&&!document.querySelector('.table-config-dialog[open]'))void tableConfigView(false);}).catch(()=>{});
 const heading=el('header',undefined,{className:'table-config-heading'}),titles=el('div'),views=el('div',undefined,{className:'table-config-views'});
 titles.append(el('h1',t('tableConfig')),el('p',t('tableConfigHint')));if(cloudStatus?.enabled){const cloudText=cloudStatus.state==='SYNCED'?(lang==='ky'?'Cloud: шайкештирилди':'Cloud: синхронизировано'):cloudStatus.state==='PENDING'?(lang==='ky'?'Cloud: жөнөтүлүүдө':'Cloud: ожидает отправки'):(lang==='ky'?'Cloud: байланыш жок':'Cloud: нет синхронизации');titles.append(el('small',cloudText+' · '+cloudStatus.acknowledgedRevision+'/'+cloudStatus.revision));}const cards=el('button',t('tableConfigCards'),{type:'button',className:tableConfigMode==='cards'?'selected':''});cards.setAttribute('aria-pressed',String(tableConfigMode==='cards'));const map=el('button',t('tableConfigMap'),{type:'button',className:tableConfigMode==='map'?'selected':''});map.setAttribute('aria-pressed',String(tableConfigMode==='map'));cards.onclick=()=>run(async()=>{if(tableConfigMode==='cards')return;if(tableEditing&&!await confirmAction(t('tableDiscard')))return;tableEditing=false;tableConfigMode='cards';await tableConfigView();},cards);map.onclick=()=>run(async()=>{if(tableConfigMode==='map')return;tableConfigMode='map';await tableConfigView();},map);views.append(cards,map);heading.append(titles,views);root.append(heading);
 if(tableConfigMode==='map'){await tableMapView(root,data);return;}
 const body=el('div',undefined,{className:'table-config-body'}),left=el('section',undefined,{className:'table-config-zones'}),right=el('section',undefined,{className:'table-config-tables'});root.append(body);body.append(left,right);
 const zoneHead=el('div',undefined,{className:'table-config-panel-head'});zoneHead.append(el('h2',t('tableConfigZones')));tableConfigAction(zoneHead,t('tableConfigAddZone'),()=>tableConfigForm('zone',null,data),true);left.append(zoneHead);
 if(!zones.length)left.append(el('p',t('tableConfigEmptyZones'),{className:'table-config-empty'}));
 for(const zone of zones){
  const row=el('div',undefined,{className:'table-config-zone'+(zone.id===tableConfigZoneId?' selected':'')+(zone.active?'':' inactive')}),pick=el('button',undefined,{type:'button',className:'table-config-zone-pick'}),dot=el('span','',{className:'table-config-dot'}),name=el('span');const count=data.tables.filter(table=>table.zoneId===zone.id&&table.active).length;
  name.append(el('strong',zone.name),el('small',tableConfigCount(count)+(zone.active?'':' · '+t('tableConfigInactive'))));pick.append(dot,name);pick.setAttribute('aria-pressed',String(zone.id===tableConfigZoneId));pick.onclick=()=>{tableConfigZoneId=zone.id;tableConfigSearch='';run(tableConfigView);};
  const edit=tableConfigAction(row,'⋯',()=>tableConfigForm('zone',zone,data));edit.classList.add('table-config-more');edit.setAttribute('aria-label',t('tableConfigEditZone')+' '+zone.name);row.prepend(pick);left.append(row);
 }
 const inactive=tableConfigAction(left,t(tableConfigShowInactive?'tableConfigHideInactive':'tableConfigShowInactive'),()=>{tableConfigShowInactive=!tableConfigShowInactive;return tableConfigView();});inactive.classList.add('table-config-inactive-toggle');
 const tableHead=el('div',undefined,{className:'table-config-panel-head'}),tableTitle=el('h2',selected?t('tableConfigTables')+' «'+selected.name+'»':t('tableConfigTables'));tableHead.append(tableTitle);if(selected?.active)tableConfigAction(tableHead,t('tableConfigAddTable'),()=>tableConfigForm('table',null,data),true);right.append(tableHead);
 const toolbar=el('div',undefined,{className:'table-config-toolbar'}),search=el('input',undefined,{type:'search',value:tableConfigSearch,placeholder:t('tableConfigSearch')});search.setAttribute('aria-label',t('tableConfigSearch'));toolbar.append(search);right.append(toolbar);
 const grid=el('div',undefined,{className:'table-config-grid'});right.append(grid);
 function drawTables(){grid.replaceChildren();if(!selected){grid.append(el('p',t('tableConfigEmptyZones'),{className:'table-config-empty'}));return;}const all=data.tables.filter(table=>table.zoneId===selected.id&&(tableConfigShowInactive||table.active)),shown=all.filter(table=>table.name.toLocaleLowerCase().includes(tableConfigSearch.trim().toLocaleLowerCase()));if(!shown.length){grid.append(el('p',t(all.length?'tableConfigNoResults':'tableConfigEmptyTables'),{className:'table-config-empty'}));return;}
  const requests=[];
  for(const table of shown){
   const card=el('article',undefined,{className:'table-config-card'+(table.active?'':' inactive')}),title=el('strong',table.name),status=el('small',table.active?t(table.state==='OCCUPIED'?'tableOccupied':'tableFree'):t('tableConfigInactive')),link=data.publicLinks?.[table.id],ready=link?.publicLinkStatus==='READY'&&!!link.publicUrl,qr=el('div',undefined,{className:'table-config-card-qr'});
   const more=tableConfigAction(card,'⋯',()=>tableConfigForm('table',table,data));more.classList.add('table-config-card-more');more.setAttribute('aria-label',t('tableConfigEditTable')+' '+table.name);
   if(ready){card.dataset.qrUrl=link.publicUrl;card.dataset.qrFilename=tableConfigQrFilename(selected.name,table.name);card.dataset.tableName=table.name;qr.append(el('span',t('tablePublicQrLoading')));if(!tableConfigQrCache.has(link.publicUrl)&&!tableConfigQrLoading.has(link.publicUrl)){tableConfigQrLoading.add(link.publicUrl);requests.push({id:table.id,url:link.publicUrl});}}
   else qr.append(el('span',tableConfigQrStatus(link)));
   card.prepend(qr,title,status);grid.append(card);
   if(ready&&tableConfigQrCache.has(link.publicUrl))tableConfigPaintQr(grid,link.publicUrl,tableConfigQrCache.get(link.publicUrl));
  }
  if(requests.length)void tableConfigLoadQr(grid,requests);
 }
 search.oninput=()=>{tableConfigSearch=search.value;drawTables();};drawTables();
}

function tableConfigNextNumber(tables){
 const used=new Set(tables.map(table=>table.name.trim()));let highest=0;
 for(const name of used){if(!/^\d+$/.test(name))continue;const number=Number(name);if(Number.isSafeInteger(number)&&number<Number.MAX_SAFE_INTEGER)highest=Math.max(highest,number);}
 let next=highest+1;while(used.has(String(next)))next++;
 return String(next);
}
function tableConfigForm(kind,record,data){
 const isZone=kind==='zone',dialog=el('dialog',undefined,{className:'table-config-dialog'}),form=el('form'),title=t(record?(isZone?'tableConfigEditZone':'tableConfigEditTable'):(isZone?'tableConfigAddZone':'tableConfigAddTable'));
 dialog.append(el('h2',title),form);const name=field(form,isZone?'zoneName':'tableName',record?.name??(isZone?'':tableConfigNextNumber(data.tables)));name.maxLength=200;name.autocomplete='off';let dirty=false;const mark=()=>{dirty=true;tableEditing=true;};name.oninput=mark;
 let zoneSelect;if(!isZone){const label=el('label',t('zone'));zoneSelect=el('select',undefined,{required:true});for(const zone of data.zones.filter(zone=>zone.active||zone.id===record?.zoneId))zoneSelect.append(el('option',zone.name,{value:zone.id,selected:zone.id===(record?.zoneId??tableConfigZoneId)}));zoneSelect.onchange=mark;label.append(zoneSelect);form.append(label);if(record){const link=data.publicLinks?.[record.id];if(link){
  const ready=!!link.publicUrl,pathLabel=el('label',t(ready?'tablePublicUrl':'tablePublicPath')),path=el('input',undefined,{type:'text',value:link.publicUrl??link.publicPath,readOnly:true});path.setAttribute('aria-label',t(ready?'tablePublicUrl':'tablePublicPath'));path.onclick=()=>path.select();
  const detail={READY:'tablePublicReady',PENDING_SYNC:'tablePublicSyncWait',PENDING_VERIFY:'tablePublicVerify',MENU_NOT_PUBLISHED:'tablePublicMenuOff',CLOUD_UNAVAILABLE:'tablePublicCloudOff',INACTIVE:'tablePublicInactive'}[link.publicLinkStatus]??'tablePublicPending';pathLabel.append(path,el('small',t(detail)));form.append(pathLabel);
  if(ready){const block=el('div',undefined,{className:'table-public-qr'});block.append(el('strong',t('tablePublicQr')));const actions=el('div',undefined,{className:'table-public-qr-actions'});tableConfigAction(actions,t('tablePublicCopy'),async()=>{await api('tableCopyUrl',{tableId:record.id});message(t('tablePublicCopied'));});block.append(actions);form.append(block);
   void api('tablePublicQr',{tableId:record.id}).then(result=>{if(!dialog.open||!result.qrDataUrl)return;const img=el('img',undefined,{src:result.qrDataUrl,alt:t('tablePublicQr')});block.insertBefore(img,actions);actions.append(el('a',t('tablePublicDownloadQr'),{href:result.qrDataUrl,download:tableConfigQrFilename(data.zones.find(zone=>zone.id===record.zoneId)?.name,record.name)}));}).catch(()=>{});
  }
 }}}
 const actions=el('div',undefined,{className:'table-config-dialog-actions'});form.append(actions);
 const close=()=>{tableEditing=false;dialog.close();};tableConfigAction(actions,t('tableConfigCancel'),async()=>{if(dirty&&!await confirmAction(t('tableDiscard')))return;close();});
 if(record){const toggle=tableConfigAction(actions,t(record.active?'tableConfigDeactivate':'tableConfigActivate'),async()=>{
   if(record.active&&isZone&&data.tables.some(table=>table.zoneId===record.id&&table.active))throw new Error(t('tableConfigNeedsTables'));
   if(!isZone&&record.state==='OCCUPIED')throw new Error(t('tableConfigOccupied'));
   if(!record.active&&!isZone&&!data.zones.some(zone=>zone.id===zoneSelect.value&&zone.active))throw new Error(t('tableConfigRestoreZone'));
   if(record.active&&!await confirmAction(t(isZone?'tableConfigDeleteZone':'tableConfigDeleteTable')))return;
   await api(isZone?'zoneSave':'tableSave',isZone?{zoneId:record.id,revision:record.revision,name:record.name,active:!record.active}:{tableId:record.id,zoneId:record.zoneId,revision:record.revision,name:record.name,active:!record.active});close();await tableConfigView();message(t('tableConfigSaved'));
  });toggle.classList.add('table-config-toggle');}
 const save=el('button',t(isZone?'saveZone':'saveTable'),{type:'submit',className:'primary'});actions.append(save);if(record&&!isZone&&record.state==='OCCUPIED'){save.disabled=true;save.title=t('tableConfigOccupied');}
 form.onsubmit=event=>{event.preventDefault();run(async()=>{
  const payload=isZone?{zoneId:record?.id??null,revision:record?.revision??0,name:name.value,active:record?.active??true}:{tableId:record?.id??null,zoneId:zoneSelect.value,revision:record?.revision??0,name:name.value,active:record?.active??true};
  await api(isZone?'zoneSave':'tableSave',payload);close();await tableConfigView();message(t('tableConfigSaved'));
 },save);};
 dialog.oncancel=event=>{if(!dirty)return;event.preventDefault();void confirmAction(t('tableDiscard')).then(accepted=>{if(accepted)close();});};
 dialog.onclose=()=>{tableEditing=false;dialog.remove();};document.body.append(dialog);dialog.showModal();name.focus();
}
