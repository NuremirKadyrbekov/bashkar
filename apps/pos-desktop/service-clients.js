'use strict';
function initServiceClientUi(ru, ky) {Object.assign(ru,{printWidth:'Ширина печати, точек',printFeed:'Подача после чека, точек',kitchenTextSize:'Размер текста кухни',kitchenNormal:'Обычный',kitchenLarge:'Крупный',kitchenPreview:'Предпросмотр кухонного чека',kitchenPreviewHint:'Образец показывает переносы. Перед работой проверьте реальную бумагу тестовым чеком.',kitchenSettings:'Кухонный чек · бумага 80 мм'});Object.assign(ky,{printWidth:'Басып чыгаруунун туурасы, чекит',printFeed:'Чектен кийинки берүү, чекит',kitchenTextSize:'Ашкана текстинин өлчөмү',kitchenNormal:'Кадимки',kitchenLarge:'Чоң',kitchenPreview:'Ашкана чегин алдын ала көрүү',kitchenPreviewHint:'Үлгү саптардын бөлүнүшүн көрсөтөт. Иштөөдөн мурун кагазды сыноо чеги менен текшериңиз.',kitchenSettings:'Ашкана чеги · 80 мм кагаз'});ru.printDisconnected='Задания печати сохраняются в очереди. Передача в Windows не подтверждает получение бумаги.';ky.printDisconnected='Басып чыгаруу тапшырмалары кезекте сакталат. Windowsка тапшыруу кагаз алынганын ырастабайт.'; Object.assign(ru, { printing: 'Печать', waiterNetwork: 'Официанты', printSettings: 'Принтеры и маршруты', printQueue: 'Очередь печати', printTest: 'Тестовый чек', printReason: 'Причина решения', printConfirm: 'Подтвердить решение', printRisk: 'Я проверил очередь Windows и бумагу. Повтор или изменение маршрута может создать дубликат.', printUnknown: 'UNKNOWN: результат передачи неизвестен. Автоматический повтор запрещён; проверьте бумагу и очередь Windows.', printSent: 'SENT означает передачу в Windows, получение бумаги проверяется на принтере.', printerQueue: 'Очередь Windows', receiptMode: 'На принтере подтверждён режим чеков ESC/POS и бумага 80 мм', configurePrinter: 'Сохранить принтер', configureRoute: 'Сохранить маршрут', printPrimary: 'Основной принтер', printBackup: 'Резервный принтер', none: 'Не задан', kitchen: 'Кухня', customerReceipt: 'Клиентский чек', importTls: 'Импортировать TLS bundle', exportRoot: 'Сохранить публичный root certificate', originChange: 'При изменении IP/порта потребуется повторная настройка телефонов и перенос старых черновиков до смены адреса.', networkTrust: 'Установите публичный root certificate на Android/iPhone. На iPhone отдельно включите полное доверие SSL. Вход только по HTTPS без обхода предупреждений.', printDetails: 'Открыть задание', nextPrint: 'Следующая страница', resolveDiagnostic: 'Завершить проверку тестового чека', retrySafe: 'Повторить безопасную ошибку', reprint: 'Повторная печать', redirect: 'Перенаправить на резервный', handoff: 'Передано кухне вручную', noPrint: 'Завершить без печати', releaseLate: 'Разрешить позднюю печать', assignRoute: 'Назначить маршрут' }); Object.assign(ky, { printing: 'Басып чыгаруу', waiterNetwork: 'Официанттар', printSettings: 'Принтерлер жана багыттар', printQueue: 'Басып чыгаруу кезеги', printTest: 'Сыноо чеги', printReason: 'Чечимдин себеби', printConfirm: 'Чечимди ырастоо', printRisk: 'Windows кезеги жана кагаз текшерилди. Кайталоо же багыт өзгөртүү дубликат чыгарышы мүмкүн.', printUnknown: 'UNKNOWN: жөнөтүүнүн жыйынтыгы белгисиз. Автоматтык кайталоого тыюу салынат; кагазды жана Windows кезегин текшериңиз.', printSent: 'SENT Windowsка тапшырылганын билдирет. Кагазды принтерден текшериңиз.', printerQueue: 'Windows кезеги', receiptMode: 'Принтерде ESC/POS чек режими жана 80 мм кагаз ырасталды', configurePrinter: 'Принтерди сактоо', configureRoute: 'Багытты сактоо', printPrimary: 'Негизги принтер', printBackup: 'Резервдик принтер', none: 'Берилген эмес', kitchen: 'Ашкана', customerReceipt: 'Кардардын чеги', importTls: 'TLS bundle импорттоо', exportRoot: 'Жалпы root certificate сактоо', originChange: 'IP/порт өзгөрсө телефондорду кайра жөндөө керек. Эски долбоорлорду дарек өзгөргөнгө чейин өткөрүңүз.', networkTrust: 'Android/iPhoneго жалпы root certificate орнотуңуз. iPhoneдо толук SSL ишенимин өзүнчө күйгүзүңүз. HTTPS аркылуу гана кириңиз.', printDetails: 'Тапшырманы ачуу', nextPrint: 'Кийинки бет', resolveDiagnostic: 'Сыноо чегин текшерүүнү бүтүрүү', retrySafe: 'Коопсуз катаны кайталоо', reprint: 'Кайра басып чыгаруу', redirect: 'Резервдик принтерге жөнөтүү', handoff: 'Ашканага кол менен берилди', noPrint: 'Басып чыгарбай бүтүрүү', releaseLate: 'Кеч басып чыгарууга уруксат', assignRoute: 'Багыт дайындоо' }); }
// Later waiter onboarding labels override the older technical network heading.
function initWaiterOnboardingUi(ru,ky){
Object.assign(ru,{waiterNetwork:'Настройка веб-экрана',waiterWifi:'Подключите телефон к рабочему Wi-Fi, отсканируйте QR и введите личный PIN.',waiterNoLink:'QR появится после запуска экрана официанта.',waiterCopy:'Скопировать ссылку',waiterCopied:'Ссылка скопирована',waiterTeam:'Официанты филиала',waiterCreate:'Создать официанта',waiterNoTeam:'Официантов пока нет.',waiterStatusReady:'Готов к входу',waiterStatusMissing:'PIN не выдан',waiterStatusSuspended:'Доступ приостановлен',waiterNoStaffAccess:'Список официантов доступен сотруднику с правом просмотра персонала.',waiterLanIp:'IP компьютера в рабочей Wi-Fi сети',waiterLanMissing:'Локальный IP не найден. Подключите компьютер к сети ресторана и нажмите «Обновить».',waiterHttpPort:'Порт экрана официанта',waiterHttpEnable:'Включить HTTP и показать QR',waiterHttpChange:'Изменить HTTP-адрес',waiterHttpRisk:'HTTP MVP: PIN и заказы передаются по локальной сети без шифрования. Подключайте к этой сети только доверенные устройства.'});
Object.assign(ky,{waiterNetwork:'Веб-экранды жөндөө',waiterWifi:'Телефонду иш Wi-Fi тармагына туташтырып, QR скандап, жеке PIN киргизиңиз.',waiterNoLink:'QR официант экраны иштегенден кийин чыгат.',waiterCopy:'Шилтемени көчүрүү',waiterCopied:'Шилтеме көчүрүлдү',waiterTeam:'Филиалдын официанттары',waiterCreate:'Официант түзүү',waiterNoTeam:'Азырынча официант жок.',waiterStatusReady:'Кирүүгө даяр',waiterStatusMissing:'PIN берилген эмес',waiterStatusSuspended:'Кирүү токтотулган',waiterNoStaffAccess:'Официанттардын тизмеси кызматкерлерди көрүү укугу менен жеткиликтүү.',waiterLanIp:'Компьютердин иш Wi-Fi тармагындагы IP дареги',waiterLanMissing:'Жергиликтүү IP табылган жок. Компьютерди ресторан тармагына туташтырып, «Жаңыртуу» басыңыз.',waiterHttpPort:'Официант экранынын порту',waiterHttpEnable:'HTTP иштетип QR көрсөтүү',waiterHttpChange:'HTTP дарегин өзгөртүү',waiterHttpRisk:'HTTP MVP: PIN жана заказдар жергиликтүү тармакта шифрленбейт. Бул тармакка ишенимдүү түзмөктөрдү гана туташтырыңыз.'});
}
function clientCheck(parent, key) { const l = el('label'), i = el('input', undefined, { type: 'checkbox' }); l.append(i, document.createTextNode(t(key))); parent.append(l); return i; }
function clientSelect(parent, key, choices) { const l = el('label', t(key)), s = el('select'); s.setAttribute('aria-label', t(key)); for (const [v, name] of choices)
    s.append(el('option', name, { value: v })); l.append(s); parent.append(l); return s; }
async function printingView() { me = await api('me'); const section = shell(t('printing')); section.append(el('p', t('printSent'))); button(section, 'refresh', printingView); if (me.permissions.includes('print.settings.manage'))
    button(section, 'printSettings', printerSettings); if (!me.permissions.includes('print.queue.view'))
    return; let after = 0; const list = el('div'); section.append(list); const load = async () => { const data = await api('printQueue', { after, limit: 20 }); for (const job of data.jobs) {
    const card = el('article', undefined, { className: 'card' });
    card.append(el('h2', (job.role === 'KITCHEN' ? t('kitchen') : t('customerReceipt')) + ' · ' + job.state), el('p', (job.header?.tableName ?? job.header?.counterNumber ?? '') + ' · ' + new Date(job.createdAt).toLocaleString()));
    if (job.state === 'UNKNOWN')
        card.append(el('p', t('printUnknown')));
    if (job.blocked)
        card.append(el('p', 'DEPENDENCY_BLOCKED'));
    button(card, 'printDetails', () => printJobDialog(job.id));
    list.append(card);
} after = data.next; more.hidden = after === null; }; const more = button(section, 'nextPrint', load); await load(); }
async function printJobDialog(dispatchId) { const job = await api('printDetails', { dispatchId }), m = shiftModal('printDetails'); m.body.append(el('p', job.role + ' · ' + job.state),el('p',effectivePrintText(job.state))); for (const line of job.payload.lines ?? [])
    m.body.append(el('p', line.quantity + ' × ' + line.name + (line.comment ? ' · ' + line.comment : ''))); if (job.state === 'UNKNOWN')
    m.body.append(el('p', t('printUnknown'))); for (const event of job.events)
    m.body.append(el('p', new Date(event.createdAt).toLocaleString() + ' · ' + event.state + ' · ' + JSON.stringify(event.details))); const actions = { RETRY_SAFE: ['print.retry_safe', 'retrySafe'], REPRINT: ['print.reprint', 'reprint'], REDIRECT: ['print.redirect', 'redirect'], MANUAL_HANDOFF: ['print.manual_handoff', 'handoff'], RESOLVE_NO_PRINT: ['print.resolve_no_print', 'noPrint'], RELEASE_LATE: ['print.release_late', 'releaseLate'], ASSIGN_ROUTE: ['print.settings.manage', 'assignRoute'] }; for (const [action, [permission, label]] of Object.entries(actions)) {
    const eligible=action==='RETRY_SAFE'?job.state==='FAILED_SAFE'&&job.attemptCount>=5:action==='REPRINT'?['SENT','UNKNOWN','MANUAL_HANDOFF','RESOLVED_NO_PRINT'].includes(job.state):action==='MANUAL_HANDOFF'?job.role==='KITCHEN'&&!['SENT','MANUAL_HANDOFF','RESOLVED_NO_PRINT','CLAIMED','IN_PROGRESS'].includes(job.state):action==='RESOLVE_NO_PRINT'?!['SENT','MANUAL_HANDOFF','RESOLVED_NO_PRINT','CLAIMED','IN_PROGRESS'].includes(job.state):action==='ASSIGN_ROUTE'?job.state==='UNCONFIGURED':action==='RELEASE_LATE'?['LEGACY_REVIEW','LATE_REVIEW','UNCONFIGURED','PENDING'].includes(job.state):!['CLAIMED','IN_PROGRESS'].includes(job.state);if (!eligible||!me.permissions.includes(permission))
        continue;
    button(m.footer, label, () => { const confirm = shiftModal(label), reason = field(confirm.body, 'printReason'), risk = clientCheck(confirm.body, 'printRisk'); let targetDeviceId = null; if (action === 'REDIRECT') {
        const select = clientSelect(confirm.body, 'printBackup', []);
        api('printTargets', { dispatchId }).then(devices => { for (const d of devices)
            select.append(el('option', d.name, { value: d.id })); targetDeviceId = select.value || null; }).catch(handleError);
        select.onchange = () => { targetDeviceId = select.value || null; };
    } shiftCommit(confirm, 'printConfirm', async () => { const input = { action, reason: reason.value, expectedRevision: job.revision, targetDeviceId, riskConfirmed: risk.checked }, q = await api('printActionPrepare', { dispatchId, ...input }); await api('printActionCommit', { dispatchId, ...input, confirmationHash: q.confirmationHash }); confirm.dialog.close(); m.dialog.close(); await printingView(); }); });
} }
async function printerSettings() {
    const [inventory, devices, routes, diagnostics] = await Promise.all([api('printInventory').catch(error => { message(error.message); return []; }), api('printDevices'), api('printRoutes'), api('printDiagnostics')]), m = shiftModal('printSettings');
    button(m.body, 'refresh', async () => { m.dialog.close(); await printerSettings(); });
    for (const d of devices)
        m.body.append(el('p', d.queueName + ' · ' + d.portName + ' · rev ' + d.revision));
    m.body.append(el('h3',t('kitchenSettings')));const queue = clientSelect(m.body, 'printerQueue', inventory.map(d => [d.queueName, d.queueName + ' / ' + d.portName])), confirmed = clientCheck(m.body, 'receiptMode'),width=field(m.body,'printWidth','576','number'),feed=field(m.body,'printFeed','24','number'),textSize=clientSelect(m.body,'kitchenTextSize',[['NORMAL',t('kitchenNormal')],['LARGE',t('kitchenLarge')]]);width.min='384';width.max='608';width.step='8';feed.min='0';feed.max='96';const profile=()=>({model:'XP-365B',mode:'ESC_POS_RECEIPT',dpi:203,width:Number(width.value),feed:Number(feed.value),cutter:false,kitchenTextSize:textSize.value});const showProfile=()=>{const prior=devices.find(d=>d.queueName===queue.value);width.value=String(prior?.profile.width??576);feed.value=String(prior?.profile.feed??24);textSize.value=prior?.profile.kitchenTextSize??'NORMAL';confirmed.checked=false;};queue.onchange=showProfile;showProfile();const previewBox=el('div',undefined,{className:'card kitchen-preview'}),previewImage=el('img',undefined,{alt:t('kitchenPreview')}),previewHint=el('p',t('kitchenPreviewHint'));previewImage.style.maxWidth='100%';previewImage.style.height='auto';previewImage.style.display='block';previewBox.append(el('h3',t('kitchenPreview')),previewImage,previewHint);m.body.append(previewBox);button(previewBox,'kitchenPreview',async()=>{const result=await api('printKitchenPreview',profile());previewImage.src=result.image;});
    button(m.body, 'configurePrinter', async () => { const existing = devices.find(d => d.queueName === queue.value), input = { deviceId: existing?.id ?? null, expectedRevision: existing?.revision ?? 0, queueName: queue.value, profile: profile(), receiptModeConfirmed: confirmed.checked }, q = await api('printDevicePrepare', input); await api('printDeviceSave', { ...input, deviceId: q.deviceId, confirmationHash: q.confirmationHash }); m.dialog.close(); await printerSettings(); });
    for (const role of ['KITCHEN', 'CUSTOMER']) {
        const box = el('section', undefined, { className: 'card' });
        box.append(el('h3', t(role === 'KITCHEN' ? 'kitchen' : 'customerReceipt')));
        const route = routes.find(r => r.role === role), primary = clientSelect(box, 'printPrimary', devices.map(d => [d.id, d.queueName])), backup = clientSelect(box, 'printBackup', [['', t('none')], ...devices.map(d => [d.id, d.queueName])]);
        if (route) {
            primary.value = route.deviceId;
            backup.value = route.backupId ?? '';
        }
        button(box, 'configureRoute', async () => { const input = { role, expectedRevision: route?.revision ?? 0, deviceId: primary.value, backupId: backup.value || null }, q = await api('printRoutePrepare', input); await api('printRouteSave', { ...input, confirmationHash: q.confirmationHash }); m.dialog.close(); await printerSettings(); });
        m.body.append(box);
    }
    for (const d of devices){const testButton=button(m.body, 'printTest', async () => { await api('printTest', { deviceId: d.id, expectedDeviceRevision: d.revision }); m.dialog.close(); await printerSettings(); });testButton.textContent=t('printTest')+' · '+d.queueName;}
    for (const test of diagnostics) {
        const card = el('div', undefined, { className: 'card' });
        card.append(el('p', test.id + ' · ' + test.state));
        if (['UNKNOWN', 'FAILED_SAFE', 'PENDING'].includes(test.state))
            button(card, 'resolveDiagnostic', () => { const c = shiftModal('resolveDiagnostic'), reason = field(c.body, 'printReason'), risk = clientCheck(c.body, 'printRisk'); shiftCommit(c, 'printConfirm', async () => { await api('printDiagnosticResolve', { dispatchId: test.id, expectedRevision: test.revision, reason: reason.value, riskConfirmed: risk.checked }); c.dialog.close(); m.dialog.close(); await printerSettings(); }); });
        m.body.append(card);
    }
}
async function waiterNetworkView() {
    me = await api('me');
    const data = await api('waiterNetwork'), section = shell(t('waiterNetwork'));
    document.getElementById('screen').scrollTop=0;
    const statusLabels=lang==='ky'?{WEB_HTTP_READY:'HTTP экраны иштеп жатат. Телефонду ушул Wi-Fi тармагына туташтырыңыз.',WEB_READY:'HTTPS экраны иштеп жатат.',WEB_HTTP_CONFIG_INVALID:'HTTP дареги же порт туура эмес. Локалдык сервердин орнотуусун текшериңиз.',WEB_INTERFACE_UNAVAILABLE:'Тандалган IP компьютерде жок. Wi-Fi дарегин текшериңиз.',WEB_PORT_IN_USE:'Бул портту башка программа колдонуп жатат.',WEB_UNCONFIGURED:'Официант экраны азырынча орнотулган эмес.',WEB_LISTENER_UNAVAILABLE:'Официант экранын иштетүү мүмкүн болгон жок.'}:{WEB_HTTP_READY:'HTTP-экран работает. Подключите телефон к этой сети Wi-Fi.',WEB_READY:'HTTPS-экран работает.',WEB_HTTP_CONFIG_INVALID:'Неверный HTTP-адрес или порт. Проверьте настройку локального сервера.',WEB_INTERFACE_UNAVAILABLE:'Указанного IP нет на этом компьютере. Проверьте адрес Wi-Fi.',WEB_PORT_IN_USE:'Порт занят другой программой.',WEB_UNCONFIGURED:'Экран официанта ещё не настроен.',WEB_LISTENER_UNAVAILABLE:'Не удалось запустить экран официанта.'};
    const connection=el('div',undefined,{className:'waiter-connection card'});
    const details=el('div',undefined,{className:'waiter-connection-details'});
    details.append(el('h2',statusLabels[data.code]??data.code),el('p',data.code,{className:'muted'}));
    if(data.listening&&data.url){
        details.append(el('strong',data.url,{className:'waiter-url'}));
        button(details,'waiterCopy',async()=>{await api('waiterCopyUrl');message(t('waiterCopied'));});
        details.append(el('p',t('waiterWifi')));
    }else details.append(el('p',t('waiterNoLink')));
    connection.append(details);
    if(data.listening&&data.qrDataUrl)connection.append(el('img',undefined,{src:data.qrDataUrl,alt:data.url,width:240,height:240,className:'waiter-qr'}));
    section.append(connection);
    if(data.mode==='HTTP_MVP')section.append(el('p',t('waiterHttpRisk')));
    else if(data.listening)section.append(el('p',t('networkTrust')),el('p',t('originChange')));
    {
        const setup=el('div',undefined,{className:'waiter-http-setup card'});
        setup.append(el('h2',data.mode==='HTTP_MVP'?t('waiterHttpChange'):t('waiterHttpEnable')));
        if(data.localIps?.length){
            const ip=clientSelect(setup,'waiterLanIp',data.localIps.map(value=>[value,value]));
            if(data.ip&&data.localIps.includes(data.ip))ip.value=data.ip;
            const port=field(setup,'waiterHttpPort',String(data.mode==='HTTP_MVP'?data.port:3002),'number');
            button(setup,'waiterHttpEnable',async()=>{await api('waiterNetworkHttp',{ip:ip.value,port:Number(port.value)});await waiterNetworkView();});
            if(data.mode!=='HTTP_MVP')setup.append(el('p',t('waiterHttpRisk')));
            setup.append(el('p',t('originChange')));
        }else setup.append(el('p',t('waiterLanMissing')));
        section.append(setup);
    }
    if (data.rootFingerprint) section.append(el('p', data.rootFingerprint));
    if (data.validUntil) section.append(el('p', new Date(data.validUntil).toLocaleString() + ' · ' + data.daysRemaining));
    if (data.mode !== 'HTTP_MVP') {
        button(section, 'importTls', async () => {
            const m = shiftModal('importTls'), ack = clientCheck(m.body, 'originChange');
            button(m.body, 'importTls', async () => {
                const prepared = await api('waiterNetworkImport', { expectedRevision: data.revision, acknowledgeOriginChange: ack.checked });
                if (prepared.cancelled) return;
                m.body.append(el('p', prepared.ip + ':' + prepared.port), el('p', prepared.rootFingerprint), el('p', new Date(prepared.validUntil).toLocaleString()));
                shiftCommit(m, 'printConfirm', async () => { await api('waiterNetworkCommit', { stagingId: prepared.stagingId, expectedRevision: data.revision, confirmationHash: prepared.confirmationHash }); m.dialog.close(); await waiterNetworkView(); });
            });
        });
        if (data.rootCertificate) button(section, 'exportRoot', () => api('waiterRootExport'));
    }
    button(section, 'refresh', waiterNetworkView);
    section.append(el('h2',t('waiterTeam')));
    if(me.permissions?.includes('employee.edit')){
        const employees=(await api('employees')).filter(employee=>employee.role==='WAITER'&&employee.status!=='DEACTIVATED');
        if(!employees.length)section.append(el('p',t('waiterNoTeam')));
        for(const employee of employees){
            const card=el('article',undefined,{className:'card'});
            const status=employee.status!=='ACTIVE'?'waiterStatusSuspended':employee.pinIssued?'waiterStatusReady':'waiterStatusMissing';
            card.append(el('h3',employee.name),el('p',t(status)+' · '+employee.login));
            if(employee.status==='ACTIVE'&&me.permissions?.includes(employee.pinIssued?'employee.pin.reset':'employee.pin.issue'))button(card,employee.pinIssued?'pinReset':'pinIssue',async()=>{
                if(employee.pinIssued&&!await confirmAction(t('pinResetHint')))return;
                const result=await api(employee.pinIssued?'pinReset':'pinIssue',{employeeId:employee.id,revision:employee.revision});
                await waiterNetworkView();
                if(result.temporaryPin)showPinCard(result.temporaryPin,employee.name,employee.id);else message(t('pinAlreadyIssued'));
            });
            section.append(card);
        }
        if(me.permissions.includes('employee.create'))button(section,'waiterCreate',async()=>{screen='employees';await render();});
    }else section.append(el('p',t('waiterNoStaffAccess'),{className:'muted'}));
}

function effectivePrintText(state){const messages={UNCONFIGURED:['Принтер не назначен','Принтер дайындала элек'],PENDING:['В очереди','Кезекте'],CLAIMED:['Подготовка','Даярдалууда'],IN_PROGRESS:['Передача в Windows','Windowsка жөнөтүлүүдө'],SENT:['Передано в Windows; проверьте бумагу','Windowsка тапшырылды; кагазды текшериңиз'],FAILED_SAFE:['Не отправлено; безопасная ошибка','Жөнөтүлгөн жок; коопсуз ката'],UNKNOWN:['Результат неизвестен; повтор требует проверки','Жыйынтык белгисиз; кайталоо үчүн текшерүү керек'],MANUAL_HANDOFF:['Передано кухне вручную','Ашканага кол менен берилди'],RESOLVED_NO_PRINT:['Завершено без печати','Басып чыгарбай бүтүрүлдү'],LEGACY_REVIEW:['Старая очередь требует проверки','Эски кезекти текшерүү керек'],LATE_REVIEW:['Поздняя печать требует разрешения','Кеч басып чыгарууга уруксат керек']};return messages[state]?.[lang==='ky'?1:0]??state;}
