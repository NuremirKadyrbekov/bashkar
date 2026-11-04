> **Сверка 24.10.2026.** Контракт исходной поставки schema 5; расчёты/корректировки добавлены API-FINANCE-007, доставка печати — API-PRINT-010. Снимки MATRIX/SET расширены MENU-VARIANT-MATRIX-TECH-001 и MENU-SETS-001. [Актуальное состояние и решения](DOCS-AUDIT-001.md).

**Дополнение 25.10.2026:** [API-CHECKOUT-015](API-CHECKOUT-015.md) реализует перенос/смену ответственного с историей и атомарную оплату с новым пакетом. Прежние ограничения неизменяемого назначения и запрет оплаты с дозаказом ниже описывают предыдущий этап; FAST_FIRST теперь использует новый контракт. TABLE_FIRST/TABLE_QUICK сохраняют свои сценарии.

# TABLE заказы и пакеты — фактический контракт 4.2

22.10.2026. Исходный сервер `0.5.0-orders`, SQLite schema 5. Основание: утверждённое `STAGE-004-02-SPEC.md`, рекомендации R4.2-01…07. Это описание реализации; не приёмка финансового контура или физической печати.

## Доступ и API

Все пути ниже относительно `/api/v1`; действуют прежние loopback/Host/Origin/Authorization/JSON/2 MiB ограничения. Новые права `table.batch.submit` и `order.discount.set` выданы исходными ролевыми шаблонами Owner/Manager/Cashier/Waiter, отзываются отдельно и показаны в форме прав. Manager не обходит существующие ограничения делегирования. Просмотр и любые операции дополнительно ограничены доступом TableService к конкретному посещению (STRICT/SHARED/access_others); доступ Owner не безусловный.

| Метод / путь | Тело / параметры | Результат |
|---|---|---|
| GET `/tables/visits/:id/order` | UUID посещения | Order/null; id/sessionId/status/revision, subtotal/discount/base/fees/total |
| GET `/tables/visits/:id/batches` | after (sequence, default 0), limit (1…100, default 20) | batches[], next; снимки строк, отправитель/время/редакция, сумма новых товаров и job ID/status |
| GET `/tables/visits/:id/kitchen-jobs` | UUID посещения | Только jobs этого Order: id/status/payload |
| GET `/tables/visits/:id/draft-context` | UUID посещения | Проверенный instance/branch/employee/session scope, open/canSubmit, serverTime/validUntil; без токенов/секретов |
| POST `/tables/visits/:id/batches/prepare` | draftId, draftRevision, menuRevision, lines[], discount | Полное серверное предложение, menuChanged, orderRevision и confirmationHash; без записи |
| POST `/tables/visits/:id/batches/submit` | Всё из prepare request + commandId, orderRevision, confirmationHash | Минимальный receipt: commandId/sessionId/orderId/batchId/batchSequence/orderRevision/kitchenJobIds |
| POST `/orders/:id/discount` | commandId, expectedRevision, amount | orderId/revision; суммы перечитываются защищённым GET |

Каждая selection: lineId UUIDv4, itemId, variantId null/ID, modifierIds[], quantity, необязательный comment. Новые поля тела не принимаются. Первичная ненулевая скидка требует дополнительного `order.discount.set`; при дозаказе передаётся текущая сохранённая скидка, её изменение не прячется в Batch.

Prepare рассчитывает по текущей опубликованной редакции и возвращает новые условия даже при старой menuRevision. UI обновляет локальную revision меню, показывает изменение и цены было/стало по сохранённому preview, затем готовит новое предложение и требует подтверждение. Старое предложение никогда не фиксирует цену само по себе.

Hash — SHA-256 канонического server proposal с branch/actor/session/draft/revisions/line snapshots/fee snapshot/итогами. Это проверка неизменности предложения, не credential/подпись или резервирование. В writer повторяется полный серверный расчёт. Изменившийся hash/menu/order revision отклоняет всю новую команду как `CONFIRMATION_STALE` 409. После исправления и нового подтверждения — новый commandId; при неизвестном исходе — исключительно прежний ID/тело.

Существенные коды: CONFIRMATION_STALE, ORDER_REVISION_CONFLICT, DRAFT_ALREADY_ACCEPTED, VISIT_CLOSED, SHIFT_REQUIRED, ORDER_NOT_OPEN, INVALID_COMMENT/INVALID_LINES/DUPLICATE_LINE, прежние ITEM/MODIFIER_UNAVAILABLE, INVALID_VARIANT, MODIFIER_SELECTION_LIMIT, MONEY_LIMIT_EXCEEDED/INVALID_DISCOUNT; auth/scope/journal/storage ошибки сохраняются. При конфликте UI сохраняет черновик и заново получает предложение; ошибка не принимает разрешённый поднабор строк. Ошибка API не содержит запретных подробностей или секретов.

## Приёмка и деньги

Первый непустой Batch создаёт один TABLE Order; последующие добавляются к нему. Уникальны branch+visit и branch+commandId; draftId также нельзя принять повторно под новым ID. Порядок Batch — серверный sequence. При параллельных разных пакетах второй может получить конфликт предложения, но после нового явного подтверждения принимается в тот же Order.

Batch/Item неизменяемы. Item содержит JSON snapshot товара/переводов/размера/модификаторов/цен/quantity/comment/menuRevision/kitchen; модификаторы не читаются из актуального меню ради истории. Fee snapshot (revision настройки + набор, включая пустой) хранится в Order и не изменяется после первого Batch. Физический SQL использует JSON snapshots вместо отдельных концептуальных таблиц modifiers/fee snapshots/print_job_items из DB-SCHEMA, сохраняя их смысл и происхождение.

Subtotal Batch — только его новые товары; общий счёт — сумма исторических строк всех Batch минус одна фиксированная скидка плюс независимые TABLE-сборы по сохранённым ставкам. Сборы пересчитываются от общей обновлённой базы, не складываются из округлённых сумм Batch. BigInt/целые тыйыны и ранее утверждённые пределы сохранены; накопленный Order тоже ограничен максимумом. Discount events фиксируют изменения; Item snapshots не переписываются.

Order/Batch/Items, признак has_accepted_batch и revision посещения, KITCHEN job при необходимости, audit/outbox/command receipt сохраняются атомарно. Replay проверяет актуальные права/доступ, затем возвращает прежний receipt; новая цена/закрытие не превращают состоявшийся commit в повторную операцию. Искусственные сбои записи проверяют откат всех связанных фактов.

Нулевая стоимость не означает EMPTY. После приёмки хотя бы одного Batch закрытие EMPTY запрещено навсегда для этого посещения. Финансовое закрытие/Payment/Settlement и корректировки в 4.2 не реализованы; нет обхода закрытия смены.

## Desktop drafts и потеря связи

Черновики, pending и связь frozen draft revision→commandId хранятся совместно в `protected-session.bin`, зашифрованном safeStorage. Записи синхронно сериализованы в main process; временный файл flush→rename; отказ записи откатывает память, сеть не запускается до успешного сохранения. Single-instance lock исключает второго writer того же профиля. Недоступное/повреждённое хранилище не заменяется пустым. Renderer не имеет token/Node/fs; IPC whitelist не принимает actor/branch/путь файла.

Scope включает instance+branch+employee+tableSession, а профиль устройства определяется собственным userData. Новое посещение того же стола не наследует черновик. Локальные изменения строки фиксируются кнопкой «Сохранить строку», до неё форма явно помечена несохранённой и требует подтверждения выхода. Каждая сохранённая редакция имеет CAS; форма другой редакции не затирает новую. Дополнительный preview цены используется только для сравнения; сервер считает по меню.

Локальная правка не требует сетевого вызова на каждое добавление: native хранит в памяти ранее проверенный draft-context, привязанный к текущему token и monotonic deadline до исходного idle/absolute срока. Контекст не сохраняется между рестартами и не продлевает сессию. При связи проверяется каждые 5 секунд; явный 401/403 очищает кеш. При недоступном сервере допускается лишь локальный непринятый Draft в пределах прежнего срока. Мгновенный remote revoke в отсутствие связи не обещается; любая приёмка/скидка требует новой серверной авторизации. После рестарта для открытия/восстановления экрана нужен доступный локальный сервер; интернет ему не требуется.

При неизвестном исходе frozen-редакция не редактируется/не очищается и не отправляется новой командой. Retry использует прежний pending payload/ID и после рестарта обоих процессов. Успешный результат и очистка соответствующего draft/pending сохраняются одной локальной записью; новый пустой Draft получает новый ID. При отзыве доступа pending остаётся, подробности скрываются; такой отказ не доказывает отсутствие commit. Фоновый опрос не отмечает активность.

Перед закрытием EMPTY проверяется локальный черновик: frozen блокирует действие; для строк требуется отдельное предупреждение. Черновик закрытого посещения не переносится и не отправляется. Чужие локальные drafts не выдаются другому сотруднику.

## Кухонная очередь

Один постоянный KITCHEN/NEW_BATCH/PENDING job на кухонный поднабор Batch; если поднабор пуст — job отсутствует. Payload version 1 содержит стол/зону, время, реального отправителя и только kitchen-строки с модификаторами/комментариями. Batch ID/sequence остаются в связях БД/UI; бумажная разметка не создаётся и номер Batch в печатные строки не включается.

Нет worker, маршрута физического принтера, попыток печати и переходов в SENT/COMPLETED/FAILED_SAFE/UNKNOWN. Нельзя выдать PENDING за успешную печать. Перед физическим модулем отдельно прорабатываются PRINT-001/D06: UNKNOWN без автоповтора, подтверждение драйвера не доказательство выхода бумаги. UI постоянно сообщает «Печать не подключена».

## Миграция и проверка

Новая 005-orders-batches не меняет 1–4. Обычный запуск старую БД не мигрирует. Проверены явные переходы schema 3/4→5 с сохранением identity/checksums и отказ при OPEN без изменения старой базы. MANGO/Windows данные не менялись, Windows ZIP iteration-002 остаётся schema 3. Новый ZIP заказов не выпускался.

`pnpm run check`, `pnpm test`, `test:orders-desktop`, `test:tables-desktop`, `test:desktop` — результаты в PROGRESS.md. Orders QA использует настоящий Electron/macOS, HTTP/proxy и safeStorage с одноразовой fixture-активацией. Скриншоты: `artifacts/orders-qa/preview.png`, `accepted.png`, `orders-ky.png`. Это не реальное облако, Windows, целевой POS 4 ГБ или принтер. Испытания hardware durability/restore остаются отдельными.
