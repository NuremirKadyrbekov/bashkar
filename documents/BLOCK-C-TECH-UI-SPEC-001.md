> **Уточнение 29.10.2026.** Исторический план/срез ниже сохраняет прежний idle Waiter 3 часа; действующий лимит Waiter Web — 6 часов, абсолютный срок 12 часов, блокировка экрана в фоне — 120 секунд. См. [WAITER-UI-007](WAITER-UI-007%20Открытие%20стола%20и%20предпросмотр%20пакета.md).

> **Сверка 24.10.2026.** Исторический план/срез: фразы «сейчас», «ещё нет» и номера source/schema ниже относятся к дате исходной поставки. Дальнейшая реализация — в DOCS-AUDIT-001. [Актуальное состояние и решения](DOCS-AUDIT-001.md).

# BASHKAR.KG — блок C: Waiter Web и физическая USB-печать

Дата:23 октября2026, Asia/Bishkek. Версия:0.1.

**Статус: R-C1…R-C8 подтверждены пользователем 23.10.2026; блок C реализован локально.** Фактические контракты: API-WAITER-009.md, API-PRINT-010.md; результаты и аппаратная приёмка: BLOCK-C-ACCEPTANCE-001.md. Исходный аудит ниже относится к состоянию до реализации. Ниже отдельно исходные согласованные правила, новые рекомендации и аппаратная приёмка. Блоки A/B и существующие финансовые ограничения сохраняются.

## 1. Подтверждённые условия и текущий аудит

Папка `/Users/a1234/Desktop/bashkar.kg`. Основания: NEXT-DEVELOPMENT-002 §6; CORE «Столы, посещения и пакеты», «Меню», «Оплаты», «Отмены», «Нестандартные ситуации» §9; AUTH-001/AUTH-002; BACKEND-001 D01/D02/D06; фактические API-ORDERS-005, API-AUTH-006, API-FINANCE-007 и API-SHIFT-FINANCE-008.

**Ответы пользователя23.10.2026:**

- Два отдельных **Xprinter XP-365B**, бумага **80мм**, **USB**. Оба подключены к компьютеру кассы. Первый — кухня, второй — клиентский чек.
- Пока доступен **только локальный IP**, без домена. Телефоны — **Android и iPhone**.
- Реальный LAN IP, способ его закрепления, версии Windows/телефонов, имена Windows-очередей, USB-идентификаторы и установленный режим принтеров ещё не проверены. Это поля внедрения, а не причины подставить выдуманные значения.

| Область | Что действительно есть | Чего пока нет |
|---|---|---|
| Source/SQLite | 0.8.0-shift-finance/schema8, миграции001–008; Local POS Server, CommandBus, audit/outbox/receipts | Новых C-таблиц и реализации C |
| Native API | Fastify на127.0.0.1; строгий Host/JSON, browser headers запрещены, WAITER_WEB на native API отклоняется | LAN HTTPS-listener, cookie/CSRF web-adapter, Waiter UI |
| Авторизация | PIN для Cashier/Waiter, audience, grant/revoke, idle Waiter3h/absolute12h; PinService.login умеет WAITER_WEB внутри | PIN reserve допускает только loopback source; безопасного LAN source attribution ещё нет |
| TABLE | STRICT/SHARED, посещения/ответственный, Batch/Item, скидки/корректировки, исторические snapshots | Телефонного управления и browser draft lifecycle |
| Деньги | TABLE/COUNTER/PAID/ZERO, Refund, close/report, защищённая24h история | Waiter payment UI; Refund/Reversal/Recovery официанту не выдаются |
| Печать | Immutable print_jobs.status=PENDING, payload v1/v2; KITCHEN/CUSTOMER; NEW_BATCH/CANCEL/CHANGE_COMMENT/SETTLEMENT; зависимости | Worker, attempt/claim/result, Windows USB adapter, конфигурация и queue UI |
| Каталог | kitchen:boolean определяет печатаемые позиции | Кухонных станций/маршрутов по блюдам; для двух заданных принтеров они не требуются |
| Desktop | Зашифрованные native pending/drafts, RU/KY, экраны A/B | QR/диагностика Waiter, queue/actions/config печати |
| Windows | Скрипты отдельной службы/поставки в infrastructure/windows-service | Приёмки schema8/C и USB под LocalService на реальной кассе |

Свежие проверки аудита: **pnpm run check PASS; pnpm exec vitest run PASS —25 файлов/141 тест**. Vitest запускался без сборки в рабочий dist. TypeScript отдельно собран в `/private/tmp/bashkar-block-c-audit-compiled`: **66 JS-файлов побайтно совпали с dist**, включая process-fixtures. Это static/fixture проверки, не новый Electron/Windows/phone/physical-print прогон.

Git без коммитов, исходники untracked; пустой diff не доказывает неизменность. Сохранены SHA256182 исходных файлов apps/infrastructure/documents и основных корневых файлов. Финальная SHA256-проверка подтвердила: все182 существующих файла без изменений, добавлено только это ТЗ. .local/MANGO/ключи/регистрации/рабочие БД/OPEN-смены/драйверы/настройки роутера и телефонов не затрагивались.

## 2. Границы и решения для подтверждения

Не пересогласовываются: одна авторитетная SQLite на филиал; commit до успеха; печать вне business transaction; два типа документов KITCHEN/CUSTOMER; фильтр kitchen по исторической настройке; номер Batch на кухонной бумаге отсутствует; COUNTER маркируется «НА ВЫНОС»; UNKNOWN без автоповтора; исходник→корректировка; закрытая смена не вызывает автоматическую позднюю кухонную печать. Desktop не открывается PIN официанта, Cashier PIN не открывает Waiter. Полномочия/STRICT/SHARED/авторство/ответственный сохраняются.

| ID | Рекомендуемое решение | Что утверждается |
|---|---|---|
| R-C1 | Для текущего локального IP — HTTPS с отдельным CA филиала и доверенной установкой публичного root certificate на каждый телефон; постоянный LAN IP | Без HTTP-входа и обхода предупреждений; выдача/renewal/ответственный и ручная подготовка телефонов входят в сетевой PoC |
| R-C2 | Отдельный LAN web-adapter, cookie+CSRF+разрешённые Origin/Host, неизменная защита native API | Web whitelist, LAN limiter, единые текущие права и серверная сессия |
| R-C3 | Encrypted IndexedDB; ключ только после PIN и в памяти; PIN при reload/смене пользователя и после60s в фоне | На общем телефоне чужие drafts недоступны; после reload без сервера черновик сохранён, но не разблокируется |
| R-C4 | Полный TABLE-путь официанта; скидки по действующим правам; корректировки и TABLE payment только по grant | Single/mixed/ZERO и сообщение о спорном TABLE-поступлении при соответствующих правах; без COUNTER/Refund/close/report |
| R-C5 | Две отдельные логические роли KITCHEN/CUSTOMER → два USB XP-365B; Windows spooler RAW, чековый ESC/POS, raster RU/KY | Модель/режим/профиль подтверждаются self-test; native helper не зависит от окна Electron; без перенастройки устройств при подготовке ТЗ |
| R-C6 | Durable attempts, честный SENT без обещания бумаги; UNKNOWN/manual handoff/redirect/reprint по отдельным правам и подтверждению риска | Правила §8 и матрица §4; рискованные права не наследуются из названия роли |
| R-C7 | Весь накопленный backlog до C — LEGACY_REVIEW; поздние KITCHEN и UNKNOWN автоматически не запускаются | Явная сверка актуальности/первого позднего исполнения/повтора; financial close/report не меняются |
| R-C8 | Два независимых технических направления в одном согласованном блоке; локальные QA и затем единая аппаратная приёмка | Код можно проверить на fixtures, но готовность IP/TLS/USB объявляется только после Windows+Android+iPhone+двух принтеров |

В подтверждение ТЗ входит предложенная private-CA схема для текущего условия «IP без домена». Это новое ограниченное решение D01 для управляемых телефонов, а не утверждение, что прежнее направление DNS-01 проверено. Если установка доверенного CA на телефоны неприемлема, до сетевого выпуска потребуется другое отдельно согласованное решение; передача PIN по HTTP не является заменой.

Не входит: Owner Web/платформенный admin; Cloud/Telegram/report delivery; исправления Reversal и финансовый MANUAL_RECOVERY; произвольный интернет-доступ/публичное пробрасывание портов; native iOS/Android app; кухонный экран готовности/склад/разделение блюд по бару; LAN/Bluetooth/TSPL адаптеры; автоматическое создание новой БД/обновление действующей OPEN-установки. Целевой аппаратный выпуск C — Windows x64; macOS остаётся средой разработки/QA, физическая USB-печать на macOS не заявляется.

## 3. Архитектура и безопасная локальная сеть

### 3.1. Процессы и границы

Одна служба Local POS Server владеет Storage/instance lock/SQLite. В ней общие AuthService/PinService/CommandBus/Table/Order/Finance, новый Waiter web-adapter и фоновый PrintCoordinator. Отдельный Windows helper выполняет блокирующие Winspool-вызовы, но не открывает SQLite и не становится вторым сервером. PrintCoordinator живёт независимо от Desktop. Хеширование PIN/рендер/USB/spooler не выполняются внутри writer; только короткие claim/result/domain транзакции.

Native listener остаётся loopback с прежней защитой. LAN listener привязывается к явно настроенному IPv4 интерфейсу, предварительный порт3443; адрес иллюстрируется как `https://<LAN-IP>:3443/waiter/`, реальный IP не задан. Не bind ко всем интерфейсам по умолчанию. Windows Firewall разрешает web-порт только из согласованной служебной подсети; native3210 не открывается в LAN. Нет UPnP/WAN port forwarding и trustProxy по умолчанию.

LAN listener публикует только `/waiter/` static assets и `/waiter/api/v1/*`. Он не монтирует `/api/v1/*`, активацию, сотруднические/меню-admin API, native bearer API, finance history/refund/report или printer configuration. Shared domain services вызываются из adapter по внутреннему principal; телефон не получает SQLite/USB/native bridge. Неполадки web-сертификата выключают web-вход, а не уже рабочий native POS/учёт заказов/сохранение print_jobs. Неисправность принтера не выключает Waiter/кассу.

### 3.2. HTTPS на локальном IP

Техническая рекомендация: per-branch private CA; leaf certificate с **IP SAN**, serverAuth EKU, SHA-256 и совместимым ключом. В leaf включается только фактический согласованный LAN IP; совпадения CommonName недостаточно. Примерный срок leaf180days, CA5years — параметры предлагаемого профиля, не универсальная гарантия совместимости. Финальный TLS-profile проверяется на целевых Android Chrome/iPhone Safari с корректными часами. Минимум TLS1.2; TLS1.3 при поддержке runtime.

Публичный root certificate устанавливается на каждое разрешённое устройство через контролируемый канал с проверенным fingerprint. Закрытый ключ CA на телефоны/QR/POS не распространяется: хранение у назначенного технического ответственного вне кассы в защищённом виде, отдельная связь с D11. Leaf private key генерируется для кассы, защищается OS-хранилищем/ACL LocalService, загружается только в серверную память. Нет общего ключа филиалов или секретов в Git/outbox/browser.

Для iPhone ручная установка профиля сама по себе не включает SSL-доверие: нужен отдельный шаг доверия root; это подтверждено [Apple Support](https://support.apple.com/en-gb/102390). Для Android инструкция зависит от версии/производителя: проверяется установка именно доверенного CA для браузера, а не только Wi-Fi client certificate. На каждом телефоне PoC должен доказать `isSecureContext`, cookie, WebCrypto и service worker без browser warning. Наличие установленного файла сертификата не равно приёмке доверия.

IP фиксируется безопасно: DHCP reservation при доступе к роутеру либо согласованная статическая конфигурация вне конфликтов адресов. Право/возможность изменения роутера пока не подтверждены. При смене IP сертификат/QR/config обновляются контролируемо; старый адрес не заменяется молча. **IndexedDB принадлежит origin**: смена IP/порта/схемы не переносит drafts. Перед сменой адреса сверяются pending/drafts; принудительная смена требует отдельного плана сохранения, а не обещания автоматического восстановления.

Renewal можно выполнять без интернета с доступом к офлайн CA. Предупреждения30/14/7days до окончания, документированный CSR/import и проверка пары key/certificate/IP/fingerprint. Просроченный/недоверенный сертификат не обходится HTTP или настройкой «не проверять TLS»; native POS показывает причину и инструкцию ремонта. До аппаратного PoC не утверждается, что все телефоны примут предложенную цепочку. DNS/публичный домен могут быть последующим улучшением, сейчас не обязательны.

QR содержит только согласованный HTTPS URL текущего филиала. Без PIN/token/cookie/root private key/автоматического входа. Публичный root fingerprint и инструкция доступны в native setup; онбординг доверия — техническая операция, не экран «нажмите продолжить, несмотря на угрозу».

### 3.3. Cookie/Origin/CSRF и PIN

Предлагаемая cookie: `__Host-bashkar-waiter`; Secure, HttpOnly, SameSite=Strict, Path=/, без Domain, серверное ограничение idle3h/absolute12h независимо от времени жизни cookie. Эти свойства host-cookie соответствуют [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie). В ответе login не возвращается bearer token: adapter устанавливает cookie и отдаёт безопасный DTO; JS не копирует cookie в IndexedDB/localStorage/URL.

Сервер проверяет точный configured Host:port, scheme и для unsafe requests точный Origin; CORS wildcard/чужие origins/Origin:null запрещены. Все мутации JSON+custom CSRF header; серверный CSRF nonce связан с текущей web-session, проверяется на logout/activity/command actions. Login имеет строгую Origin/content-type/custom-client-header проверку против login-CSRF и clickjacking; preflight чужому сайту не разрешает доступ. GET не меняет бизнес-состояние; отсутствие Origin у GET само по себе не основание ослабить auth/Fetch Metadata. Не использовать Sec-Fetch-* как единственное средство безопасности.

Веб-сессии только WAITER_WEB/роль WAITER. Native PIN Cashier и web PIN Waiter не взаимозаменяемы; client/branch/role нельзя выбрать в теле login. Один общий PinService ограничивает Argon2 jobs для обоих listener, а не отдельный лимит на каждый adapter. Native loopback reserve не отключается глобально: LAN получает отдельный проверенный source context из socket.remoteAddress, без доверия к X-Forwarded-For/переданному deviceId.

Начальный limiter: до5 попыток в минуту на LAN source и существующий branch-global per-code limiter, затем60s с ростом до15min; максимум2 PIN hash jobs и общий password hash ceiling сохраняются. Исчерпание даёт429/Retry-After, не бесконечную глобальную блокировку. Стойкость при нескольких телефонах/общем NAT/перезапуске проверяется; лимит не считать защитой от всех LAN DoS без измерений. PIN, cookie, csrf, unlock ticket, DEK и тела входа не логируются.

Polling не activity. `POST session/activity` по осмысленному действию пользователя, с debounce не чаще30s; его нельзя посылать таймером ради бесконечной жизни сессии. Роль/статус/credentialVersion/grant/STRICT проверяются каждой операцией и receipt lookup, включая replay. Деактивация/архив/сброс PIN закрывают доступ на следующем запросе; offline устройство узнает об отзыве при восстановлении связи и не может провести server mutation до проверки.

## 4. Матрица прав

Действующие роли/defaults не переписываются из-за появления телефона. Waiter default — table.view_status/details/open/close_empty/batch.submit/order.discount.set в пределах объекта. Отдельные grants order.correct/order.settle.table/payment.incident.record сохраняют действующие ceilings; полная отмена заказа/COUNTER/Refund/reversal/shift/report/admin для Waiter запрещены.

| Новое право | Предлагаемый default | Допустимый grant / граница |
|---|---|---|
| print.queue.view | Cashier | Owner/Manager grant; Waiter видит только разрешённые job-статусы своего доступного TABLE, без общего queue scope |
| print.settings.manage | Owner | Manager grant; Cashier/Waiter запрещено |
| print.retry_safe | Cashier | Owner/Manager grant; Waiter запрещено; только доказанный FAILED_SAFE после остановки авто-retry |
| print.reprint | Никому | Owner/Manager/Cashier grant; Waiter запрещено; явное подтверждение риска/причина |
| print.redirect | Никому | Owner/Manager/Cashier grant согласно AUTH; Waiter запрещено |
| print.manual_handoff | Никому | Owner/Manager/Cashier grant; Waiter запрещено |
| print.resolve_no_print | Никому | Owner/Manager/Cashier grant; Waiter запрещено |
| print.release_late | Никому | Owner/Manager/Cashier grant; Waiter запрещено |
| network.waiter.manage | Owner | Manager grant; настройка/просмотр QR и диагностики; без выдачи private keys в UI |

Рискованные права добавляются явно, без автоматического наследования административным Owner-фильтром. Право queue.view не выдаёт raw payload старой продажи. CUSTOMER details/reprint требуют дополнительно действующий доступ к исходной продаже: Cashier24h, Owner/Manager — адресный financial historical scope по утверждённой B-политике. Общая очередь после24h показывает технические состояние/job ID/type/time/device, без состава/суммы/guest label; печать не становится обходом terminal-read guards. Для подробностей/повтора старой кухни также отдельная проверка исходного объекта/разрешённого historical scope, а не только print.reprint.

Print-операции фиксируют фактического сотрудника; автоматические attempt events — branch/workerEpoch/system actor и связь с исходным автором заказа. Это не замена исполнителя на Owner. Действия могут обслуживать задания закрытых смен по отдельной явной процедуре, но не меняют Shift/Payment/report и не требуют переоткрытия исходной смены.

## 5. Waiter: состояния, черновики и неизвестная отправка

### 5.1. Объекты и сценарии

Телефон использует существующие Menu/Table/Order/Finance, серверные цены/целые тыйыны/CAS и исторические snapshots. Свободный стол открывается по праву, Waiter становится ответственным по действующему правилу. В STRICT чужой стол показывает занятость, но сервер не возвращает состав/сумму/комментарии. SHARED открывает разрешённый текущий объект, не меняет ответственного/автора Batch. Переключение режима/отзыв после загрузки применяется до следующей команды, а stale UI не даёт обхода direct-ID.

Черновик ≠ принятый Batch ≠ приготовлено ≠ оплачено. Сохраняются размеры/modifiers/comments/скидка и язык, предварительная сумма явно обозначена. Принятые пакеты показывают автора/time/исторический состав и print delivery state. Печать не означает готовность блюда и не требует обычного подтверждения кассиром. Непечатные позиции сохраняются без кухонного job.

Default Waiter не получает оплаты. При действующем order.settle.table UI показывает полный TABLE single/mixed/ZERO по A, сервер заново проверяет объект. При payment.incident.record вместе с правом TABLE-расчёта доступно сообщение о известном неполном/спорном поступлении. Нет инцидентов по COUNTER или списка финансов всего филиала. Ни смешанный расчёт, ни PIN не создают PARTIALLY_PAID. При order.correct — количество/группа/комментарий/атомарная замена; операция, превращающая заказ в полную отмену, требует запрещённого Waiter order.cancel и предлагается кассиру, а не скрывается как успешная.

### 5.2. Encrypted local store и общий телефон

IndexedDB содержит encrypted drafts/pending и минимум безопасной метаинформации. Namespace: origin + serverInstanceId + branchId + employeeId + deviceId + tableSessionId + localDraftId + keyVersion. deviceId — случайный UUID, не пароль/доказательство роли. Draft имеет revision; записи сериализуются, CAS/lease исключают silent overwrite второй вкладкой. Web Locks при доступности, fallback IndexedDB lease+revision/heartbeat; BroadcastChannel лишь уведомляет, не является единственным замком. Второе окно того же draft получает read-only/conflict, а не два независимых writer.

AES-GCM DEK отдельный на actor/device/instance с AAD идентичности, случайным nonce на запись. PIN не используется как криптоключ:4 цифры не дают достаточной защиты offline. DEK хранится на сервере только wrapped под отдельным OS-protected WebDraft key; ключи PIN/activation/TLS не переиспользуются. После свежего PIN server отдаёт DEK по доверенному TLS для импорта в non-extractable CryptoKey в памяти. Ни plaintext DEK, ни auth token не сохраняются в browser storage. Это прикладная изоляция общего телефона, не защита от XSS/владельца полностью скомпрометированного активного устройства. WebCrypto требует подходящего secure context: [MDN Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API).

Cookie сама по себе не разблокирует содержимое: после PIN выдаётся отдельный memory-only unlock ticket, связанный с web-session/device/credentialVersion, требуемый для data/mutation endpoints и выдачи DEK вместе с CSRF. Locked bootstrap возвращает только безопасный статус приложения. Reload, logout, смена пользователя и нахождение в фоне≥60s очищают tickets/DEK/расшифрованное UI; повторная работа требует PIN. На resume блокировка проверяется до первого render/request, не полагается на точность фонового таймера. Другой сотрудник получает другой actor namespace и не может запросить старый DEK. PIN reset не уничтожает исторический draft key автоматически: активный тот же employee ID может разблокировать свои drafts после нового PIN, при проверке отзыва старых tickets.

Encrypted frozen pending сохраняется при logout, не доступен следующему сотруднику; после входа исходного actor восстанавливается. Draft можно явно удалить отдельно, но неизвестную отправку не уничтожать кнопкой «очистить корзину». Logout сначала сохраняет/подтверждает IndexedDB; невозможность записи показывается до выхода. Локальная блокировка без сети возможна немедленно; server logout best effort, локальные capabilities удаляются в любом случае. Session expiry/revoke/архив не выдаёт drafts новому сотруднику даже при повторном использовании4-значного PIN.

При потере только интернета локальный Wi-Fi/сервер работают. При потере Local Server разрешено редактировать уже разблокированный local draft, но не подтверждать server mutations. При reload/блокировке без Local Server ciphertext остаётся, **чтение/редактирование до нового online PIN недоступны**. Очистка/eviction хранилища браузером может уничтожить несинхронизированный draft; это не резервная копия. Если IndexedDB/crypto/protected server key недоступны, мутации блокируются до сохранения, не отправляются без pending. Ключи браузерных drafts включаются в требования backup D11, но C не объявляет готовым перенос DPAPI/restore.

### 5.3. Prepare → frozen pending → commit → receipt

До HTTP commit атомарно сохранить encrypted envelope: исходный commandId, operation/target, immutable payload/confirmation hash, actor/instance/branch, local revision. Только после успешной записи отправлять. Во время UNKNOWN тело/ID не редактируются и новая команда на тот же объект не заменяет исходную. При восстановлении Wi-Fi автоматического submit/payment нет: сначала актуальная сессия/scope/состояние и проверка исходного результата, затем явный retry прежней команды.

Receipt lookup возвращает только собственный минимальный результат поддержанной команды с текущим разрешением. Клиент передаёт frozen operation/envelope; сервер сверяет actor/fingerprint с commands и применяет тот же current authorize/replay policy доменного сервиса. Нельзя сделать общий endpoint «читай любые commands по UUID». NOT_RECORDED означает только отсутствие локальной committed команды, не отсутствие внешне полученных денег. При terminal/24h/SHARED ограничениях восстанавливается допустимый minimal own receipt, а подробности проходят отдельный read-policy A/B.

Stale menu/цена/сбор/скидка/order revision/shift требует нового prepare и явного подтверждения. Принятый Batch не пересылается второй раз после client restart. При закрытии смены локальный непосланный draft сохраняется; он не blocker сервера и не переносится молча в новую смену. Для нового периода нужны новый context и подтверждённые цены. Сохранённый print failure не превращает принятый пакет обратно в draft.

## 6. Интерфейс Waiter RU/KY

Основной mobile viewport360×640,390×844 и landscape; крупные действия≥44CSSpx, видимый focus, корректная клавиатура, disabled/busy/error состояния. Названия/переводы блюда и fallback существующего меню сохраняются. Поля/комментарии не меняются при переключении RU/KY. Технические UUID только в раскрываемых сведениях для диагностики, не вместо названия стола/кнопки.

| Экран | Содержание и действия |
|---|---|
| Подключение | На Desktop адрес/QR, доступность HTTPS, инструкция доверенного сертификата и срок; телефон не видит PIN в QR |
| Вход официанта | Название/подтверждённый ID филиала,4-значный masked PIN с leading zero, показать/скрыть, счётчик паузы; «Другой филиал» без открытого redirect URL |
| Столы | «Мои / Все», зоны, свободен/занят/мой/чужой; понятный запрет STRICT; индикаторы «Смена закрыта», «Нет связи»; обновление не выдаёт чужие детали |
| Посещение | Стол/зона/ответственный/открывший; текущий состав и история Batch; «Добавить блюда», разрешённая скидка/корректировка/оплата; EMPTY закрытие только по действующему правилу |
| Каталог | Категории/поиск, stop-list, размер/modifiers, количество/комментарий; offline показ последнего разрешённого снимка с датой, не обещание доступности |
| Черновик | Явная метка «Не отправлен», строки/сумма, локально сохранён/ошибка/вторая вкладка; принятые позиции не редактируются как черновик |
| Подтверждение пакета | Серверные актуальные цены/скидка/сборы/итог и изменения; отдельный footer «Назад / Отправить заказ»; новый prepare после stale |
| Результат | «Принят сервером», время/автор/состояние передачи кухни; при print trouble «Заказ принят, требуется проверка печати»; без фиктивного «Приготовлено» |
| UNKNOWN | «Результат отправки неизвестен», состояние проверки и «Проверить / Повторить исходное действие»; нет нового submit под тем же draft |
| Корректировка | Before/after по разрешению, точное количество/причина, отдельная отправка изменения; последняя позиция/полная отмена передаётся кассиру |
| TABLE payment по grant | A single/mixed/ZERO, явное подтверждение фактически полученного, ошибка/unknown исходной команды и разрешённая форма incident; без общего sales/refund/report UI |
| Блокировка/выход | PIN для возврата в работу, сохранённые encrypted drafts/pending; предупреждение о неподтверждённой команде, пользовательская смена без доступа к чужим drafts |

Foreground refresh примерно5s с jitter; на hidden остановить polling, на возврате проверить блокировку/сессию/права и обновить context. Service worker кеширует только versioned app shell/локальные шрифты/иконки; private API/login/receipt/payload в CacheStorage не попадают. Активный draft не обновляется новым app bundle молча: schema/version check, предложение обновить после сохранения/сверки pending. Service worker требует secure context: [MDN Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API). WebSocket/SSE в первом C не обязательны; появление push не отменяет auth/Origin/revoke.

## 7. Принтеры, драйвер и шаблоны

### 7.1. Матрица текущего оборудования

| Роль | Устройство пользователя | Подключение | Базовое назначение |
|---|---|---|---|
| KITCHEN | Xprinter XP-365B №1 | USB к кассовому Windows PC | NEW_BATCH, «ОТМЕНА», «ИЗМЕНЕНИЕ» |
| CUSTOMER | Xprinter XP-365B №2 | USB к тому же PC | Первый внутренний чек после PAID/ZERO и отдельный контролируемый повтор |

Два устройства нельзя различать только по одинаковому model/display name. После установки назначаются отдельные Windows queues, фиксируются точный queue name/driver/port, USB identity при доступности, роль, profileVersion и выполненный test print. Переподключение к другому порту/изменение queue не вызывает автоматического переназначения соседнему XP-365B. Кухонная бумага не должна случайно уйти на клиентский принтер из-за совпадения названий.

По [официальной карточке XP-365B](https://www.xprintertech.com/xp-365b-xp-365bm-3-inch-label-printer) указаны203dpi, максимальная ширина печати76мм, USB и разные режимы TSPL/ESC-POS. Это документальные характеристики семейства, не доказательство установленного режима двух конкретных экземпляров. В C принимается **чековый режим ESC/POS на сплошной80мм бумаге**. Self-test/прошивка/настройка датчика/официальный драйвер проверяются до физической приёмки. Если экземпляр работает только как TSPL label, RAW ESC/POS на него не отправляется; нужна отдельная подтверждённая настройка/адаптер. Ни прошивка, ни драйвер при подготовке ТЗ не изменяются.

Профиль содержит dpi/printableDots/margins/feed/raster command set/max chunk/timeout/cutter=false по умолчанию. Предварительная безопасная ширина raster576dots уточняется по self-test и бумаге;80мм рулона не означает80мм печатной области. Не обещать576/608dots без измерения конкретного профиля. Автоотрез и импульс денежного ящика не посылаются без подтверждения поддержки/необходимости; ручной отрыв допустим. Бар/другие модели/интерфейсы в этот аппаратный состав не включены.

### 7.2. Windows USB adapter

Рабочий путь: служба → короткий claim/attempt commit → render вне writer → ограниченный helper process → Windows spooler RAW → выбранная USB queue. Используются штатные OpenPrinter/StartDocPrinter/WritePrinter/EndDocPrinter, без browser print dialog/зависимости от Electron/QZ/ручного нажатия после каждого заказа. Драйвер/queue устанавливается отдельно с минимальными Print permissions для LocalService; работоспособность под интерактивным Administrator не доказывает работоспособность службы.

Microsoft описывает [StartDocPrinter](https://learn.microsoft.com/en-us/windows/win32/printdocs/startdocprinter) как постановку документа в spooler с возвратом job ID, а [WritePrinter](https://learn.microsoft.com/en-us/windows/win32/printdocs/writeprinter) — как блокирующую передачу данных. Поэтому helper изолирован от server event loop, получает bounded input через pipe/защищённый локальный файл и возвращает структурированные stages/OS job ID/count/error. Нет shell interpolation/произвольных команд из queue name/комментария, автоматического скачивания exe или запуска с правами администратора на каждую печать.

DocumentName включает application/attempt UUID для диагностики, не PIN/имя гостя/весь чек. Существование/удаление OS job не доказывает выход бумаги. Kill/timeout helper не означает отмену уже спуленного задания: оно может выйти позже. Не удалять автоматически чужие Windows jobs/всю очередь. Отмена OS job/переподключение устройства при UNKNOWN требует ручной проверки и не превращает прошлую попытку в FAILED_SAFE.

### 7.3. Raster и содержимое

RU/KY печатаются через серверный monochrome raster с локально поставленным лицензированным шрифтом, покрывающим Ө/ө, Ү/ү, Ң/ң и используемую кириллицу. Не полагаться на кодовую страницу XP-365B или наличие шрифта на телефоне. Rendering не использует внешний CDN/облако или окно Desktop. Library/шрифт фиксируются в lock/manifest с лицензиями и Windows x64 ABI-check; выбор конкретного raster backend — инженерная деталь, принимаемая по CPU/memory/physical PoC, а не новое бизнес-решение.

Длинный документ рендерится ограниченными полосами; нет бесконтрольного огромного canvas/процесса Chromium на каждую квитанцию. Разрывы не режут строку/модификатор, данные не обрезаются молча. Невозможность render — безопасная печатная ошибка, не rollback заказа. ESC/control bytes из пользовательских комментариев не интерпретируются как команды устройства. Денежные суммы берутся из snapshot, не из актуального меню; формат тыйынов точный.

KITCHEN: крупный стол/зона либо «НА ВЫНОС», тип «ЗАКАЗ/ОТМЕНА/ИЗМЕНЕНИЕ», автор/time, только нужные позиции/количества/варианты/modifiers/comments. **Номер Batch на бумаге отсутствует**, хотя доступен в POS-истории. При отмене видны только отменяемые позиции, при смене комментария — понятные old/new; замена сохраняет отдельные отмену и новый заказ в установленном порядке. Не печатать финансовые суммы там, где они не предусмотрены кухонным шаблоном.

CUSTOMER: внутренний документ, TABLE/COUNTER, исходный состав/исторические цены, скидка, каждый сбор, итог, методы/суммы Payment либо ZERO без фиктивной оплаты, время/кассир. Reprint помечается «ПОВТОР» с исходным временем и временем повтора; он не меняет исходный payload/расчёт и не превращается в текущую финансовую квитанцию после Refund. Первое позднее исполнение, доказанно не имевшее передачи, обозначается первым поздним экземпляром, не «повторной продажей». Отчёт смены/документ Refund/фискализация не добавляются под видом нового CUSTOMER purpose без отдельного ТЗ.

## 8. Durable queue, UNKNOWN и порядок

### 8.1. Разделение фактов

`print_jobs` остаётся immutable business intent с первоначальным payload/status=PENDING v1/v2. Реальное состояние берётся из новых dispatch/attempt/event projections; старый столбец PENDING не показывается как актуальная доставка. Все read paths Desktop/Waiter/order history получают effective delivery status из общего PrintService.

Новый business commit создаёт прежний job и один dispatch с логической ролью KITCHEN/CUSTOMER и frozen route/profile revision. Принтер может быть UNCONFIGURED/OFFLINE: job и заказ сохраняются, очередь ждёт настройки. Route failure не откатывает Batch/Settlement. Изменение printer settings действует на новые dispatch; старые не переводятся молча на другой аппарат/порт/профиль. Явное перенаправление — отдельный audited факт.

| Effective state | Значение и разрешённое продолжение |
|---|---|
| UNCONFIGURED / PENDING | Нет проверенной привязки либо ждёт первой попытки; configure/review или claim |
| CLAIMED | Один workerEpoch владеет dispatch; подготовка/рендер без внешней передачи |
| IN_PROGRESS | Устойчиво записан SEND_STARTED до первой операции, которая может создать внешний print job |
| SENT | Helper подтвердил доступный этап передачи в spooler; **не «бумага точно вышла»** |
| FAILED_SAFE | Доказанная ошибка до возможной внешней передачи; ограниченный retry допускается |
| UNKNOWN | Возможна полная/частичная/поздняя печать; авто-retry запрещён, station на review |
| MANUAL_HANDOFF | Всё содержимое KITCHEN-job подтверждённо передано кухне вручную; auto-dispatch остановлен |
| RESOLVED_NO_PRINT | Уполномоченный сотрудник решил не печатать с причиной и scope; исходник/попытки сохраняются |
| LEGACY_REVIEW / LATE_REVIEW | Нужна первичная проверка старого backlog либо актуальности кухни закрытой смены |

Состояния могут иметь несколько причин удержания, например UNKNOWN+late: одна команда не снимает вторую проверку автоматически. Дополнительная отметка STAFF_CONFIRMED_PAPER — заявление сотрудника с actor/time, не machine ACK. Для RAW USB `SENT` не переименовывается в PRINTED.

### 8.2. Claim и crash windows

Один активный dispatch на физический device, максимум2 одновременно по двум устройствам; bounded render/helper concurrency. Даже если backup mapping позднее совпадёт с основным аппаратом, один physical device lease не даст параллельных потоков. Claim/revision/active attempt UNIQUE проверяются в writer. В порядке используется committed server sequence/связи dependencies, не UUID/скачущий timestamp.

1. Claim с attempt ID/workerEpoch фиксируется; payload/route/template/font version/hash сохраняются для воспроизведения.
2. Render выполняется вне transaction. Пока нет SEND_STARTED, код не вызывает StartDocPrinter/передачу; падение здесь допускает безопасное освобождение claim после доказанного завершения старого worker.
3. Перед вызовом внешнего этапа записывается SEND_STARTED. Даже crash между marker и фактическим вызовом даёт консервативный UNKNOWN: «не было бумаги» не выдумывается.
4. Helper сохраняет доступные OS stages/job ID/byte counts; окончательный result/event записывается в короткой транзакции. После WritePrinter/EndDoc без durable result следующий startup видит UNKNOWN, а не новый автоматический send.
5. На startup instance lock доказывает отсутствие старого владельца. Истёкший lease сам по себе не доказывает остановку живого helper/spooler; нельзя запускать второго отправителя только по таймеру. Пока прежний helper/OS job может работать, station удерживается для сверки.

FAILED_SAFE допускается при локальном render/config/доступе к queue **до** потенциального StartDoc/передачи, с точным stage evidence. Ошибка/timeout после начала потенциальной передачи, partial WritePrinter или неполный ответ helper — UNKNOWN. Spooler может держать документ при выключенном USB/принтере: это не FAILED_SAFE и не основание создать ещё одну копию.

Авто-retry только FAILED_SAFE, например1/3/10/30/60s до5 попыток, затем operator pause. Эти параметры — предложение начального профиля. UNKNOWN/SENT/MANUAL_HANDOFF/RESOLVED_NO_PRINT/late не попадают в auto-retry. Отсутствие интернета не влияет на очередь USB.

### 8.3. Dependencies и ручные действия

Сохраняются все существующие print_job_dependencies. Корректировка не отправляется раньше разрешённого результата предшественника. SENT предшественника обеспечивает порядок этапов передачи, не доказательство физического приготовления. UNKNOWN/ошибка/нерешённый поздний предшественник удерживает последующие связанные jobs. На двух разных устройствах нельзя обещать физический порядок выхода бумаги только по времени callback.

Manual handoff подтверждает **весь кухонный поднабор job**: сотрудник передал сохранённое содержание кухне, причина/time/actor фиксируются; новых Batch/Payment нет. Частичную ручную передачу строк в C не вводить. При pending оригинале и последующей отмене нельзя автоматически удалить оба job: ответственный просматривает original→cancel и явно определяет, что уже передано и что ещё нужно сообщить.

Redirect допускается только на заранее настроенный и проверенный backup device/profile. В данном составе два основных принтера не становятся резервными друг другу автоматически. Перед redirect показываются исходный аппарат/состояние/OS job/риск дубля/содержание по правам и причина. UNKNOWN требует фактической сверки и подтверждения риска; если доказать отсутствие прошлой бумаги нельзя, новая попытка маркируется контролируемым повтором. Исходные attempt/route не стираются.

После MANUAL_HANDOFF auto-print исходника не возобновляется. При отдельной необходимости печати создаётся новая linked delivery command с причиной, признаком повтора и текущим правом. Reprint CUSTOMER всегда отдельная связанная выдача «ПОВТОР», без нового Settlement/Payment/CUSTOMER business job в обход его UNIQUE. Две команды действий с разными commandId не должны дать две конкурирующие reprint delivery: CAS по dispatch revision и UNIQUE active successor; каждый новый намеренный экземпляр требует нового просмотра актуального состояния/подтверждения.

### 8.4. Backlog и закрытие смены

Все задания, существовавшие до миграции C, материализуются в LEGACY_REVIEW; payload/checksum/ID/dependencies сохраняются. Никакой массовой автоматической печати при первой настройке USB. Пользователь сверяет вручную переданные/ранее напечатанные/неактуальные задания. KITCHEN закрытой смены всегда LATE_REVIEW перед первым или повторным исполнением; решение содержит конкретные job refs/причину, не общую галочку «разрешить старую очередь».

Для CUSTOMER прошлой смены тоже нет автоматического выпуска backlog: первый поздний экземпляр и повтор различаются по известной истории передачи. Неизвестность бумажной истории не объявляется первой печатью. Print resolution и новые attempts после close не меняют immutable report; printer trouble не становится financial blocker. Если обнаружены спорные деньги — отдельный B financial case, а не print state как замена сверки.

## 9. SQLite и миграции

Предварительный план: **009-waiter-web** и **010-print-dispatch**; source0.9.0-service-clients/schema10 при включении обоих срезов. Окончательное имя версии фиксируется в фактическом контракте. Разделение миграций позволяет независимо проверять C web/print;001–008/checksums не меняются. Существующие print_jobs/CHECK v1/v2 не реконструируются ради mutable status.

| Новая сущность | Контракт |
|---|---|
| waiter_session_security | session FK/branch/actor/audience, csrf hash/unlock lease hash/device/credentialVersion/expiry; без plaintext PIN/cookie в audit/outbox |
| web_draft_key_contexts | instance/branch/employee/device/keyVersion, OS-wrapped DEK/AAD, lifecycle; UNIQUE scope; доступ только после current PIN/unlock |
| web_security_attempts | Раздельные LAN sources/counters/expiry для устойчивого limiter; один shared Argon2 budget, без storage IP из клиента |
| waiter_network_revisions | Не-секретные public endpoint/IP/порт/root fingerprint/cert expiry/version; private keys отдельно OS-protected, не в UI snapshot |
| print_device_revisions | Immutable device identity/queue/driver/profile/dpi/width/cutter/timeouts, installed/verified status и actor; endpoint только из локальной allowlist |
| print_role_routes | Revisioned KITCHEN/CUSTOMER→device mapping, optional заранее проверенный backup; CAS/audit; route history сохраняется |
| print_dispatches | branch/job/generation/role/frozen route/profile/current effective state/revision/active attempt; initial UNIQUE(branch,job,generation=0), origin/reprint linkage |
| print_attempts | Immutable attempt identity/dispatch/workerEpoch/payloadHash/renderVersion; append-only stages/results/OS job evidence в отдельных events |
| print_delivery_events | branch/dispatch/attempt/sequence/state/reason/evidence/time/system-or-human actor/command; UNIQUE transition/sequence, no UPDATE/DELETE |
| print_device_leases | UNIQUE physical device, owner epoch/attempt/revision; не обеспечивает exactly-once внешней бумаги по одному TTL |
| print_operator_actions | commandId/job/dispatch/revision/action/reason/actor/risk confirmation/linked delivery; durable result/audit/outbox, UNIQUE active successor |

Все job/Order/actor/device/branch refs составные и защищены; поле jobId другого филиала не открывает payload. Состояние projection обновляется только с CAS и соответствующим append-only event в одной writer transaction. Полезные индексы branch/state/nextAttemptAt, device/activeAttempt, job/generation, actor/device key scope. Секреты не проходят в commands/result/outbox. Не вводить FK на временную browser session там, где draft key должен переживать logout/новый PIN того же employee ID.

Переход old8→9/10 только явно после безопасного backup/preflight, запрет OPEN сохраняется. Реальный deploy/DPAPI/restore — D11/D13, не выполняется автоматически по утверждению ТЗ C. Неполная/непроверенная printer configuration не мешает бизнес-commit; очередь остаётся UNCONFIGURED. Невозможность сохранить необходимый job/dispatch/event откатывает business transaction — это ошибка хранения, а не физический отказ принтера.

## 10. API-контракт

Пути — проект, окончательные DTO/error codes документируются в API-WAITER-009/API-PRINT-010 после реализации. Native и web адаптеры остаются раздельными. Prepare без мутаций, commandId UUIDv4, unknown fields запрещены, branch/actor/цены/готовые статусы клиента не доверенные.

### 10.1. Waiter HTTPS `/waiter/api/v1`

| Метод/путь | Действие/ограничение |
|---|---|
| GET /bootstrap | Версия shell/instance/branch display/доступность; locked-safe DTO, без меню/состава/credential |
| POST /session/pin | PIN,deviceId → Secure cookie + current principal/csrf/unlock capability/draft key по подтверждённой политике; token не в JSON |
| POST /session/unlock | PIN для того же session actor/device, новый ticket/key в память; другой actor — явная смена пользователя |
| GET /session/me | Safe current actor/permissions/locked status; данные только с unlock; не продлевает idle |
| POST /session/activity /logout | CSRF+current scope; logout отзывает текущую session/tickets, не меняет смену |
| GET /menu /tables | Только разрешённый operational menu/status; все financial/admin поля отфильтрованы |
| POST /tables/open /tables/close-empty | Действующие доменные команды, CAS/commandId; Waiter responsibility сервером |
| GET /visits/:id /visits/:id/order /batches | Current object access; page limit/cursor; история в разрешённой области, без branch sales archive |
| GET /visits/:id/draft-context | Instance/branch/actor/visit/shift/menu context и срок; не создаёт заказ |
| POST /visits/:id/batches/prepare /submit | Тот же pricing/confirmation/domain CommandBus, web frozen envelope и current scope |
| POST /orders/:id/discount | Действующий CAS/permission, без новых скрытых defaults |
| POST /orders/:id/corrections/prepare /commit | Только order.correct и разрешённые операции; full cancellation Waiter недоступна |
| POST /orders/:id/settlements/prepare /commit | Только grant order.settle.table + TABLE scope; single/mixed/ZERO по A |
| POST /payment-incidents | Только доступный TABLE и оба права; та же B-модель без ложных Payment/Refund |
| POST /commands/receipt | Собственный frozen envelope; fingerprint/operation/current auth/replay policy; минимальный committed result либо NOT_RECORDED |
| GET /orders/:id/print-status | Разрешённый TABLE, effective state/человеческая причина; без spooler credentials/branch-wide payload |

Нет `/counter`, `/sales`, `/refunds`, `/shifts/close`, `/reports`, `/employees`, `/activation`, printer manage/redirect/reprint во web whitelist. No-store для private responses. HTML/DOM строятся безопасно textContent, без выполнения комментариев/названий как HTML; CSP только local assets/connect self, frame-ancestors none, no inline scripts/eval.

### 10.2. Native `/api/v1`

| Метод/путь | Действие |
|---|---|
| GET /waiter/network-status | Readiness/IP/QR/cert expiry/fingerprint; secrets не возвращаются |
| POST /waiter/network/prepare /commit | Current administrative right/CAS, public config/валидированный certificate import reference; не plaintext private key в journal |
| GET /print/devices /print/routes | Queue/config metadata по правам |
| POST /print/devices/prepare /commit | Привязка проверенной локальной Windows queue/profile, revision; отсутствие автосмены USB identity |
| POST /print/routes/prepare /commit | Назначение двух ролей/backup, CAS/audit, новые jobs используют новую revision |
| POST /print/devices/:id/test | Audited nonfinancial test delivery с постоянным diagnostic ID, без Batch/Payment; unknown тоже требует сверки |
| GET /print/queue?state=&role=&after=&limit= | Effective states, scope-safe metadata, pagination; очередь не выгружается целиком |
| GET /print/jobs/:id | Допустимый payload preview/attempt/events/dependencies по current read scope |
| POST /print/jobs/:id/actions/prepare /commit | RETRY_SAFE/REPRINT/REDIRECT/MANUAL_HANDOFF/RESOLVE_NO_PRINT/RELEASE_LATE, expectedRevision/reason/confirmationHash/risk confirmation/commandId |

Нельзя принять arbitrary binary/ESC-POS stream/path/executable/queue name из Waiter. Native config не становится произвольным LAN/localhost SSRF/командным shell. Для действий возвращается receipt, а не декларация физической бумаги до попытки. Основные ошибки: WEB_TLS_UNAVAILABLE, WEB_ORIGIN_DENIED, CSRF_INVALID, WEB_UNLOCK_REQUIRED, PIN_RATE_LIMITED, LOCAL_DRAFT_WRITE_FAILED, DRAFT_FROZEN, DRAFT_REVISION_CONFLICT, PRINT_UNCONFIGURED, PRINT_ACTION_CONFLICT, PRINT_UNKNOWN_REQUIRES_REVIEW, PRINT_LATE_REQUIRES_REVIEW, PRINT_DEVICE_IDENTITY_CHANGED; сохраняются401/403/409/storage/COMMAND_ID_CONFLICT.

## 11. Desktop UI печати и подключения

**«Официанты / Подключение»:** LAN IP/порт/QR, статус TLS/cert validity, fingerprint/инструкция root trust для Android/iPhone, диагноз «IP изменился / сертификат истёк / интерфейс недоступен». Настройка только по network.waiter.manage. PIN-секреты/CA private key не показываются. Название филиала не выдумывается: имеющийся ID/согласованный display label отдельно от authority.

**«Принтеры»:** две карточки «Кухня» и «Клиентский чек», модель/Windows queue/USB port/profile/check status, отдельное действие test page. Процедура настройки явно выбирает каждое физическое устройство и подтверждает, на каком вышла бумага. Не отмечать «Готов» только по наличию драйвера. Карточка состояния доступна Cashier по read right, edit только Owner/Manager grant.

**«Очередь печати»:** роль/тип/стол или на вынос в пределах read scope/time/состояние/причина/связь с исходником и кнопка подробностей. Фильтры «Требует внимания / Ожидает / Передано / Ручное решение / Старые», pagination. На экране заказа показывается эффективная передача, но исходный Batch не исчезает из-за сбоя принтера. Индикатор в POS ненавязчивый, сохраняет доступ к оплате/закрытию.

**UNKNOWN dialog:** крупно «Неизвестно, вышел ли документ», источник/время/аппарат, доступные этапы/OS job ID в диагностике, предупреждение о риске дубля. Нельзя превратить его в «попробовать ещё раз» без причины/явной сверки. Только разрешённые отдельные действия: «Передано кухне вручную», «Не печатать», «Повторить после проверки», «Направить на резервный». Следствие для зависимой отмены/нового пакета показывается до подтверждения.

**Повтор/redirect/late dialog:** исходное содержание и состояние, выбранный аппарат, предыдущие попытки, причина и checkbox подтверждения риска; prepare показывает actual revisions, footer отдельно от scroll body. Stale требует повторного просмотра, lost response — original command retry. Manual handoff действует на весь job, не молча на часть. В UI состояния переведены RU/KY, внутренние enum не заменяют понятный текст. Физическая передача печати и действия с queue не создают денежных операций.

## 12. Проверки и критерии приёмки

### 12.1. Автоматически / изолированные стенды

- Регрессии A/B: menu/pricing/Batch/portions/settlement/refund/close/report/24h/STRICT/audiences/identity, старые checksums. Native API продолжает отвергать browser transport/Waiter tokens; LAN не публикует native/activation/admin routes.
- Web auth: правильный Waiter PIN и отказ Cashier/Manager/Owner PIN; leading zero; source/per-code/global concurrency limits/restart; Host/Origin/CSRF/content-type/CORS/Fetch Metadata; session rotation/fixation; отсутствие secrets в JSON/logs/URLs/cache/audit/outbox.
- Current role/status/grant/revoke/STRICT race, direct IDs/чужой branch/другой actor; own minimal receipt не раскрывает старый состав. Polling не продлевает idle; Waiter3h/absolute12h сохраняются.
- Drafts: AES-GCM tamper/AAD/wrong actor/instance/device; переключение сотрудника, reload/background-lock, восстановление исходным actor после PIN reset, отсутствие key persistence. IndexedDB failure до сети, атомарная freeze, двe вкладки/lease/revision races, browser eviction с честной потерей локальных данных.
- Непринятый draft/accepted Batch/UNKNOWN различаются. Network drop до/после commit, tab/server restart, original retry, меню/цена/discount/shift changed, нет automatic submit upon reconnect. Table payment/incident по grant и запрет Counter/Refund/admin.
- Queue: immutable payload v1/v2/dependencies, initial dispatch один на job, два claimers/процесса, physical device mutex, crash до SEND_STARTED/после marker/во время WritePrinter/после spooler accept до commit. UNKNOWN не повторяется по lease timeout, classified FAILED_SAFE имеет доказуемый stage.
- Original→cancel/change/replacement, ручная передача и последующая корректировка, поздняя кухня/legacy backlog, first-late vs reprint CUSTOMER. CAS двух operator actions с разными commandId; own receipt после lost response и текущий revoke на retry. Snapshot report/Payment/Batch от print actions не меняются.
- Renderer: RU/KY глифы/длинные имена/modifiers/comments/нули/скидки/сборы/mixed, кухня без Batch number, on-the-go label, непечатные строки/пустой kitchen subset, несколько длин raster, безопасные control chars, bounded memory без truncation.
- Fresh9/10 и заполненный8→9→10 FK/integrity; сохраняются ID/история/PIN binding/008reports/commands/print payloads. OPEN upgrade отвергается; миграция не запускает ни одной физической попытки. Ошибка записи dispatch/event откатывает business commit.

### 12.2. Обязательная физическая матрица

| Стенд | Сценарии | Статус до выполнения |
|---|---|---|
| Windows10/11 x64, целевая касса4ГБ, LocalService | Headless worker без Desktop, driver/queue ACL/USB identities, service restart/timeout/helper kill, очередь при печати из службы | NOT RUN |
| XP-365B kitchen | Self-test/чековый режим/80мм/реальная ширина, RU/KY, длинный/короткий job, отмена/комментарий/замена, manual handoff, поздний backlog | NOT RUN |
| XP-365B customer | PAID/mixed/ZERO, длинные строки/сборы/низ чека/подача, «ПОВТОР», первый поздний экземпляр | NOT RUN |
| Оба USB устройства одновременно | Верная физическая роль, unplug/power off/paper end/cover open/spooler stopped, одинаковые модели/смена USB port, partial/unknown без дублей | NOT RUN |
| Android Chrome и iPhone Safari | Установка CA/trust, HTTPS по IP без warning, secure context/cookie/IndexedDB/WebCrypto/SW, PIN/draft/shared phone/locked resume, реальные размеры | NOT RUN |
| Wi-Fi/роутер без внешнего интернета | Холодный запуск после установки, LAN offline/возврат связи/смена IP/конфликт IP/expiry/wrong clocks, отсутствие public DNS зависимости | NOT RUN |

Минимальный нагрузочный стенд-предложение:10 активных Waiter клиентов, две очереди, кассовая оплата/close параллельно; p95 обычных local reads≤1s и commit-response≤1.5s без PIN hash/физического принтера, память/CPU/диск фиксируются на целевых4ГБ. Это критерии для измерения, не уже достигнутые показатели. Backpressure/rate limit понятны UI; не расширять очередь writer ради скрытия зависшей печати.

Результат каждого сценария содержит source/schema/OS/browser/device/driver/profile, шаги, реальные признаки передачи/бумаги, screenshot/log и PASS/FAIL/NOT RUN. Fake adapter/скриншот/спулер не засчитываются за физическую бумагу. Hardware тесты — единым циклом после крупного блока, не запрос после каждой небольшой правки.

## 13. Порядок реализации после подтверждения

1. Зафиксировать R-C1…R-C8 и конкретные deployment fields при подготовке стенда; TLS-IP PoC и официальный XP-365B self-test — ранние аппаратные проверки, не конец после всего кода.
2. Web security/009, cookie/PIN/unlock/keys и адаптер на общих сервисах; параллельно print contract/010, dispatcher и Windows helper/fake adapter. Два направления не блокируют сохранение заказов ожиданием телефона/принтера.
3. Waiter RU/KY drafts/Batch/права/corrections/допустимый TABLE payment, Desktop QR/queue/config/operator flows; контроль secrets/current scope.
4. Автоматические проверки/доступные browser и Electron QA, screenshots/визуальный review; реальные Windows USB и Android+iPhone по общей матрице.
5. Фактические API-WAITER-009/API-PRINT-010, PROGRESS/README/runbooks; отдельно отметить локально реализованное, аппаратно подтверждённое и оставшееся. Старые документы — история, не доказательство новых тестов.

**Локальный C готов**, когда защищённый Waiter client и durable print pipeline/операторские действия работают на согласованных fixtures и проходят регрессии без обходов A/B. **Аппаратный C готов**, когда оба XP-365B под службой печатают согласованные документы, а Android+iPhone работают по доверенному HTTPS IP с реальной потерей связи/рестартом и принятыми UNKNOWN-процедурами. Подтверждение ТЗ/локальные тесты не заменяют аппаратную приёмку. Production update/backup/restore/Recovery/ККМ и общая готовность пилота остаются блоком D.
