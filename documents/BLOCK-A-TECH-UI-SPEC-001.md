> **Сверка 24.10.2026.** Исторический план/срез: фразы «сейчас», «ещё нет» и номера source/schema ниже относятся к дате исходной поставки. Дальнейшая реализация — в DOCS-AUDIT-001. [Актуальное состояние и решения](DOCS-AUDIT-001.md).

# BASHKAR.KG — блок A: расчёты, COUNTER, корректировки и история

Дата: 22 октября 2026 года, Asia/Bishkek. Версия: 0.1.

**Статус: утверждено пользователем «потверждаю», включая R-A1…R-A6; блок A реализован локально.** Исходное ТЗ подготовлено по разделу 8 NEXT-DEVELOPMENT-002 без изменения кода. Реализация добавлена после подтверждения: source 0.7.0-finance/schema7. Фактический контракт — API-FINANCE-007.md; проверки и ограничения — PROGRESS.md. Текст ниже сохраняет основания и согласованный план, не подменяя фактический API и приёмку B–D.

## 1. Проверенное исходное состояние

Рабочая папка: `/Users/a1234/Desktop/bashkar.kg`. `server.ts` сообщает source **0.6.0-pin**, `migrations/index.ts` содержит **001–006 / schema 6**. Node **24.18.0**, pnpm **10.20.0**. Git: ветка main, коммитов нет, исходники untracked; отсутствие diff не является проверкой неизменности.

| Область | Что действительно есть | Что добавляет A |
|---|---|---|
| SQLite / запись | WAL/FULL/FK, проверки файлов/схемы, явная миграция, writer/CommandBus, audit/outbox/result в одной транзакции | Новые финансовые факты, ограничения и новые проверки конкуренции |
| Активация и вход | Подписанная привязка, сотрудники, пароль/PIN, audience, grants, отзыв, защищённые native session/pending | Только необходимые финансовые права; существующая модель входа сохраняется |
| Каталог / цены | Редакции, stop-list, исторические снимки, BigInt, фиксированная скидка, TABLE-сборы | Предложение контейнера в операционном COUNTER; существующие цены переиспользуются |
| TABLE | Зоны/столы/посещения, STRICT/SHARED, EMPTY, первый и последующие Batch | Полный/нулевой расчёт и полная отмена с атомарным закрытием посещения |
| Заказ | Только TABLE/OPEN, immutable Batch/Item, revisions, discount events | COUNTER, действующие количества/комментарии, корректировки, финализация |
| Печать | Immutable KITCHEN/NEW_BATCH/PENDING, только кухонный поднабор | CUSTOMER и KITCHEN-корректировки как постоянные задания; worker остаётся C |
| Финансы / история | Нет Settlement/Payment и настоящих продаж; UI содержит честную заглушку | Положительные/нулевые расчёты, история 24h; без окончательного отчёта D08 |
| Смена | Открытие с личным паролем; close намеренно недоступен | Запись новых операций в текущую OPEN; закрытие остаётся блоком B |
| Платформенный admin | Отдельный код/сайт/provisioning; по документу постоянный bootstrap ожидает пароль человека | Не затрагивается. Owner Web отложен, локальный Owner сохраняется |

Свежие проверки этого аудита: **`pnpm run check` PASS; `pnpm exec vitest run` PASS — 23 файла / 96 тестов**. Vitest запущен напрямую без предшествующей записи build/dist. Дополнительно TypeScript собран в `/private/tmp/bashkar-block-a-audit-compiled`: все 57 выходных JS-файлов побайтно совпали с существующим dist, включая дочерние process-fixtures тестов. Это текущие статические и fixture-проверки на macOS, а не новый `pnpm test`/Electron/cloud/Windows-прогон. Исторические Electron/cloud-результаты — в PROGRESS.md. Windows iteration-002/schema 3 имеет USER_CONFIRMED, а не приёмку текущей schema 6 или будущего A.

### 1.1. Выявленные технические стыки

1. `005-orders-batches.ts`: CHECK только TABLE/OPEN; `table_session_id NOT NULL`. Расширения API без новой схемы недостаточно.
2. `004-tables.ts`: закрытие разрешено только EMPTY с нулевыми защитными флагами. Для PAID/ZERO_TOTAL/CANCELLED нужна новая схема и равноценные защитные триггеры.
3. `print_jobs`: обязательный Batch, только KITCHEN/NEW_BATCH/v1/PENDING; UPDATE/DELETE запрещены. CUSTOMER связан с расчётом, а не с произвольным последним Batch.
4. `OrderService.dto()` использует TABLE и исходный subtotal. После корректировок нельзя суммировать неизменяемые исходные Batch как действующую стоимость.
5. `TableService.accessible()` даёт SHARED-доступ только OPEN-посещению. После оплаты прежний исполнитель может потерять такой доступ; нужно отдельно определить узкий доступ к собственному command receipt при replay, не открывая историю посещения.
6. `permissions.ts` автоматически включает многие новые ключи в Owner administrative defaults. Добавляя финансовые ключи, необходимо явно сохранить AUTH-матрицу: Owner не получает корректировки и полную отмену автоматически.
7. Каталог уже поддерживает `containerId`; валидатор допускает контейнер с размерами/модификаторами. Нельзя молча считать его простым товаром с одной ценой. Операционное предложение и редактор связи нужно закончить.
8. Persistent native drafts/pending уже есть. Новые сценарии должны расширить их, включая scope ещё не созданного COUNTER; renderer не получает токен или файловый доступ.
9. Старые установки могут иметь OPEN и не уметь её закрыть. Нельзя ради установки A переписать смену SQL или отключить миграционный guard.
10. CORE Recovery §10 требует отдельного факта при реально полученной неполной/спорной оплате; атомарность SQLite не отменяет уже совершённый перевод в банке.

## 2. Основания и приоритет

NEXT-DEVELOPMENT-002 прочитан целиком, включая A–D и промпт §8. Актуальные контракты и профильные разделы источников сопоставлены с кодом и тестами.

| Источник в documents/ | Что переносится в A |
|---|---|
| NEXT-DEVELOPMENT-002 §§2–4, 8 | Scope A, согласование, ограничения установок, общая последовательность A–D |
| README, PROGRESS, API-ITERATION-001, ITERATION-001, CLOUD-ACTIVATION-001 | Текущее исполнение, D03/D04, loopback, пароль смены, пределы, привязка |
| API-TABLES-004, STAGE-004-PLAN, STAGE-004-02-SPEC, API-ORDERS-005 | TABLE-доступ, Batch, снимки/ставки, draft/pending, CAS и replay |
| AUTH-001 §6.3–6.6; AUTH-002-ROLE-EXPERIENCES-DRAFT §§5, 8, 14; AUTH-002-A-TECHNICAL-CONTRACT; API-AUTH-006 | Ролевые потолки/defaults, новые audience, PIN, история всех продаж филиала за 24h |
| CORE «Оплаты и расчёты» §§3–7, 9–12, 17–20 | Методы, два Payment, отсутствие сдачи в POS, ZERO_SETTLED, формула/точность, гонки |
| CORE «Заказы Counter» §§3–14, 20, 23–25 | Q01–Q17/C01–C05: на вынос, номер смены, два checkout, карточка/×, контейнер |
| CORE «Отмены и корректировки» §§2–10, 16, 20 | Q01–Q13/R01–R05: неизменяемое происхождение, количества, причины, замена, кухня |
| CORE «Столы, посещения и пакеты заказов»; CORE «Меню и ценооброзование» §§6–14 | Один заказ посещения, текущие/исторические цены, модификаторы, сборы первого Batch |
| CORE «Кассовые смены»; CORE «Нестандартные ситуации и восстановление» §§9–10, 16–18 | OPEN, будущие блокеры close, неполученный ответ и незачтённые внешние деньги |
| BACKEND-001 и лист решений; DB-SCHEMA-001 §§4–10; POS-001 TECH §§9–12; «ТЗ АРХИТЕКТУРА» | Транзакции, FK, новая схема, сохранность, границы D05/D08/D09/D11/D12/D13 |
| PLATFORM-ADMIN-001; Windows ITERATION-002-WINDOWS-RESULTS | Owner Web отложен; исторические и текущие результаты не смешиваются |

Поздние утверждённые CORE/AUTH и ITERATION-контракты уточняют ранние документы. Старый лист с «D05/D09 не решено» не отменяет уже выбранные принципы в основном BACKEND-001. Старые запрет PIN, предложение процентной скидки и COUNTER-сборов не переоткрываются. Отдельных финальных POS-001/PRINT-001/WAITER-001 нет: новые UI/API ниже — проект этого ТЗ.

## 3. План A–D и зависимости

| Блок | Конкретный результат | Условия / зависимости |
|---|---|---|
| **A** | TABLE-расчёт, ZERO_SETTLED, COUNTER, корректировки, 24h-история, постоянные задания и Desktop | Подтверждение этого ТЗ и решений §15; disposable fixtures; реальные установки пока не обновляются |
| **B** | Полные Refund Payment, закрытие смены, immutable report, разрешение денежных инцидентов | A; словарь D08; процедура D05 только для Reversal. Обычный Refund можно делать независимо от незавершённого D05 |
| **C** | Два независимых среза: Waiter Web и persistent print worker | Доменная основа A; D01/D02 и телефоны для сети; PRINT/D06 и модели принтеров для печати |
| **D** | Backup/restore, безопасный upgrade, outbox/inbox/доставка, сквозная приёмка и пилот | Проектирование backup/preflight начать вместе с A; испытания на финансовых данных после A/B; D09/D11/D13/D16 и оборудование по профилю |

В A не включаются: Refund/Reversal, итоговые KPI/отчёт/close, Waiter transport, физическая печать/перепечатка, export, облачный кабинет Owner, удалённый персонал, биллинг, Sync delivery, production restore. Нет частичных оплат, автоматического банковского подтверждения, смены TABLE↔COUNTER и статусов готовности/выдачи.

### 3.1. Первая реализация после подтверждения

**Один согласованный блок A**, внутри — последовательные завершённые срезы:

1. Контракты/права + migration 007 + финансовая финализация TABLE/ZERO_SETTLED + CUSTOMER + Desktop и проверка потери ответа.
2. Отдельные корректировки/действующие порции + атомарная замена + KITCHEN-уведомления + соответствующий Desktop.
3. COUNTER: черновики, первый/последующие Batch, номера, быстрый и отложенный checkout, контейнеры, общий worklist/×.
4. История 24h и все обходные маршруты, минимальные денежные инциденты, регрессия и единый Electron QA на fixtures.

Срезы — инженерная последовательность, не предложение просить ручной Windows-тест после каждого. Изменение финального согласованного scope или новое продуктовое решение требует согласования; уже утверждённые пункты повторно не спрашиваются. После блока обновляются PROGRESS, README и фактические API-контракты с разделением реализовано/проверено/не проверено/открыто.

## 4. Жизненный цикл и денежный контракт

### 4.1. Состояния

Сохранить `orders.status=OPEN` для действующих TABLE; добавить `COMPLETED`, `CANCELLED`. Для COUNTER в API выдавать `operationalState=ACTIVE` при внутреннем OPEN, `COMPLETED` или `CANCELLED`. Это техническое отображение согласованного CORE ACTIVE, а не четвёртое состояние. Отдельный `financialState`: `UNPAID | PAID | ZERO_SETTLED | CANCELLED`.

| Операция | Заказ после commit | TABLE-посещение | Settlement / Payment |
|---|---|---|---|
| Первый/следующий Batch | OPEN / UNPAID | OPEN | Нет |
| Положительный полный расчёт | COMPLETED / PAID | CLOSED / PAID | Один полный Settlement, 1–2 положительных Payment |
| Явный нулевой расчёт с действующими порциями | COMPLETED / ZERO_SETTLED | CLOSED / ZERO_TOTAL | Один нулевой Settlement, Payment отсутствуют |
| Полная отмена всех действующих порций | CANCELLED / CANCELLED | CLOSED / CANCELLED | Ни Settlement, ни Payment, ни CUSTOMER |
| EMPTY без когда-либо принятого Batch | Order отсутствует | CLOSED / EMPTY | Нет |

COUNTER не создаёт посещение. Терминальный заказ не принимает Batch/скидку/обычную коррекцию и не переоткрывается. Refund/Reversal позже не переписывают исходное закрытие. `has_accepted_batch` монотонен; `has_registered_payment=1` только при настоящем положительном Payment. Нулевой расчёт и полная отмена сохраняют флаг принятых пакетов.

Settlement в A — только подтверждённый immutable факт, не PENDING-процесс оплаты. Payment — immutable регистрация положительной суммы и метода. UI-состояния «подготовка/сохранение/неизвестно» не являются финансовыми статусами БД.

### 4.2. Цена и суммы

Все деньги — целые тыйыны, диапазон **0…999999999**; Payment строго **1…999999999**. Количество **1…9999**, лимит входящего Batch **1000 строк**, действуют прежние пределы JSON. Расчёт промежуточных значений BigInt. Ввод «12,34» или «12.34» преобразуется в 1234 без float-округления; третий дробный знак, минус, экспонента, NaN/Infinity/unsafe integer отклоняются.

`S = Σ(историческая unitPrice × действующее количество)`; после коррекции `D' = min(D, S)` с отдельным discount event, причиной и связью с коррекцией. `B=S−D'`. TABLE: для каждой сохранённой ставки r в сотых процента `F=(B*r+5000)/10000` с целочисленным делением; `T=B+ΣF`. COUNTER: `T=B`, сборов нет. Старые строки не переоцениваются по новому меню; новые Batch/замены используют актуальное меню. Итог не округляется до сома.

Обычный расчёт: выбран один метод CASH/CARD_MANUAL/QR_TRANSFER_MANUAL; сумма целиком определяется сервером. Нет обязательного ввода «получено», автоматического расчёта сдачи или cash rounding. Сотрудник выдаёт сдачу самостоятельно. Для карты/QR явно указано, что результат внешней оплаты проверяет сотрудник.

Смешанный расчёт: **два разных** метода из трёх; разрешены CASH+CARD, CASH+QR, CARD+QR в любом порядке. `0 < firstAmount < T`; `secondAmount=T−firstAmount`, ввод второго поля запрещён; сумма двух Payment точно T. Для T=1 тыйын смешанный расчёт недоступен. Не принимать одинаковые методы, три метода, нулевую/отрицательную долю или неравный итог. Это одно завершение, не два последовательных списания.

ZERO_SETTLED имеет отдельный явный payload и подтверждение; никакой подстановки CASH=0. Пустой состав и заказ без действующих порций не допускаются к нулевому расчёту.

## 5. Права и область доступа

Обозначения: **✓** default; **○** только явный grant; **—** запрещено ролью. Все значения можно отозвать в рамках действующих системных правил. Audience/роль/статус/grant/branch/object/state проверяет сервер, включая replay.

| Предлагаемый ключ | Owner | Manager | Cashier | Waiter | Предметная область |
|---|:---:|:---:|:---:|:---:|---|
| `order.settle.table` | ✓ | ✓ | ✓ | ○ | Доступное TABLE-посещение, включая ZERO |
| `counter.view` | ○ | ○ | ✓ | — | Операционные COUNTER своего филиала |
| `counter.batch.submit` | ○ | ○ | ✓ | — | Первый Batch/дозаказ; fast checkout требует также settle |
| `order.settle.counter` | ○ | ○ | ✓ | — | COUNTER своего филиала; включая ZERO |
| `order.correct` | ○ | ○ | ○ | ○ | Частичные отмены/замены/комментарии, TABLE или разрешённый COUNTER |
| `order.cancel` | ○ | ○ | ○ | — | Полная отмена, включая последнюю порцию |
| `counter.hide` | ○ | ○ | ✓ | — | Только завершённые карточки своего филиала |
| `sales.view_24h` | ✓* | ○* | ✓ | — | Все продажи филиала в 24h, не только личные |
| `payment.incident.record` | ✓* | ✓* | ✓* | ○* | Минимальное сообщение о спорном/неполном поступлении |

*Новые defaults истории у Owner/Manager и регистрации инцидента — рекомендация R-A1/R-A6, а не ссылка на уже утверждённые defaults. Cashier history всех продаж за 24h уже согласована AUTH-002. Финальный набор фиксируется при подтверждении. Для Waiter инцидент доступен только при grant TABLE-расчёта и доступе к посещению, native Desktop всё равно не принимает WAITER_WEB.*

Существующие `order.discount.set`, `table.batch.submit`, `table.view_details`, `table.access_others` сохраняются. COUNTER-скидка дополнительно требует counter.view и допустимой роли. Для COUNTER-коррекции нужны counter.view и order.correct/cancel; Waiter не получает COUNTER через общий grant корректировки. Ролевые defaults новых ключей задаются явно, исключая непреднамеренное расширение Owner через административный фильтр.

TABLE: grant оплаты или отмены **не даёт** доступ к чужому столу в STRICT. Сохраняется TableService scope; кассиру, обслуживающему чужие столы в STRICT, нужен существующий отдельный `table.access_others`. Не выдавать его миграцией автоматически. SHARED не меняет автора и ответственного. Финансовая история 24h — отдельный разрешённый read-scope, который не открывает операции чужого активного посещения.

Manager делегирует только действующее собственное право из Owner-набора, не себе/Owner и не сверх role ceiling. Не назначать новые override всем существующим сотрудникам ради удобства; новые defaults соответствуют матрице, финансовые рисковые grants остаются явными. Метод входа PIN/пароль полномочия не меняет.

## 6. SQLite: проект migration 007

### 6.1. Сохраняемые и новые структуры

Новая **007-block-a**; SQL и checksum 001–006 неизменны. Окончательные имена/индексы фиксируются в migration и API-контракте при реализации; обязательная физическая модель:

| Структура | Существенные данные / инварианты |
|---|---|
| `orders` — совместимое расширение | Существующие ID/branch/shift/visit/fees/createdAt; TABLE/COUNTER, состояния, финансовый результат, revision; counterNumber, guestLabel; terminal actor/time; агрегаты из действующих порций |
| `table_sessions` — расширение допустимого закрытия | EMPTY/PAID/ZERO_TOTAL/CANCELLED; прежние ID/снимки/ответственный; монотонные флаги; terminal immutable |
| `settlements` | UUID, branch/order/shift/command, orderRevision, kind PAID/ZERO_SETTLED, сумма, snapshot полного расчёта/состава, actor ID/name, server time; immutable |
| `payments` | UUID, branch/settlement/order/shift, method, amount>0, actor ID/name/time; уникальный method на Settlement; immutable |
| `settlement_seals` | Один финализированный Settlement заказа в объёме A; immutable; создание проверяет сумму/число Payment и ZERO, связывает терминальный результат |
| `order_corrections` / `order_correction_lines` | Immutable header с reason/type/actor/time/command/before-after; ссылки на все исходные item/portion, quantities, комментарии, replacement Batch |
| `order_item_portions` | Производная текущая проекция порций: stable portion ID, исходный Item, active quantity, текущий комментарий, revision; исходная цена только из Item; история всех изменений в correction facts |
| `counter_sequences` | branch+shift PK, следующий номер; выдача в той же транзакции, без удаления/повторного использования подтверждённых номеров |
| `counter_worklist` / `counter_visibility_events` | Order, VISIBLE/HIDDEN, отдельная visibilityRevision; immutable события ×; не менять финансовую revision или время продажи |
| `print_jobs` — совместимое расширение | Immutable ID/payload; KITCHEN/CUSTOMER; назначение NEW_BATCH/CANCEL/CHANGE_COMMENT/SETTLEMENT; ссылки на Batch/Correction/Settlement по назначению |
| `print_job_dependencies` | Immutable ребро predecessor→successor в одном branch/order; серверная последовательность, без цикла/ссылки на себя; без физических attempts в A |
| `payment_incidents` / events | Только минимальный durable факт неурегулированного поступления по §11; не Payment/Refund и не ручная восстановительная продажа |

Для TABLE visit обязателен, counterNumber отсутствует; для COUNTER visit **NULL**, номер положителен, fees пустые. Составной UNIQUE(branch,shift,counterNumber) исключает гонки. Имя гостя необязательно, до **100 Unicode code points**, простой однострочный текст, без управляющих символов; лимит предлагается к утверждению R-A4. Номер отображается минимум тремя цифрами (`014`, после 999 — `1000`), хранится числом, всегда вместе с идентификатором смены в истории. Переполнение последовательности — отказ без commit, не wrap.

Все предметные ссылки — составные по branch и ID; связь Payment→Settlement дополнительно гарантирует совпадение order/shift. Смена финализации совпадает со сменой активного заказа: переноса обязательств между сменами в A нет. FK RESTRICT, без удаления исторических родителей/каскада. Факты Settlement/Payment/Correction/Batch/Item/discount/print/audit/receipt не переписываются и не удаляются обычными командами.

### 6.2. Проверяемые ограничения

- Терминальные сочетания из §4 — CHECK/trigger; запрет отката в OPEN и обычной модификации закрытого заказа. Один TABLE Order на посещение, одна OPEN Session на стол сохраняются.
- На момент sealing: PAID имеет 1–2 разных метода, суммы >0 и точно total; ZERO — total=0, действующие позиции и ни одного Payment. После seal новые Payment запрещены. Нет промежуточного committed неполного Settlement: его создание, Payments, seal и терминальные переходы выполняются одной сервисной транзакцией; тесты принудительного сбоя проверяют весь набор.
- Один слот финализации заказа в A защищён PK/UNIQUE независимо от command ID и процессов. Не добавлять выдуманную семантику ACTIVE/REVERSED и partial index «действительных» расчётов до D05. Будущий замещающий расчёт потребует отдельного согласованного расширения слота, сохраняя все исходные факты.
- У проекции порций сумма active quantities ≤ исходного количества; отмена/разделение не увеличивает исходное количество. До commit сверяются проекция и correction ledger; изменение количества защищено CAS. При разделении по комментарию сумма количеств сохраняется. Новая порция новой цены появляется только новым Item/Batch.
- Физическая cross-row целостность проверяется триггерами для переходов/связей и серверными проверками внутри BEGIN IMMEDIATE; ограничения, которые SQLite не может выразить обычным CHECK, не выдаются за такой CHECK. Прямые негативные SQL-тесты обязательны.
- Старые payload print v1 сохраняются побайтно; новые допускают отдельную версию. Batch-уникальность KITCHEN/NEW_BATCH сохраняется; CUSTOMER уникален по Settlement; коррекция уникальна по correction+purpose+группе исходных связей. Несколько отмен одного Batch имеют разные correction ID.

### 6.3. Совместимость и миграционный preflight

1. Fresh init получает новую схему. Старый runtime со схемой 7 отказывает; новый runtime старую БД сам не мигрирует. Desktop получает capabilities и не показывает финансовые действия на schema<7; старый Desktop не должен изображать CLOSED-заказ редактируемым.
2. Миграция только явная, при эксклюзивном владении instance lock и отсутствии OPEN-смены. Проверить marker/identity/checksums/physical schema/FK/integrity, место на диске и совместимость runtime/SQLite ABI.
3. До обновления существующей установки — проверенная согласованная копия и изолированное пробное обновление. Безопасный backup/preflight — зависимость D13; эксперимент на fixtures не доказывает пригодность production backup.
4. CHECK-ограничения меняются реконструкцией затронутого графа таблиц с копированием всех исходных значений/ID, восстановлением FK/index/trigger. Не использовать `writable_schema`, бесконтрольный rename родителя или отключение FK внутри уже начатой транзакции. Конкретную shadow-table последовательность доказать на реальном SQLite и сравнить с эталонной новой схемой.
5. Сохранить старые Session/Order/Batch/Item/print payload/discount/commands/audit/outbox/identity/PIN bindings. Для старых Item создать однозначную исходную portion-проекцию. Старые jobs остаются PENDING; A не запускает массовую доставку.
6. Migration transaction: либо всё и новая запись checksum, либо исходная схема/данные. Прерывание/нехватка места не приводит к READY с частичной схемой. После — physical schema comparison, FK/integrity, контроль ID/counts/snapshots и restart.
7. На fixtures проверить fresh и старые 3/4/5/6→7, CLOSED/исторические данные и отказ при OPEN без изменения файла/смены. Fixture со старым OPEN используется для проверки guard и копирования в изолированном техническом стенде, не для разрешения обновления пользователя.
8. **Переход MANGO/Windows с OPEN и отсутствующим close — отдельный блокирующий runbook до поставки.** Возможный compatibility release следует проектировать отдельно; это ТЗ не разрешает промежуточную смену статуса SQL, reset регистрации или новую пустую БД. Разработка/приёмка A на новых fixtures от этого не блокируются.

## 7. API v1 и DTO

Native loopback/Host/Origin/no-store/JSON/ограничения тела сохраняются. Не принимать branch/actor/role, готовые статусы или клиентские цены как полномочия/итоги. Неизвестные поля отклоняются. Новые маршруты — предложение, существующие не переименовываются без необходимости.

### 7.1. Общие формы

`PaymentSelection` — строго один вариант:

```json
{"kind":"SINGLE","method":"CASH"}
{"kind":"MIXED","firstMethod":"CASH","firstAmount":80000,"secondMethod":"QR_TRANSFER_MANUAL"}
{"kind":"ZERO"}
```

`OrderDto`: id/type/status/operationalState/financialState/revision/shiftId; TABLE sessionId либо COUNTER counterNumber/guestLabel; действующие portion-строки с исходными itemId/batchId, историческими unitPrice/модификаторами и current quantity/comment; subtotal/discount/base/fees/total; допустимые действия; отдельные страницы исходной истории. Денежные итоги берутся из сервера.

`PrepareResult`: authoritative rows/totals; expectedOrderRevision; expectedVisitRevision для TABLE; shiftId; разбиение Payment либо ZERO; необходимые before/after; `confirmationHash` канонического существенного предложения, привязанного к branch+actor+операции+объекту+revisions+payment selection. Для новых Batch включаются menuRevision/draftId/draftRevision и снимки. Hash не credential и не резерв цены. ServerTime для отображения **не включается** в каждый новый hash, чтобы само течение времени не делало любое подтверждение устаревшим.

`CommitReceipt`: commandId/orderId/новая revision/result; при применимости settlementId/paymentIds/correctionId/batchId/sessionId/printJobIds/counterNumber. **Без состава, сумм, методов и guest label**: это узкий результат команды, а не бесконечный обход 24h. Подробности читаются отдельным разрешённым GET.

### 7.2. Расчёт / коррекции

| Метод и путь после `/api/v1` | Запрос / результат |
|---|---|
| GET `/orders/:id` | Операционная карточка доступного активного TABLE/COUNTER; terminal financial details только через sales-policy |
| POST `/orders/:id/settlements/prepare` | `{payment}` → текущий итог/разбиение/revisions/hash; read-only |
| POST `/orders/:id/settlements/commit` | commandId, payment, expectedOrderRevision, expectedVisitRevision (null для COUNTER), shiftId, confirmationHash → receipt |
| POST `/orders/:id/corrections/prepare` | action, targets[], reason при отмене/замене; replacement Draft при замене → before/after/discount adjustment/jobs preview/hash |
| POST `/orders/:id/corrections/commit` | commandId, тот же semantic payload, revisions/shiftId/hash → receipt |
| POST `/orders/:id/cancel/prepare` | reason → все действующие порции/последствия закрытия/hash |
| POST `/orders/:id/cancel/commit` | commandId, reason, revisions/shiftId/hash → receipt |
| POST `/orders/:id/discount` | Существующий CAS DTO; расширить COUNTER и запретить terminal; history события сохраняются |

Actions correction: CANCEL_QUANTITY/GROUP_CANCEL/REPLACE_ITEM/CHANGE_COMMENT; платный модификатор использует REPLACE_ITEM. Targets: `{itemId,portionId,quantity}`, без дублей/перекрытий. Отмена и замена: непустая причина до **300 code points**, простой текст; комментарий до существующих 300. Для CHANGE_COMMENT reason необязателен, но old/new text и автор обязательны. Replacement содержит обычные selections с новым draftId/revision; положительные количества новой позиции не обязаны совпадать со старой, итог операции показывается целиком.

Отдельный GET `/orders/:id/events?after=&limit=` возвращает исходные Batch, corrections, discount events с общим серверным порядком, текущие проекции — отдельно. Для terminal применяется тот же 24h read-scope, что и sales details. Существующие `/tables/visits/:id/order|batches|kitchen-jobs` также закрываются общей terminal-policy, а не остаются обходом старых продаж. Доступ Waiter к terminal TABLE не превращается в доступ ко всем продажам: прежний разрешённый объектный scope плюс ограниченное окно для финансовых данных.

### 7.3. COUNTER

| Метод / путь | Контракт |
|---|---|
| GET `/counter/orders?state=ACTIVE&cursor=&limit=` | Все доступные активные COUNTER филиала, включая старше 24h; limit default 20, max 100 |
| POST `/counter/draft-context` | Существующий/новый counter draft scope → instance/branch/employee/shift/capabilities/validUntil; не создаёт Order |
| POST `/counter/orders/prepare` | draftId/draftRevision/menuRevision/lines/discount/guestLabel, mode ACCEPT или CHECKOUT, payment только CHECKOUT → предложение |
| POST `/counter/orders/commit` | commandId и подтверждённые поля/revisions/hash/shiftId → первый Order+Batch; CHECKOUT дополнительно полностью финализирует |
| POST `/counter/orders/:id/batches/prepare|submit` | Переиспользование существующего Batch-контракта с COUNTER scope; без TABLE fees |
| GET `/counter/worklist?cursor=&limit=` | VISIBLE завершённые карточки филиала, отдельная пагинация; фильтр текущая/все смены по §10 |
| POST `/counter/orders/:id/hide` | commandId, expectedVisibilityRevision → HIDDEN receipt; не требует OPEN/не меняет суммы |

Для accepted COUNTER финализация только общим Settlement API; нельзя повторно включить старые строки как новый fast checkout. Повтор payment после отложенного Batch не создаёт KITCHEN заново. Скрытые карточки доступны через историю в разрешённых пределах. Команда unhide и её право в A не реализуются.

### 7.4. История / инциденты

| Метод / путь | Контракт |
|---|---|
| GET `/sales?type=&method=&query=&cursor=&limit=` | Только подтверждённые PAID/ZERO_SETTLED в 24h; cursor по financialFactTime+ID, default 20/max 100; serverTime/windowStart |
| GET `/sales/:orderId` | Исторический состав и расчёт/Payment/коррекции до финализации/actor/time; окно и branch повторно проверяются |
| POST `/payment-incidents` | commandId, связанный orderId либо counter draft reference, исходный command ID при наличии, известные суммы/методы, пояснение → durable OPEN incident |
| GET `/payment-incidents?state=OPEN` | Разрешённые операционные случаи; без банковских секретов; не отчёт о продажах |

Чтение/запись инцидента ограничивается текущими полномочиями и связанным объектом. Общую историю инцидентов/административное разрешение расширит B. Экспорт, reprint и финансовые исправления не появляются скрытыми alias-маршрутами. Если добавятся позже, 24h/отдельные grants обязательны на каждом.

### 7.5. Ошибки

| Группа | Коды / поведение |
|---|---|
| Валидация 400 | INVALID_PAYMENT_METHOD, INVALID_PAYMENT_SPLIT, ZERO_SETTLEMENT_REQUIRED, INVALID_REASON, INVALID_QUANTITY, INVALID_COMMENT; существующие MONEY_LIMIT_EXCEEDED/INVALID_DISCOUNT/INVALID_LINES |
| Auth 401/403 | SESSION_INVALID/EXPIRED, PASSWORD_CHANGE_REQUIRED, CLIENT_AUDIENCE_DENIED, PERMISSION_DENIED, VISIT_ACCESS_DENIED; не выдавать подробности запрещённого объекта |
| Scope/read 404 | ORDER_NOT_FOUND/SALE_NOT_FOUND; чужой и вышедший за окно объект не раскрывают состав/сумму/время |
| Domain 409 | CONFIRMATION_STALE, ORDER_REVISION_CONFLICT, VISIT_CLOSED, ORDER_NOT_OPEN, ORDER_ALREADY_SETTLED, SHIFT_REQUIRED/SHIFT_CHANGED, DRAFT_ALREADY_ACCEPTED, FULL_CANCELLATION_PERMISSION_REQUIRED, COUNTER_NOT_COMPLETED, VISIBILITY_REVISION_CONFLICT |
| Повтор/ресурсы | COMMAND_ID_CONFLICT 409; STORAGE_BUSY/WRITE_QUEUE_FULL 503; STORAGE_WRITE_FAILED/BLOCKED по существующему storage-контракту |

Ошибка не содержит чужой новый счёт. После конфликта UI отдельно получает разрешённый актуальный DTO и заново prepare. При изменении условий — явное новое подтверждение. Любая неоднозначная транспортная ошибка сохраняет pending; не считать любой HTTP 5xx доказанным rollback.

## 8. Транзакции, подтверждение и replay

### 8.1. Полный/нулевой TABLE-расчёт

1. До отправки native main надёжно сохраняет commandId и неизменное semantic body; затем HTTP.
2. BEGIN IMMEDIATE существующего CommandBus → assertStorage → актуальная сессия/audience/роль/grant/branch и допустимый object/receipt scope → fingerprint/replay.
3. Для новой команды: текущая OPEN-смена совпадает с order/visit, Order OPEN, ожидаемые revisions, действующие порции и итог; повторный полный prepare/hash, payment validation, отсутствие seal.
4. INSERT Settlement + 1–2 Payment либо ZERO без Payment; seal; update Order revision/status; close Session с actor/time/reason и revision+1; положительный payment flag при применимости. Свободность стола выводится из отсутствия OPEN-посещения.
5. CUSTOMER immutable snapshot, audit, outbox, command receipt → проверка storage → **commit → успех**.

При ошибке любой обязательной записи — нет ни оплаты, ни освобождения стола, ни частичных Payment. Принтер/сеть/банк/ожидание сотрудника не выполняются внутри транзакции.

### 8.2. COUNTER и коррекции

Fast COUNTER: текущие права+shift+подтверждённое меню → номер → Order+Batch+Items+portions → KITCHEN при необходимости → полный/нулевой расчёт+CUSTOMER+VISIBLE → audit/outbox/result → один commit. Ошибка не оставляет подтверждённого неоплаченного заказа или использованного номера этой операции.

Deferred COUNTER: такой же первый приём без Settlement/CUSTOMER, ACTIVE/UNPAID; дозаказы отдельно. Последующая оплата сохраняет только расчёт/финализацию/CUSTOMER, а не повторяет принятый Batch.

Коррекция: авторизация → revision/active portions → проверка всей группы/причины/нового меню → вычисление **итога всей операции** → при итоговом нуле порций order.cancel → immutable correction → CAS portions → replacement Batch/Items при необходимости → пересчёт/discount event → нужные KITCHEN/dependencies → возможное CANCELLED и закрытие TABLE → audit/outbox/result. При замене последней старой позиции новой действующей право полной отмены не требуется только из-за промежуточного нуля внутри операции.

CHANGE_COMMENT части позиции создаёт однозначное разделение порций: например Item×2 → portionA×1 «без лука» и portionB×1 исходный комментарий. Последующие отмены/комментарии выбирают конкретную portion и revision; невозможно дважды отменить одну и ту же порцию. При split сохраняются ancestry/previous values, общий денежный итог неизменен.

### 8.3. Гонки и проверка исхода

- Settlement↔Settlement: один seal; другой command ID получает ORDER_ALREADY_SETTLED, не второй Payment.
- Batch/correction/discount первым → прежнее подтверждение оплаты stale. Оплата первой → позднее изменение отклоняется. Два первых COUNTER получают разные номера; одинаковый ID — один номер/Order.
- Параллельные отмены сериализуются/CAS; нельзя получить negative quantity или обойти последнюю порцию.
- Пока close отсутствует, A не изображает его рабочим. Проверка OPEN внутри writer обязательна; настоящий race close↔checkout/Batch/incident выполняется после реализации B, до приёмки B.
- Network timeout после commit не отменяет операцию. Только прежний ID/тело/actor; новая сессия того же employee допустима при текущих полномочиях. Новый ID допустим после доказанного отказа без commit и нового подтверждения условий.
- Смена/цены/статус OPEN проверяются **после journal lookup для новой команды**, иначе replay после финализации/будущего закрытия смены ошибочно скроет состоявшийся commit.

**Предлагаемая узкая receipt-policy R-A2.** Для совпавшего command fingerprint разрешить тому же действующему employee своего филиала получить только минимальный receipt собственной принятой команды, если текущие роль/audience/право операции сохранены. Это отдельный object scope «мой результат команды», а не доступ к закрытому SHARED-посещению. Не возвращать состав/суммы через replay; чужой actor запрещён; новые действия по такому разрешению невозможны. Для ещё не принятой команды сохраняется обычная текущая TableService/Counter авторизация. Отзыв права/блокировка не обходятся; pending сохраняется и показывается без чужих подробностей.

Применить этот принцип согласованно к затронутым TABLE Batch/discount/correction/settlement retries: иначе принятый Batch, ответ которого потерян перед оплатой другим сотрудником, нельзя безопасно завершить в native store. Существующий CommandBus не переписывать: добавить узкую проверяемую policy в authorize-слой сервисов. Проверить изменения STRICT/SHARED и revoke отдельно.

## 9. Печать как постоянные факты блока A

CUSTOMER snapshot: branch/shift/order; table/zone historical names или COUNTER number; актуальные на финализацию порции/цены/варианты/modifiers/comments; S/D/B/fee names/rates/amounts/T; методы и суммы Payment либо явное ZERO без метода; actor/time; language fallback. Это внутренний документ, не обещание фискальности. После commit payload не зависит от текущего меню/переименования сотрудника.

KITCHEN NEW_BATCH содержит только новые kitchen-позиции; COUNTER-маркировку «НА ВЫНОС» и номер, TABLE — стол. Отмена/комментарий используют исходный Item.kitchen, а новая replacement позиция — актуальный kitchen snapshot. При замене: old kitchen/new non-kitchen — только отмена; обратный случай — только новый Batch; оба non-kitchen — jobs нет. Полная отмена создаёт KITCHEN для затронутых кухонных строк, CUSTOMER не создаёт.

Сохранить порядок исходный job → отмена/изменение → replacement NEW_BATCH, если обе стороны требуют кухни. По одному Order использовать устойчивую серверную последовательность и dependency edges, не сортировку только по Date.now. Старый ожидающий job не удалять/не сливать с новым. Номер Batch остаётся только в связях/UI, не в печатных строках.

В A UI показывает **«Задание сохранено. Печать не подключена»**, без «Напечатано». Worker/claim/attempt/FAILED_SAFE/UNKNOWN/ручная перепечатка и поздние jobs закрытых смен — C. Для них оставить возможность отдельных state/attempt tables поверх immutable jobs, не добавлять неработающие физические статусы. Наличие jobs/dependencies проверяется в A; физический порядок бумаги — только аппаратная приёмка C.

## 10. История 24 часа и COUNTER worklist

### 10.1. Financial fact time — R-A3

Рекомендация: **financialFactTime = неизменяемое серверное settledAt** полного PAID/ZERO Settlement. Время принятия Batch, обновления заказа, скрытия карточки, печати или позднего Refund не переносит исходную продажу в новое окно.

Для запроса сервер фиксирует один `now`; доступно `now−86400000 ≤ settledAt ≤ now`. Нижняя граница включительна; запись на 1 мс старше исключается. Дата/часовой пояс UI не влияет на отбор. Ответ no-store, UTC epoch ms; отображение Asia/Bishkek. Cursor не расширяет окно: каждый запрос, details и переход по ID проверяют актуальное серверное окно; в открытой карточке право перечитывается и данные очищаются при истечении окна/сессии/отзыве.

PAID/ZERO — продажи; ACTIVE/UNPAID и CANCELLED не выдаются за продажи. История исходных пакетов/коррекций остаётся в карточке доступного активного заказа; отменённые заказы хранятся в операционном/audit контуре, не включаются в список продаж. Финансовые итоги «выручка/чистая выручка» до D08 не добавлять; A показывает конкретные суммы конкретных расчётов.

Mixed payment при фильтре по методу выбирает продажу один раз, в details остаётся разбивка. Поиск по номеру/ID/пометке ограничен той же SQL-выборкой, не выдаёт число/сумму старых найденных записей. Результат пустого поиска не раскрывает существование чужой продажи. Owner/Manager в A также не получают неограниченную финансовую историю автоматически: предлагается тот же ограниченный sales.view_24h, будущий административный доступ — отдельно.

Защита действует также на legacy TABLE GET, jobs payload, terminal Counter GET, события, поиск и будущие export/reprint. Защита UI без SQL/service-policy недостаточна. Операционный доступ к **активным неоплаченным** заказам старше 24h сохраняется; они не являются старой продажей.

### 10.2. Долговременные карточки — R-A5

CORE COUNTER требует карточку до ручного ×; AUTH-002 ограничивает старые финансовые подробности. Рекомендация, требующая утверждения: **видимость не сбрасывать таймером**, но после 24h возвращать только минимальную операционную карточку: orderId, номер и идентификатор смены, VISIBLE/visibilityRevision и сообщение «Подробности доступны в административной истории». Не отдавать сумму, payment method, guest label, состав/комментарии. Разрешить × по counter.hide с аудитом без требования OPEN. Кнопка × не считает заказ выданным.

По умолчанию экран завершённых показывает текущую смену; отдельный фильтр «Все видимые» включает прежние смены с указанной маской. Пагинация не удаляет/не скрывает записи. Старая карточка хранится до явного ×; новая смена не делает её задолженностью. Если пользователь хочет сохранять полный состав после 24h, это отдельное явное уточнение AUTH-002, его нельзя молча вывести из worklist.

При PAID/ZERO создаётся VISIBLE; CANCELLED уходит из активных и виден в разрешённой операционной истории, отдельной карточки выдачи для него не создавать. Нажатие × только на завершённом; скрытие ACTIVE запрещено. Возврат HIDDEN→VISIBLE отложен, доступ к разрешённой истории обязателен.

## 11. Сбой фактического получения денег — минимальный контракт R-A6

До полного commit нет Payment/PARTIALLY_PAID, даже если вне POS уже поступила часть средств. UI не должен предлагать получить их повторно. Сначала проверить исходный command receipt; отсутствие подтверждённого результата не равно отсутствию денег.

В A предлагается минимальный durable `payment_incident`: branch, shift при наличии, orderId либо counter draft reference, source command ID, actor/time, OPEN, известные методы/целые суммы, пояснение. Сохраняется отдельной идемпотентной командой с audit/outbox/result; не регистрирует продажу/Payment/Refund. Для первого COUNTER без Order сохраняется draft reference и ограниченный безопасный снимок контекста, не фиктивный принятый Batch. При недоступном Local Server сообщение pending хранится защищённо на клиенте и явно помечается «ещё не сохранено на сервере».

Сценарии: перевод получен, commit неизвестен; commit достоверно отклонён при изменившейся сумме; получен только первый компонент mixed; сотрудник не уверен в банковском результате. Сумма инцидента — заявленный известный факт, не подтверждение банка. Банковские секреты, PIN/CVV/полный PAN/пароли в поля/логи не допускаются. Рекомендованный reason простой текст до 300 символов с подсказкой не вводить реквизиты.

В A нет произвольной кнопки «урегулирован» и автоматического удаления OPEN-инцидента. Безопасное подтверждение исходного Settlement связывается с case, но само по себе не закрывает спор о лишнем внешнем поступлении. Разрешение/внешний возврат незачтённых средств и права проверяющего проектируются в B по Recovery §10; это не D05 Reversal и не D09 MANUAL_RECOVERY. До B close всё равно недоступен, после B открытые денежные случаи — реальные блокеры. Не возвращать фиктивное «инцидентов нет».

## 12. Интерфейсное ТЗ Desktop RU/KY

### 12.1. Общая структура

Сохранить существующий shell/login/смену/столы/меню/PIN. Добавить по правам вкладки **«На вынос»**, **«Продажи за 24 часа»**; в карточке TABLE — **«К расчёту»** и действия по принятым строкам. В shell постоянно видны сотрудник, филиал, текущая смена и состояние Local Server. Печать показывается отдельным состоянием от принятия заказа/оплаты.

Рабочее окно: при ширине ≥1100 px две колонки (каталог/действия и состав/итог); в диапазоне 800–1099 px последовательные секции с закреплённым итогом; вертикальная прокрутка без горизонтальной для основных действий. Проверить 1024×768 и 1366×768 при масштабе 100%, крупном системном шрифте и длинных RU/KY строках. Сенсорные основные кнопки не менее 44×44 px; клавиатура равноправна.

В A не менять существующую модель персонала/Owner, не добавлять панель межфилиальной аналитики. Разделы скрываются по правам, при отзыве активная форма закрывается с объяснением и повторной серверной проверкой. Polling не activity; во время ввода не перерисовывать форму/не сбрасывать выбранные порции.

### 12.2. Оплата TABLE / принятого COUNTER

1. «К расчёту» получает актуальный разрешённый серверный Order и prepare; показывает номер стола/COUNTER, действующие позиции с комментариями/модификаторами, S/скидку/каждый сбор/итог. База/ставки доступны в деталях. Для COUNTER нет даже нулевых строк сборов.
2. Три равные кнопки выбора **«Наличные» / «Карта» / «QR-перевод»**. Изначально метод не выбран; финальная кнопка disabled. Второстепенно «Смешанная оплата». Нет поля суммы при SINGLE и нет дополнительной обязательной формы сдачи.
3. Для CARD/QR текст: «Проверьте поступление во внешнем терминале/банковском приложении. BASHKAR регистрирует ваше подтверждение». Не показывать банковский success значок до ручной регистрации.
4. Итоговая кнопка **«Завершить оплату · 1 908,00 сом»** — явное финальное подтверждение; ещё одного одинакового confirm-dialog не требуется. Смена метода пересчитывает prepare; кнопка активна только для показанного актуального предложения.
5. MIXED: два select с разными методами, editable первая доля, второй остаток read-only от сервера, обе суммы видны крупно; подсказка «Подтвердите получение обеих частей». До корректного prepare финальная кнопка disabled. Выход из mixed не регистрирует первый Payment.
6. T=0: методы скрыты, пояснение «Нулевой расчёт. Деньги не регистрируются»; отдельная кнопка **«Завершить нулевой расчёт»**. Для TABLE заранее указать «Посещение будет закрыто, стол освободится». Для CANCELLED/пустого состава эта форма не открывается.
7. Во время сохранения форма блокирует повторный submit и закрытие, показывает «Сохраняем расчёт…». После commit — понятное подтверждение PAID/ZERO, для TABLE возврат к свободному столу; CUSTOMER «задание сохранено, печать не подключена». Ошибка последующего GET деталей не превращает уже подтверждённый commit в неуспешную оплату.

При наличии локального непринятого Draft показать отдельное предупреждение перед расчётом: «В черновике есть N позиций. Они не входят в оплату». Frozen/pending Batch сначала требует выяснения исхода; нельзя оплатить предположительно принятый пакет. Непустой обычный Draft разрешается явно оставить вне расчёта после подтверждения; он сохраняется закрытым и не переносится в новое посещение. Недоступность чужих клиентских drafts не позволяет обещать их отсутствие.

### 12.3. COUNTER

Экран «На вынос»: **«Новый заказ»**, списки **«Не оплачены» / «Завершены — видимые»**, фильтр смены. Draft-карточки явно локальные, не имеют подтверждённого номера. Несколько локальных drafts допускаются; scope instance+branch+employee+device+draftId и shift context. После смены shift черновик требует нового server prepare, не отправляется автоматически в старую смену.

Редактор: необязательная пометка гостя, выбор категорий/поиск/размеры/модификаторы/quantity/comment как TABLE, отдельные товары-контейнеры и итог без сборов. Две явные ветки:

- **«Оформить и оплатить»** → payment UI → один fast commit. До commit нет номера и принятого заказа; после — завершённая карточка.
- **«Подтвердить заказ»** → server preview/commit первого Batch → номер, ACTIVE/UNPAID, KITCHEN при необходимости; можно отложить и вернуться. Для существующего заказа новые строки отправляются отдельным Batch, кнопка оплаты рассчитывает принятые строки.

Оплаченная карточка: номер, пометка/состав/сумма/тип расчёта в разрешённом окне; **× с доступным именем «Скрыть из рабочего списка»**. Подсказка: «Скрывает карточку во всём филиале. История сохраняется». Не называть × «Выдано» или «Удалить продажу». Пока запрос выполняется, карточка сохраняется с индикатором; после commit исчезает на всех клиентах при следующем polling. Для старых карточек — маска §10.2.

### 12.4. Контейнер

Админка товара с menu.edit: поле **«Предлагать контейнер для заказа на вынос»**, выбор одного товара существующего меню, «Не предлагать», краткая цена/доступность. Изменение входит в обычный draft/publish всего меню; не действует на уже принятые позиции. Самоссылка запрещена; при архиве/недоступности связанного товара понятное предупреждение, без скрытого удаления исторического предложения.

После добавления выбранного блюда COUNTER — компактный блок **«Добавить контейнер?»**, отдельная цена, quantity по умолчанию равна количеству блюда, **«Добавить» / «Без контейнера»**. Блюдо не блокируется отсутствием контейнера. Если контейнер имеет варианты/обязательные группы, открыть существующий selector; не выбирать платные опции молча. Предложение не запускает рекурсивные предложения контейнеру. Новая строка получает свой lineId и обычную проверку меню.

После изменения quantity блюда в Draft предложить привести quantity явно связанного контейнера в соответствие; изменение только после согласия. Удаление/коррекция принятого блюда не удаляет контейнер автоматически: это самостоятельная принятая позиция. В TABLE автоматическое предложение не появляется. Не добавлять процент «за упаковку».

### 12.5. Корректировки

В принятых действующих строках меню действий: **«Отменить количество» / «Заменить» / «Изменить комментарий»**. Плюс групповое выделение. Кнопки не редактируют исходный Batch. В истории показывать «Исходно ×3; отменено ×1; действует ×2» с authors/time/reason, разные комментарии — отдельными portion-подстроками.

Отмена: quantity 1…current, обязательная причина; можно дать быстрые варианты «Ошибка заказа», «Отказ гостя», «Нет в наличии», «Другое» с редактируемым текстом. До commit server preview показывает старый/новый итог, уменьшение скидки и необходимые уведомления. Финальная кнопка **«Подтвердить отмену»**. Для kitchen-строк текст о необходимости связаться с кухней, без фиктивного цифрового подтверждения повара.

Последняя порция/вся группа: отдельное заметное состояние **«Полная отмена заказа»**, обязательное право order.cancel, причина, предупреждение об освобождении TABLE. При отсутствии права — объяснение и отсутствие отправки, серверный запрет обязателен. Наличие order.cancel без order.correct допускает отдельную полную отмену, не выдаёт частичную правку автоматически.

Замена: исходная строка/quantity, новое блюдо/вариант/modifiers/quantity, причина, before/after; одна финальная кнопка **«Заменить»**. Недоступность нового товара сохраняет исходный заказ целиком. Увеличение количества принятой позиции направляет в новый Draft/Batch, не на UPDATE исходной строки.

Комментарий: выбрать portion и количество; до 300 символов, счётчик, старый/новый текст. Цена не меняется; платный модификатор — кнопка замены. Preview поясняет, к какой части порций относится новое пожелание.

### 12.6. История продаж

Список «Продажи за 24 часа»: время, TABLE/COUNTER и номер, результат PAID/ZERO, сумма расчёта, методы, исполнитель. Фильтры тип/метод и поиск; состояние окна объясняется рядом, серверное время/граница доступны. Нет произвольного выбора старого периода и ложного KPI «выручка».

Details read-only: принятые и отменённые позиции/исторические цены, действующий состав на момент финализации, скидка/сборы, Settlement и отдельные Payment, фактические авторы и время. ZERO явно отличается от CANCELLED и CASH. Открытие известного старого URL/ID даёт «Продажа недоступна в разрешённом периоде», без сумм. В A нет действующих кнопок Refund/Reversal/перепечатки/export.

### 12.7. Ошибки, pending и доступность

| Состояние | Что видит сотрудник / допустимое действие |
|---|---|
| Загрузка | Skeleton/короткое сообщение; нет старого итога с активной оплатой |
| Успешный prepare | Серверная сумма и доступные способы; итог не редактируется |
| Конфликт / новая цена | Before/after по разрешённому DTO; сохранённый Draft; новое явное подтверждение |
| Сервер недоступен до отправки | Действие не подтверждено; Draft сохранён; оплаты/коррекции не выполняются offline в renderer |
| Ответ неизвестен | «Неизвестно, сохранился ли расчёт. Не принимайте деньги повторно»; **«Проверить исходную операцию»**, прежний ID/тело; новая продажа того же draft/order заблокирована |
| Достоверный отказ + деньги уже получены | Пояснение не требовать повторно; ссылка на минимальный денежный incident; новая регистрация только после проверки исхода и условий |
| Отзыв права / истёкшая сессия | Очистка подробностей, повторный вход; pending не стирать и не передавать другому сотруднику |
| Commit есть, локальная запись результата не сохранилась | Честное уведомление о локальной проблеме; безопасный replay прежней команды, без повторного платежа |
| Печать не работает | Отдельное предупреждение, не откат заказа/расчёта |

Новые drafts/pending расширяют текущий safeStorage store. Сначала durable запись, затем HTTP; ошибка записи — сеть не запускается. Frozen ID/body не редактировать. Resolve receipt и завершение соответствующего Draft сохраняются вместе; чужой employee не получает чужие payload/состав. Открытый render-кеш очищать на logout/revoke/expiry; HTML только textContent, без исполнения comments/guest label. Никаких банковских/сессионных секретов в URL/logs/renderer storage.

Новые модальные окна: осмысленный autofocus, focus trap, Esc/«Отмена» до submit, возврат фокуса к инициатору, aria-label и live-status, ошибка рядом с полем. Enter в textarea вводит перевод строки; Enter в редакторе суммы не должен непреднамеренно запускать оплату без выбранного/подтверждённого метода. Глобальную горячую клавишу оплаты не добавлять. Несохранённые формы закрываются после предупреждения; при pending закрытие окна не удаляет операцию. RU/KY переводятся все новые labels/errors/statuses, суммы сохраняют точность двух знаков.

## 13. Карта реализации по существующим файлам

| Файлы / модули | Изменение после подтверждения |
|---|---|
| `apps/local-server/src/migrations/007-…ts`, `migrations/index.ts`, `storage.ts` | Новая схема/проверки/совместимость; старые миграции не редактировать |
| `modules/orders/order-service.ts` + новые settlement/correction/counter/sales/incident services | Расширить существующие prepare/price/Batch, выделить новые операции по предметной ответственности; не второй CommandBus |
| `modules/tables/table-service.ts` | Контролируемое финансовое/отменное закрытие, область active/read/receipt; сохранить STRICT/SHARED |
| `modules/auth/permissions.ts`, authorization policy, auth/me | Явные defaults/ceilings/новые ключи и разрешённые действия; без изменения PIN lifecycle |
| `modules/menu/catalog.ts`, `pricing.ts`, menu service | Переиспользование арифметики, snapshot; закончить контейнерный UX, не новая ценовая модель |
| `api.ts`, `server.ts` | Whitelist DTO/routes/errors/services/capabilities и новая source version |
| `apps/pos-desktop/main.cjs`, `preload.cjs`, `draft-store.cjs` | Узкие IPC, pending/freeze/resolve и новый scope COUNTER/incident; никаких произвольных URL/branch/actor |
| `orders.js`, renderer/shell/styles + новые UI-модули | Сценарии §12, translations и состояния без секретов |
| Server tests и Desktop QA | Проверки §14, новые fixtures/настоящий Electron на одноразовой БД |
| Документы | Финальный API-A…/PROGRESS/README и принятое ТЗ; исходные решения не переписывать задним числом |

Сборки/fixtures/QA не используют `.local`, MANGO, рабочие Windows каталоги, настоящие регистрации/keys/OPEN-смены. Новый финансовый Windows ZIP и его установка — отдельный согласованный выпуск после решения перехода.

## 14. Приёмка A

| ID | Обязательная проверка | Критерий |
|---|---|---|
| A-AT-01 | Fresh schema7, 3/4/5/6→7, OPEN guard, interrupted migration | Старые ID/checksums/snapshots/commands сохранены; отказ не меняет смену/историю; нет partial READY |
| A-AT-02 | SINGLE: все три метода | Один Settlement, один положительный Payment, итог сервера, CUSTOMER, TABLE закрыт атомарно |
| A-AT-03 | MIXED: все три пары в обоих порядках | Два положительных Payment, точная сумма; одинаковые/три метода/0/переполнение отклонены |
| A-AT-04 | Нулевые товары и скидка 100% базы | ZERO_SETTLED без Payment, CUSTOMER=0; TABLE ZERO_TOTAL; отсутствие действующих позиций запрещено |
| A-AT-05 | Double checkout разными ID/процессами | Один seal, одна финализация, без двойной кухни/чека |
| A-AT-06 | Replay после commit/потери ответа/restart обоих процессов | Исходный receipt и frozen resolve, прежний ID/body; без второго Payment/номера/Batch |
| A-AT-07 | Оплата↔Batch/correction/discount | Последовательный итог, stale отклонён, terminal неизменяем; ни одной оплаты устаревшей суммы |
| A-AT-08 | Forced error Settlement/Payment/seal/Session/job/audit/outbox/result | Полный rollback всех новых фактов/агрегатов/флагов/номера/стола |
| A-AT-09 | SQL cross-branch/FK/immutable/terminal/quantity | Прямые недопустимые записи отклоняются; составные связи и триггеры работают |
| A-AT-10 | Исторические цены, новые меню/fees/stop-list | Старые позиции и TABLE ставки сохраняются; новые позиции/замены пересчитываются и требуют подтверждения |
| A-AT-11 | Частичная/групповая отмена, две отмены одной порции | Нет отрицательных/двойных количеств; общая причина; группа all-or-nothing |
| A-AT-12 | Последняя порция / замена последней старой позиции | Полная отмена требует grant; атомарная замена с итоговыми блюдами не считается полной отменой |
| A-AT-13 | Комментарий части количества, повторные split/cancel | Порции однозначны, суммы и исходные тексты сохранены; нет бесплатной смены платного modifier |
| A-AT-14 | Кухня old/new printable/nonprintable, несколько Batch | Только нужные задания, immutable payload, dependency order; нет дублирования при поздней оплате |
| A-AT-15 | Fast/deferred COUNTER, параллельные первые приёмы | Нет Session/fees, уникальные номера; быстрый полный commit; отложенный ACTIVE, отдельный checkout |
| A-AT-16 | Контейнер: отказ/quantity/варианты/stop/archive/нулевая цена | Только явные отдельные строки, корректный total, нет скрытой доплаты/рекурсии; TABLE без предложения |
| A-AT-17 | × из двух клиентов + restart + новая смена fixture | Глобальное durable HIDDEN; только visibilityRevision; нет изменения Payment/времени продажи/выдачи |
| A-AT-18 | 24h на границе ±1ms / прямой ID / search / cursor | Единая server-policy; обновление/скрытие не возвращают старую продажу; активный старый unpaid доступен |
| A-AT-19 | Все обходные terminal endpoints/jobs/events/receipt | Нет утечки старого состава/сумм; старый receipt только минимальный и собственный по R-A2 |
| A-AT-20 | Roles/defaults/revoke/audience/STRICT/SHARED/делегирование | AUTH-матрица, чужой branch/direct ID запрещены; Waiter не COUNTER; Owner без авто-grant отмен |
| A-AT-21 | Mixed получил только первую часть / спорный платёж | Нет частичного Payment; durable OPEN case/pending, без фиктивного банковского успеха |
| A-AT-22 | Максимальные деньги/количества/ставки/округление | BigInt и утверждённые лимиты; недопустимые значения до commit |
| A-AT-23 | Настоящий Electron/macOS, RU/KY, клавиатура/размеры окна | Все UI сценарии, live HTTP, safeStorage, pending/restart, отсутствие лишней отправки при ошибке локального store |
| A-AT-24 | Регрессия текущего проекта | check + полный Vitest + прежние Desktop/PIN/TABLE/Orders сценарии и новые финансовые QA |

Финансовые векторы для новых тестов:

- TABLE S=200000, D=20000, ставки 500/100 → база180000, сборы9000/1800, T=190800 тыйынов; COUNTER T=180000.
- Тыйыны: B=1, две ставки5000/5000 → каждый сбор1, TABLE total3; нельзя сначала сложить ставки и округлить один раз.
- Mixed T=200000, CASH=80000 → QR=120000; T=1 mixed запрещён.
- Отмена при S=70000/D=60000 до нового S=40000 → D'=40000, T=0, но с действующими блюдами Order остаётся OPEN до явного ZERO. Полное исключение всех порций → CANCELLED, не ZERO.
- Исторический плов30000×3, отмена1 после повышения меню до35000 → оставшиеся2 стоят60000; replacement/new Batch используют35000.

До реализации B отдельно пометить **NOT RUN / deferred** настоящий race close↔fast checkout/Refund и итоговый отчёт. В A можно проверить внутреннюю OPEN-защиту на контролируемых fixtures, но не выдавать это за работающий Shift close. В C отдельно физические принтеры/телефоны/роутер. В D отдельно Windows10/11/4ГБ/SCM/DPAPI/ACL, restore/power loss и пилот. Новые UI-сценарии без реально выполненного Electron QA не объявляются проверенными.

## 15. Что требуется подтвердить

Уже решённые CASH/CARD/QR, два метода, отсутствие частичных оплат/сдачи/COUNTER-сборов, фиксированную скидку, неизменяемую историю, Q/C/R CORE повторно не выбирать. Для нового блока предлагается подтвердить scope, DB/API и UI этого документа, включая следующие конкретизации:

| ID | Рекомендация / пример | Что именно утверждается |
|---|---|---|
| **R-A1** | Явная матрица §5; Cashier получает counter view/submit/settle/hide и sales24h; Owner/Manager COUNTER по grant, исправления/полная отмена у всех по grant | Технические ключи/defaults, включая Owner sales24h default, Manager по grant; существующие системные запреты сохраняются |
| **R-A2** | После потерянного ответа свой прежний receipt доступен при текущем праве, даже если SHARED-посещение уже закрыто; без сумм/состава | Узкий object scope восстановления собственной команды, не обход доступа к чужому посещению или revoke |
| **R-A3** | Скользящие 24h от immutable settledAt, нижняя граница включительна; например Batch позавчера, расчёт сегодня → сегодняшняя продажа | Единая временная ось/границы sales, terminal read и отсутствие итогового KPI до D08 |
| **R-A4** | COUNTER guest label до100 символов; номера 001…999/1000…; контейнеры используют обычные options selector и явное добавление | Новые интерфейсные пределы/потоки, drafts/размеры экранов/подтверждения §12 |
| **R-A5** | VISIBLE спустя24h остаётся, но без финансовых подробностей/состава; × доступен; полный состав не становится обходом AUTH | Согласование стыка долговременного worklist с ограничением истории24h; без автоматического скрытия |
| **R-A6** | Минимальный OPEN денежный case для полученной части mixed/спорного внешнего поступления; без Payment/самовольного resolve | Включение минимального incident backend/DTO/UI в A; полноценное урегулирование и close остаются B |

### 15.1. Открытые решения вне утверждения A

| Вопрос | Уже согласовано | Что ещё остаётся и что блокирует |
|---|---|---|
| D05 | Отдельное право Owner/Manager, причина, immutable исходный Payment | Замещающий расчёт/mixed/закрытая смена; блокирует Reversal, не обычную оплату A |
| D08 | Продажи/оплаты/методы/нули/возвраты раздельно, исходный отчёт immutable | Точные определения и формулы KPI; блокирует окончательный отчёт B, не список конкретных расчётов A |
| D09 | Два разных уполномоченных для финансовой MANUAL_RECOVERY | Документы/дедупликация/допустимый финансовый эффект; не реализуется формой «ввести прошлую продажу» |
| D11/D13 | Локальная и независимая шифрованная копия, проверяемый restore, безопасное обновление | RPO/RTO/ключи/носитель/ответственные и transition старой OPEN; блокируют production upgrade/пилот, не новый fixture A |
| D01/D02 | Защищённый отдельный Waiter-контур | Владение DNS/HTTPS/renewal/offline и реальные телефоны; блокирует сетевой выпуск C |
| D06 | Immutable jobs, UNKNOWN без автоповтора | Поддерживаемые принтеры/драйверы/attempt/маршрутизация и physical QA; блокирует физическую печать C |
| D12 | Серверное время и неизменяемые первичные timestamps | Пороги скачков/политика после restart остаются открытыми; 24h тестируется на управляемых часах, защита от изменения часов администратором не обещается |
| D16 | Предварительное направление отдельной ККМ | Проверка местным специалистом и инструкция ресторана до коммерческого пилота; CUSTOMER не фискальный чек |

**Ворота начала пройдены:** пользователь подтвердил блок A и R-A1…R-A6. Подтверждение A не является согласием на обновление существующих установок, разрешением нерешённых процедур Dxx или приёмкой всего MVP.
