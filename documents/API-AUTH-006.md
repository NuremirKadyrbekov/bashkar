> **Сверка 28.10.2026.** Контракт исходной поставки schema 6; HTTPS Waiter добавлен API-WAITER-009, новый онлайн-Owner — AUTH-003. Публичное создание CASHIER/WAITER теперь атомарно создаёт личный PIN вместе с сотрудником; поздний контракт — [WAITER-MVP-TZ-020](WAITER-MVP-TZ-020.md) §2. Отдельная выдача PIN остаётся для старых записей без кода, reset — для замены. Прежний локальный Owner остаётся переходным. [Актуальное состояние и решения](DOCS-AUDIT-001.md).

# AUTH-002 A — фактический локальный API

22.10.2026. Source 0.6.0-pin, SQLite 6, migration 006-pin. Ограничения native loopback/Host/Origin/JSON/no-store, protected Desktop storage и прежний CommandBus сохраняются. Это не Waiter HTTPS и не remote Owner API.

| Метод / `/api/v1` | Тело | Ответ |
|---|---|---|
| POST `/auth/pin` | pin: строка из 4 ASCII цифр | token, employeeId, mustChangePassword=false; только CASHIER |
| POST `/auth/login` | login,password | Прежний ответ; CASHIER/MANAGER → CASHIER_POS, OWNER → переходный LOCAL_ADMIN; WAITER отклоняется |
| GET `/auth/me` | bearer | Прежние поля + audience; mustChangePassword относится к методу текущей сессии |
| POST `/employees/pin/issue` | commandId,employeeId,revision | employeeId,revision; temporaryPin только первым ответом вне CommandBus; replay secretAlreadyIssued |
| POST `/employees/pin/reset` | commandId,employeeId,revision | Аналогично; требуется существующий PIN, новый код, отзыв всех сессий цели |
| GET `/employees/pin` | bearer | Только доступные ACTIVE цели с PIN: id/name/role/branchId; никаких кодов/хешей |
| POST `/employees/pin/reveal` | employeeId | pin,employeeId,name,branchId,expiresInSeconds=20; отдельный no-store ответ после обязательного аудита |

`employee.pin.issue` / `.reset` — отдельные права, default Owner, Manager только явным grant; цель ACTIVE CASHIER/WAITER своего филиала, не Manager/Owner. Просмотр не следует из права выдачи. `employee.pin.view` default Cashier, допускает revoke; роль и target scope нельзя расширить grant: собственный код и ACTIVE WAITER того же филиала. Manager/локальный Owner не получают произвольного repeat reveal. Переходный Owner видит одноразовый результат выдачи/reset. Cloud Owner reveal ещё отсутствует, кабинет честно недоступен.

Список `/employees` добавляет `pinIssued` (0/1), не секрет. UI выдаёт/reset по этой метке; сервер повторно проверяет реальное состояние/revision. PIN никогда не передаётся как входная величина административной команды: генерирует сервер. Fingerprint и receipt содержат только безопасные employeeId/revision, audit — version/action/actor/target/time/result; открытый результат не сохраняется в journal/outbox/pending.

Ошибки: INVALID_CREDENTIALS 401 для неправильного кода/роли/статуса; PIN_RATE_LIMITED 429 + `error.retryAfterSeconds`/Retry-After; PIN_WORK_LIMIT 429; PIN_KEYS_UNAVAILABLE/PIN_CIPHERTEXT_INVALID 503; PIN_NOT_ISSUED (нет конфигурации входа 503, отсутствующий код цели 404 или reset 409), PIN_ALREADY_ISSUED/PIN_SPACE_EXHAUSTED/PIN_CONTENTION/REVISION_CONFLICT 409; PIN_TARGET_DENIED/PIN_VIEW_DENIED/PERMISSION_DENIED/CLIENT_AUDIENCE_DENIED 403. Неизвестный employee ID не раскрывает секрет и возвращает EMPLOYEE_NOT_FOUND. Общие ошибки транспорта/хранилища неизменны.

POS и LOCAL_ADMIN проверяются по текущей роли при каждом вызове. Старые сессии миграция отзывает. Внутренний WAITER_WEB PIN policy существует для будущего B; native API такие токены отвергает. Нет ручки выбора audience в JSON. PIN-сессия позволяет независимую работу, даже пока пароль временный, но открытие смены всё равно требует личный постоянный пароль и отдельное право. Парольный первый вход до смены остаётся ограниченным.

Desktop RU/KY: PIN по умолчанию, четыре маскированные ячейки, физическая/экранная клавиатура, очистка, автоотправка четвёртой цифры, одна попытка в работе, countdown. Альтернативный парольный экран сохраняет Owner/Manager. Cashier попадает в столы; меню доступно только для чтения, админка персонала не показывается, PIN-панель не предоставляет employee.manage. История продаж/оплата/печать не изображаются готовыми. Текущая активация сохраняет переходный Owner; первого кассира он создаёт штатной durable employee.create и отдельно выдаёт PIN. Новый cloud provisioning без локального Owner относится к переходу F.

Ключи загружаются один раз на процесс сервера; дальнейшие попытки не запускают Keychain/PowerShell. При ошибке загрузки PIN-контур остаётся закрытым до проверки хранилища и перезапуска, парольный контур независим. Удаление системного ключа не очищает уже загруженную память: отказ проверяется при новом запуске, аналогично существующей device identity. Secret provider и точная схема/параметры: AUTH-002-A-TECHNICAL-CONTRACT.md.

Миграция только явная, без OPEN; 001–005 не изменены. Ни MANGO, ни Windows ZIP/службы этим выпуском не обновлялись. Текущий Windows PIN DPAPI/LocalService/ACL — NOT RUN. Реальные результаты автоматических/macOS проверок — PROGRESS.md.

Совместимость Desktop: native IPC `version` читает существующий `/system/version`. При schema <6 PIN не предлагается; при schema <4 начальный экран после пароля — смена. Старый сервер/БД не обновляются автоматически. Сотрудники: текущие permissions перечитываются перед перерисовкой; при отзыве `employee.create` форма создания скрыта с объяснением, но запрет не обходится. Восстановление выполняет уполномоченный Owner через обычную административную команду.
