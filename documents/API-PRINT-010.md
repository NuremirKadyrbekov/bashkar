> **Сверка 24.10.2026.** Номера source/schema и результаты тестов ниже привязаны к своей поставке. Текущий срез — source 0.11.0-menu-sync / SQLite 12; изменения и ограничения — в DOCS-AUDIT-001. [Актуальное состояние и решения](DOCS-AUDIT-001.md).

# Физическая печать — API-PRINT-010

Source0.9.0-service-clients/schema10, новая010-print-dispatch. Согласовано: **два Xprinter XP-365B,80mm,USB к Windows-компьютеру кассы**, роли KITCHEN/CUSTOMER. Драйвер/очереди/серийные номера и receipt mode проверяются на стенде; физическая печать ещё NOT RUN.

## Бизнес-факт и доставка

Неизменные print_jobs snapshot v1/v2/status PENDING остаются как были. Новая dispatch создаётся SQL trigger в той же транзакции принятия Batch/Correction/Settlement; сбой initial delivery event откатывает весь бизнес-факт. Эффективное состояние читается из последней generation, в том числе в прежних Order history/jobs API. Нельзя трактовать старый print_jobs.status как бумажную доставку.

Конфигурация device/profile и role route append-only/revisioned. Dispatch замораживает конкретные route/device revisions. Изменение настройки применяется к новым jobs; старую доставку нельзя молча перенаправить. На primary KITCHEN/CUSTOMER требуются разные physical IDs. Backup назначается явно. Отсутствующий маршрут даёт UNCONFIGURED. Долг до010 получает LEGACY_REVIEW, без автоматической отправки.

Writer/worker — тот же Local POS Server с единственной SQLite connection и общим bounded CommandBus. `bus.system` сериализует технические переходы без выдуманного employee. Claim/attempt/device lease/events atomic. Рендер/USB идут вне writer. Две независимые physical queues могут двигаться параллельно, одна physicalId имеет одну lease. Сканирование pending вращает cursor, чтобы заблокированные старые jobs не останавливали всю очередь.

| Состояние | Смысл/следующее действие |
|---|---|
| UNCONFIGURED | Бизнес-факт есть, маршрут не назначен; назначение только явным действием |
| PENDING | Готово к claim при выполненных зависимостях |
| CLAIMED | Durable claim, передача ещё не отмечена; после crash → FAILED_SAFE |
| IN_PROGRESS | SEND_STARTED записан до возможного helper/spooler I/O; после crash → UNKNOWN |
| SENT | Helper подтвердил EndDocPrinter; **это не подтверждение бумаги/кухни** |
| FAILED_SAFE | Известный отказ до возможной передачи; максимум5 attempts/generation, delays1/3/10/30/60s; затем ручное решение |
| UNKNOWN | Возможна передача/частичная печать; автоповтора нет, physical lease удерживается |
| MANUAL_HANDOFF | Сотрудник подтвердил передачу всего кухонного subset с причиной/риском |
| RESOLVED_NO_PRINT | Сотрудник явно завершил эту доставку; история/задание остаются |
| LEGACY_REVIEW | Исторические jobs доC, ручная оценка |
| LATE_REVIEW | Кухонная передача после CLOSED-смены ждёт отдельного разрешения |

Зависимости исходный → отмена/изменение → replacement не обходятся. UNKNOWN/неотправленный предшественник блокирует successor. После ручной передачи/завершения без печати successor требует отдельного release с причиной. REPRINT/REDIRECT сами не обходят late gate. Queue failure не блокирует Settlement/shift close; late kitchen сохраняется для review. Customer receipt после close остаётся допустимым.

Решения используют prepare/hash → commit/revision/current permission; race проигрывает CAS, повтор исходного commandId возвращает свой receipt. Новая отправка создаёт новую generation. Повтор после SENT/UNKNOWN/MANUAL помечен ПОВТОР и датой. UNKNOWN lease освобождается только сотрудником с разрешённым рискованным действием; прежний OS job автоматически не отменяется. Проверка очереди Windows обязательна при ручном решении: старый job может продолжить печататься даже после закрытия helper.

## Рендер и Windows helper

Профиль XP-365B/ESC_POS_RECEIPT/203dpi/576dots/feed24dots/cutter:false. Допустима ручная новая revision384…608dots, кратная8; cutter/drawer отключены. Default conservative576dots нужно проверить self-test и реальной бумагой. Label TSPL mode не подходит; нет автоматического переключения режима.

RU/KY raster: bundled Noto Sans/SIL OFL, SVG layout с фактическим измерением и переносом Unicode, strips до768px, threshold RGBA→ESC/POS GS v0, общий предел32MiB. Node Worker не блокирует основной event loop. No system font dependency. Кухня печатает стол/зону или НА ВЫНОС, время/сотрудника, позиции/варианты/модификаторы/комментарии, ОТМЕНА/ИЗМЕНЕНИЕ и причину; Batch-номер кассовой UI не печатается. Customer — frozen accepted active portions, скидка/сборы/итог/методы/нулевой расчёт, внутренний документ. Отдельный диагностический тест не создаёт Order/Payment/print_jobs.

Headless RawPrint.exe: .NET Framework/Winspool, WMI inventory, USB port/queue/driver recheck, RAW StartDoc/WritePrinter chunks/EndDoc, bounded framed stdin/JSON stdout и OS job ID. Процесс не открывает SQLite и не вызывает браузерный print dialog. После возможного StartDoc любой timeout/crash/потеря ответа → UNKNOWN. Реальный build/run helper на Windows остаётся NOT RUN. Подключённые пользовательские queues должны быть видимы именно LocalService; это часть приёмки.

## Права

`print.queue.view`, `print.settings.manage`, `print.retry_safe`, `print.reprint`, `print.redirect`, `print.manual_handoff`, `print.resolve_no_print`, `print.release_late`. Default Cashier — queue.view/retry_safe; Owner — settings.manage; рискованные действия отдельно выдаются, Manager — через delegation. Waiter все эти права запрещены ceiling. Detail/payload/action сохраняют24h/current order access; privileged historical read не следует автоматически из queue right. Headers старых недоступных заказов не раскрываются. Диагностический UNKNOWN завершается отдельным settings action, тоже reason/risk/revision, чтобы не оставить принтер навсегда заблокированным.

## Native endpoints `/api/v1/printing`

| Метод/путь | Контракт |
|---|---|
| GET inventory, devices, routes | settings.manage; installed USB inventory/configured revisions/routes |
| POST devices/prepare | deviceId:null/UUID,expectedRevision,queueName,profile,receiptModeConfirmed:true → proposal/hash |
| POST devices/commit | Те же поля с выделенным deviceId,commandId,confirmationHash; CAS/current inventory before first commit |
| POST routes/prepare, routes/commit | role,expectedRevision,deviceId,backupId:null/UUID; commit +commandId/hash |
| GET queue?after=&limit=&state=&role= | queue.view; keyset cursor, latest generation, effective states/dependency/late, accessible headers |
| GET jobs/:id | queue.view +payloadAccess, immutable snapshot и delivery event history |
| GET jobs/:id/targets | print.redirect +payloadAccess; только назначенный backup target, без доступа к settings |
| POST jobs/:id/prepare, commit | action,reason,expectedRevision,targetDeviceId:null/backup,riskConfirmed; commit +commandId/confirmationHash |
| GET diagnostics | settings.manage; последние20 диагностик |
| POST diagnostics | commandId,deviceId,expectedDeviceRevision |
| POST diagnostics/:id/resolve | commandId,expectedRevision,reason,riskConfirmed:true; только неактивная PENDING/FAILED_SAFE/UNKNOWN |

Actions: RETRY_SAFE (после5 safe failures), REPRINT (terminal/UNKNOWN), REDIRECT (configured backup), MANUAL_HANDOFF (KITCHEN), RESOLVE_NO_PRINT, RELEASE_LATE (также release зависимости после manual), ASSIGN_ROUTE (UNCONFIGURED). Подтверждение не заменяет live authorization. Каждая попытка и решение остаются в append-only events/audit/outbox; frozen identity/revisions и FK защищают ссылки. Печатный retry не создаёт нового финансового факта.
