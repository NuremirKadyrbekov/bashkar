'use strict';
const analyticsState={preset:'today',from:'',to:'',request:0};
const analyticsZone='Asia/Bishkek';
function analyticsDate(date=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:analyticsZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
function analyticsAddDays(day,offset){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}
function analyticsPreset(preset){const today=analyticsDate();if(preset==='yesterday'){analyticsState.from=analyticsState.to=analyticsAddDays(today,-1);}else{analyticsState.to=today;analyticsState.from=analyticsAddDays(today,preset==='7days'?-6:preset==='30days'?-29:0);}}
function analyticsMoney(value){const minor=BigInt(value??'0'),sign=minor<0n?'-':'',absolute=minor<0n?-minor:minor;return sign+new Intl.NumberFormat('ru-RU').format(absolute/100n)+(absolute%100n?','+String(absolute%100n).padStart(2,'0'):'')+' сом';}
function analyticsPercent(value,total){const sum=BigInt(total);return sum===0n?'0%':(Number((BigInt(value)*1000n+sum/2n)/sum)/10).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%';}
function analyticsSyncLabel(sync){
 if(!sync?.enabled)return {tone:'off',text:'Синхронизация с Cloud не настроена'};
 if(sync.pendingFacts>0&&sync.lastError)return {tone:'error',text:`Cloud отстаёт · ${sync.pendingFacts} операций ожидают отправки`};
 if(sync.pendingFacts>0)return {tone:'pending',text:`Новые данные для Cloud · ${sync.pendingFacts} операций`};
 if(!sync.lastSuccessAt)return {tone:'pending',text:'Первая синхронизация с Cloud ещё не подтверждена'};
 const time=new Date(sync.lastSuccessAt).toLocaleString('ru-RU',{timeZone:analyticsZone,dateStyle:'short',timeStyle:'short'});
 return {tone:sync.lastError?'pending':'current',text:sync.lastError?`Данные переданы · связь не проверена с ${time}`:`Cloud актуален · подтверждено ${time}`};
}
function analyticsNode(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function analyticsPlot(container,points){
 container.replaceChildren();const maximum=points.reduce((max,point)=>BigInt(point.amount)>max?BigInt(point.amount):max,0n);
 if(maximum===0n){container.append(analyticsNode('p','analytics-empty','Нет оплат за период'));return;}
 const ns='http://www.w3.org/2000/svg',make=(tag,attributes={},content)=>{const node=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,String(value));if(content!==undefined)node.textContent=content;return node;};
 const width=720,height=270,left=54,right=18,top=16,bottom=37,base=height-bottom,plotHeight=base-top,plotWidth=width-left-right;
 const svg=make('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':'Динамика зарегистрированных оплат'});
 const defs=make('defs'),gradient=make('linearGradient',{id:'pos-analytics-area',x1:'0',y1:'0',x2:'0',y2:'1'});gradient.append(make('stop',{offset:'0%','stop-color':'#00a98b','stop-opacity':'.26'}),make('stop',{offset:'100%','stop-color':'#00a98b','stop-opacity':'0'}));defs.append(gradient);svg.append(defs);
 for(let tick=0;tick<=4;tick++){const y=base-tick*plotHeight/4;svg.append(make('line',{x1:left,x2:width-right,y1:y,y2:y,class:'analytics-grid'}));svg.append(make('text',{x:left-8,y:y+4,'text-anchor':'end',class:'analytics-axis'},new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}).format(Number(maximum*BigInt(tick)/400n))));}
 const coordinates=points.map((point,index)=>({x:left+(points.length===1?plotWidth/2:index*plotWidth/(points.length-1)),y:base-Number(BigInt(point.amount)*1000000n/maximum)/1000000*plotHeight}));
 const line=coordinates.map((point,index)=>`${index?'L':'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');svg.append(make('path',{d:`${line} L${coordinates.at(-1).x.toFixed(2)},${base} L${coordinates[0].x.toFixed(2)},${base} Z`,class:'analytics-area'}),make('path',{d:line,class:'analytics-line'}));
 const step=Math.max(1,Math.ceil(points.length/9));coordinates.forEach((point,index)=>{const label=points[index].period.includes('T')?points[index].period.slice(-2)+':00':points[index].period.slice(5);if(index%step===0||index===points.length-1)svg.append(make('text',{x:point.x,y:height-8,'text-anchor':'middle',class:'analytics-axis'},label));const dot=make('circle',{cx:point.x,cy:point.y,r:3.8,class:'analytics-dot',tabindex:'0','aria-label':`${label}: ${analyticsMoney(points[index].amount)}`});dot.append(make('title',{},`${label} · ${analyticsMoney(points[index].amount)}`));svg.append(dot);});
 container.append(svg);
}
function analyticsPayments(root,methods){
 const entries=[['CASH','Наличные','#12b981'],['CARD_MANUAL','Карта','#45a4cb'],['QR_TRANSFER_MANUAL','QR-перевод','#009b91']],total=entries.reduce((sum,[key])=>sum+BigInt(methods[key]??0),0n),donut=root.querySelector('.analytics-donut'),legend=root.querySelector('.analytics-legend');legend.replaceChildren();
 if(total===0n){donut.style.background='#edf4f3';donut.querySelector('strong').textContent='0 сом';donut.querySelector('small').textContent='Нет оплат';}
 else{let cumulative=0n;const stops=entries.map(([key,,color])=>{const start=Number(cumulative*1000n/total)/10;cumulative+=BigInt(methods[key]??0);return `${color} ${start}% ${Number(cumulative*1000n/total)/10}%`;});donut.style.background=`conic-gradient(${stops.join(',')})`;donut.querySelector('strong').textContent=analyticsMoney(total);donut.querySelector('small').textContent='Оплаты';}
 for(const [key,name,color]of entries){const row=analyticsNode('div','analytics-legend-row'),mark=analyticsNode('i','analytics-legend-mark'),label=analyticsNode('span','',name),amount=analyticsNode('strong','',analyticsMoney(methods[key])),share=analyticsNode('small','',analyticsPercent(methods[key]??'0',total));mark.style.background=color;row.append(mark,label,amount,share);legend.append(row);}
}
function analyticsRender(data){
 const root=document.querySelector('.analytics-overview');if(!root)return;
 const values={net:data.netReceiptsAmount,orders:String(data.paidOrdersCount),average:data.averageCheckAmount,refunds:data.refundsAmount};
 for(const [key,value]of Object.entries(values))root.querySelector(`[data-analytics-value="${key}"]`).textContent=key==='orders'?new Intl.NumberFormat('ru-RU').format(Number(value)):analyticsMoney(value);
 root.querySelector('[data-analytics-extra="discounts"]').textContent=analyticsMoney(data.discountsAmount);
 root.querySelector('[data-analytics-extra="cancelled"]').textContent=String(data.cancelledOrdersCount);
 root.querySelector('.analytics-granularity').textContent=data.range.granularity==='hour'?'Сумма оплат по часам':'Сумма оплат по дням';
 analyticsPlot(root.querySelector('.analytics-plot'),data.dynamics);analyticsPayments(root,data.paymentMethods);
 for(const [key,selector]of [['TABLE','hall'],['COUNTER','takeaway']]){const item=data.serviceTypes[key],card=root.querySelector(`[data-analytics-service="${selector}"]`);card.querySelector('strong').textContent=analyticsMoney(item.amount);card.querySelector('small').textContent=`${item.paidOrdersCount} заказов · ${analyticsPercent(item.amount,data.grossPaymentsAmount)} от оплат`;}
 const sync=analyticsSyncLabel(data.cloudSync),badge=root.querySelector('.analytics-sync');badge.dataset.tone=sync.tone;badge.textContent=sync.text;badge.title=data.cloudSync?.lastError?`Последняя ошибка: ${data.cloudSync.lastError}`:sync.text;
 root.querySelector('.analytics-local').textContent='Локальные данные на '+new Date(data.generatedAt).toLocaleString('ru-RU',{timeZone:analyticsZone,dateStyle:'short',timeStyle:'short'});
}
async function analyticsOverviewView(){
 if(me?.role!=='OWNER'){screen='shift';await shiftView();return;}
 if(!analyticsState.from)analyticsPreset(analyticsState.preset);
 const section=shell('Обзор');section.classList.add('analytics-overview');section.querySelector('h1').before(analyticsNode('span','analytics-eyebrow','Аналитика'));
 section.insertAdjacentHTML('beforeend',`<div class="analytics-head"><span class="analytics-local" aria-live="polite">Загрузка локальных данных…</span><span class="analytics-sync" data-tone="pending" aria-live="polite">Проверка Cloud…</span></div>
 <div class="analytics-filters"><div class="analytics-branch"><small>Филиал</small><strong></strong></div><div class="analytics-period" role="group" aria-label="Период"><button type="button" data-period="today">Сегодня</button><button type="button" data-period="yesterday">Вчера</button><button type="button" data-period="7days">7 дней</button><button type="button" data-period="30days">30 дней</button></div><div class="analytics-dates"><label>С <input type="date" data-date="from" aria-label="Дата с"></label><label>По <input type="date" data-date="to" aria-label="Дата по"></label></div></div>
 <div class="analytics-error" role="alert" hidden><span></span><button type="button">Повторить</button></div>
 <div class="analytics-kpis"><article class="analytics-card green"><span class="analytics-icon">▣</span><small>Поступления после возвратов</small><strong data-analytics-value="net">—</strong><span>Оплаты за вычетом возвратов</span></article><article class="analytics-card mint"><span class="analytics-icon">▤</span><small>Оплаченные заказы</small><strong data-analytics-value="orders">—</strong><span>С денежным расчётом</span></article><article class="analytics-card blue"><span class="analytics-icon">▦</span><small>Средний чек</small><strong data-analytics-value="average">—</strong><span>По оплаченным заказам</span></article><article class="analytics-card rose"><span class="analytics-icon">↶</span><small>Возвраты</small><strong data-analytics-value="refunds">—</strong><span>По дате регистрации</span></article></div>
 <div class="analytics-main-grid"><article class="analytics-panel"><h2>Динамика продаж</h2><p class="analytics-granularity">Сумма зарегистрированных оплат</p><div class="analytics-plot" aria-busy="true"></div></article><article class="analytics-panel"><h2>Способы оплаты</h2><p>Распределение зарегистрированных оплат</p><div class="analytics-payment-layout"><div class="analytics-donut"><div><strong>—</strong><small>Оплаты</small></div></div><div class="analytics-legend"></div></div></article></div>
 <div class="analytics-bottom-grid"><article class="analytics-panel"><h2>Тип обслуживания</h2><div class="analytics-service-grid"><div data-analytics-service="hall"><span>В зале</span><strong>—</strong><small>Оплаченные заказы</small></div><div data-analytics-service="takeaway"><span>На вынос</span><strong>—</strong><small>Оплаченные заказы</small></div></div></article><article class="analytics-panel analytics-extra"><h2>Дополнительно за период</h2><div><span>Скидки</span><strong data-analytics-extra="discounts">—</strong></div><div><span>Отменённые заказы</span><strong data-analytics-extra="cancelled">—</strong></div></article></div>`);
 section.querySelector('.analytics-branch strong').textContent=me.branchName??'Текущий филиал';
 const from=section.querySelector('[data-date="from"]'),to=section.querySelector('[data-date="to"]');from.value=analyticsState.from;to.value=analyticsState.to;
 const mark=()=>section.querySelectorAll('[data-period]').forEach(button=>{button.classList.toggle('active',button.dataset.period===analyticsState.preset);button.setAttribute('aria-pressed',String(button.dataset.period===analyticsState.preset));});mark();
 const load=async(silent=false)=>{const number=++analyticsState.request;const error=section.querySelector('.analytics-error');error.hidden=true;if(!analyticsState.from||!analyticsState.to||analyticsState.from>analyticsState.to||analyticsState.to>analyticsAddDays(analyticsState.from,365)){error.querySelector('span').textContent='Выберите период не длиннее 366 дней.';error.hidden=false;return;}if(!silent){for(const value of section.querySelectorAll('[data-analytics-value],[data-analytics-extra],.analytics-service-grid strong'))value.textContent='—';section.querySelector('.analytics-plot').replaceChildren(analyticsNode('p','analytics-empty','Загрузка…'));section.querySelector('.analytics-donut strong').textContent='—';section.querySelector('.analytics-legend').replaceChildren();}section.classList.add('is-loading');section.querySelector('.analytics-plot').setAttribute('aria-busy','true');try{const data=await api('analyticsOverview',{from:analyticsState.from,to:analyticsState.to});if(number!==analyticsState.request||!section.isConnected)return;analyticsRender(data);}catch(exception){if(number!==analyticsState.request||!section.isConnected)return;error.querySelector('span').textContent=exception.message==='SERVER_UNAVAILABLE'?'Нет связи с Local POS Server. Повторите загрузку.':'Не удалось загрузить аналитику. Код: '+exception.message;error.hidden=false;}finally{if(number===analyticsState.request&&section.isConnected){section.classList.remove('is-loading');section.querySelector('.analytics-plot').setAttribute('aria-busy','false');}}};
 section.querySelectorAll('[data-period]').forEach(button=>button.onclick=()=>{analyticsState.preset=button.dataset.period;analyticsPreset(analyticsState.preset);from.value=analyticsState.from;to.value=analyticsState.to;mark();void load();});
 for(const input of [from,to])input.onchange=()=>{analyticsState.preset='custom';analyticsState.from=from.value;analyticsState.to=to.value;mark();void load();};
 section.querySelector('.analytics-error button').onclick=()=>void load();await load();const timer=setInterval(()=>{if(!section.isConnected){clearInterval(timer);return;}void load(true);},30000);
}
