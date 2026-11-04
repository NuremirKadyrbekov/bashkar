> **Сверка 24.10.2026.** Исторический план/срез: фразы «сейчас», «ещё нет» и номера source/schema ниже относятся к дате исходной поставки. Дальнейшая реализация — в DOCS-AUDIT-001. [Актуальное состояние и решения](DOCS-AUDIT-001.md).

# API v1 — текущая локальная итерация

Только native Desktop main → 127.0.0.1. Не контракт LAN/Waiter/Cloud. Реальная активация подключена в main; до её commit бизнес-маршруты отвечают 503 ACTIVATION_REQUIRED. Новый облачный контракт: CLOUD-ACTIVATION-001.md. Windows-приёмка отдельно.

## Общие правила

JSON POST, unknown/missing fields и неверные типы отклоняются. Bearer-секрет выдаётся входом и остаётся только в native main. В любой защищённой операции сервер получает employee/branch/permissions из БД, не из клиентского branch/role. Host только localhost/127.0.0.1; Origin/Sec-Fetch-Site запрещены. Тела/headers/URL не логируются и не отражаются в error/404.

Для бизнес-мутаций `commandId` — UUID v4 до отправки. DTO полей команды входит в canonical fingerprint API/type/actor/payload. Один ID+другое содержимое/автор → COMMAND_ID_CONFLICT. Повтор требует актуального доступа, возвращает исходный commit result. Ошибка commit не является успехом. Queue/busy/неизвестный ответ — сохранить ID; после logout/relogin тем же сотрудником native pending list позволяет исходный повтор. Пароли повторной проверки в journal не сохраняются. Временные секреты повторно не выдаются.

Суммы — integer тыйыны, ставка — integer сотые процента. Публичные machine codes передаются как `{error:{code}}`; клиент локализует сообщение. 400 validation, 401 session/credentials, 403 access/transport, 404 not found, 409 state/revision/command conflict, 413 body limit, 415 JSON required, 429 throttle/hash capacity, 503 queue/storage/activation/dependencies. Непредвиденная ошибка — INTERNAL_ERROR без stack/SQL/секретов.

## Маршруты

| Метод и `/api/v1` путь | Поля JSON / назначение |
|---|---|
| GET `/system/health/live` | process liveness, не операционная готовность |
| GET `/system/health/ready` | 200 READY только с проверенной binding; иначе диагностический 503 с state/code |
| GET `/system/version` | server/API/schema |
| GET `/activation/status` | configured/activated, без секретов |
| POST `/activation/start` | email/password облачного Owner → flowId/филиалы; токен только в памяти сервера |
| POST `/activation/complete` | flowId/branchId/login/name/password локального Owner → branchId/alreadyActivated после commit; pending request сохранён в schema 3 |
| POST `/auth/login` | login,password → token,employeeId,mustChangePassword (не журналировать ответ) |
| GET `/auth/me` | id,branchId,name,role,permissions,mustChangePassword; фоновое чтение не activity |
| POST `/auth/activity` | `{}`; только реальное пользовательское взаимодействие |
| POST `/auth/logout` | `{}`; отзыв текущей сессии, Shift остаётся |
| POST `/auth/password` | commandId,oldPassword,newPassword → loginRequired; все прежние сессии отзываются |
| GET `/employees[?archive=true]` | employee.edit / archive.view; безопасные карточки, при permission.manage — actual keys/delegation |
| POST `/employees` | commandId,login,name,role (MANAGER/CASHIER/WAITER) → safe employee; temporaryPassword только впервые |
| POST `/employees/update` | commandId,employeeId,revision; name/role/status хотя бы необходимый набор для изменения |
| POST `/employees/reset-password` | commandId,employeeId,revision → temporaryPassword только впервые; статус/права не меняются |
| POST `/employees/permission` | commandId,employeeId,revision,permission,allowed; потолок роли/Owner/Manager |
| POST `/employees/delegation` | commandId,employeeId,revision,permissions[]; только Owner для Manager |
| GET `/shifts/current` | текущая OPEN или null |
| POST `/shifts/open` | commandId,login,password; повторная проверка именно текущего исполнителя, shift.open |
| POST `/shifts/close` | Реализован позднее: commandId,shiftId,expectedShiftRevision,confirmationHash,login,password; prepare/context/blockers — API-SHIFT-FINANCE-008 |
| GET `/menu` | revision,catalog,availability; read не продлевает session |
| GET `/menu/drafts` | последние 100 drafts филиала, menu.edit |
| GET `/menu/drafts/:id` | id,baseRevision,revision,catalog |
| POST `/menu/drafts` | commandId,draftId (null для нового),draftRevision (0 для нового),baseRevision,catalog |
| POST `/menu/publish` | commandId,draftId,draftRevision; CAS, вся редакция+audit/outbox/result |
| POST `/menu/availability` | commandId,entityId,available,revision (0 если override ещё нет) |
| GET `/menu/fees` | revision,fees; settings.service_charge.manage |
| POST `/menu/fees` | commandId,revision,fees[] → новая revision; полная настройка |
| POST `/menu/quote` | menuRevision,type TABLE/COUNTER,lines[],discount → QUOTE_ONLY + snapshots/totals |

## Каталог и цены

Каталог: mainLanguage, languages[], categories[], items[]. Category: id/name/translations?/archived. Item: id/categoryId/name/translations?/archived/available/kitchen/price/variants[]/groups[], optional description/containerId/isPackaging, kind/components, pricingMode/combinationPrices; расширения MENU-VARIANT-MATRIX-TECH-001 и MENU-SETS-001. Один уровень категорий; current item связан с действующей category. Варианты: id/name/translations?/price/available. В прежнем additive-режиме у item либо ненулевая заданность `price` (включая число 0) без variants, либо `price:null` и непустые variants с конечной ценой. Group: id/name/translations?/min/max/options[]. Option такая же структура цены/имени/availability, стоимость принадлежит конфигурации конкретного товара. ID не меняет вид/владельца через редакции; item/category не исчезают без архива.

Fee: id,name,rate; rate 0…10000, общая ≤10000. Пустой список — сборы отключены. Публикация базового availability существующего item/modifier дополнительно требует stoplist permission; отдельный operational override не сбрасывается публикацией.

Quote line: itemId,variantId (null без размеров),modifierIds[],quantity,comment?. Не принимает клиентскую цену. Revision должна быть текущей; дубли/чужие/недоступные опции, min/max и неверный размер отклоняются. Quantity 1…9999. Price/line/subtotal/total ≤999999999. После fixed discount, TABLE fee = ROUND_HALF_UP(base × rate / 10000), каждый отдельно; COUNTER fees пусты. Сам quote не сохраняет принятый заказ. Принятие Batch отдельно сохраняет снимки по API-ORDERS-005/API-FINANCE-007.
