'use strict';
const words = { ru: { login: 'Вход по PIN', enter: 'Войти', tables: 'Столы', refresh: 'Обновить', back: 'Назад', logout: 'Выйти', free: 'Свободен', busy: 'Занят', mine: 'Мой стол', open: 'Открыть стол', menu: 'Меню', cart: 'Новая партия', add: 'Добавить', quantity: 'Количество', comment: 'Комментарий', send: 'Проверить и отправить', cancel: 'Закрыть', confirm: 'Подтвердить', history: 'История партий', pay: 'Расчёт', discount: 'Скидка, сом', save: 'Сохранить', reason: 'Причина', pending: 'Неподтверждённые команды', check: 'Проверить результат', retry: 'Повторить ту же команду', unknown: 'Ответ не получен. Проверьте результат команды.', lock: 'Экран заблокирован. Введите PIN.', empty: 'Закрыть пустой визит', remove: 'Удалить из черновика', correct: 'Коррекция', cancelQty: 'Отменить количество', changeComment: 'Изменить комментарий', replace: 'Заменить позицию', cash: 'Наличные', card: 'Карта (вручную)', qr: 'QR-перевод (вручную)', split: 'Смешанная оплата', first: 'Первая часть, сом', actual: 'Фактическое получение денег проверено', incident: 'Сообщить о полученных деньгах', amount: 'Получено, сом', print: 'Печать', drafts: 'Сохранённые черновики', noAuto: 'Восстановление сети не отправляет команды. Нажмите проверку результата.', total: 'Итого', accepted: 'Принято сервером', clear: 'Очистить черновик', stale: 'Меню изменилось. Обновите меню и проверьте выбор.', permission: 'Действие сейчас недоступно. Обновите состояние.', error: 'Ошибка', price: 'Цена', result: 'Результат', next: 'Ещё', replacement: 'Выберите одну новую позицию в черновик перед заменой.' }, ky: { login: 'PIN менен кирүү', enter: 'Кирүү', tables: 'Үстөлдөр', refresh: 'Жаңыртуу', back: 'Артка', logout: 'Чыгуу', free: 'Бош', busy: 'Бош эмес', mine: 'Менин үстөлүм', open: 'Үстөл ачуу', menu: 'Меню', cart: 'Жаңы партия', add: 'Кошуу', quantity: 'Саны', comment: 'Комментарий', send: 'Текшерүү жана жөнөтүү', cancel: 'Жабуу', confirm: 'Ырастоо', history: 'Партиялар тарыхы', pay: 'Эсептешүү', discount: 'Арзандатуу, сом', save: 'Сактоо', reason: 'Себеби', pending: 'Ырастала элек аракеттер', check: 'Жыйынтыгын текшерүү', retry: 'Ошол аракетти кайталоо', unknown: 'Жооп алынган жок. Аракеттин жыйынтыгын текшериңиз.', lock: 'Экран кулпуланды. PIN киргизиңиз.', empty: 'Бош визитти жабуу', remove: 'Долбоордон өчүрүү', correct: 'Түзөтүү', cancelQty: 'Санын жокко чыгаруу', changeComment: 'Комментарий өзгөртүү', replace: 'Позицияны алмаштыруу', cash: 'Накталай', card: 'Карта (кол менен)', qr: 'QR-которуу (кол менен)', split: 'Аралаш төлөм', first: 'Биринчи бөлүк, сом', actual: 'Акчанын алынганы текшерилди', incident: 'Алынган акчаны билдирүү', amount: 'Алынды, сом', print: 'Басып чыгаруу', drafts: 'Сакталган долбоорлор', noAuto: 'Байланыш калыбына келсе аракет автоматтык жөнөтүлбөйт. Жыйынтыгын текшериңиз.', total: 'Жыйынтык', accepted: 'Сервер кабыл алды', clear: 'Долбоорду тазалоо', stale: 'Меню өзгөрдү. Менюну жаңыртып, тандоону текшериңиз.', permission: 'Аракет азыр жеткиликсиз. Абалды жаңыртыңыз.', error: 'Ката', price: 'Баасы', result: 'Жыйынтык', next: 'Дагы', replacement: 'Алмаштыруу үчүн долбоорго бир жаңы позиция тандаңыз.' } };
const $ = id => document.getElementById(id);
const BACKGROUND_LOCK_MS = 900000;
let language = localStorage.getItem('waiter-language') === 'ky' ? 'ky' : 'ru', identity = null, store = null, epoch = 0, visitId = null, lastVisitId = null, currentSection = 'tables', backgroundAt = 0, lockTimer = null, tableFilter = localStorage.getItem('waiter-table-filter') === 'all' ? 'all' : 'mine', refreshTableSnapshot = null;
const httpResume = location.protocol === 'http:', httpSessionKey = 'waiter-http-tab-session-v1', httpHiddenKey = 'waiter-http-hidden-at';
const visitCache = new Map();
let waiterEventsSocket = null, waiterEventsTimer = null, waiterMenuChanged = false;
function connectWaiterEvents() {
    if (!identity || waiterEventsSocket || waiterEventsTimer) return;
    const generation = epoch, url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/waiter/api/v1/events`;
    const socket = new WebSocket(url, ['bashkar.waiter.events', `ticket.${identity.unlockTicket}`]);
    waiterEventsSocket = socket;
    socket.onmessage = () => { if (generation === epoch) waiterMenuChanged = true; };
    socket.onclose = () => { if (waiterEventsSocket === socket) waiterEventsSocket = null; if (identity && generation === epoch) waiterEventsTimer = setTimeout(() => { waiterEventsTimer = null; connectWaiterEvents(); }, 3000); };
}
function closeWaiterEvents() { clearTimeout(waiterEventsTimer); waiterEventsTimer = null; const socket = waiterEventsSocket; waiterEventsSocket = null; if (socket) socket.close(); waiterMenuChanged = false; }
$('language').value = language;
const t = k => words[language][k] ?? k, money = n => (n / 100).toFixed(2), can = p => identity?.permissions.includes(p);
function uuid() { if (crypto.randomUUID) return crypto.randomUUID(); const data = crypto.getRandomValues(new Uint8Array(16)); data[6] = data[6] & 15 | 64; data[8] = data[8] & 63 | 128; const hex = Array.from(data, b => b.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`; }
let deviceId = localStorage.getItem('waiter-device-id');
if (!deviceId) {
    deviceId = uuid();
    localStorage.setItem('waiter-device-id', deviceId);
}
function element(tag, text, attrs = {}) { const e = document.createElement(tag); if (text !== undefined)
    e.textContent = text; Object.assign(e, attrs); return e; }
function tableGlyph() { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'table-card-icon'); svg.innerHTML = '<rect x="5" y="7" width="14" height="7" rx="2"/><path d="M7 14v4m10-4v4M4 18h5m6 0h5"/>'; return svg; }
function visitActionIcon(kind) {
    const shapes = {
        refresh: '<path d="M20 11a8 8 0 1 0-1.5 5M20 5v6h-6"/>',
        transfer: '<circle cx="8" cy="7" r="3"/><path d="M3 20v-2a5 5 0 0 1 10 0v2m3-13h5m-2-2 2 2-2 2m2 6h-5m2-2-2 2 2 2"/>',
        move: '<rect x="3" y="5" width="9" height="9" rx="2"/><rect x="12" y="10" width="9" height="9" rx="2"/><path d="m7 18 3 3 3-3"/>',
        discount: '<path d="M3 5a2 2 0 0 1 2-2h7l9 9-9 9-9-9V5Z"/><circle cx="8" cy="8" r="1"/><path d="m11 16 5-5"/>',
        cancel: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
        incident: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
        empty: '<rect x="4" y="3" width="13" height="18" rx="2"/><path d="M10 12h11m-3-3 3 3-3 3"/>'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'visit-action-icon');
    svg.innerHTML = shapes[kind]; return svg;
}
let noticeTimer = null, noticeExitTimer = null, activeDraftPopover = null, activeCartDrawer = null;
function note(s = '', tone = 'info') {
    const box = $('notice'); clearTimeout(noticeTimer); clearTimeout(noticeExitTimer);
    box.textContent = s; box.dataset.tone = tone; box.classList.remove('notice-exit');
    if (s) { noticeExitTimer = setTimeout(() => box.classList.add('notice-exit'), 1250); noticeTimer = setTimeout(() => { box.textContent = ''; box.classList.remove('notice-exit'); }, 1500); }
}
function fail(e) { const code = e.message;if(code==='SET_COMPONENT_UNAVAILABLE'){note(language==='ky'?'Сеттин курамындагы тамак жеткиликсиз. Менюну жаңыртыңыз.':'Компонент сета недоступен. Обновите меню и проверьте состав.','error');return;}if(code==='SET_QUANTITY_LIMIT'){note(language==='ky'?'Сеттердин санын азайтыңыз.':'Уменьшите количество сетов: превышен предел компонентов.','error');return;} note(code === 'RESULT_UNKNOWN' ? t('unknown') : code === 'CONFIRMATION_STALE' ? t('stale') : code === 'PERMISSION_DENIED' ? t('permission') : code === 'COMBINATION_UNAVAILABLE' ? (language==='ky'?'Бул айкалыш жеткиликсиз. Башкасын тандаңыз же менюну жаңыртыңыз.':'Это сочетание недоступно. Выберите другое или обновите меню.') : t('error') + ' · ' + code,'error'); }
function closeDraftPopover(returnFocus = false) {
    const active = activeDraftPopover; if (!active) return;
    activeDraftPopover = null; active.menu.remove(); document.removeEventListener('pointerdown', active.outside); document.removeEventListener('keydown', active.escape); window.removeEventListener('scroll', active.onScroll, true);
    active.anchor.setAttribute('aria-expanded', 'false'); if (returnFocus && active.anchor.isConnected) active.anchor.focus();
}
function closeCartDrawer(fromHistory = false) {
    const active = activeCartDrawer; if (!active) return;
    closeDraftPopover(); activeCartDrawer = null; active.drawer.classList.add('closing'); active.backdrop.classList.add('closing');
    setTimeout(() => { active.drawer.remove(); active.backdrop.remove(); if (!activeCartDrawer) document.body.classList.remove('cart-drawer-open'); }, 160);
    document.removeEventListener('keydown', active.escape);
    if (!fromHistory && history.state?.waiterCartDrawer) history.back();
    if (active.anchor.isConnected) active.anchor.focus();
}
function draftActionIcon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('width', '20'); svg.setAttribute('height', '20');
    svg.innerHTML = kind === 'comment' ? '<path d="M4 5h16v11H8l-4 4V5Z"/><path d="M8 9h8m-8 3h6"/>' : kind === 'cancel' ? '<path d="M5 5l14 14M19 5 5 19"/>' : '<path d="M4 7h16m-13 0 1 13h8l1-13M9 7V4h6v3m-5 4v6m4-6v6"/>';
    return svg;
}
function openDraftPopover(anchor, onComment, onRemove, labeled = false, accepted = false) {
    if (activeDraftPopover?.anchor === anchor) { closeDraftPopover(true); return; }
    closeDraftPopover(); const menu = element('div', undefined, { className: 'draft-popover' + (labeled ? ' cart-item-popover' : '') + (accepted ? ' accepted-item-popover' : '') }); menu.setAttribute('role', 'menu');
    const actions = accepted ? [['cancel', language === 'ky' ? 'Тамакты жокко чыгаруу' : 'Отменить блюдо', onRemove], ['comment', t('comment'), onComment]] : [['comment', t('comment'), onComment], ['remove', labeled ? language === 'ky' ? 'Өчүрүү' : 'Удалить' : t('remove'), onRemove]];
    for (const [kind, label, action] of actions) {
        if(!action)continue;
        const item = element('button', undefined, { type: 'button', className: 'draft-popover-action' }); item.setAttribute('role', 'menuitem'); item.setAttribute('aria-label', label); item.title = label; item.append(draftActionIcon(kind)); if (labeled) item.append(element('span', label)); item.onclick = () => { closeDraftPopover(); action(); }; menu.append(item);
    }
    document.body.append(menu); const rect = anchor.getBoundingClientRect(), menuWidth = menu.offsetWidth, menuHeight = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(rect.right - menuWidth, innerWidth - menuWidth - 8)) + 'px'; menu.style.top = (rect.bottom + menuHeight + 8 < innerHeight ? rect.bottom + 5 : rect.top - menuHeight - 5) + 'px';
    const outside = event => { if (!menu.contains(event.target) && !anchor.contains(event.target)) closeDraftPopover(); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); closeDraftPopover(true); } };
    const onScroll = event => { if (!menu.contains(event.target)) closeDraftPopover(); };
    activeDraftPopover = { menu, anchor, outside, escape, onScroll }; anchor.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); window.addEventListener('scroll', onScroll, true);
}
async function run(fn, b) { if (b)
    b.disabled = true; try {
    await fn();
}
catch (e) {
    fail(e);
}
finally {
    if (b?.isConnected)
        b.disabled = false;
} }
function button(parent, key, fn, primary = false) { const b = element('button', t(key), { type: 'button', className: primary ? 'primary' : '' }); b.onclick = () => run(fn, b); parent.append(b); return b; }
function field(parent, key, value = '', type = 'text') { const l = element('label', t(key)), i = element('input', undefined, { type, value }); l.append(i); parent.append(l); return i; }
function select(parent, key, choices) { const l = element('label', t(key)), s = element('select'); s.setAttribute('aria-label', t(key)); for (const [value, name] of choices)
    s.append(element('option', name, { value })); l.append(s); parent.append(l); return s; }
function check(parent, key) { const l = element('label', undefined, { className: 'check' }), i = element('input', undefined, { type: 'checkbox' }); l.append(i, document.createTextNode(t(key))); parent.append(l); return i; }
function cents(v) { if (!/^\d+(\.\d{1,2})?$/.test(v))
    throw Error('INVALID_AMOUNT'); const n = Math.round(Number(v) * 100); if (!Number.isSafeInteger(n) || n > 999999999)
    throw Error('INVALID_AMOUNT'); return n; }
function displayName(entity){return entity?.translations?.[language]??entity?.name??'';}
function sameDraftConfig(a,b){return a.itemId===b.itemId&&(a.kind??null)===(b.kind??null)&&(a.unitPrice??null)===(b.unitPrice??null)&&(a.variantId??null)===(b.variantId??null)&&(a.comment??'')===(b.comment??'')&&JSON.stringify([...(a.modifierIds??[])].sort())===JSON.stringify([...(b.modifierIds??[])].sort());}
function maxDraftQuantity(item){return item?.kind==='SET'?Math.min(999,Math.floor(9999/Math.max(...item.components.map(c=>c.quantity)))):999;}
function coalesceDraftLines(lines,catalog){const merged=[];for(const line of lines){const item=catalog?.items.find(i=>i.id===line.itemId),max=maxDraftQuantity(item),prior=merged.find(row=>sameDraftConfig(row,line)&&row.quantity+line.quantity<=max);if(prior)prior.quantity+=line.quantity;else merged.push(structuredClone(line));}return merged;}
const shortEmployeeName=name=>String(name??'').trim().split(/\s+/)[0]||'—';
function formatTableDuration(minutes, lang = language) {
    if (minutes < 60) return `${minutes} ${lang === 'ky' ? 'мүн' : 'мин'}`;
    const hours = Math.floor(minutes / 60), remainder = minutes % 60;
    if (lang === 'ky') return `${hours} саат ${remainder} мүн`;
    const hourWord = hours % 10 === 1 && hours % 100 !== 11 ? 'час' : hours % 10 >= 2 && hours % 10 <= 4 && (hours % 100 < 12 || hours % 100 > 14) ? 'часа' : 'часов';
    return `${hours} ${hourWord} ${remainder} мин`;
}
function selectionLabels(item,line){const row=item?.combinationPrices?.find(c=>c.variantId===line.variantId&&c.optionIds.length===line.modifierIds.length&&c.optionIds.every(id=>line.modifierIds.includes(id)));if(row?.translations?.[language])return row.translations[language];const variant=item?.variants?.find(v=>v.id===line.variantId);return [variant?.name,...(item?.groups?.flatMap(g=>g.options).filter(o=>line.modifierIds.includes(o.id)).map(o=>o.name)??[])].filter(Boolean).join(' · ');}
function waiterSetBlocker(item,catalog,availability={}){if(item?.kind!=='SET')return null;for(const c of item.components??[]){const child=catalog?.items.find(i=>i.id===c.itemId);if(!child||child.kind==='SET'||child.isPackaging||waiterUnitPrice(child,c.variantId,c.modifierIds,availability)===null)return child?.name??c.itemId;const row=child.combinationPrices?.find(r=>r.variantId===c.variantId&&r.optionIds.length===c.modifierIds.length&&r.optionIds.every(id=>c.modifierIds.includes(id)));if(child.pricingMode==='MATRIX'&&row?.id!==c.combinationId)return child.name;}return item.components?.length?null:'Пустой состав';}
function waiterSetContents(parent,item,catalog,quantity=1){if(item?.kind!=='SET')return;const box=element('details');box.append(element('summary',language==='ky'?'Сеттин курамы':'Состав сета'));for(const c of item.components??[]){const child=catalog?.items.find(i=>i.id===c.itemId);box.append(element('p',`${c.quantity*quantity} × ${displayName(child)||c.itemId} · ${selectionLabels(child,c)}`));}parent.append(box);}
function waiterAvailabilityReason(item,availability={}){
    const stopped=row=>availability[row.id]?.available===false,available=row=>availability[row.id]?.available??row.available;
    const words=language==='ky'
        ? {stop:'Бул тамак стоп-листте',menu:'Менюда жеткиликсиз',variantsStop:'Бул тамактын бардык өлчөмдөрү стоп-листте',variantsMenu:'Бул тамактын бардык өлчөмдөрү менюда жеткиликсиз',variantsMixed:'Өлчөмдөр стоп-листте же менюда өчүрүлгөн'}
        : {stop:'Это блюдо в стоп-листе',menu:'Недоступно в меню',variantsStop:'Все варианты блюда в стоп-листе',variantsMenu:'Все варианты блюда недоступны в меню',variantsMixed:'Варианты в стоп-листе или отключены в меню'};
    if(stopped(item))return words.stop;
    if(!available(item))return words.menu;
    if(item.variants.length&&!item.variants.some(available)){
        if(item.variants.every(stopped))return words.variantsStop;
        if(item.variants.every(row=>!row.available&&availability[row.id]?.available!==true&&!stopped(row)))return words.variantsMenu;
        return words.variantsMixed;
    }
    return null;
}
function waiterUnitPrice(item,variantId,modifierIds,availability={},catalog=null){if(!item||item.archived||!(availability[item.id]?.available??item.available))return null;if(item.kind==='SET')return catalog&&!waiterSetBlocker(item,catalog,availability)?item.price:null;const selectedVariant=item.variants.find(v=>v.id===variantId),selectedOptions=item.groups.flatMap(g=>g.options).filter(o=>modifierIds.includes(o.id));if((item.variants.length?(!selectedVariant||!(availability[selectedVariant.id]?.available??selectedVariant.available)):variantId!==null)||new Set(modifierIds).size!==modifierIds.length||selectedOptions.length!==modifierIds.length||selectedOptions.some(o=>!(availability[o.id]?.available??o.available))||item.groups.some(g=>{const n=g.options.filter(o=>modifierIds.includes(o.id)).length;return n<g.min||n>g.max;}))return null;if(item.pricingMode==='MATRIX'){const variant=item.variants.find(v=>v.id===variantId);if(!(availability[item.id]?.available??item.available)||(item.variants.length&&(!variant||!(availability[variant.id]?.available??variant.available)))||item.groups.some(g=>!g.options.some(o=>modifierIds.includes(o.id)&&(availability[o.id]?.available??o.available))))return null;const row=item.combinationPrices?.find(c=>c.variantId===variantId&&c.optionIds.length===modifierIds.length&&c.optionIds.every(id=>modifierIds.includes(id)));return row&&(availability[row.id]?.available??row.available)?row.price:null;}const variant=item.variants.find(v=>v.id===variantId),options=item.groups.flatMap(g=>g.options).filter(o=>modifierIds.includes(o.id));return (variant?.price??item.price??0)+options.reduce((sum,o)=>sum+o.price,0);}
function snapshotLabels(line){if(line.kind==='SET')return (line.components??[]).map(c=>`${c.quantity*line.quantity} × ${displayName(c)}${snapshotLabels(c)?' · '+snapshotLabels(c):''}`).join('; ');if(line.combination)return displayName(line.combination);return [line.variant?displayName(line.variant):'',...(line.modifiers??[]).map(displayName)].filter(Boolean).join(' · ');}
function page(title) { if (!identity)
    throw Error('WEB_LOCKED'); closeCartDrawer(); closeDraftPopover(); document.body.classList.remove('waiter-login', 'waiter-visit', 'waiter-menu'); const root = $('app'); root.className = ''; root.replaceChildren(element('h1', title)); return root; }
function modal(title) { if (!identity)
    throw Error('WEB_LOCKED'); const d = element('dialog'), body = element('div'); d.append(element('h2', title), body); button(d, 'cancel', () => d.close()); d.addEventListener('click', e => { if (e.target === d) {
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        d.close();
} }); d.onclose = () => d.remove(); document.body.append(d); d.showModal(); return { d, body }; }
async function api(path, body, publicCall = false) { const generation = epoch, headers = {}; if (body !== undefined)
    Object.assign(headers, { 'Content-Type': 'application/json', 'X-Bashkar-Client': 'waiter' }); if (identity)
    Object.assign(headers, { 'X-CSRF-Token': identity.csrf, 'X-Waiter-Unlock': identity.unlockTicket }); let response; try {
    response = await fetch('/waiter/api/v1/' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
}
catch {
    throw Error('RESULT_UNKNOWN');
} const data = await response.json(); if (generation !== epoch)
    throw Error('WEB_LOCKED'); if (!response.ok) {
    if (response.status === 401 && !publicCall)
        lock();
    const e = Error(data.error?.code ?? 'REQUEST_FAILED');
    e.status = response.status;
    throw e;
} return data; }
function lock(announce = true) { closeWaiterEvents(); closeCartDrawer(); closeSidebar(); if (announce)
    localStorage.setItem('waiter-lock-event', uuid()); if (httpResume) { sessionStorage.removeItem(httpSessionKey); sessionStorage.removeItem(httpHiddenKey); } epoch++; identity = null; store?.lock(); store = null; visitId = null; lastVisitId = null; refreshTableSnapshot = null; visitCache.clear(); document.querySelectorAll('dialog').forEach(d => d.remove()); $('actor').textContent = ''; $('lock').hidden = true; $('logout').hidden = true; login(); }
function showIdentity(data) { $('actor').textContent = data.name; $('actor-role').textContent = 'Официант'; $('lock').hidden = false; $('logout').hidden = false; $('logout').textContent = t('logout'); note(); connectWaiterEvents(); }
function closeSidebar(fromHistory = false) {
    const sidebar = $('sidebar'); if (sidebar.hidden) return;
    sidebar.hidden = true; $('sidebar-backdrop').hidden = true; document.body.classList.remove('sidebar-open');
    if (!fromHistory && history.state?.waiterDrawer) history.back();
}
async function openSidebar() {
    if (!identity || !$('sidebar').hidden) return;
    const sidebar = $('sidebar'); sidebar.replaceChildren();
    const close = element('button', '×', { type: 'button', className: 'sidebar-close' }); close.setAttribute('aria-label', language === 'ky' ? 'Менюну жабуу' : 'Закрыть меню'); close.onclick = () => closeSidebar(); sidebar.append(close);
    const profile = element('button', undefined, { type: 'button', className: 'sidebar-profile' });
    profile.append(element('span', '♙', { className: 'sidebar-avatar', ariaHidden: 'true' }), element('span', undefined, { className: 'sidebar-person' }));
    profile.querySelector('.sidebar-person').append(element('strong', identity.name), element('small', 'Официант'));
    profile.append(element('span', '⌄', { ariaHidden: 'true' })); profile.onclick = () => { closeSidebar(); profilePage(); }; sidebar.append(profile);
    const local = await store.read(); if (!identity) return;
    const drafts = Object.values(local.drafts).filter(d => d.lines?.length).length;
    const entries = [
        ['tables', language === 'ky' ? 'Үстөлдөр' : 'Столы', '▰', () => tables()],
        ['menu', language === 'ky' ? 'Меню' : 'Меню', '♧', () => menuBrowse()],
        ['order', language === 'ky' ? 'Буйрутма' : 'Заказ', '▤', () => openLastOrder(), drafts],
        ['profile', language === 'ky' ? 'Профиль' : 'Профиль', '♙', () => profilePage()],
        ['settings', language === 'ky' ? 'Жөндөөлөр' : 'Настройки', '⚙', () => settingsPage()],
        ['help', language === 'ky' ? 'Жардам' : 'Помощь', '?', () => helpPage()],
        ['logout', language === 'ky' ? 'Чыгуу' : 'Выход', '⇥', () => confirmLogout()]
    ];
    const nav = element('nav', undefined, { className: 'sidebar-nav' });
    for (const [key, label, icon, action, badge] of entries) {
        if (key === 'settings') nav.append(element('hr'));
        const item = element('button', undefined, { type: 'button', className: 'sidebar-item' + (currentSection === key ? ' active' : '') });
        item.append(element('span', icon, { className: 'sidebar-icon', ariaHidden: 'true' }), element('span', label));
        if (badge) item.append(element('span', String(badge), { className: 'sidebar-badge', ariaLabel: language === 'ky' ? `${badge} долбоор` : `${badge} черновиков` }));
        item.onclick = () => { closeSidebar(); void run(action); }; nav.append(item);
    }
    sidebar.append(nav); $('sidebar-backdrop').hidden = false; sidebar.hidden = false; document.body.classList.add('sidebar-open');
    history.pushState({ waiterDrawer: true }, '', location.href); close.focus();
}
function confirmLogout() {
    const m = modal(language === 'ky' ? 'Чыгасызбы?' : 'Выйти из аккаунта?');
    m.body.append(element('p', language === 'ky' ? 'Жеке сессия аяктайт. Сакталган буйрутмалар автоматтык жөнөтүлбөйт.' : 'Личная сессия завершится. Черновики не будут отправлены автоматически.'));
    button(m.body, 'logout', () => { m.d.close(); $('logout').click(); }, true);
}
async function openLastOrder() {
    if (lastVisitId) { try { await visit(lastVisitId); return; } catch (error) { if (!['VISIT_ACCESS_DENIED', 'VISIT_NOT_FOUND'].includes(error.message)) throw error; lastVisitId = null; } }
    await tables(); note(language === 'ky' ? 'Буйрутма үчүн өзүңүздүн үстөлүңүздү тандаңыз.' : 'Выберите свой стол, чтобы открыть заказ.');
}
async function menuBrowse(searchText = '') {
    currentSection = 'menu'; const root = page(t('menu')); root.classList.add('waiter-section');
    const data = await api('menu'), search = field(root, language === 'ky' ? 'Тамакты издөө' : 'Поиск блюда', searchText); search.type = 'search'; search.placeholder = language === 'ky' ? 'Тамакты издөө...' : 'Поиск блюда...';
    const list = element('div', undefined, { className: 'menu-browse-list' }); root.append(list);
    const draw = () => { list.replaceChildren(); const query = search.value.trim().toLocaleLowerCase();
        for (const item of data.catalog.items.filter(item => !item.archived && displayName(item).toLocaleLowerCase().includes(query))) {
            const row = element('div', undefined, { className: 'card' }); row.append(element('strong', displayName(item)));
            const reason=waiterAvailabilityReason(item,data.availability);if(reason)row.append(element('small',reason,{className:'menu-availability-reason'}));
            list.append(row);
        }
        if (!list.children.length) list.append(element('p', language === 'ky' ? 'Тамак табылган жок' : 'Блюда не найдены', { className: 'muted' }));
    }; search.oninput = draw; draw();
}
function profilePage() { currentSection = 'profile'; const root = page(language === 'ky' ? 'Профиль' : 'Профиль'); root.classList.add('waiter-section'); const card = element('section', undefined, { className: 'card' }); card.append(element('strong', identity.name), element('p', 'Официант')); root.append(card); }
function settingsPage() { currentSection = 'settings'; const root = page(language === 'ky' ? 'Жөндөөлөр' : 'Настройки'); root.classList.add('waiter-section'); const card = element('section', undefined, { className: 'card' }); card.append(element('h2', language === 'ky' ? 'Тил' : 'Язык')); const choice = select(card, language === 'ky' ? 'Тил' : 'Язык', [['ru', 'Русский'], ['ky', 'Кыргызча']]); choice.value = language; choice.onchange = () => { $('language').value = choice.value; $('language').dispatchEvent(new Event('change')); }; root.append(card); }
function helpPage() { currentSection = 'help'; const root = page(language === 'ky' ? 'Жардам' : 'Помощь'); root.classList.add('waiter-section'); root.append(element('p', language === 'ky' ? 'Үстөлдөрдөн өзүңүздүн активдүү үстөлдөрүңүздү караңыз. Бош үстөлдү «Бардык үстөлдөр» бөлүмүнөн ачыңыз.' : 'Во вкладке «Мои столы» находятся ваши активные столы. Чтобы открыть свободный стол, перейдите во «Все столы».', { className: 'card' })); }
function login() {
    document.body.classList.remove('waiter-visit'); document.body.classList.add('waiter-login');
    const root=$('app');root.className='';root.replaceChildren();note();
    const stage=element('div',undefined,{className:'login-stage'}),brand=element('div',undefined,{className:'login-brand'});
    brand.append(element('span',undefined,{className:'login-logo-placeholder','ariaHidden':'true'}),element('strong','Bashkar'),element('span',language==='ky'?'Ресторан системасы':'Ресторанная система'));
    const form=element('form',undefined,{className:'pin card login-card'});
    form.append(element('h1',t('login')),element('p',language==='ky'?'Ишти баштоо үчүн төрт орундуу жеке кодуңузду киргизиңиз':'Введите свой четырёхзначный код для начала работы',{className:'login-instruction'}));
    const entry=element('div',undefined,{className:'login-pin-entry'}),pin=element('input',undefined,{type:'password',className:'login-pin-input',inputMode:'none',maxLength:4,autocomplete:'off'});
    pin.setAttribute('aria-label','PIN');pin.setAttribute('pattern','[0-9]{4}');
    const cells=Array.from({length:4},(_,index)=>element('span',undefined,{className:'login-pin-cell'+(index===0?' active':'')}));
    entry.append(...cells,pin);form.append(entry);
    const keypad=element('div',undefined,{className:'login-keypad'}),keys=[];
    let busy=false;
    const draw=()=>{const digits=pin.value;cells.forEach((cell,index)=>{cell.textContent=index<digits.length?'•':'';cell.classList.toggle('active',index===Math.min(digits.length,3));});};
    const submit=async()=>{if(busy||pin.value.length!==4)return;busy=true;keys.forEach(key=>key.disabled=true);pin.disabled=true;const value=pin.value;note();try{
        const data=await api('session/pin',{pin:value,deviceId},true),newStore=await WaiterDraftStore.open(data,data.draftKey);
        if(httpResume)sessionStorage.setItem(httpSessionKey,JSON.stringify(data));
        delete data.draftKey;localStorage.setItem('waiter-lock-event',uuid());identity=data;store=newStore;tableFilter='mine';localStorage.setItem('waiter-table-filter','mine');showIdentity(data);await tables();
    }catch(error){fail(error);}finally{pin.value='';draw();busy=false;pin.disabled=false;keys.forEach(key=>key.disabled=false);}};
    pin.oninput=()=>{pin.value=pin.value.replace(/\D/g,'').slice(0,4);draw();if(pin.value.length===4)void submit();};
    form.onsubmit=event=>{event.preventDefault();void submit();};
    for(const digit of ['1','2','3','4','5','6','7','8','9','backspace','0']){
        const key=element('button',digit==='backspace'?'⌫':digit,{type:'button',className:'login-key'});
        key.setAttribute('aria-label',digit==='backspace'?(language==='ky'?'Акыркы санды өчүрүү':'Удалить последнюю цифру'):digit);
        key.onclick=()=>{if(busy)return;pin.value=digit==='backspace'?pin.value.slice(0,-1):(pin.value+digit).slice(0,4);pin.dispatchEvent(new Event('input',{bubbles:true}));};
        keypad.append(key);keys.push(key);
    }
    keypad.append(element('span',undefined,{className:'login-key login-key-empty','ariaHidden':'true'}));form.append(keypad);
    const fallback=element('button',language==='ky'?'Логин жана сырсөз менен кирүү':'Войти по логину и паролю',{type:'button',className:'login-password-link'});
    const feedback=element('p','',{className:'login-feedback'});
    fallback.onclick=()=>{feedback.textContent=language==='ky'?'Официант азырынча жеке PIN менен гана кирет. PIN жоголсо, менеджерге кайрылыңыз.':'Официант пока входит только по личному PIN. Если код утрачен, обратитесь к менеджеру.';};
    form.append(element('div',undefined,{className:'login-divider'}),fallback,feedback);
    const notice=element('div',undefined,{className:'login-access-note'});notice.append(element('span','ⓘ',{className:'login-access-icon','ariaHidden':'true'}),element('p',language==='ky'?'Кирүү ресторан кызматкерлерине гана. Жеке PIN кодуңузду колдонуңуз.':'Доступ только для сотрудников ресторана. Используйте личный PIN-код.'));
    stage.append(brand,form,notice);root.append(stage);
}
async function resumeHttpSession() {
    if (!httpResume) { login(); return; }
    const raw = sessionStorage.getItem(httpSessionKey), hiddenAt = Number(sessionStorage.getItem(httpHiddenKey) ?? 0);
    if (!raw || hiddenAt && Date.now() - hiddenAt >= BACKGROUND_LOCK_MS) { sessionStorage.removeItem(httpSessionKey); sessionStorage.removeItem(httpHiddenKey); login(); return; }
    $('app').replaceChildren(element('h1', language === 'ky' ? 'Сессия текшерилүүдө' : 'Проверяем сессию'));
    try {
        const saved = JSON.parse(raw);
        if (saved.deviceId !== deviceId || typeof saved.draftKey !== 'string' || typeof saved.csrf !== 'string' || typeof saved.unlockTicket !== 'string') throw Error('WEB_UNLOCK_REQUIRED');
        const response = await fetch('/waiter/api/v1/session/me', { credentials: 'same-origin', headers: { 'X-CSRF-Token': saved.csrf, 'X-Waiter-Unlock': saved.unlockTicket }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw Error('SESSION_EXPIRED');
        const current = await response.json();
        const latestHiddenAt = Number(sessionStorage.getItem(httpHiddenKey) ?? 0);
        if (sessionStorage.getItem(httpSessionKey) !== raw || latestHiddenAt && Date.now() - latestHiddenAt >= BACKGROUND_LOCK_MS) throw Error('WEB_LOCKED');
        if (current.id !== saved.employeeId || current.instanceId !== saved.instanceId || current.branchId !== saved.branchId || current.deviceId !== saved.deviceId) throw Error('SESSION_INVALID');
        const newStore = await WaiterDraftStore.open(saved, saved.draftKey);
        delete saved.draftKey;
        identity = { ...saved, name: current.name, permissions: current.permissions };
        store = newStore;
        sessionStorage.removeItem(httpHiddenKey);
        showIdentity(identity);
        await tables();
    } catch {
        store?.lock(); store = null; identity = null;
        sessionStorage.removeItem(httpSessionKey); sessionStorage.removeItem(httpHiddenKey);
        login();
    }
}
async function frozen(operation, targetId, path, payload, draftScope = null) { const id = uuid(), record = { operation, targetId, path, envelope: { commandId: id, ...payload }, draftScope: draftScope ?? visitId, createdAt: Date.now() }; await store.update(s => { if (Object.values(s.pending).some(p => p.targetId === targetId))
    throw Error('PENDING_COMMAND_REQUIRES_REVIEW'); s.pending[id] = record; }); return sendFrozen(record); }
async function finish(record, result) { await store.update(s => { delete s.pending[record.envelope.commandId]; if ((record.operation === 'batch.submit' || record.operation === 'order.correct' && record.envelope.action === 'REPLACE_ITEM') && record.draftScope)
    delete s.drafts[record.draftScope]; }); note(t('accepted')); return result; }
async function sendFrozen(record) { try {
    const result = await api(record.path, record.envelope);
    return finish(record, result);
}
catch (e) {
    if ((record.operation === 'tables/open' && ['TABLE_OCCUPIED', 'SHIFT_REQUIRED', 'TABLE_INACTIVE'].includes(e.message) || ['tables/move','tables/responsible'].includes(record.operation)) && [400, 403, 409, 422].includes(e.status)) {
        await store.update(s => { delete s.pending[record.envelope.commandId]; });
        throw e;
    }
    if ([400, 403, 409, 422].includes(e.status))
        await store.update(s => { if (s.pending[record.envelope.commandId])
            s.pending[record.envelope.commandId].rejected = e.message; });
    throw e;
} }
async function pending(parent) { const state = await store.read(); if (!identity)
    return; const values = Object.values(state.pending).filter(record => record.operation !== 'tables/open'); if (!values.length)
    return; const box = element('section', undefined, { className: 'card' }); box.append(element('h2', t('pending')), element('p', t('noAuto'))); for (const record of values) {
    const row = element('article', undefined, { className: 'card' });
    row.append(element('p', record.operation + ' · ' + record.envelope.commandId));
    button(row, 'check', async () => { const result = await api('commands/receipt', { operation: record.operation, targetId: record.targetId, envelope: record.envelope }); if (result.state === 'COMMITTED') {
        await finish(record, result.receipt);
        await tables();
    }
    else {
        note('NOT_RECORDED');
        button(row, 'retry', async () => { const m = modal(t('retry')); m.body.append(element('p', t('noAuto'))); button(m.body, 'confirm', async () => { await sendFrozen(record); m.d.close(); await tables(); }, true); });
    } });
    if (record.rejected) {
        row.append(element('p', record.rejected));
        button(row, 'clear', async () => { const m = modal(t('clear')); m.body.append(element('p', record.rejected)); button(m.body, 'confirm', async () => { await store.update(s => { delete s.pending[record.envelope.commandId]; }); m.d.close(); await tables(); }); });
    }
    box.append(row);
} parent.prepend(box); }
function openPending(parent, records, data) {
    if (!records.length) return;
    const wrap = element('section', undefined, { className: 'table-open-pending' });
    for (const record of records) {
        const table = data.tables.find(row => row.id === record.targetId), row = element('div', undefined, { className: 'table-open-pending-row' });
        row.append(element('span', '◷', { className: 'table-open-pending-icon', ariaHidden: 'true' }), element('span', `${language === 'ky' ? 'Үстөлдүн ачылышын текшерүүдө' : 'Проверяем открытие стола'} ${table?.name ?? ''}`));
        const check = element('button', language === 'ky' ? 'Текшерүү' : 'Проверить', { type: 'button' });
        check.onclick = () => run(async () => {
            const result = await api('commands/receipt', { operation: record.operation, targetId: record.targetId, envelope: record.envelope });
            if (result.state === 'COMMITTED') { await finish(record, result.receipt); await visit(result.receipt.sessionId); return; }
            const latest = await api('tables'), current = latest.tables.find(item => item.id === record.targetId);
            if (current?.state !== 'FREE') {
                await store.update(s => { delete s.pending[record.envelope.commandId]; }); await tables();
                note(language === 'ky' ? 'Үстөлдү башка кызматкер ачты' : 'Стол уже открыл другой сотрудник'); return;
            }
            if (latest.shiftOpen && can('table.open') && !row.querySelector('.table-open-retry')) {
                const retry = element('button', language === 'ky' ? 'Кайра ачуу' : 'Повторить открытие', { type: 'button', className: 'table-open-retry' });
                retry.onclick = () => { const m = modal(language === 'ky' ? 'Үстөлдү ачуу' : 'Открыть стол'); m.body.append(element('p', language === 'ky' ? 'Ушул эле аракет кайра жөнөтүлөт.' : 'Повторим ту же команду открытия.')); button(m.body, 'confirm', async () => { try { const opened = await sendFrozen(record); m.d.close(); await visit(opened.sessionId); } catch (error) { if (error.message === 'TABLE_OCCUPIED') { m.d.close(); await tables(); note(language === 'ky' ? 'Үстөлдү башка кызматкер ачты' : 'Стол уже открыл другой сотрудник'); return; } throw error; } }, true); };
                row.append(retry);
            }
        }, check);
        row.append(check); wrap.append(row);
    }
    parent.insertBefore(wrap, parent.querySelector('.table-search'));
}
async function tables() {
    let data;
    try { data = await api('tables'); }
    catch (error) {
        if (!identity) throw error;
        currentSection = 'tables'; visitId = null; refreshTableSnapshot = null;
        const root = page(t('tables')); root.classList.add('waiter-tables');
        const offline = element('section', undefined, { className: 'table-empty table-unavailable' });
        offline.append(element('strong', language === 'ky' ? 'Жергиликтүү сервер жеткиликсиз' : 'Локальный сервер недоступен'), element('p', language === 'ky' ? 'Байланышты текшерип, кайра аракет кылыңыз. Буйрутмалар жөнөтүлгөн жок.' : 'Проверьте соединение и повторите попытку. Заказы не отправлялись.'));
        const retry = element('button', t('refresh'), { type: 'button', className: 'primary' }); retry.onclick = () => run(tables, retry); offline.append(retry); root.append(offline); fail(error); return;
    }
    currentSection = 'tables'; visitId = null; refreshTableSnapshot = null;
    const root = page(t('tables')); root.classList.add('waiter-tables');
    const filters = element('nav', undefined, { className: 'table-filters', ariaLabel: language === 'ky' ? 'Үстөл чыпкасы' : 'Фильтр столов' });
    const list = element('div', undefined, { className: 'table-list' });
    for (const [value, label] of [['mine', language === 'ky' ? 'Менин үстөлдөрүм' : 'Мои столы'], ['all', language === 'ky' ? 'Бардык үстөлдөр' : 'Все столы']]) {
        const filter = element('button', label, { type: 'button' });
        filter.setAttribute('aria-pressed', String(tableFilter === value));
        filter.onclick = () => { tableFilter = value; localStorage.setItem('waiter-table-filter', value); for (const choice of filters.querySelectorAll('button')) choice.setAttribute('aria-pressed', String(choice === filter)); drawTables(); };
        filters.append(filter);
    }
    root.append(filters);
    const searchWrap = element('div', undefined, { className: 'table-search' });
    const search = element('input', undefined, { type: 'search', autocomplete: 'off', placeholder: language === 'ky' ? 'Үстөлдү издөө...' : 'Поиск стола...' });
    search.setAttribute('aria-label', language === 'ky' ? 'Үстөлдү издөө' : 'Поиск стола');
    const searchIcon = element('span', '⌕', { ariaHidden: 'true' });
    const refresh = element('button', '↻', { type: 'button', className: 'table-refresh' }); refresh.setAttribute('aria-label', t('refresh')); refresh.onclick = () => run(tables, refresh);
    searchWrap.append(searchIcon, search, refresh); root.append(searchWrap, list);
    search.oninput = drawTables;
    if (!data.shiftOpen) root.append(element('p', language === 'ky' ? 'Нөөмөт жабык. Үстөл ачуу жана буйрутма жөнөтүү жеткиликсиз.' : 'Смена закрыта. Открытие столов и отправка заказов недоступны.', { className: 'draft-status' }));
    let local = await store.read(); if (!identity) return;
    const obsoleteOpens = Object.values(local.pending).filter(record => record.operation === 'tables/open' && ['TABLE_OCCUPIED', 'SHIFT_REQUIRED', 'TABLE_INACTIVE'].includes(record.rejected));
    if (obsoleteOpens.length) local = await store.update(state => { for (const record of obsoleteOpens) delete state.pending[record.envelope.commandId]; });
    if (Object.keys(local.pending).length) await pending(root);
    openPending(root, Object.values(local.pending).filter(record => record.operation === 'tables/open'), data);
    let draftSessions = new Set(Object.entries(local.drafts).filter(([, draft]) => draft.lines?.length > 0).map(([id]) => id));
    const collapsed = new Set(); let snapshotAt = performance.now(), durationUpdates = [];
    function drawTables() {
        list.replaceChildren(); durationUpdates = [];
        const query = search.value.trim().toLocaleLowerCase();
        const visible = data.tables.filter(table => (tableFilter === 'all' || table.state === 'OCCUPIED' && table.isMine) && (!query || [table.name, data.zones.find(zone => zone.id === table.zoneId)?.name].some(value => value?.toLocaleLowerCase().includes(query))));
        if (!visible.length) {
            const empty = element('div', undefined, { className: 'table-empty' });
            empty.append(element('strong', query ? language === 'ky' ? 'Үстөл табылган жок' : 'Столы не найдены' : tableFilter === 'mine' ? language === 'ky' ? 'Азырынча активдүү үстөлдөрүңүз жок' : 'У вас пока нет активных столов' : language === 'ky' ? 'Үстөлдөр жок' : 'Столов пока нет'));
            if (!query && tableFilter === 'mine') { const action = element('button', language === 'ky' ? 'Бардык үстөлдөрдү көрүү' : 'Посмотреть все столы', { type: 'button', className: 'primary' }); action.onclick = () => filters.querySelectorAll('button')[1].click(); empty.append(action); }
            list.append(empty); return;
        }
        for (const zone of data.zones) {
            const entries = visible.filter(table => table.zoneId === zone.id).sort((a, b) => a.name.localeCompare(b.name, language, { numeric: true }));
            if (!entries.length) continue;
            const block = element('details', undefined, { className: 'table-zone' }); block.open = !collapsed.has(zone.id);
            const summary = element('summary');
            summary.append(element('span', '▣', { className: 'zone-icon', ariaHidden: 'true' }), element('strong', zone.name), element('span', `${entries.length} ${language === 'ky' ? 'үстөл' : entries.length === 1 ? 'стол' : entries.length < 5 ? 'стола' : 'столов'}`, { className: 'zone-count' }));
            block.append(summary);
            const grid = element('div', undefined, { className: 'grid table-grid' });
            for (const table of entries) {
                const tile = element('button', undefined, { type: 'button', className: 'table-card ' + (table.state === 'FREE' ? 'free' : 'busy') });
                tile.setAttribute('aria-label', `${table.name} · ${table.state === 'FREE' ? t('free') : table.isMine ? t('mine') : t('busy')}`);
                tile.append(tableGlyph(), element('strong', table.name), element('span', t(table.state === 'FREE' ? 'free' : 'busy'), { className: 'table-card-status' }));
                if (table.state === 'OCCUPIED' && table.canViewDetails && table.sessionId && draftSessions.has(table.sessionId)) {
                    const draftMark = element('span', '◷', { className: 'table-card-draft', ariaHidden: 'true' });
                    draftMark.title = language === 'ky' ? 'Жөнөтүлбөгөн долбоор' : 'Неотправленный черновик'; tile.setAttribute('aria-description', draftMark.title); tile.append(draftMark);
                }
                if (table.state !== 'FREE' && table.canViewDetails && Number.isFinite(table.openedAt) && Number.isFinite(table.currentTotal)) {
                    const opener = element('span', shortEmployeeName(table.openedBy?.name), { className: 'table-card-opener' }); opener.title = table.openedBy?.name ?? '';
                    const facts = element('span', undefined, { className: 'table-card-facts' }), elapsed = element('span', '', { className: 'table-card-elapsed' });
                    const updateDuration = () => { elapsed.textContent = formatTableDuration(Math.max(0, Math.floor((data.serverTime + performance.now() - snapshotAt - table.openedAt) / 60000))); };
                    updateDuration(); durationUpdates.push(updateDuration);
                    facts.append(elapsed, element('span', new Intl.NumberFormat(language === 'ky' ? 'ky-KG' : 'ru-RU', { maximumFractionDigits: 2 }).format(table.currentTotal / 100) + ' сом', { className: 'table-card-amount' }));
                    tile.append(opener, facts);
                } else if (table.state !== 'FREE') tile.append(element('small', language === 'ky' ? 'Маалымат жабык' : 'Детали недоступны'));
                tile.onclick = () => run(async () => {
                    if (table.state === 'FREE') {
                        if (!can('table.open') || !data.shiftOpen) { note(language === 'ky' ? 'Үстөл ачуу жеткиликсиз.' : 'Открытие стола сейчас недоступно.'); return; }
                        const m = modal(`${language === 'ky' ? 'Үстөлдү ачуу: ' : 'Открыть стол '}${table.name}`);
                        m.d.classList.add('table-open-dialog');
                        const icon = element('span', undefined, { className: 'table-open-dialog-icon', ariaHidden: 'true' }); icon.append(tableGlyph()); m.d.insertBefore(icon, m.d.querySelector('h2'));
                        m.body.append(element('span', zone.name, { className: 'table-open-dialog-zone' }), element('p', language === 'ky' ? 'Бул үстөлдө жаңы визитти баштайсызбы?' : 'Начать новое посещение за этим столом?', { className: 'table-open-dialog-copy' }));
                        const actions = element('div', undefined, { className: 'table-open-dialog-actions' }), cancel = m.d.querySelector('button'); cancel.textContent = language === 'ky' ? 'Жокко чыгаруу' : 'Отмена'; actions.append(cancel);
                        const open = button(actions, 'open', async () => { try { const result = await frozen('tables/open', table.id, 'tables/open', { tableId: table.id, responsibleWaiterId: identity.employeeId }); m.d.close(); await visit(result.sessionId); } catch (error) { if (['TABLE_OCCUPIED', 'SHIFT_REQUIRED', 'TABLE_INACTIVE'].includes(error.message)) { m.d.close(); await tables(); note(error.message === 'TABLE_OCCUPIED' ? language === 'ky' ? 'Үстөлдү башка кызматкер ачты' : 'Стол уже открыл другой сотрудник' : language === 'ky' ? 'Үстөл же нөөмөт өзгөрдү. Жаңыртылган тизмени текшериңиз.' : 'Стол или смена изменились. Проверьте обновлённый список.'); return; } if (error.message === 'RESULT_UNKNOWN') { m.d.close(); await tables(); return; } throw error; } }, true);
                        open.textContent = language === 'ky' ? 'Үстөлдү ачуу' : 'Открыть стол'; m.body.append(actions);
                    } else if (table.canViewDetails && table.sessionId) await visit(table.sessionId);
                    else note(language === 'ky' ? 'Бул үстөлдүн маалыматтарын көрүүгө укугуңуз жок.' : 'У вас нет доступа к подробностям этого стола.');
                }, tile);
                grid.append(tile);
            }
            block.append(grid); block.addEventListener('toggle', () => { if (block.open) collapsed.delete(zone.id); else collapsed.add(zone.id); }); list.append(block);
        }
    }
    drawTables();
    const tableClock = setInterval(() => { if (!list.isConnected) clearInterval(tableClock); else durationUpdates.forEach(update => update()); }, 30000);
    refreshTableSnapshot = async () => {
        const latest = await api('tables');
        if (!identity || visitId !== null || !list.isConnected || document.querySelector('dialog[open]')) return;
        const currentDrafts = await store.read(); if (!identity || !list.isConnected) return;
        const latestDraftSessions = new Set(Object.entries(currentDrafts.drafts).filter(([, draft]) => draft.lines?.length > 0).map(([id]) => id));
        const draftsChanged = latestDraftSessions.size !== draftSessions.size || [...latestDraftSessions].some(id => !draftSessions.has(id)); draftSessions = latestDraftSessions;
        if (JSON.stringify(latest.zones) !== JSON.stringify(data.zones) || latest.shiftOpen !== data.shiftOpen) { await tables(); return; }
        data.serverTime = latest.serverTime; snapshotAt = performance.now();
        if (draftsChanged || JSON.stringify(latest.tables) !== JSON.stringify(data.tables)) { data.tables = latest.tables; drawTables(); }
    };
}
async function loadVisitBatches(id) {
    const batches = []; let after = 0;
    do { const result = await api('visits/' + id + '/batches?after=' + after + '&limit=100'); batches.push(...result.batches); after = result.next; } while (after !== null);
    return batches.reverse();
}
async function loadVisitFulfillment(orderId) {
    const lines = new Map(); let after = 0, orderRevision = 0;
    do { const result = await api('orders/' + orderId + '/fulfillment?after=' + after + '&limit=100'); orderRevision = result.orderRevision;
        for (const batch of result.batches) for (const line of batch.lines) lines.set(line.id, line);
        after = result.next;
    } while (after !== null);
    return { lines, orderRevision };
}
async function visit(id, localOnly = false) {
    const generation = epoch;
    let cached = visitCache.get(id);
    if (!localOnly || !cached || cached.deadline <= performance.now()) {
        try {
            const [details, ctx, menu, order, batches] = await Promise.all([api('visits/' + id + '/details'), api('visits/' + id + '/draft-context'), api('menu'), api('visits/' + id + '/order'), loadVisitBatches(id)]);
            const live = order ? await api('orders/' + order.id) : null;
            const fulfillment = live ? await loadVisitFulfillment(live.id) : null;
            cached = { details, ctx, menu, order, live, batches, fulfillment, deadline: performance.now() + Math.max(0, ctx.validUntil - ctx.serverTime) };
            visitCache.set(id, cached);
        } catch (error) {
            if (!identity || generation !== epoch) throw error;
            currentSection = 'order'; visitId = id; refreshTableSnapshot = null;
            const root = page(''); root.classList.add('active-visit'); document.body.classList.add('waiter-visit');
            const card = element('section', undefined, { className: 'visit-load-error' });
            card.append(element('h1', language === 'ky' ? 'Үстөлдү ачуу мүмкүн эмес' : 'Не удалось открыть стол'), element('p', error.message === 'RESULT_UNKNOWN' ? language === 'ky' ? 'Жергиликтүү серверге байланыш жок.' : 'Нет связи с локальным сервером.' : language === 'ky' ? 'Маалымат өзгөрдү же кирүү укугуңуз жок.' : 'Данные изменились или доступ к столу больше не разрешён.'));
            const back = element('button', t('tables'), { type: 'button' }), retry = element('button', t('refresh'), { type: 'button', className: 'primary' }); back.onclick = () => run(tables, back); retry.onclick = () => run(() => visit(id), retry); card.append(back, retry); root.append(card); fail(error); return;
        }
    }
    const { details, ctx, menu, order, live, batches, fulfillment } = cached;
    let local = await store.read(); if (generation !== epoch) throw Error('WEB_LOCKED');
    visitId = id; lastVisitId = id; currentSection = 'order'; refreshTableSnapshot = null;
    let draft = local.drafts[id] ?? { draftId: uuid(), draftRevision: 1, menuRevision: menu.revision, lines: [], discount: order?.discount ?? 0, tableName: details.tableName };
    const root = page(''); root.classList.add('active-visit'); document.body.classList.add('waiter-visit');
    const header = element('section', undefined, { className: 'visit-header' });
    const back = element('button', '←', { type: 'button', className: 'visit-back' }); back.setAttribute('aria-label', t('back')); back.onclick = () => run(tables, back);
    const heading = element('div', undefined, { className: 'visit-heading' });
    const title = element('div', undefined, { className: 'visit-title' }); title.append(element('h1', (language === 'ky' ? 'Үстөл ' : 'Стол ') + details.tableName), element('span', details.status === 'OPEN' ? t('busy') : language === 'ky' ? 'Жабык' : 'Закрыт', { className: 'visit-status' }));
    const subtitle = element('div', undefined, { className: 'visit-subtitle' }); subtitle.append(element('span', details.zoneName));
    const actor = element('div', undefined, { className: 'visit-opened' }); actor.append(element('span', (language === 'ky' ? 'Ачты: ' : 'Открыл: ') + (details.openedBy?.name ?? '—')));
    const elapsed = element('span', '', { className: 'visit-duration' }); actor.append(elapsed);
    const startedAt = performance.now(), serverStart = ctx.serverTime;
    const updateElapsed = () => { if (!elapsed.isConnected) return; elapsed.textContent = formatTableDuration(Math.max(0, Math.floor((serverStart + performance.now() - startedAt - details.openedAt) / 60000))); };
    subtitle.append(actor); heading.append(title, subtitle);
    const moreButton = element('button', '•••', { type: 'button', className: 'visit-more' }); moreButton.setAttribute('aria-label', language === 'ky' ? 'Кошумча аракеттер' : 'Дополнительные действия');
    header.append(back, heading, moreButton); root.append(header); updateElapsed(); const durationTimer = setInterval(() => { if (!elapsed.isConnected) clearInterval(durationTimer); else updateElapsed(); }, 30000);
    if (details.status !== 'OPEN') root.append(element('p', language === 'ky' ? 'Бул визит жабылды. Жаңы пакет жөнөтүү жана эсептешүү жеткиликсиз.' : 'Посещение закрыто. Отправка пакетов и расчёт недоступны.', { className: 'draft-status' }));
    const pendingBox = element('div', undefined, { className: 'visit-pending' }); root.append(pendingBox); await pending(pendingBox); if (!identity) return; local = await store.read();
    const blocked = Object.values(local.pending).some(p => p.draftScope === id);
    const editable = ctx.open && ctx.canSubmit && !blocked;
    const save = async fn => { local = await store.update(state => { if (Object.values(state.pending).some(p => p.draftScope === id)) throw Error('PENDING_COMMAND_REQUIRES_REVIEW'); const prior = state.drafts[id]; if (prior && prior.draftRevision !== draft.draftRevision) throw Error('DRAFT_REVISION_CONFLICT'); const next = structuredClone(draft); fn(next); next.lines = coalesceDraftLines(next.lines, menu.catalog); next.draftRevision++; state.drafts[id] = next; }); draft = local.drafts[id]; note(); };
    const draftPrice = line => { if(line.kind==='CUSTOM_AMOUNT')return Number.isSafeInteger(line.unitPrice)&&line.unitPrice>0?line.unitPrice:null; const item = menu.catalog?.items.find(i => i.id === line.itemId); return waiterUnitPrice(item, line.variantId, line.modifierIds, menu.availability, menu.catalog); };
    const draftTotal = () => draft.lines.reduce((sum, line) => { const unit = draftPrice(line); return unit === null ? NaN : sum + unit * line.quantity; }, 0);
    async function sendDraft(sourceButton) {
        if (!draft.lines.length) throw Error('DRAFT_EMPTY');
        const label = sourceButton.textContent; sourceButton.textContent = language === 'ky' ? 'Жөнөтүлүүдө...' : 'Отправляем...'; sourceButton.disabled = true;
        try {
            const body = { draftId: draft.draftId, draftRevision: draft.draftRevision, menuRevision: draft.menuRevision, lines: draft.lines, discount: live?.discount ?? draft.discount };
            const q = await api('visits/' + id + '/batches/prepare', body); if (q.menuChanged) throw Error('CONFIRMATION_STALE');
            const m = modal(language === 'ky' ? 'Пакетти текшерүү' : 'Проверить пакет'); m.d.classList.add('batch-preview-dialog');
            m.body.append(element('p', `${language === 'ky' ? 'Үстөл ' : 'Стол '}${details.tableName} · ${details.zoneName}`, { className: 'batch-preview-context' }));
            const preview = element('div', undefined, { className: 'batch-preview-lines' });
            for (const row of q.lines) {
                const line = element('div', undefined, { className: 'batch-preview-line' }), description = element('div', undefined, { className: 'batch-preview-description' });
                description.append(element('strong', displayName(row) || row.name), element('small', `${row.quantity} × ${money(row.unitPrice)} сом`));
                const labels = row.kind === 'SET' ? '' : snapshotLabels(row); if (labels) description.append(element('small', labels, { className: 'batch-preview-options' }));
                if (row.comment) description.append(element('small', row.comment, { className: 'batch-preview-comment' }));
                if (row.components?.length) for (const component of row.components) description.append(element('small', `${component.quantity * row.quantity} × ${displayName(component) || component.name}${snapshotLabels(component) ? ' · ' + snapshotLabels(component) : ''}`, { className: 'batch-preview-component' }));
                line.append(description, element('strong', money(row.total) + ' сом', { className: 'batch-preview-line-total' })); preview.append(line);
            }
            m.body.append(preview);
            const totals = element('div', undefined, { className: 'batch-preview-totals' });
            const totalLine = (label, amount, className = '') => { const row = element('div', undefined, { className }); row.append(element('span', label), element('strong', money(amount) + ' сом')); totals.append(row); };
            totalLine(language === 'ky' ? 'Жаңы пакеттин суммасы' : 'Сумма нового пакета', q.batchSubtotal, 'batch-preview-subtotal');
            totalLine(language === 'ky' ? 'Буйрутманын орто суммасы' : 'Подытог всего заказа', q.subtotal);
            if (q.discount) totalLine(language === 'ky' ? 'Арзандатуу' : 'Скидка', -q.discount);
            for (const fee of q.fees ?? []) totalLine(fee.name, fee.amount);
            m.body.append(totals, element('p', language === 'ky' ? 'Бул пакетти жөнөтүү, төлөм эмес.' : 'Отправка пакета не регистрирует оплату.', { className: 'batch-preview-note' }));
            const actions = element('div', undefined, { className: 'batch-preview-actions' }), cancel = m.d.querySelector('button'); cancel.textContent = language === 'ky' ? 'Себетке кайтуу' : 'Вернуться в корзину'; actions.append(cancel);
            const confirm = button(actions, 'confirm', async () => {
                const original = confirm.textContent; confirm.textContent = language === 'ky' ? 'Жөнөтүлүүдө...' : 'Отправляем...';
                try { await frozen('batch.submit', id, 'visits/' + id + '/batches/submit', { ...body, orderRevision: q.orderRevision, confirmationHash: q.confirmationHash }, id); m.d.close(); await visit(id); note(language === 'ky' ? 'Буйрутма жөнөтүлдү' : 'Заказ отправлен'); }
                catch (error) { if (activeCartDrawer) { m.d.close(); await renderCartDrawer(); } throw error; }
                finally { if (confirm.isConnected) confirm.textContent = original; }
            }, true);
            confirm.textContent = language === 'ky' ? 'Жөнөтүүнү ырастоо' : 'Подтвердить отправку'; m.body.append(actions);
        } finally { if (sourceButton.isConnected) { sourceButton.textContent = label; sourceButton.disabled = false; } }
    }
    const orders = element('section', undefined, { className: 'visit-orders' });
    const ordersTitle = element('div', undefined, { className: 'visit-section-title' }); ordersTitle.append(element('h2', language === 'ky' ? 'Буйрутмалар' : 'Заказы'), element('span', `${live?.lines?.length ?? 0} ${language === 'ky' ? 'позиция' : 'позиций'}`)); orders.append(ordersTitle);
    if (!batches.length) orders.append(element('p', language === 'ky' ? 'Азырынча жөнөтүлгөн пакеттер жок' : 'Отправленных пакетов пока нет', { className: 'visit-empty' }));
    for (const batch of batches) {
        const block = element('details', undefined, { className: 'visit-batch accepted-batch' }); block.open = true;
        const summary = element('summary'); const when = new Date(batch.submittedAt).toLocaleTimeString(language === 'ky' ? 'ky-KG' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
        const info = element('span', undefined, { className: 'visit-batch-info' });
        const acceptedLine = element('span', undefined, { className: 'accepted-heading' }); acceptedLine.append(element('strong', (language === 'ky' ? 'Кабыл алынды' : 'Принято') + (batch.sender?.name?.trim() ? ' · ' + batch.sender.name.trim() : '')), element('span', '', { className: 'accepted-heading-rule' }), element('time', when));
        info.append(acceptedLine, element('small', `Пакет №${batch.sequence}`));
        summary.append(info, element('span', '⌄', { className: 'batch-chevron', ariaHidden: 'true' })); block.append(summary);
        const content = element('div', undefined, { className: 'batch-lines' });
        for (const line of batch.lines) {
            const state = fulfillment?.lines.get(line.id);
            const portions = state?.portions ?? [];
            const currentComments = [...new Set(portions.map(portion => portion.comment).filter(Boolean))];
            const cancelled = !!state && state.currentQuantity === 0;
            const displayLine = state && !cancelled ? { ...line, quantity: state.currentQuantity, total: state.currentTotal, comment: currentComments.join(' · ') } : line;
            const row = visitItemRow(displayLine, false);
            if (cancelled) { row.classList.add('visit-item-cancelled'); row.querySelector('.visit-item-detail')?.append(element('span', language === 'ky' ? 'Жокко чыгарылды' : 'Отменено', { className: 'visit-item-cancelled-label' })); }
            if (state?.currentQuantity > 0 && details.status === 'OPEN') acceptedItemControls(row, live, line, state, fulfillment.orderRevision, id);
            content.append(row);
        }
        block.append(content); orders.append(block);
    }
    root.append(orders);
    function renderDraft() { updateCartBadge(); updateDraftIndicator(); }
    const catalog = element('section', undefined, { className: 'visit-catalog' }); catalog.hidden = true;
    const menuHeader = element('div', undefined, { className: 'menu-order-header' });
    const menuBack = element('button', '←', { type: 'button', className: 'menu-order-back' }); menuBack.setAttribute('aria-label', t('back'));
    menuBack.onclick = () => { closeCartDrawer(); catalog.hidden = true; document.body.classList.remove('waiter-menu'); window.scrollTo(0, 0); };
    const menuHeading = element('div', undefined, { className: 'menu-order-heading' }); menuHeading.append(element('h2', language === 'ky' ? 'Буйрутмага кошуу' : 'Добавить в заказ'), element('small', `${language === 'ky' ? 'Үстөл ' : 'Стол '}${details.tableName} · ${details.zoneName}`));
    const cartButton = element('button', undefined, { type: 'button', className: 'menu-cart-button' }); cartButton.setAttribute('aria-label', language === 'ky' ? 'Себетти ачуу' : 'Открыть корзину');
    const cartIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); cartIcon.setAttribute('viewBox', '0 0 24 24'); cartIcon.setAttribute('aria-hidden', 'true'); cartIcon.innerHTML = '<path d="M3 4h2l2.2 11.5h11.9L21 7H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>';
    const cartBadge = element('span', '', { className: 'menu-cart-badge' }); cartButton.append(cartIcon, cartBadge); cartButton.onclick = () => void run(() => openCartDrawer(cartButton), cartButton);
    menuHeader.append(menuBack, menuHeading);
    if(editable&&can('order.custom_item.create')) {
        const custom = element('button','+',{type:'button',className:'menu-custom-amount'});custom.setAttribute('aria-label',language==='ky'?'Эркин баа':'Произвольная цена');custom.title=language==='ky'?'Эркин баа':'Произвольная цена';
        custom.onclick=()=>{const m=modal(language==='ky'?'Эркин баадагы товар':'Товар с произвольной ценой');m.d.classList.add('waiter-custom-dialog');
            m.body.append(element('p',language==='ky'?'Бааны сом менен киргизиңиз. Товар ашканага жөнөтүлбөйт.':'Укажите цену в сомах. Позиция не отправляется на кухню.'));
            const value=field(m.body,language==='ky'?'Бир даананын баасы, сом':'Цена за единицу, сом');value.inputMode='decimal';value.autocomplete='off';value.placeholder='0,00';
            const total=element('div',undefined,{className:'waiter-custom-total'});total.append(element('span',language==='ky'?'Бир позиция үчүн':'За одну позицию'),element('strong','—'));m.body.append(total);
            const add=button(m.body,'add',async()=>{const unitPrice=cents(value.value.trim().replace(',','.'));if(unitPrice<=0)throw Error('INVALID_AMOUNT');await save(d=>{const line={lineId:uuid(),kind:'CUSTOM_AMOUNT',itemId:'CUSTOM_AMOUNT',variantId:null,modifierIds:[],quantity:1,comment:'',unitPrice};const existing=d.lines.find(row=>sameDraftConfig(row,line));if(existing){if(existing.quantity>=999)throw Error('INVALID_QUANTITY');existing.quantity++;}else d.lines.push(line);});m.d.close();renderDraft();note(language==='ky'?'Себетке кошулду':'Добавлено в корзину');},true);add.textContent=language==='ky'?'Себетке кошуу':'Добавить в корзину';
            value.oninput=()=>{let amount=null;try{amount=cents(value.value.trim().replace(',','.'));}catch{}total.querySelector('strong').textContent=amount>0?money(amount)+' сом':'—';add.disabled=!(amount>0);};value.oninput();value.focus();};menuHeader.append(custom);
    }
    menuHeader.append(cartButton);
    catalog.append(menuHeader);
    const menuControls = element('div', undefined, { className: 'menu-order-controls' });
    const search = field(menuControls, language === 'ky' ? 'Менюдан издөө' : 'Поиск по меню'); search.type = 'search'; search.autocomplete = 'off'; search.placeholder = language === 'ky' ? 'Тамактарды жана суусундуктарды издөө...' : 'Поиск блюд и напитков...';
    const categories = element('div', undefined, { className: 'menu-order-categories' }); menuControls.append(categories); catalog.append(menuControls);
    const list = element('div', undefined, { className: 'menu-order-grid' }); catalog.append(list);
    const searchable = [], categoryButtons = []; let selectedCategory = menu.catalog?.categories.find(c => !c.archived)?.id ?? null;
    for (const category of menu.catalog?.categories.filter(c => !c.archived) ?? []) {
        const chip = element('button', displayName(category), { type: 'button', className: 'menu-category-chip' }); chip.onclick = () => { selectedCategory = category.id; drawMenu(); }; categories.append(chip); categoryButtons.push({ button: chip, id: category.id });
    }
    for (const item of menu.catalog?.items.filter(i => !i.archived) ?? []) {
        const row = element('article', undefined, { className: 'menu-order-item' }); row.append(element('strong', displayName(item)));
        const variants = item.variants?.map(v => displayName(v)).filter(Boolean).join(' · '); if (variants) row.append(element('small', variants));
        const priceRow = element('div', undefined, { className: 'menu-order-item-bottom' });
        const prices = [item.price, ...(item.variants ?? []).map(v => v.price), ...(item.combinationPrices ?? []).map(c => c.price)].filter(v => Number.isFinite(v));
        priceRow.append(element('span', prices.length ? `${language === 'ky' ? 'баштап' : 'от'} ${money(Math.min(...prices))} сом` : '—'));
        const add = element('button', '+', { type: 'button', className: 'menu-order-add' }); add.setAttribute('aria-label', `${language === 'ky' ? 'Кошуу' : 'Добавить'} ${displayName(item)}`);
        add.onclick = () => run(() => addItem(item, menu, async line => { await save(d => { const existing = d.lines.find(row => sameDraftConfig(row, line)); if (existing) { if (existing.quantity + line.quantity > maxDraftQuantity(item)) throw Error('INVALID_QUANTITY'); existing.quantity += line.quantity; } else d.lines.push(line); }); renderDraft(); note(language === 'ky' ? 'Себетке кошулду' : 'Добавлено в корзину'); }), add);
        const unavailable = waiterSetBlocker(item, menu.catalog, menu.availability),availabilityReason=waiterAvailabilityReason(item,menu.availability); add.disabled = !editable || !!availabilityReason || !!unavailable;
        row.tabIndex = add.disabled ? -1 : 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', displayName(item));
        row.onclick = event => { if (!event.target.closest('button')) add.click(); };
        row.onkeydown = event => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); add.click(); } };
        if (unavailable) row.append(element('small', (language === 'ky' ? 'Жеткиликсиз: ' : 'Нет в наличии: ') + unavailable));
        priceRow.append(add); row.append(priceRow);if(availabilityReason)row.append(element('small',availabilityReason,{className:'menu-availability-reason'})); searchable.push({ row, item, name: [item.name, item.translations?.ru, item.translations?.ky].filter(Boolean).join(' ').toLocaleLowerCase() }); list.append(row);
    }
    const searchEmpty = element('p', language === 'ky' ? 'Тамак табылган жок' : 'Блюда не найдены', { className: 'menu-order-empty' }); searchEmpty.hidden = true; catalog.append(searchEmpty);
    function drawMenu() { const query = search.value.trim().toLocaleLowerCase(); let count = 0; for (const entry of searchable) { entry.row.hidden = query ? !entry.name.includes(query) : selectedCategory !== null && entry.item.categoryId !== selectedCategory; if (!entry.row.hidden) count++; } for (const entry of categoryButtons) entry.button.classList.toggle('active', entry.id === selectedCategory); searchEmpty.hidden = count > 0; }
    function updateCartBadge() { cartBadge.textContent = String(draft.lines.length); cartBadge.hidden = !draft.lines.length; }
    search.oninput = drawMenu; drawMenu(); updateCartBadge(); root.append(catalog);
    async function openCartDrawer(anchor) {
        if (activeCartDrawer) return;
        if (!Object.values(local.pending).some(record => record.draftScope === id)) { const merged = coalesceDraftLines(draft.lines, menu.catalog); if (JSON.stringify(merged) !== JSON.stringify(draft.lines)) await save(d => { d.lines = merged; }); }
        const backdrop = element('div', undefined, { className: 'cart-drawer-backdrop' });
        const drawer = element('aside', undefined, { className: 'cart-drawer' }); drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-label', `${language === 'ky' ? 'Үстөл ' : 'Стол '}${details.tableName}`);
        const top = element('div', undefined, { className: 'cart-drawer-header' }), titleBlock = element('div');
        titleBlock.append(element('h2', `${language === 'ky' ? 'Үстөл ' : 'Стол '}${details.tableName}`));
        const close = element('button', '×', { type: 'button', className: 'cart-drawer-close' }); close.setAttribute('aria-label', language === 'ky' ? 'Себетти жабуу' : 'Закрыть корзину'); close.onclick = () => closeCartDrawer();
        top.append(titleBlock, close); drawer.append(top);
        const summary = element('div', undefined, { className: 'cart-drawer-summary' }), list = element('div', undefined, { className: 'cart-drawer-list' }), bottom = element('div', undefined, { className: 'cart-drawer-bottom' }); drawer.append(summary, list, bottom);
        backdrop.onclick = () => closeCartDrawer(); document.body.append(backdrop, drawer); document.body.classList.add('cart-drawer-open');
        const escape = event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]') && !activeDraftPopover) { event.preventDefault(); closeCartDrawer(); } };
        document.addEventListener('keydown', escape); activeCartDrawer = { backdrop, drawer, anchor, escape, summary, list, bottom };
        history.pushState({ waiterCartDrawer: true }, '', location.href); renderDraft(); await renderCartDrawer(); close.focus();
    }
    async function renderCartDrawer() {
        const active = activeCartDrawer; if (!active) return;
        const state = await store.read(); if (activeCartDrawer !== active) return;
        const pendingRecord = Object.values(state.pending).find(p => p.draftScope === id), total = draftTotal(), priceValid = Number.isFinite(total) && draft.menuRevision === menu.revision;
        active.summary.replaceChildren(element('span', `${draft.lines.length} ${language === 'ky' ? 'позиция' : draft.lines.length === 1 ? 'позиция' : draft.lines.length < 5 ? 'позиции' : 'позиций'}`), element('strong', priceValid ? money(total) + ' сом' : '—'));
        active.list.replaceChildren();
        if (pendingRecord) {
            const warning = element('section', undefined, { className: 'cart-pending' }); warning.append(element('strong', t('pending')), element('p', pendingRecord.rejected || t('noAuto')));
            button(warning, 'check', async () => { const result = await api('commands/receipt', { operation: pendingRecord.operation, targetId: pendingRecord.targetId, envelope: pendingRecord.envelope }); if (result.state === 'COMMITTED') { await finish(pendingRecord, result.receipt); await visit(id); note(language === 'ky' ? 'Буйрутма жөнөтүлдү' : 'Заказ отправлен'); return; } note('NOT_RECORDED'); const retry = button(warning, 'retry', async () => { const m = modal(t('retry')); m.body.append(element('p', t('noAuto'))); button(m.body, 'confirm', async () => { await sendFrozen(pendingRecord); m.d.close(); await visit(id); }, true); }); retry.focus(); });
            if (pendingRecord.rejected) button(warning, 'clear', async () => { const m = modal(t('clear')); m.body.append(element('p', pendingRecord.rejected)); button(m.body, 'confirm', async () => { await store.update(s => { delete s.pending[pendingRecord.envelope.commandId]; }); m.d.close(); await renderCartDrawer(); }, true); });
            active.list.append(warning);
        }
        if (!draft.lines.length) {
            const empty = element('div', undefined, { className: 'cart-drawer-empty' }); empty.append(element('strong', language === 'ky' ? 'Себет бош' : 'Корзина пуста'), element('p', language === 'ky' ? 'Буйрутмага кошуу үчүн менюдан тамак тандаңыз.' : 'Выберите блюда из меню, чтобы добавить их в заказ.')); active.list.append(empty);
        }
        for (const line of draft.lines) {
            const item = menu.catalog?.items.find(i => i.id === line.itemId), unit = draftPrice(line), card = element('article', undefined, { className: 'cart-line-card' });
            const lineName = line.kind==='CUSTOM_AMOUNT'?(language==='ky'?'Белгисиз товар':'Неизвестный товар'):displayName(item) || line.itemId;
            const head = element('div', undefined, { className: 'cart-line-head' }), nameBox = element('div'); nameBox.append(element('strong', lineName));
            const labels = selectionLabels(item, line); if (labels) nameBox.append(element('small', labels)); if (line.comment) nameBox.append(element('small', line.comment, { className: 'cart-line-comment' }));
            const more = element('button', '•••', { type: 'button', className: 'cart-line-more' }); more.setAttribute('aria-label', `${language === 'ky' ? 'Позиция аракеттери' : 'Действия с позицией'} ${lineName}`); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
            more.disabled = !editable || !!pendingRecord;
            more.onclick = () => openDraftPopover(more, line.kind==='CUSTOM_AMOUNT'?null:() => {
                const m = modal(language === 'ky' ? 'Тамакка комментарий' : 'Комментарий к блюду');m.d.classList.add('cart-comment-dialog');
                m.body.append(element('strong',displayName(item)||line.itemId));if(labels)m.body.append(element('small',labels));
                m.body.append(element('p',language==='ky'?'Ашканага керектүү түшүндүрмөнү жазыңыз.':'Укажите пожелание для кухни.'));
                const comment = element('textarea', undefined, { value: line.comment || '', rows: 4, maxLength: 300, placeholder: language === 'ky' ? 'Мисалы: пиязсыз...' : 'Например: без лука, хорошо прожарить...' }); comment.setAttribute('aria-label', t('comment')); m.body.append(comment);
                const saveComment=button(m.body, 'save', async () => { await save(d => { const target = d.lines.find(l => l.lineId === line.lineId); if (!target) throw Error('DRAFT_REVISION_CONFLICT'); target.comment = comment.value; }); m.d.close(); renderDraft(); await renderCartDrawer(); }, true);saveComment.textContent=language==='ky'?'Комментарийди сактоо':'Сохранить комментарий';comment.focus();
            }, () => run(async () => { await save(d => { d.lines = d.lines.filter(l => l.lineId !== line.lineId); }); renderDraft(); updateCartBadge(); await renderCartDrawer(); }), true);
            head.append(nameBox, more); card.append(head);
            const bottomLine = element('div', undefined, { className: 'cart-line-bottom' }), controls = element('div', undefined, { className: 'cart-quantity' });
            const minus = element('button', '−', { type: 'button' }), count = element('span', String(line.quantity)), plus = element('button', '+', { type: 'button' });
            minus.setAttribute('aria-label', `${language === 'ky' ? 'Азайтуу' : 'Уменьшить'} ${lineName}`); plus.setAttribute('aria-label', `${language === 'ky' ? 'Көбөйтүү' : 'Увеличить'} ${lineName}`);
            minus.disabled = line.quantity <= 1 || !editable || !!pendingRecord; plus.disabled = !editable || !!pendingRecord;
            minus.onclick = () => run(async () => { await save(d => { const target = d.lines.find(l => l.lineId === line.lineId); if (!target || target.quantity <= 1) throw Error('INVALID_QUANTITY'); target.quantity--; }); renderDraft(); await renderCartDrawer(); }, minus);
            plus.onclick = () => run(async () => { await save(d => { const target = d.lines.find(l => l.lineId === line.lineId); const max = item?.kind === 'SET' ? Math.min(999, Math.floor(9999 / Math.max(...item.components.map(c => c.quantity)))) : 999; if (!target || target.quantity >= max) throw Error('INVALID_QUANTITY'); target.quantity++; }); renderDraft(); await renderCartDrawer(); }, plus);
            controls.append(minus, count, plus); bottomLine.append(controls, element('strong', unit === null ? '—' : money(unit * line.quantity) + ' сом')); card.append(bottomLine); active.list.append(card);
        }
        if (!priceValid && draft.lines.length) active.list.append(element('p', t('stale'), { className: 'cart-pending' }));
        active.bottom.replaceChildren(); const totalRow = element('div', undefined, { className: 'cart-drawer-total' }); totalRow.append(element('strong', t('total')), element('strong', priceValid ? money(total) + ' сом' : '—')); active.bottom.append(totalRow);
        const send = element('button', language === 'ky' ? '➤ Жөнөтүү' : '➤ Отправить', { type: 'button', className: 'cart-drawer-send' }); send.disabled = !editable || !!pendingRecord || !draft.lines.length || !priceValid;
        send.onclick = () => run(() => sendDraft(send), send); active.bottom.append(send);
    }
    const footer = element('footer', undefined, { className: 'visit-footer' });
    const amount = element('div', undefined, { className: 'visit-footer-total' }); amount.append(element('span', language === 'ky' ? 'Төлөөгө жалпы' : 'Итого к оплате'), element('strong', money(live?.total ?? 0) + ' сом')); footer.append(amount);
    const buttons = element('div', undefined, { className: 'visit-footer-actions' });
    const addButton = element('button', language === 'ky' ? '+ Кошуу' : '+ Добавить в заказ', { type: 'button', className: 'visit-add' });
    const draftClock = element('span', '◷', { className: 'visit-draft-clock', ariaHidden: 'true' }); addButton.append(draftClock);
    function updateDraftIndicator() { draftClock.hidden = !draft.lines.length; }
    addButton.onclick = () => { catalog.hidden = false; document.body.classList.add('waiter-menu'); window.scrollTo(0, 0); };
    const finishButton = element('button', language === 'ky' ? '✓ Төлөөгө' : '✓ К оплате', { type: 'button', className: 'primary visit-finish' });
    finishButton.disabled = details.status !== 'OPEN';
    finishButton.onclick = () => run(async () => { if (draft.lines.length) { const m = modal(language === 'ky' ? 'Жөнөтүлбөгөн долбоор' : 'Неотправленный черновик'); m.body.append(element('p', language === 'ky' ? 'Адегенде пакетти жөнөтүңүз же долбоорду өчүрүңүз.' : 'Сначала отправьте пакет или удалите позиции из черновика.')); return; } if (!details.hasAcceptedBatch && !live && can('table.close_empty')) { const m = modal(t('empty')); button(m.body, 'confirm', async () => { await frozen('tables/close-empty', id, 'tables/close-empty', { sessionId: id, revision: details.revision }); m.d.close(); await tables(); }, true); return; } if (live?.allowedActions?.includes('order.settle.table')) { const fresh = await api('orders/' + live.id); if (fresh.allowedActions?.includes('order.settle.table')) payment(fresh, id, details.tableName); else note(t('permission')); return; } const m = modal(language === 'ky' ? 'Эсептешүү' : 'Расчёт через кассира'); m.body.append(element('p', language === 'ky' ? 'Төлөмдү кассир жүргүзөт. Үстөл эсептешүүдөн кийин жабылат.' : 'Оплату проведёт кассир. Стол закроется после подтверждённого расчёта.')); }, finishButton);
    buttons.append(addButton, finishButton); footer.append(buttons); root.append(footer); renderDraft();
    async function assignmentDialog(kind) {
        const [snapshot, current] = await Promise.all([api('tables'), api('visits/' + id + '/details')]);
        if (snapshot.settings.mode !== 'SHARED' || current.status !== 'OPEN' || current.responsibleWaiter?.id !== identity.employeeId) throw Error('SHARED_ASSIGNMENT_UNAVAILABLE');
        const changingWaiter = kind === 'RESPONSIBLE';
        const options = changingWaiter ? (await api('tables/waiters')).filter(waiter => waiter.id !== identity.employeeId) : snapshot.tables.filter(table => table.state === 'FREE' && table.active && table.id !== current.tableId);
        const dialog = modal(changingWaiter ? language === 'ky' ? 'Үстөлдү өткөрүү' : 'Передать стол' : language === 'ky' ? 'Буйрутманы башка үстөлгө көчүрүү' : 'Перенести заказ на другой стол');
        dialog.d.classList.add('visit-assignment-dialog');
        dialog.body.append(element('p', changingWaiter ? language === 'ky' ? 'Жаңы жооптуу официантты тандаңыз. Буйрутма жана тарых сакталат.' : 'Выберите нового ответственного официанта. Заказ и история сохранятся.' : language === 'ky' ? 'Бош үстөлдү тандаңыз. Буйрутма жана төлөм суммасы сакталат.' : 'Выберите свободный стол. Заказ и сумма к оплате сохранятся.'));
        if (!options.length) { dialog.body.append(element('p', changingWaiter ? language === 'ky' ? 'Башка активдүү официант жок.' : 'Нет другого активного официанта.' : language === 'ky' ? 'Бош үстөл жок.' : 'Нет свободных столов.')); return; }
        const choices = changingWaiter ? options.map(waiter => [waiter.id, waiter.name]) : options.map(table => [table.id, (snapshot.zones.find(zone => zone.id === table.zoneId)?.name ?? '') + ' · ' + table.name]);
        const target = select(dialog.body, changingWaiter ? language === 'ky' ? 'Жооптуу официант' : 'Ответственный' : language === 'ky' ? 'Үстөл' : 'Стол', choices);
        const confirm = button(dialog.body, 'confirm', async () => {
            const payload = changingWaiter ? { sessionId: id, responsibleWaiterId: target.value, revision: current.revision } : { sessionId: id, tableId: target.value, revision: current.revision };
            await frozen(changingWaiter ? 'tables/responsible' : 'tables/move', id, changingWaiter ? 'tables/responsible' : 'tables/move', payload, id);
            dialog.d.close(); await visit(id); note(changingWaiter ? language === 'ky' ? 'Жооптуу официант өзгөрдү' : 'Ответственный официант изменён' : language === 'ky' ? 'Буйрутма башка үстөлгө көчүрүлдү' : 'Заказ перенесён на другой стол');
        }, true);
        confirm.textContent = changingWaiter ? language === 'ky' ? 'Өткөрүү' : 'Передать стол' : language === 'ky' ? 'Көчүрүү' : 'Перенести заказ';
    }
    moreButton.onclick = () => run(async () => { const snapshot = await api('tables'), ownShared = snapshot.settings.mode === 'SHARED' && details.status === 'OPEN' && details.responsibleWaiter?.id === identity.employeeId; const m = modal(language === 'ky' ? 'Аракеттер' : 'Действия'); m.d.classList.add('visit-actions-dialog');
        m.body.append(element('p', `${language === 'ky' ? 'Үстөл ' : 'Стол '}${details.tableName} · ${details.zoneName}`, { className: 'visit-actions-context' }));
        const cards = element('div', undefined, { className: 'visit-actions-grid' }); m.body.append(cards);
        const actionCard = (key, icon, fn, danger = false) => { const control = button(cards, key, fn); const label = control.textContent; control.classList.add('visit-action-card'); if (danger) control.classList.add('danger'); control.replaceChildren(visitActionIcon(icon), element('span', label)); return control; };
        actionCard('refresh', 'refresh', async () => { m.d.close(); await visit(id); });
        if (ownShared && can('table.responsible.change')) actionCard(language === 'ky' ? 'Үстөлдү өткөрүү' : 'Передать стол', 'transfer', async () => { m.d.close(); await assignmentDialog('RESPONSIBLE'); });
        if (ownShared && can('table.move') && details.tableId) actionCard(language === 'ky' ? 'Буйрутманы көчүрүү' : 'Перенести заказ', 'move', async () => { m.d.close(); await assignmentDialog('MOVE'); });
        if (live?.allowedActions?.includes('order.discount.set')) actionCard('discount', 'discount', () => { m.d.close(); const d = modal(t('discount')), value = field(d.body, 'discount', money(live.discount)); button(d.body, 'save', async () => { await frozen('order.discount', live.id, 'orders/' + live.id + '/discount', { expectedRevision: live.revision, amount: cents(value.value) }); d.d.close(); await visit(id); }); });
        if(live?.allowedActions?.includes('order.cancel')) actionCard(language==='ky'?'Буйрутманы толук жокко чыгаруу':'Отменить весь заказ', 'cancel', ()=>{m.d.close();cancelAcceptedDish(live,null,live.lines,id,true);}, true);
        if (live && can('payment.incident.record')) actionCard('incident', 'incident', () => { m.d.close(); incident(live, id); });
        if (!details.hasAcceptedBatch && can('table.close_empty') && !draft.lines.length) actionCard('empty', 'empty', async () => { const d = modal(t('empty')); button(d.body, 'confirm', async () => { await frozen('tables/close-empty', id, 'tables/close-empty', { sessionId: id, revision: details.revision }); d.d.close(); m.d.close(); await tables(); }); }, true);
    });
}
function visitItemRow(line, draft) {
    const row = element('div', undefined, { className: 'visit-item' });
    const detail = element('div', undefined, { className: 'visit-item-detail' });
    detail.append(element('strong', displayName(line) || line.name || '—'));
    const unit = line.unitPrice ?? (Number.isFinite(line.total) && line.quantity ? line.total / line.quantity : null);
    detail.append(element('small', unit === null || line.total === null ? t('stale') : `${line.quantity} × ${money(unit)} сом`));
    const labels = snapshotLabels(line); if (labels) detail.append(element('small', labels)); if (line.comment) detail.append(element('small', line.comment));
    const total = element('strong', line.total === null ? '—' : money(line.total) + ' сом', { className: 'visit-item-total' });
    detail.append(total); row.append(detail);
    return row;
}
function acceptedItemControls(row, order, line, state, orderRevision, visitId) {
    const controls = element('div', undefined, { className: 'accepted-item-controls' });
    if (order?.allowedActions?.includes('order.correct')) {
        const more = element('button', '•••', { type: 'button', className: 'accepted-item-more' });
        more.setAttribute('aria-label', (language === 'ky' ? 'Тамактын аракеттери: ' : 'Действия с блюдом: ') + (displayName(line) || line.name));
        more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
        more.onclick = () => openDraftPopover(more, line.kind === 'CUSTOM_AMOUNT' ? null : () => commentAcceptedDish(order, line, state, visitId), () => cancelAcceptedDish(order, line, state.portions, visitId), false, true);
        controls.append(more);
    }
    let issued = state.fulfillment?.issuedQuantity ?? 0, pendingMark = false, blockedMark = false;
    const max = state.currentQuantity;
    if (can('order.fulfillment.mark')) {
        const counter = element('div', undefined, { className: 'accepted-fulfillment' });
        counter.append(element('small', language === 'ky' ? 'Берилди' : 'Выдано'));
        const buttons = element('div', undefined, { className: 'accepted-fulfillment-buttons' });
        const minus = element('button', '−', { type: 'button' }), plus = element('button', '+', { type: 'button' }), count = element('strong');
        minus.setAttribute('aria-label', language === 'ky' ? 'Берилген санды азайтуу' : 'Уменьшить выданное количество'); plus.setAttribute('aria-label', language === 'ky' ? 'Берилген санды көбөйтүү' : 'Увеличить выданное количество');
        const paint = () => { count.textContent = `${issued} / ${max}`; minus.disabled = pendingMark || blockedMark || issued === 0; plus.disabled = pendingMark || blockedMark || issued >= max; };
        const mark = async next => { if (pendingMark) return; pendingMark = true; paint();
            try { const result = await frozen('order.fulfillment.mark', order.id, 'orders/' + order.id + '/fulfillment/mark', { itemId: line.id, issuedQuantity: next, expectedRevision: state.fulfillment.revision, expectedOrderRevision: orderRevision });
                issued = result.issuedQuantity; state.fulfillment.revision = result.revision; state.fulfillment.issuedQuantity = result.issuedQuantity;
                note(language === 'ky' ? 'Берүү жаңыртылды' : 'Выдача обновлена');
            } catch (error) {
                if ([409, 403].includes(error.status)) { const at = window.scrollY; await visit(visitId); window.scrollTo(0, at); }
                else { blockedMark = true; const box = document.querySelector('.visit-pending'); if (box) { box.replaceChildren(); await pending(box); } }
                throw error;
            } finally { pendingMark = false; if (row.isConnected) paint(); }
        };
        minus.onclick = () => run(() => mark(issued - 1)); plus.onclick = () => run(() => mark(issued + 1));
        buttons.append(minus, count, plus); counter.append(buttons); controls.append(counter); paint();
    } else controls.append(element('small', `${language === 'ky' ? 'Берилди' : 'Выдано'} ${issued} / ${max}`, { className: 'accepted-fulfillment-readonly' }));
    row.append(controls);
}
function commentAcceptedDish(order, line, state, visitId) {
    const portions = state.portions.filter(p => p.quantity > 0); if (!portions.length) return;
    const m = modal(language === 'ky' ? 'Комментарийди өзгөртүү' : 'Изменить комментарий'); m.d.classList.add('accepted-action-dialog');
    m.body.append(element('strong', displayName(line) || line.name));
    const selected = portions.length > 1 ? select(m.body, language === 'ky' ? 'Бөлүк' : 'Порция', portions.map((p, i) => [String(i), `${i + 1} · ${p.quantity} × ${money(p.unitPrice)} сом`])) : null;
    const counter = element('div',undefined,{className:'accepted-cancel-counter',role:'group'}),minus=element('button','−',{type:'button','aria-label':t('quantity')+' −'}),number=element('strong','0',{role:'status','aria-live':'polite'}),plus=element('button','+',{type:'button','aria-label':t('quantity')+' +'});
    counter.append(minus,number,plus);m.body.append(counter);let count=0;
    const selectedPortion=()=>portions[Number(selected?.value??0)];
    const refreshCounter=()=>{const max=selectedPortion().quantity;counter.hidden=max===1;if(max===1)count=1;else count=Math.min(count,max);number.textContent=String(count);minus.disabled=count===0;plus.disabled=count===max;if(submit)submit.disabled=count===0;};
    minus.onclick=()=>{count=Math.max(0,count-1);refreshCounter();};plus.onclick=()=>{count=Math.min(selectedPortion().quantity,count+1);refreshCounter();};
    const comment = field(m.body, language === 'ky' ? 'Жаңы комментарий' : 'Новый комментарий', portions[0].comment ?? ''); comment.maxLength = 300;
    if (selected) selected.onchange = () => { count=0;comment.value=selectedPortion().comment??'';refreshCounter(); };
    const submit = button(m.body, 'check', async () => {
        const portion = selectedPortion();
        if (count < 1 || count > portion.quantity) return;
        const request = { action: 'CHANGE_COMMENT', targets: [{ itemId: line.id, portionId: portion.portionId ?? portion.id, quantity: count }], comment: comment.value };
        const quote = await api('orders/' + order.id + '/corrections/prepare', request);
        await frozen('order.correct', order.id, 'orders/' + order.id + '/corrections/commit', { ...request, expectedOrderRevision: quote.expectedOrderRevision, expectedVisitRevision: quote.expectedVisitRevision, shiftId: quote.shiftId, confirmationHash: quote.confirmationHash });
        m.d.close(); await visit(visitId); note(language === 'ky' ? 'Комментарий жаңыртылды' : 'Комментарий обновлён');
    }, true); submit.textContent = language === 'ky' ? 'Комментарийди сактоо' : 'Сохранить комментарий';refreshCounter();
}
function cancelAcceptedDish(order,line,portions,id,whole=false){
    const m=modal(whole?(language==='ky'?'Буйрутманы жокко чыгаруу':'Отменить весь заказ'):(language==='ky'?'Тамакты жокко чыгаруу':'Отменить блюдо'));m.d.classList.add('accepted-action-dialog');
    m.body.append(element('strong',whole?(language==='ky'?'Бүт буйрутма':'Весь заказ'):(displayName(line)||line.name||'—')));
    const available=portions.reduce((sum,p)=>sum+p.quantity,0);let selected=whole?available:1,quote=null,request=null;
    if(!whole){m.body.append(element('p',(language==='ky'?'Жокко чыгарууга болот: ':'Доступно для отмены: ')+available));
        const counter=element('div',undefined,{className:'accepted-cancel-counter'}),minus=element('button','−',{type:'button'}),number=element('strong','1'),plus=element('button','+',{type:'button'});
        minus.setAttribute('aria-label',language==='ky'?'Санды азайтуу':'Уменьшить количество отмены');plus.setAttribute('aria-label',language==='ky'?'Санды көбөйтүү':'Увеличить количество отмены');counter.append(minus,number,plus);m.body.append(counter);
        minus.onclick=()=>{selected=Math.max(1,selected-1);refresh();};plus.onclick=()=>{selected=Math.min(available,selected+1);refresh();};
        function refresh(){number.textContent=String(selected);minus.disabled=selected===1;plus.disabled=selected===available;reset();}
        minus.disabled=true;plus.disabled=available<=1;
    }else m.body.append(element('p',language==='ky'?'Заказ жана сумма жокко чыгарылат. Ашканага жокко чыгаруу чеги жөнөтүлөт.':'Заказ и сумма будут отменены. Сервер создаст чек отмены для кухни.'));
    const warning=element('p','',{className:'accepted-cancel-warning'});m.body.append(warning);
    m.body.append(element('p',language==='ky'?'Себебин тандаңыз':'Выберите причину'));
    const quick=element('div',undefined,{className:'accepted-cancel-reasons'}),chips=[];let selectedReason='';
    const reasonLabel=element('label',language==='ky'?'Башка себеп':'Другая причина'),reason=element('input',undefined,{type:'text',maxLength:300});reason.setAttribute('aria-label',language==='ky'?'Башка себеп':'Другая причина');reasonLabel.className='accepted-cancel-other';reasonLabel.hidden=true;reasonLabel.append(reason);
    for(const [index,label] of (language==='ky'?['Конок оюн өзгөрттү','Жаңылыш кошулган','Тамак жок','Башка']:['Гость передумал','Добавлено по ошибке','Блюдо недоступно','Другое']).entries()){
        const chip=element('button',label,{type:'button'});chip.setAttribute('aria-pressed','false');chip.onclick=()=>{selectedReason=index===3?'other':label;reasonLabel.hidden=index!==3;if(index!==3)reason.value='';for(const item of chips)item.setAttribute('aria-pressed',String(item===chip));reset();if(index===3)reason.focus();};quick.append(chip);chips.push(chip);
    }m.body.append(quick,reasonLabel);
    const reasonText=()=>selectedReason==='other'?reason.value.trim():selectedReason;
    const impact=element('div',undefined,{className:'accepted-cancel-impact'});impact.hidden=true;m.body.append(impact);
    const confirm=button(m.body,'check',async()=>{
        if(!reasonText())throw Error('INVALID_REASON');
        if(!quote){const targets=[];let remaining=selected;for(const p of portions){if(!remaining)break;const count=Math.min(remaining,p.quantity);targets.push({itemId:p.itemId,portionId:p.portionId??p.id,quantity:count});remaining-=count;}
            if(remaining)throw Error('INVALID_QUANTITY');request=whole?{action:'CANCEL_ORDER',reason:reasonText()}:{action:targets.length>1?'GROUP_CANCEL':'CANCEL_QUANTITY',targets,reason:reasonText()};quote=await api('orders/'+order.id+'/corrections/prepare',request);
            impact.replaceChildren(element('span',(language==='ky'?'Жаңы сумма: ':'Новая сумма: ')+money(quote.total)+' сом'));impact.hidden=false;confirm.textContent=language==='ky'?'Жокко чыгарууну ырастоо':'Подтвердить отмену';return;
        }
        await frozen('order.correct',order.id,'orders/'+order.id+'/corrections/commit',{...request,expectedOrderRevision:quote.expectedOrderRevision,expectedVisitRevision:quote.expectedVisitRevision,shiftId:quote.shiftId,confirmationHash:quote.confirmationHash});m.d.close();if(quote.remaining===0)await tables();else await visit(id);note(language==='ky'?'Жокко чыгарылды':'Отменено');
    },true);confirm.textContent=language==='ky'?'Жокко чыгарууну текшерүү':'Проверить отмену';
    function reset(){quote=null;request=null;impact.hidden=true;if(confirm)confirm.textContent=language==='ky'?'Жокко чыгарууну текшерүү':'Проверить отмену';if(confirm)confirm.disabled=!reasonText()||(!whole&&selected===order.lines.reduce((sum,p)=>sum+p.quantity,0)&&!can('order.cancel'));warning.textContent=!whole&&selected===order.lines.reduce((sum,p)=>sum+p.quantity,0)?language==='ky'?'Акыркы тамак: буйрутма жабылат, үстөл бошойт.':'Последнее блюдо: заказ закроется, стол освободится.':'';}
    reason.oninput=reset;reset();
}
async function addItem(item, menu, accept) {
    const variants = item.variants ?? [], groups = item.groups ?? [];
    const requiresChoice = variants.length > 0 || groups.some(group => group.options?.length > 0);
    if (!requiresChoice) {
        if (waiterUnitPrice(item, null, [], menu.availability, menu.catalog) === null) throw Error('COMBINATION_UNAVAILABLE');
        await accept({ lineId: uuid(), itemId: item.id, variantId: null, modifierIds: [], quantity: 1, comment: '' });
        return;
    }
    chooseItem(item, menu, accept);
}
function chooseItem(item, menu, accept) {
    const d = element('dialog', undefined, { className: 'variant-dialog' });
    const head = element('div', undefined, { className: 'variant-dialog-header' });
    const title = element('div'); title.append(element('h2', displayName(item)), element('p', language === 'ky' ? 'Вариантты тандаңыз' : 'Выберите вариант'));
    const close = element('button', '×', { type: 'button', className: 'variant-dialog-close' }); close.setAttribute('aria-label', t('cancel')); close.onclick = () => d.close(); head.append(title, close);
    const content = element('div', undefined, { className: 'variant-dialog-content' });
    const footer = element('div', undefined, { className: 'variant-dialog-footer' });
    let selectedVariant = null;
    const selectedGroups = new Map(), choiceButtons = [];
    const addGroup = (label, choices, key, max, min) => {
        const section = element('section', undefined, { className: 'variant-choice-group' }); section.append(element('h3', label));
        const grid = element('div', undefined, { className: 'variant-choice-grid' }); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', label);
        for (const choice of choices) {
            const selected = key === 'variant' ? false : selectedGroups.get(key)?.has(choice.id) ?? false;
            const chip = element('button', displayName(choice), { type: 'button', className: 'variant-choice-chip' }); chip.setAttribute('aria-pressed', String(selected));
            chip.disabled = !(menu.availability?.[choice.id]?.available ?? choice.available);
            chip.onclick = () => {
                if (key === 'variant') selectedVariant = choice.id;
                else { let set = selectedGroups.get(key); if (!set) { set = new Set(); selectedGroups.set(key, set); }
                    if (set.has(choice.id)) set.delete(choice.id);
                    else if (max === 1) { set.clear(); set.add(choice.id); }
                    else if (set.size < max) set.add(choice.id);
                }
                refresh();
            };
            choiceButtons.push({ chip, choiceId: choice.id, key }); grid.append(chip);
        }
        section.append(grid); if (min === 0) section.append(element('small', language === 'ky' ? 'Каалоо боюнча' : 'Необязательно')); content.append(section);
    };
    if (item.variants?.length) addGroup(language === 'ky' ? 'Өлчөм' : 'Размер', item.variants, 'variant', 1, 1);
    for (const group of item.groups ?? []) addGroup(displayName(group), group.options, group.id, group.max, group.min);
    const priceBox = element('div', undefined, { className: 'variant-price' });
    priceBox.append(element('small', language === 'ky' ? 'ТАМАКТЫН БААСЫ' : 'ЦЕНА БЛЮДА'));
    const amount = element('strong', '—'), hint = element('p', language === 'ky' ? 'Вариантты тандаңыз' : 'Выберите вариант'); priceBox.append(amount); footer.append(priceBox, hint);
    const actions = element('div', undefined, { className: 'variant-dialog-actions' });
    const cancel = element('button', t('cancel'), { type: 'button' }); cancel.onclick = () => d.close();
    const add = element('button', t('add'), { type: 'button', className: 'primary' }); add.disabled = true;
    add.onclick = () => run(async () => {
        const modifierIds = (item.groups ?? []).flatMap(group => [...(selectedGroups.get(group.id) ?? [])]);
        if (waiterUnitPrice(item, selectedVariant, modifierIds, menu.availability, menu.catalog) === null) throw Error('COMBINATION_UNAVAILABLE');
        await accept({ lineId: uuid(), itemId: item.id, variantId: selectedVariant, modifierIds, quantity: 1, comment: '' });
        d.close();
    }, add);
    actions.append(cancel, add); footer.append(actions); d.append(head, content, footer);
    const refresh = () => {
        for (const { chip, choiceId, key } of choiceButtons) chip.setAttribute('aria-pressed', String(key === 'variant' ? selectedVariant === choiceId : selectedGroups.get(key)?.has(choiceId) ?? false));
        const modifierIds = (item.groups ?? []).flatMap(group => [...(selectedGroups.get(group.id) ?? [])]);
        const price = waiterUnitPrice(item, selectedVariant, modifierIds, menu.availability, menu.catalog);
        amount.textContent = price === null ? '—' : money(price) + ' сом'; add.disabled = price === null;
        hint.textContent = price === null ? language === 'ky' ? 'Жеткиликтүү вариантты тандаңыз' : 'Выберите доступный вариант' : '';
    };
    refresh();
    d.addEventListener('click', event => { if (event.target === d) { const rect = d.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) d.close(); } });
    d.onclose = () => d.remove(); document.body.append(d); d.showModal();
}
function payment(order, id, tableName = '') {
    const context = (language === 'ky' ? 'Үстөл ' : 'Стол ') + (tableName || order.tableName || '—');
    const dialog = modal(language === 'ky' ? 'Эсептешүү' : 'Расчёт'); dialog.d.classList.add('waiter-payment-dialog');
    dialog.body.append(element('p', context, { className: 'waiter-payment-context' }));
    const amount = element('div', undefined, { className: 'waiter-payment-total' }); amount.append(element('span', language === 'ky' ? 'Төлөөгө' : 'К оплате'), element('strong', money(order.total) + ' сом')); dialog.body.append(amount);
    const info = element('p', language === 'ky' ? 'Ыкманы басуу акчаны алгандыгыңызды ырастайт. Которууну банк колдонмосунан алдын ала текшериңиз.' : 'Нажатие способа подтверждает получение денег. Перевод сначала проверьте в банковском приложении.', { className: 'waiter-payment-hint' }); dialog.body.append(info);
    const actions = element('div', undefined, { className: 'waiter-payment-actions' }); dialog.body.append(actions);
    let paying = false;
    const keepOpenDuringPayment = d => { d.addEventListener('cancel', event => { if (paying) event.preventDefault(); }); d.addEventListener('click', event => { if (paying && event.target === d) event.stopImmediatePropagation(); }, true); };
    keepOpenDuringPayment(dialog.d);
    const submit = async (selection, activeDialog = dialog) => {
        if (paying) return; paying = true;
        const controls = [...activeDialog.d.querySelectorAll('button,input,select')]; for (const control of controls) control.disabled = true;
        try {
            const quote = await api('orders/' + order.id + '/settlements/prepare', { payment: selection });
            if (quote.total !== order.total) throw Error('CONFIRMATION_STALE');
            await frozen('order.settle', order.id, 'orders/' + order.id + '/settlements/commit', { payment: selection, expectedOrderRevision: quote.expectedOrderRevision, expectedVisitRevision: quote.expectedVisitRevision, shiftId: quote.shiftId, confirmationHash: quote.confirmationHash });
            activeDialog.d.close(); await tables(); note(language === 'ky' ? 'Эсептешүү сакталды' : 'Расчёт сохранён');
        } catch (error) {
            if (['RESULT_UNKNOWN','CONFIRMATION_STALE','ORDER_REVISION_CONFLICT','ORDER_NOT_OPEN','PERMISSION_DENIED'].includes(error.message)) { activeDialog.d.close(); await visit(id); }
            throw error;
        } finally { paying = false; for (const control of controls) if (control.isConnected) control.disabled = false; }
    };
    const payButton = (label, selection, className) => { const control = element('button', label, { type: 'button', className }); control.onclick = () => run(() => submit(selection)); actions.append(control); return control; };
    if (order.total === 0) { payButton(language === 'ky' ? 'Төлөмсүз бүтүрүү' : 'Завершить без оплаты', { kind: 'ZERO' }, 'waiter-payment-choice'); return; }
    payButton(language === 'ky' ? 'Накталай' : 'Наличные', { kind: 'SINGLE', method: 'CASH' }, 'waiter-payment-choice cash');
    payButton(language === 'ky' ? 'Которуу' : 'Перевод', { kind: 'SINGLE', method: 'QR_TRANSFER_MANUAL' }, 'waiter-payment-choice transfer');
    const mixed = element('button', language === 'ky' ? 'Аралаш' : 'Смешанная', { type: 'button', className: 'waiter-payment-choice mixed' }); actions.append(mixed);
    mixed.onclick = () => {
        dialog.d.close(); const m = modal(language === 'ky' ? 'Аралаш төлөм' : 'Смешанная оплата'); m.d.classList.add('waiter-payment-dialog','waiter-mixed-dialog'); keepOpenDuringPayment(m.d);
        m.body.append(element('p', context, { className: 'waiter-payment-context' }), element('p', (language === 'ky' ? 'Жалпы: ' : 'Итого: ') + money(order.total) + ' сом', { className: 'waiter-mixed-total' }));
        const methods = [['CASH',language === 'ky' ? 'Накталай' : 'Наличные'],['QR_TRANSFER_MANUAL',language === 'ky' ? 'Которуу' : 'Перевод'],['CARD_MANUAL',language === 'ky' ? 'Карта (кол менен)' : 'Карта (вручную)']];
        const first = select(m.body,language === 'ky' ? 'Биринчи ыкма' : 'Первый способ',methods), firstAmount = field(m.body,language === 'ky' ? 'Биринчи сумма, сом' : 'Первая сумма, сом');
        firstAmount.inputMode='decimal'; firstAmount.autocomplete='off'; firstAmount.placeholder='0,00';
        const second = select(m.body,language === 'ky' ? 'Экинчи ыкма' : 'Второй способ',methods); second.value='QR_TRANSFER_MANUAL';
        const remainder = element('div',undefined,{className:'waiter-payment-remainder'}); m.body.append(remainder);
        const submitMixed = button(m.body,'confirm',async()=>{const value=cents(firstAmount.value.trim().replace(',','.'));if(value<=0||value>=order.total||first.value===second.value)throw Error('INVALID_PAYMENT_SPLIT');await submit({kind:'MIXED',firstMethod:first.value,firstAmount:value,secondMethod:second.value},m);},true);
        submitMixed.textContent=language === 'ky' ? 'Төлөө' : 'Оплатить';
        const update = () => { let value=0;try{value=cents(firstAmount.value.trim().replace(',','.'));}catch{}const valid=value>0&&value<order.total&&first.value!==second.value;remainder.textContent=(language === 'ky'?'Экинчи ыкмага калганы: ':'Остаток вторым способом: ')+money(Math.max(0,order.total-value))+' сом';submitMixed.disabled=!valid;};
        firstAmount.oninput=update;first.onchange=update;second.onchange=update;update();
    };
}
function correction(order, line, draft, id) { const m = modal(t('correct')), action = select(m.body, 'correct', [['CANCEL_QUANTITY', t('cancelQty')], ['CHANGE_COMMENT', t('changeComment')], ['REPLACE_ITEM', t('replace')]]), quantity = field(m.body, 'quantity', String(line.quantity), 'number'), reason = field(m.body, 'reason'), comment = field(m.body, 'comment', line.comment); m.body.append(element('p', t('replacement'))); button(m.body, 'check', async () => { const request = { action: action.value, targets: [{ itemId: line.itemId, portionId: line.portionId, quantity: Number(quantity.value) }], reason: reason.value, comment: comment.value, replacement: action.value === 'REPLACE_ITEM' ? { draftId: draft.draftId, draftRevision: draft.draftRevision, menuRevision: draft.menuRevision, lines: draft.lines, discount: order.discount } : undefined }; const q = await api('orders/' + order.id + '/corrections/prepare', request), confirm = modal(t('correct')); confirm.body.append(element('p', t('total') + ': ' + money(q.total) + ' сом'), element('p', reason.value)); button(confirm.body, 'confirm', async () => { await frozen('order.correct', order.id, 'orders/' + order.id + '/corrections/commit', { ...request, expectedOrderRevision: q.expectedOrderRevision, expectedVisitRevision: q.expectedVisitRevision, shiftId: q.shiftId, confirmationHash: q.confirmationHash }); if (action.value === 'REPLACE_ITEM')
    await store.update(s => { delete s.drafts[id]; }); confirm.d.close(); m.d.close(); await visit(id); }, true); }); }
function incident(order, id) { const m = modal(t('incident')), amount = field(m.body, 'amount'), method = select(m.body, 'pay', [['CASH', t('cash')], ['CARD_MANUAL', t('card')], ['QR_TRANSFER_MANUAL', t('qr')]]), reason = field(m.body, 'reason'); button(m.body, 'save', async () => { await frozen('payment.incident', order.id, 'payment-incidents', { orderId: order.id, draftId: null, sourceCommandId: null, receipts: [{ method: method.value, amount: cents(amount.value) }], reason: reason.value }); m.d.close(); await visit(id); }); }
window.addEventListener('storage', event => { if (event.key === 'waiter-lock-event') { if (identity) lock(false); else if (httpResume) { sessionStorage.removeItem(httpSessionKey); sessionStorage.removeItem(httpHiddenKey); } } });
$('open-menu').onclick = () => run(openSidebar);
$('open-profile').onclick = () => run(profilePage);
$('sidebar-backdrop').onclick = () => closeSidebar();
window.addEventListener('popstate', () => { if (activeCartDrawer) closeCartDrawer(true); else if (!$('sidebar').hidden) closeSidebar(true); });
$('lock').onclick = () => lock();
$('logout').onclick = () => run(async () => { const request=api('session/logout',{}).catch(()=>{});lock();await request; });
$('language').onchange = () => { language = $('language').value; localStorage.setItem('waiter-language', language); document.documentElement.lang = language; if (identity)
    void run(() => currentSection === 'settings' ? settingsPage() : currentSection === 'menu' ? menuBrowse() : currentSection === 'profile' ? profilePage() : currentSection === 'help' ? helpPage() : visitId ? visit(visitId) : tables());
else
    login(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) {
    backgroundAt = Date.now();
    if (httpResume && identity) sessionStorage.setItem(httpHiddenKey, String(backgroundAt));
    lockTimer = setTimeout(() => { if (identity)
        lock(); }, BACKGROUND_LOCK_MS);
}
else {
    clearTimeout(lockTimer);
    const hiddenAt = backgroundAt || (httpResume ? Number(sessionStorage.getItem(httpHiddenKey) ?? 0) : 0);
    if (hiddenAt && Date.now() - hiddenAt >= BACKGROUND_LOCK_MS) {
        if (identity) lock();
        else if (httpResume) { sessionStorage.removeItem(httpSessionKey); sessionStorage.removeItem(httpHiddenKey); }
    } else if (httpResume) sessionStorage.removeItem(httpHiddenKey);
    backgroundAt = 0;
    if(identity&&!visitId&&refreshTableSnapshot)void refreshTableSnapshot().catch(()=>{});
} });
let activityAt = 0;
for (const event of ['pointerdown', 'keydown'])
    document.addEventListener(event, () => { if (identity && Date.now() - activityAt > 30000) {
        activityAt = Date.now();
        void api('session/activity', {}).catch(() => { });
    } }, true);
window.addEventListener('offline', () => note(t('noAuto')));
window.addEventListener('online', () => note(t('noAuto')));
if (navigator.serviceWorker?.register)
    void navigator.serviceWorker.register('/waiter/sw.js', { scope: '/waiter/' }).catch(() => { });
void resumeHttpSession();
setInterval(async () => {
    if (!waiterMenuChanged || !identity || document.hidden || document.querySelector('dialog[open]') || activeCartDrawer || currentSection !== 'menu' && document.activeElement?.matches('input,textarea,select')) return;
    waiterMenuChanged = false;
    try {
        if (currentSection === 'menu') { const search=document.querySelector('.waiter-section input[type="search"]'),focused=document.activeElement===search;await menuBrowse(search?.value ?? '');if(focused)document.querySelector('.waiter-section input[type="search"]')?.focus(); }
        else if (visitId) { const id=visitId; visitCache.delete(id); await visit(id); }
    } catch (error) { waiterMenuChanged = true; if (error.status === 401) lock(); }
}, 1000);
let polling = false;
let tablePolling=false;
setInterval(async()=>{if(!identity||document.hidden||visitId!==null||!refreshTableSnapshot||tablePolling||document.querySelector('dialog[open]'))return;tablePolling=true;try{await refreshTableSnapshot();}catch(e){if(e.status===403&&identity)await run(tables);}finally{tablePolling=false;}},3000);
setInterval(async () => { if (!identity || document.hidden || polling)
    return; polling = true; try {
    const current = await api('session/me'), changed = JSON.stringify(current.permissions) !== JSON.stringify(identity.permissions);
    identity.permissions = current.permissions;
    if (visitId) {
        const id = visitId, details = await api('visits/' + id + '/details'), cached = visitCache.get(id);
        if ((changed || details.revision !== cached?.details.revision) && !document.querySelector('dialog[open]') && !document.activeElement?.matches('input,textarea,select'))
            await visit(id);
    }
    else if (changed)
        await tables();
}
catch (e) {
    if (e.status === 403 && identity) {
        epoch++;
        document.querySelectorAll('dialog').forEach(d => d.remove());
        visitCache.clear();
        visitId = null;
        $('app').replaceChildren();
        await run(tables);
        fail(e);
    }
}
finally {
    polling = false;
} }, 15000);
