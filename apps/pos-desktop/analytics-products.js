'use strict';
const productAnalyticsState={preset:'today',from:'',to:'',request:0};
async function analyticsProductsView(){
 if(me?.role!=='OWNER'){screen='shift';await shiftView();return;}
 if(!productAnalyticsState.from)productPreset(productAnalyticsState.preset);
 const section=shell('Продажи блюд');section.classList.add('analytics-overview','analytics-products');section.querySelector('h1').before(analyticsNode('span','analytics-eyebrow','Аналитика'));
 section.insertAdjacentHTML('beforeend',`<div class="analytics-head"><span class="analytics-local" aria-live="polite">Загрузка локальных данных…</span><span class="analytics-sync" data-tone="pending" aria-live="polite">Проверка Cloud…</span></div>
 <div class="analytics-filters"><div class="analytics-branch"><small>Филиал</small><strong></strong></div><div class="analytics-period" role="group" aria-label="Период"><button type="button" data-period="today">Сегодня</button><button type="button" data-period="7days">7 дней</button><button type="button" data-period="30days">30 дней</button></div><div class="analytics-dates"><label>С <input type="date" data-date="from" aria-label="Дата с"></label><label>По <input type="date" data-date="to" aria-label="Дата по"></label></div></div>
 <div class="analytics-error" role="alert" hidden><span></span><button type="button">Повторить</button></div>
 <div class="analytics-kpis"><article class="analytics-card green"><span class="analytics-icon">♧</span><small>Продано единиц</small><strong data-product-units>—</strong><span>В оплаченных заказах за период</span></article></div>
 <article class="analytics-panel product-ranking"><h2>Топ-10 блюд</h2><p>Самые продаваемые блюда по количеству</p><div class="product-table-wrap"><table><thead><tr><th scope="col">№</th><th scope="col">Блюдо</th><th scope="col">Категория</th><th scope="col">Продано</th></tr></thead><tbody></tbody></table><p class="analytics-empty product-empty" hidden>Нет продаж блюд за выбранный период</p></div><p class="product-note">Оплаченные порции с учётом исправлений до оплаты. Возврат денег не удаляет блюдо из истории продаж.</p></article>`);
 section.querySelector('.analytics-branch strong').textContent=me.branchName??'Текущий филиал';
 const from=section.querySelector('[data-date="from"]'),to=section.querySelector('[data-date="to"]');from.value=productAnalyticsState.from;to.value=productAnalyticsState.to;
 const mark=()=>section.querySelectorAll('[data-period]').forEach(button=>{button.classList.toggle('active',button.dataset.period===productAnalyticsState.preset);button.setAttribute('aria-pressed',String(button.dataset.period===productAnalyticsState.preset));});mark();
 const load=async(silent=false)=>{const request=++productAnalyticsState.request,error=section.querySelector('.analytics-error');error.hidden=true;
  if(!productAnalyticsState.from||!productAnalyticsState.to||productAnalyticsState.from>productAnalyticsState.to||productAnalyticsState.to>analyticsAddDays(productAnalyticsState.from,365)){error.querySelector('span').textContent='Выберите период не длиннее 366 дней.';error.hidden=false;return;}
  if(!silent){section.querySelector('[data-product-units]').textContent='—';section.querySelector('tbody').replaceChildren();section.querySelector('.product-empty').hidden=true;}
  section.classList.add('is-loading');try{const data=await api('analyticsProducts',{from:productAnalyticsState.from,to:productAnalyticsState.to});if(request!==productAnalyticsState.request||!section.isConnected)return;
   section.querySelector('[data-product-units]').textContent=new Intl.NumberFormat('ru-RU').format(data.totalUnits);
   const body=section.querySelector('tbody');body.replaceChildren();data.topProducts.forEach((product,index)=>{const row=analyticsNode('tr');for(const [value,css] of [[String(index+1),'rank'],[product.name,'dish'],[product.category,'category'],[new Intl.NumberFormat('ru-RU').format(product.quantity),'quantity']])row.append(analyticsNode('td',css,value));body.append(row);});
   section.querySelector('.product-empty').hidden=data.topProducts.length>0;
   const sync=analyticsSyncLabel(data.cloudSync),badge=section.querySelector('.analytics-sync');badge.dataset.tone=sync.tone;badge.textContent=sync.text;badge.title=data.cloudSync?.lastError?`Последняя ошибка: ${data.cloudSync.lastError}`:sync.text;
   section.querySelector('.analytics-local').textContent='Локальные данные на '+new Date(data.generatedAt).toLocaleString('ru-RU',{timeZone:analyticsZone,dateStyle:'short',timeStyle:'short'});
  }catch(exception){if(request!==productAnalyticsState.request||!section.isConnected)return;error.querySelector('span').textContent=exception.message==='SERVER_UNAVAILABLE'?'Нет связи с Local POS Server. Повторите загрузку.':'Не удалось загрузить продажи блюд. Код: '+exception.message;error.hidden=false;}finally{if(request===productAnalyticsState.request&&section.isConnected)section.classList.remove('is-loading');}};
 section.querySelectorAll('[data-period]').forEach(button=>button.onclick=()=>{productAnalyticsState.preset=button.dataset.period;productPreset(productAnalyticsState.preset);from.value=productAnalyticsState.from;to.value=productAnalyticsState.to;mark();void load();});
 for(const input of [from,to])input.onchange=()=>{productAnalyticsState.preset='custom';productAnalyticsState.from=from.value;productAnalyticsState.to=to.value;mark();void load();};
 section.querySelector('.analytics-error button').onclick=()=>void load();await load();const timer=setInterval(()=>{if(!section.isConnected){clearInterval(timer);return;}void load(true);},30000);
}
function productPreset(preset){const today=analyticsDate();productAnalyticsState.to=today;productAnalyticsState.from=analyticsAddDays(today,preset==='7days'?-6:preset==='30days'?-29:0);}
