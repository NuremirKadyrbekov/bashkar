> **Сверка 24.10.2026.** Номера source/schema и результаты тестов ниже привязаны к своей поставке. Текущий срез — source 0.11.0-menu-sync / SQLite 12; изменения и ограничения — в DOCS-AUDIT-001. [Актуальное состояние и решения](DOCS-AUDIT-001.md).

# Блок B — фактический локальный контракт

22.10.2026. Source **0.8.0-shift-finance**, SQLite **schema8**, новая **008-shift-finance**. Пользователь подтвердил BLOCK-B-TECH-UI-SPEC-001 и R-B1…R-B7. Это контракт локального выпуска, не разрешение обновить действующий ресторан. Текущая проверка и ограничения — PROGRESS.md.

## Данные и транзакции

`refunds` — immutable полная сумма отдельного Payment, исходный метод, исходная и текущая смены, причина/actor/name/time/command. UNIQUE(branch,payment) защищает от разных commandId/процессов, FK и source trigger проверяют sealed Payment, branch/Order/Settlement/сумму/метод и OPEN текущей смены. Нет UPDATE исходной оплаты, частичного Refund, автоматического банка или повторного открытия заказа. Mixed — два самостоятельных Payment/возврата; отсутствие второго Refund не меняет сумму первого.

`payment_incident_resolutions` и `incident_receipt_matches` — append-only сверка A-инцидентов. Старый payment_incidents.state остаётся OPEN: эффективное состояние читается через LEFT JOIN resolution. Один resolution на incident; сумма известных receipts сама по себе не Payment. `financial_cases` — immutable RECOVERY_REVIEW / EXTERNAL_REFUND_DISPUTE hold; при отсутствии OPEN сохраняется branch-level hold, иначе blockingShiftId назначает сервер. Такой hold не имеет общего resolve endpoint: финансовый D09/R01 не реализован и продолжает блокировать normal close.

`shift_reports` / `shift_closures` — взаимные deferred составные FK, UNIQUE shift, immutable snapshot+SHA256 и actor/time; closure ссылается на CLOSED статус смены через deferred FK. Нельзя завершить транзакцию с отчётом без closure либо closure без CLOSED. CLOSED нельзя менять/удалять. SQL guard запрещает close с активными посещениями/OPEN заказами/неразрешёнными cases; вставки новых финансовых фактов/Batch в CLOSED также запрещены. Legacy CLOSED без нового отчёта не получает выдуманный snapshot.

Commit business/audit/outbox/commands.result атомарен под BEGIN IMMEDIATE. Close сначала проверяет личный постоянный пароль вне writer, затем current grant/status/credentialVersion внутри. Пароль исключён из fingerprint/pending/audit/outbox/result. Replay lookup предшествует OPEN/stale/blocker проверкам новой команды, поэтому старый close не закрывает следующую смену. Current permission/revoke действуют на replay. Собственный минимальный Refund receipt восстанавливается после выхода продажи из24h без суммы/состава; новые Refund/context всё равно требуют доступ к исходному Payment.

## Права

| Право | Default / предел |
|---|---|
| payment.refund | Cashier; Owner/Manager grant; Waiter запрещено |
| payment.refund.history | Owner; Manager grant; Cashier/Waiter запрещено |
| payment.incident.resolve | Owner; Manager grant; Cashier/Waiter запрещено |
| financial.case.view | Owner; Manager grant; Cashier/Waiter запрещено |
| financial.case.record | Owner/Manager/Cashier; Waiter запрещено |
| shift.report.view | Owner/Cashier; Manager grant; Waiter запрещено |
| shift.report.history | Owner; Manager grant; Cashier/Waiter запрещено |

Существующие defaults shift.open/close сохранены: Cashier, Owner/Manager по grant. Новые финансовые ключи исключены из неявного административного Owner-фильтра. PIN не расширяет права и не заменяет повторный пароль close.

Cashier: sales.view_24h + payment.refund, исходный settledAt в серверном окне24h. Historical lookup требует payment.refund.history, а действие — дополнительно payment.refund. Нет расширения старых Table/Order/Sales endpoints. Отчёт — отдельное разрешение агрегатов всей смены; не открывает старые продажи. Без history доступны OPEN и последний CLOSED не старше24h; after для обхода последнего Cashier не принимается. Исторический архив Owner/Manager по отдельному scope.

## API

Относительно `/api/v1`. Native loopback security/no-store/strict JSON/Host/Origin сохраняются. Branch/actor/amount/method нельзя назначить в commit Refund. ID — UUIDv4; суммы входных фактов — целые тыйыны, причина1–300 NFC code points, evidenceNote1–1000, без control chars. Неизвестные поля отклоняются.

| Метод / путь | Контракт |
|---|---|
| GET /payments/:id/refund-context | paymentId/settlementId/orderId/originalShiftId/method/amount/order snapshot/refund/canRefund; current read scope |
| POST /refunds/history-lookup | Ровно один paymentId / settlementId / orderId либо counterNumber+originalShiftId; payments[] доступных contexts |
| POST /payments/:id/refunds/prepare | reason → неизменяемые method/amount/currentShiftId и confirmationHash |
| POST /payments/:id/refunds/commit | commandId,reason,currentShiftId,confirmedExternalReturn=true,confirmationHash → минимальный REFUND_REGISTERED receipt |
| GET /payment-incidents?state=OPEN&after=0&limit=20 | incidents[], next; state также RESOLVED, limit1–100, стабильный rowid cursor; права проверяются до списка, детали по объекту |
| GET /payment-incidents/:id | Исходные refs/receipts/reason, effective state, resolution и подтверждающий |
| POST /payment-incidents/:id/resolutions/prepare | outcome,settlementId/null,reason,evidenceNote,externalReturns[] → проверенный proposal/currentShiftId/hash |
| POST /payment-incidents/:id/resolutions/commit | Те же поля +commandId,currentShiftId,confirmationHash → RESOLVED receipt |
| POST /financial-cases | commandId,kind,originalShiftId/null,orderId/null,paymentId/null,sourceCommandId/null,reason,knownAmount/null → OPEN hold; blocking shift назначает сервер |
| GET /financial-cases?after=0&limit=20 | cases[],next; только financial.case.view |
| GET /shifts/:id/close-context | status/revision, все blockers counts, доступные visit/counter refs; preview только при report.view |
| POST /shifts/:id/close/prepare | expectedShiftRevision → context + confirmationHash финансовых фактов |
| POST /shifts/close | commandId,shiftId,expectedShiftRevision,confirmationHash,login,password → CLOSED/shiftId/reportId/reportHash/closedAt |
| GET /shifts/:id/report | OPEN: final=false+preview; CLOSED: final=true+сохранённый report/hash; legacy404 |
| GET /shift-reports?after=0&limit=20 | reports[],next; архив по убыванию rowid, следующий after означает строго меньше; Cashier только latest, after=0 |
| GET /sales/:id | Контракт A плюс реальные payment.id, refundId/reason/refundedBy/refundedAt/refundShiftId и производный refundState NONE/SOME_PAYMENTS/ALL_PAYMENTS |

`MATCHED_SETTLEMENT`: linked sealed Settlement того же Order, проверка source command/draft ancestry и наличия действительных невозвращённых Payment нужных методов с суммой не меньше известных поступлений; evidence описывает получение остатка. externalReturns=[] обязательны. Receipt match резервирует sourceKey=hash(orderId,method): один метод одного заказа нельзя зачесть повторно через другой incident. Это намеренно консервативно: независимое повторное поступление требует спорного case, а не списания совпадением суммы. Неизвестные/повторяющиеся методы в исходном incident не разрешаются автоматически.

`EXTERNAL_RETURN`: settlementId=null; нет зарегистрированного Settlement соответствующего заказа; source command проверяется, принятый нефинансовый Batch сам по себе не Payment. externalReturns[{method,amount,returnedAt}] точно покрывает все известные receipts; time не в будущем. Документируется возврат незачтённых денег; не создаются Refund/Payment, заказ остаётся в текущем действительном состоянии. Пустые/неизвестные receipts не разрешаются подстановкой нуля. Никакой автоматической банковской проверки.

Блокеры: все OPEN TABLE visits, OPEN подтверждённые COUNTER (включая total0), все effective OPEN payment_incidents и финансовые holds филиала. Проверка полного набора не ограничена видимостью/пагинацией. Printing/delivery/интернет/VISIBLE завершённая карточка не blockers. Локальный pending не глобальный серверный реестр: неизвестные внешние факты нужно сообщать как case. Close hash охватывает финансовые/операционные первичные факты и разрешения случаев; hide/print/delivery не меняют подтверждение. Новые факты требуют повторного prepare/подтверждения, не молчаливого изменения цифр.

## Отчёт D08 v1

Machine-readable словарь: `apps/local-server/src/modules/shifts/report-metrics.ts`; утверждённые формулы/пример — ТЗ B §6. Срезы ALL/TABLE/COUNTER. Monetary aggregates — **строки целых тыйынов**, включая отрицательные; counts — безопасные integer. Отбор по принадлежности факта смене, не по календарным суткам. Refund относится к текущей смене регистрации с originalShift reference; первичный закрытый отчёт не пересчитывается.

completed_count=PAID+ZERO, mixed один заказ. finalized_subtotal/discount/fees — конечные immutable snapshots PAID/ZERO, сумма completed_amount=subtotal−discount+fees=зарегистрированные Payment. Возвраты не уменьшают историческую сумму завершённых заказов. payments/refunds/difference отдельно по3 методам; refunds_current/previous. accepted_items_amount — все исходные Item totals, removed_items_amount — отменённое количество по исторической цене, без CHANGE_COMMENT; replacements показаны как subset, не двойное списание. При close accepted−removed=finalized_subtotal. В preview незавершённые заказы показаны отдельно.

Сборы суммируются из сохранённых округлений каждого заказа, не процент с общего итога. Нет physical cash balance/недостачи/«чистой выручки». Отчёт содержит original fact IDs, visits, отдельные сведения о сверенных денежных случаях, версии/actor/time/timeZone/hash. `restaurantName/branchName=null`: текущая активация хранит ID, а подтверждённые display names ресторана/филиала в локальной схеме отсутствуют; UI показывает branchId, названия не выдумываются. Opening actor name восстанавливается из оригинального shift.open receipt, а не из переименованной карточки сотрудника; legacy fallback отмечен отсутствием нового отчёта. Hash не электронная подпись.

## Desktop и границы

Новый shift-finance.js: RU/KY, отдельные body/footer, Refund с явным внешним выполнением, исторический lookup, две процедуры сверки, известные recovery holds, preview/close/локальный final report. Token остаётся в main; whitelist новых actions, encrypted pending до HTTP, frozen commandId/body, пароль только на попытку. На shiftClose блокируются конфликтующие исходные pending; incident/case можно сообщить без подмены неизвестного финансового результата. После рестарта retry close снова запрашивает личный пароль.

Reversal не реализован и обозначен недоступным. Нет финансового MANUAL_RECOVERY, bypass hold, reopen/переноса обязательств, банковского API, PDF/export/physical printing/report delivery. Синтетическая миграция/QA не разрешает production переход: startup не обновляет старую БД, migrate по-прежнему запрещён при OPEN. Исходники001–007 сохранены. Работающая старая OPEN-установка требует отдельного перехода D11/D13; SQL/удаление БД не использовались.

Ограничение внешнего действия: UNIQUE гарантирует единственную локальную регистрацию Refund, но не предотвращает две физические выдачи до SQLite commit на разных терминалах. Unknown result требует исходного receipt; банк/наличные повторно не выдаются. Если close победил до регистрации уже выполненного внешнего возврата, автоматического переноса в новую смену нет: отдельный EXTERNAL_REFUND_DISPUTE hold и согласованная дальнейшая процедура.
