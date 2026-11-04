> **Сверка 24.10.2026.** Номера source/schema и результаты тестов ниже привязаны к своей поставке. Текущий срез — source 0.11.0-menu-sync / SQLite 12; изменения и ограничения — в DOCS-AUDIT-001. [Актуальное состояние и решения](DOCS-AUDIT-001.md).

**Дополнение 25.10.2026:** [API-CHECKOUT-015](API-CHECKOUT-015.md) реализует перенос/смену ответственного с историей и атомарную оплату с новым пакетом. Прежние ограничения неизменяемого назначения и запрет оплаты с дозаказом ниже описывают предыдущий этап; FAST_FIRST теперь использует новый контракт. TABLE_FIRST/TABLE_QUICK сохраняют свои сценарии.

# Блок A — фактический локальный контракт

22.10.2026. Source **0.7.0-finance**, SQLite **schema 7**, новая migration **007-finance**. Основание: пользователь подтвердил BLOCK-A-TECH-UI-SPEC-001 и R-A1…R-A6. Это локальная реализация A; не приёмка B–D и не разрешение обновить действующий ресторан.

## Права и область

Новые ключи заданы явно, без наследования административного Owner-фильтра:

| Право | Default |
|---|---|
| order.settle.table | Owner, Manager, Cashier; Waiter только grant |
| counter.view / counter.batch.submit / order.settle.counter / counter.hide | Cashier; Owner/Manager только grant; Waiter запрещено |
| order.correct | Никому; допустимый grant по роли/объекту |
| order.cancel | Никому; grant Owner/Manager/Cashier; Waiter запрещено |
| sales.view_24h | Owner/Cashier; Manager только grant; Waiter запрещено |
| payment.incident.record | Owner/Manager/Cashier; Waiter только grant вместе с правом TABLE-расчёта и объектным доступом |

Существующие table.view_details / table.access_others / table.batch.submit / order.discount.set и ограничения делегирования сохраняются. Оплата TABLE не открывает чужие столы в STRICT. COUNTER имеет филиальный scope и не наследует STRICT/SHARED. PIN/пароль не меняют полномочия; native API по-прежнему отвергает WAITER_WEB.

## Состояния и финализация

В БД заказ OPEN → COMPLETED либо CANCELLED. DTO COUNTER отображает OPEN как operationalState=ACTIVE. Отдельный financialState: UNPAID / PAID / ZERO_SETTLED / CANCELLED. Терминальные заказы не принимают обычные Batch/скидки/корректировки.

Положительный расчёт: один Settlement и 1–2 Payment, затем seal заказа. Payment строго положителен; методы различны, сумма точно равна актуальному серверному итогу. ZERO_SETTLED: Settlement на ноль с действующими порциями, ни одного Payment. Полная отмена: никаких Settlement/Payment/CUSTOMER.

TABLE в том же commit закрывает посещение с причиной PAID / ZERO_TOTAL / CANCELLED; свободность стола выводится из отсутствия OPEN. has_accepted_batch монотонен, has_registered_payment ставится только для положительной оплаты. EMPTY по-прежнему запрещён после принятого Batch, включая нулевой.

Исторические цены и набор TABLE-сборов первого Batch сохраняются. Действующий subtotal рассчитывается по оставшимся порциям исходных Item; новые Batch/замены используют новое меню. После отмены избыточная фиксированная скидка ограничивается новым subtotal с отдельным событием/audit. Сборы независимо ROUND_HALF_UP от базы после скидки; COUNTER без сборов. Пределы денег/количеств прежние. Наличные не требуют поля «получено» и автоматического расчёта сдачи; банк/QR проверяет сотрудник.

## API

Все пути относительно `/api/v1`. Native loopback/Host/Origin/JSON/no-store/2MiB и защищённые bearer-сессии сохранены. Неизвестные поля отклоняются. branch/actor/role/готовые цены и статусы от клиента не принимаются.

Payment selection:

```json
{"kind":"SINGLE","method":"CASH"}
{"kind":"MIXED","firstMethod":"CASH","firstAmount":5000,"secondMethod":"QR_TRANSFER_MANUAL"}
{"kind":"ZERO"}
```

Допустимы CASH, CARD_MANUAL, QR_TRANSFER_MANUAL. В MIXED второй остаток определяет сервер; 0 < firstAmount < total. Три метода и два одинаковых запрещены. При total=0 нужен явный ZERO.

Prepare ничего не фиксирует; возвращает авторитетные суммы/снимки, expectedOrderRevision, expectedVisitRevision (null для COUNTER), shiftId, confirmationHash. Хеш включает существенные условия и actor/branch, не текущее меняющееся время запроса; он не credential и не резерв цены. Commit повторяет расчёт внутри writer. Новые условия требуют prepare и явного подтверждения, а не подстановки новой суммы в старую команду.

| Метод / путь | Запрос и результат |
|---|---|
| GET /orders/:id | Действующий состав/исторические цены/порции, totals/revision/status/financialState/shift, table или COUNTER header и допустимые действия |
| GET /orders/:id/events?after=0&limit=20 | Исходные Batch/Correction/discount events; after — offset, max limit100; порядок committed command rowid, затем порядок фактов внутри команды |
| POST /orders/:id/settlements/prepare | payment → предложение полного расчёта |
| POST /orders/:id/settlements/commit | commandId, payment, expectedOrderRevision, expectedVisitRevision, shiftId, confirmationHash → минимальный receipt |
| POST /orders/:id/corrections/prepare | action, targets[], reason/comment/replacement по виду → before/after и hash |
| POST /orders/:id/corrections/commit | Те же поля + commandId и четыре поля подтверждения |
| POST /orders/:id/cancel/prepare, /commit | Alias полной отмены: reason; для commit также commandId/подтверждение |
| POST /orders/:id/discount | Прежний CAS DTO; теперь также COUNTER, terminal запрещён |
| POST /counter/draft-context | draftId локальной области → проверенный instance/branch/employee/shift/validUntil, без создания Order |
| GET /counter/orders?after=0&limit=20 | Активные COUNTER филиала, включая старше24h; after — курсор rowid |
| POST /counter/orders/prepare, /commit | draftId/draftRevision/menuRevision/lines/discount/guestLabel/mode; mode ACCEPT либо CHECKOUT; CHECKOUT требует payment; commit также commandId/подтверждение |
| POST /counter/orders/:id/batches/prepare, /submit | Те же поля, только ACCEPT, действующий Order; нет нового номера |
| GET /counter/worklist?after=0&limit=20&all=false | VISIBLE завершённые; текущая смена или все; после24h операционная маска |
| POST /counter/orders/:id/hide | commandId, expectedVisibilityRevision → HIDDEN; только COMPLETED, OPEN-смена не требуется |
| GET /sales?type=&method=&query=&afterTime=&afterId=&limit=20 | PAID/ZERO текущего окна; stable cursor time+SettlementID, SQL фильтры по branch/time до выдачи подробностей |
| GET /sales/:orderId | Immutable Settlement snapshot + история событий заказа; то же окно |
| POST /payment-incidents | commandId, orderId либо draftId (второе null), sourceCommandId либо null, receipts[{method,amount}], reason → OPEN case |
| GET /payment-incidents?state=OPEN | До100 доступных случаев, минимальные id/order/time; без выдачи банковских секретов |

Receipt содержит ID, revision/result и ссылки на jobs/Settlement/Payment, а не суммы/состав/методы/guest label. Fingerprint сохраняет исходный semantic body; другой payload или actor того же commandId конфликтует. Успех только после commit. При неоднозначном результате native сохраняет прежний ID/body, не позволяет заменить его новым действием по тому же объекту и восстанавливает исходный результат после перезапуска.

Для собственной уже принятой команды терминального заказа действует R-A2: текущая сессия/роль/audience/право операции и свой branch, минимальный собственный receipt доступен без повторного требования OPEN/прежнего SHARED. Для открытого заказа текущий объектный доступ по-прежнему проверяется; изменение STRICT/SHARED не даёт читать чужой заказ через replay. Отзыв полномочий не обходится. Актуальные подробности — отдельный GET с read-policy.

## Корректировки и происхождение

CANCEL_QUANTITY/GROUP_CANCEL/REPLACE_ITEM/CHANGE_COMMENT/CANCEL_ORDER. Targets: itemId принятой строки, portionId, quantity. Нельзя повторять/перекрывать одну portion в группе или отменять больше действующего. Причина отмены/замены — простой непустой текст до300 Unicode code points, без управляющих символов. Комментарий до300, прежний текст не переписывается.

При CHANGE_COMMENT части количества исходная portion уменьшается и создаётся новая; correction_lines хранит source portion и new_portion_id, поэтому происхождение однозначно. Увеличение принятого количества — новый Batch. Платный modifier меняется заменой. Замена создаёт отмену и новый Batch атомарно; ссылка replacement_batch_id сохраняется. Нулевой промежуточный остаток старых блюд в успешной замене не требует права полной отмены, если итог содержит новые действующие позиции. Итоговая последняя порция требует order.cancel, включая последовательные и групповые отмены.

## COUNTER и упаковка

Только «На вынос», без Table Session и TABLE-сборов. Первый Batch выдаёт последовательный номер branch+shift в той же транзакции; rollback не потребляет номер, replay не выдаёт новый. Быстрый CHECKOUT одним commit создаёт Order/Batch/Items/portions/KITCHEN/Settlement/Payments/CUSTOMER/worklist/audit/outbox/result. ACCEPT создаёт ACTIVE/UNPAID, поздний checkout не повторяет KITCHEN. Guest label до100 code points, необязателен.

Каталог уже имел containerId; добавлен редактор связи и явное предложение в COUNTER. Отказ не блокирует блюдо. Контейнер имеет собственную строку/цену/количество/проверки; варианты и обязательные modifiers выбираются обычным selector. В native Draft отдельно сохраняется связь предложения с исходной строкой, чтобы при изменении количества предлагать изменить именно связанный контейнер. Нет рекурсивного предложения или автоматической наценки. После приёмки это отдельные позиции с общими правилами корректировки.

VISIBLE/HIDDEN — независимая ревизия и immutable события. × общий для филиала, не факт физической выдачи/не возврат/не удаление продажи. После24h карточка не скрывается автоматически, но возвращает только номер/shift header/visibility, без суммы/состава/пометки. CANCELLED не создаёт карточку выдачи. Unhide отсутствует в A.

## История и минимальные инциденты

financialFactTime = immutable settledAt; окно включительно `[serverNow−86400000, serverNow]`. Принятие Batch не является продажей; CANCELLED не входит в список продаж. Новая печать/скрытие/будущий Refund не обновляют время исходного факта. Активные неоплаченные заказы не пропадают из операционной работы после24h.

Общая terminal-policy также защищает старые TABLE order/batches/kitchen-jobs/visit details, общий Order GET/events и COUNTER worklist. Прямой старый/чужой ID не выдаёт подробности. Sales scope всех продаж филиала не открывает операции чужого активного TABLE. Просмотр не даёт Refund/Reversal/reprint/export. Итоговые KPI/закрытый report D08 не реализованы.

Если деньги вне POS получены, а полный расчёт не подтверждён, сначала проверяется исходная команда. Неполное/спорное поступление можно сохранить как отдельный OPEN incident без частичного Payment/PARTIALLY_PAID/фиктивного Refund. Native хранит неизвестную отправку защищённо; incident разрешается записать, даже пока исходная платёжная команда остаётся pending. В A нет произвольного resolve; документированное урегулирование и закрытие смены остаются B. Никаких банковских секретов в поле пояснения/логах.

## Печать и схема

Immutable KITCHEN/CUSTOMER snapshots и зависимости сохраняются в бизнес-транзакции. Kitchen использует исходный kitchen flag отменяемой позиции и актуальный flag replacement отдельно. Цепочка original→correction→replacement сохраняется, включая ожидающий original. Batch number не добавляется в печатные строки; COUNTER header «НА ВЫНОС»/номер. CUSTOMER хранит окончательный состав/итоги/разбиение либо ZERO без ложного CASH=0. Legacy payload v1 сохранён побайтно; новые v2. Worker/attempt/physical templates/перепечатка остаются C; UI сообщает «Печать не подключена».

Migration007 реконструирует весь зависимый граф с FK ON через временные копии, без rename исторического родителя и без изменения001–006. Сохранены ID, payload, snapshots, command results, audit/outbox/PIN bindings. Новые portions получают происхождение из старых Items. Добавлены immutable финансовые факты/seals, FK/уникальности/проверки terminal/print/correction scope, ограничение quantities и visibility. Исторические данные и новый эталон физической схемы проверены на fixtures.

Startup старую БД не мигрирует; migrate-db остаётся явным и запрещён при OPEN. **Production backup/preflight, восстановление и переход действующей старой OPEN-установки не приняты и не выполнены.** Финансовый Windows ZIP не выпускался. Не применять source к MANGO/Windows ради обхода отсутствующего close. Ручной runbook/поставка требуют отдельного решения D11/D13.

## Проверки

Финальные числа/среда и ограничения — PROGRESS.md. Добавлены finance.test.ts, finance-contender.ts и настоящий finance-qa.cjs. Проверяются атомарные failures, double settlement/отдельные процессы, replay/restart, mixed/zero, порции/замены/причины, historical graph migration и24h обходы. Скриншоты artifacts/finance-qa: table-mixed.png, counter-paid.png, counter-ky-1024.png. Это fixtures/macOS без настоящего банка/облака/Windows/принтеров. D05/D08/D09/D11/D01 и аппаратные части не объявлены закрытыми.
