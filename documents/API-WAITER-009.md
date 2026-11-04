> **Сверка 24.10.2026.** Номера source/schema и результаты тестов ниже привязаны к своей поставке. Текущий срез — source 0.11.0-menu-sync / SQLite 12; изменения и ограничения — в DOCS-AUDIT-001. [Актуальное состояние и решения](DOCS-AUDIT-001.md).

# Waiter Web — API-WAITER-009

> **Позднее решение 27.10.2026:** для локального MVP пользователь выбрал явный HTTP-режим без сертификатов. Его включение, ограничения и проверки описаны в [WAITER-HTTP-MVP-018](WAITER-HTTP-MVP-018.md). Ниже — исходный HTTPS-контракт, который сохраняется при выключенном HTTP-режиме.

Версия source **0.9.0-service-clients**, SQLite **10**, миграция009. R-C1…R-C8 из BLOCK-C-TECH-UI-SPEC-001 подтверждены пользователем 23.10.2026. Контракт описывает реализованный локальный код; аппаратная приёмка отдельно в BLOCK-C-ACCEPTANCE-001.

## Транспорт и секреты

Native API остаётся HTTP loopback3210 с прежними bearer/audience/Origin ограничениями. Второй Fastify HTTPS listener использует тот же CommandBus/SQLite/domain services и только явно настроенный private IPv4:port. Он публикует `/waiter/` и `/waiter/api/v1/*`; native/admin/refund/Counter API туда не подключены. TrustProxy выключен. Host должен совпадать с IP:портом сертификата. Foreign Origin/Sec-Fetch-Site и Authorization bearer отклоняются. Unsafe-запросы требуют точного Origin, JSON и `X-Bashkar-Client: waiter`.

PIN — существующий **4-значный** AUTH-002, включая ведущие нули. Только ACTIVE Waiter входит в WAITER_WEB. Cashier PIN не открывает этот клиент, Waiter PIN не открывает native POS. Общий limiter кода и отдельный limiter источника/audience остаются на сервере. Ошибки не раскрывают сотрудника по неверному PIN.

Cookie `__Host-bashkar-waiter`: Secure; HttpOnly; SameSite=Strict; Path=/, без Domain. Bearer token не возвращается в JSON. Login выдаёт только actor/bootstrap, permissions, CSRF, memory-only unlock ticket и draft DEK. В БД — хеши CSRF/unlock, credentialVersion и scoped device ID. Каждое чтение данных требует unlock ticket; изменение также `X-CSRF-Token`. PIN reset/смена роли/приостановка/credentialVersion/отзыв права проверяются текущими domain services. Idle6h, absolute12h (уточнение пользователя 29.10.2026). GET/poll idle не продлевают; отдельная activity вызывается пользовательскими событиями.

Reload всегда открывает PIN. Выход немедленно очищает память/экран даже без сети; server logout отправляется best-effort, оставшаяся cookie без memory unlock не открывает данные. После 120s в фоне экран удаляет DOM/диалоги, ключ и memory capability; при возврате проверяет реальное elapsed time даже при throttled timers. Вкладки передают только сигнал блокировки через localStorage event. Для нового PIN разрешена смена сотрудника; серверный `/session/unlock` дополнительно требует прежнего actor/device. Смена сотрудника не расшифровывает чужие черновики.

## Черновики и команды

IndexedDB содержит одну ciphertext-запись actor/device scope, только `id` (SHA256 scope), `revision`, `iv`, `cipher`. AES256-GCM, случайный IV, AAD включает instance/branch/employee/device/keyVersion/revision. DEK сервер хранит wrapped под отдельным OS-protected namespace `web`; не заменяет потерянный ключ автоматически. PIN/cookie/DEK не сохраняются в IndexedDB/localStorage/service-worker cache. LocalStorage содержит лишь device UUID, язык и сигнал блокировки.

Обновления сериализуются внутри вкладки и используют IndexedDB CAS между вкладками. Два читателя одной revision не перезаписывают друг друга. Lock закрывает DB/убирает CryptoKey. Серверный context задаёт TTL и доступ; в его пределах уже открытый экран допускает локальное редактирование без сети. После reload или истечения context нужен доступный сервер и PIN; ciphertext остаётся на устройстве.

Перед бизнес-запросом encrypted pending сохраняет неизменный commandId/operation/target/payload/draftScope. До сохранения HTTP не отправляется. Неизвестный результат замораживает черновик. Reconnect ничего не отправляет. Проверка own receipt вызывает исходный domain handler с исходным envelope, проверяет actor/current permission/fingerprint и возвращает минимальный receipt. При NOT_RECORDED доступен только явный повтор той же команды. Явный серверный отказ4xx сохраняется как rejected; пользователь может отдельно снять блокировку и исправить черновик. При потерянном ответе4xx он остаётся UNKNOWN до проверки/повтора. Принятая Batch/Replacement очищает только связанный черновик после сохранения receipt.

SW кеширует исключительно пять shell assets; ни один API/cookie/черновик/меню не кешируется им. Работа без LAN после перезагрузки ограничена заблокированной оболочкой.

## Web endpoints `/waiter/api/v1`

| Метод/путь | Назначение |
|---|---|
| GET bootstrap | instance/branch/version/draft schema, без операционных данных |
| POST session/pin, session/unlock | `{pin,deviceId}`, установка cookie и memory capabilities |
| GET session/me | Current actor/permissions, требует unlock |
| POST session/logout, session/activity | Пустое тело; current cookie/CSRF/unlock |
| GET menu, tables | Опубликованное меню/availability и разрешённые статусы столов |
| POST tables/open | commandId,tableId,responsibleWaiterId; ответ содержит **sessionId** |
| POST tables/close-empty | commandId,sessionId,revision |
| GET visits/:id/details, order, draft-context | Разрешённый визит, принятый заказ и контекст локального черновика |
| GET visits/:id/batches?after=&limit= | Пагинация принятой истории, effective print status |
| POST visits/:id/batches/prepare | draftId,draftRevision,menuRevision,lines,discount |
| POST visits/:id/batches/submit | То же + commandId,orderRevision,confirmationHash |
| GET orders/:id | TABLE Finance DTO/active portions/current allowedActions |
| GET orders/:id/print-status | Только статусы своих доступных TABLE jobs, без управления принтерами |
| POST orders/:id/discount | commandId,expectedRevision,amount (тыйыны) |
| POST orders/:id/corrections/prepare, commit | A-contract; commit с commandId/revisions/shift/hash; CANCEL_ORDER запрещён |
| POST orders/:id/settlements/prepare, commit | A-contract SINGLE/MIXED/ZERO, current grant `order.settle.table` |
| POST payment-incidents | commandId, TABLE orderId, draftId:null,sourceCommandId,receipts,reason |
| POST commands/receipt | `{operation,targetId,envelope}` → NOT_RECORDED или COMMITTED+receipt; только whitelist операций и свой actor |

Все суммы — целые тыйыны. TABLE access STRICT/SHARED/own/current grants и24h сохраняются; web adapter их не расширяет. Waiter не получает Counter, Refund, Cancel Order, shift close/report, employee/menu admin, print configuration/actions. Коррекция, расчёт и incident доступны только при выдаче отдельных прав. UI RU/KY: столы, варианты/модификаторы/количество/комментарии, локальная партия, подтверждённый preview, история, текущие portions, частичная отмена/смена комментария/замена, скидка, SINGLE/MIXED/ZERO, incident, pending recovery, status print.

## Native настройка сети

`GET /api/v1/waiter/network-status`: current config/revision/readiness, URL/QR, public root/leaf fingerprints и expiry. Только `network.waiter.manage`.

`POST /waiter/network/prepare`: IP,port,leafCertificate,rootCertificate,privateKey,expectedRevision,acknowledgeOriginChange. Проверяет privateIPv4/port, rootCA/self signature, leaf signature/IP-SAN/serverAuth/key match/validity. На выходе public proposal + stagingId/hash, TTL5min. Private key сразу wrapped отдельным OS-protected namespace `tls` и не входит в результат.

`POST /waiter/network/commit`: commandId,stagingId,expectedRevision,confirmationHash. Журнал содержит только эти поля; encrypted key хранится в append-only waiter_network_revisions вместе с public certificates. После commit listener перезапускается. Ошибка bind/key/cert отражается в network-status и не останавливает native учёт. Replay commit не требует уцелевшего staging и не создаёт новую revision.

В Desktop JSON bundle выбирает main process через системный file picker. Renderer получает только public proposal; encrypted pending хранит только commit reference/hash. Экспортируется только публичный root certificate. Provisioning CLI не запускается автоматически. Смена IP/origin требует явного acknowledgement и предварительного завершения/переноса старых device drafts, доступных только на старом origin.
