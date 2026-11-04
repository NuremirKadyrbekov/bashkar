> **Сверка 24.10.2026.** Номера source/schema и результаты тестов ниже привязаны к своей поставке. Текущий срез — source 0.11.0-menu-sync / SQLite 12; изменения и ограничения — в DOCS-AUDIT-001. [Актуальное состояние и решения](DOCS-AUDIT-001.md).

# Блок C — запуск и единая приёмка

Дата23.10.2026. Source0.9.0-service-clients/schema10. Статус: **локальная реализация и автоматизированный QA; Windows/телефоны/физическая печать NOT RUN**. Это не разрешение обновлять существующую установку с OPEN-сменой. MANGO, .local, рабочие DB/регистрации/ключи/роутер/системный trust store не изменялись.

## Что уже проверено локально

- `pnpm run check`: TypeScript и синтаксис native/web/provisioning JS.
- `pnpm test`:158 tests/26 files, включая13 новых C-сценариев. Проверены CA→CSR→IP certificate/import/secrets/CAS, cookie/Origin/Host/CSRF/audience/revocation/idle/key loss, immutable initial dispatch и rollback всего заказа, UNKNOWN lease/no auto repeat, пять safe attempts, original→cancel/manual→release, CLOSED late gate и независимый customer, crash CLAIMED/IN_PROGRESS/diagnostic resolution, device configure replay, RU/KY raster/repeat. Fresh10, explicit3…9→10, OPEN refusal и сохранность старых фактов/FK покрыты migration tests.001–008 сверены с исходным SHA256 snapshot.
- Реальный Node HTTPS GET с test CA и проверкой цепочки/IP, затем Electron/Chromium mobile390×844 на macOS. QA browser доверяет только одноразовому CA через узкий verify callback, системный trust не меняется. Все credentials/authority/DB/userData одноразовые. **Это не Safari/Android/iOS acceptance.**
- C UI QA: PIN, открытие стола, варианты/модификаторы/комментарий, AES ciphertext в IndexedDB, reload/PIN и восстановление draft, response dropped после реального HTTPS commit, own receipt без второй Batch, расчёт, статусы печати; two-store CAS;RU/KY;60s background logic; native print queue/config/network QR. Printer adapter — fixture, бумага не печаталась.
- Шесть существующих Electron QA (qa,tables,orders,pin,finance,shift-finance) прошли на одноразовых профилях. После последних изменений C UI повторяется C QA; A/B доменные проверки остаются в общем наборе.
- Compiled raster Worker реально запускался, glyph preview `artifacts/service-clients-qa/raster-test.png` проверен. Картинка не доказывает печать на XP-365B.

## Данные стенда, которые заполняются при подключении

| Поле | Сейчас |
|---|---|
| Кассовый компьютер / Windows10 или11 / RAM | Не задано; проверить4ГБ отдельно |
| Постоянный LAN IPv4 и mask, служебная подсеть | Не задано; только private IPv4, без домена |
| HTTPS port | План3443, окончательно по доступному порту |
| CA custodian/offline backup/пароль/renewal date | Не назначены |
| Android/iPhone модели/OS/браузер | Оба типа нужны; конкретные не заданы |
| Kitchen: serial/USB port/driver/queue/self-test/mode | XP-365B,80mm,USB к кассе; остальное проверить |
| Customer: serial/USB port/driver/queue/self-test/mode | Второй XP-365B,80mm,USB к той же кассе |
| Нужен ли резервный маршрут | Не задан; default none |
| Ответственный за UNKNOWN/manual decisions | Назначить и выдать отдельные права |

## Подготовка нового изолированного Windows стенда

1. Собрать source `pnpm run check` / `pnpm test`; staging: `python3 infrastructure/windows-service/prepare-block-c.py NEW_OUTPUT_OUTSIDE_REPO`. Builder копирует unbundled compiled modules (важно для Worker), native/web assets, fonts/OFL, helper source и lockfile, создаёт SHA256 manifest; не копирует .local, DB, CA/private keys, node_modules, runtime или активированную установку. Старые foundation/iteration ZIP builders не являются пакетами C.
2. На отдельном Windows стенде установить проверенные Node24.18.0 x64, pnpm10.20.0 и зависимости `pnpm install --prod --frozen-lockfile` в staging. Это загружает платформенные better-sqlite3 и resvg Windows binaries. Electron45.0.0 поставляется отдельным проверенным runtime; devDependency Electron не входит в prod install. Не переносить macOS node_modules. Проверить загрузку `better-sqlite3`, `@resvg/resvg-js`, `qrcode`, `node-forge` под standalone Node. Runtime/distribution ZIP/SCM installer/подпись нового пакета ещё не выпущены; staging не исполняет установку службы.
3. `powershell -NoProfile -File infrastructure/printing/build-helper.ps1`. Сохранить SHA256 RawPrint.exe и обновлённый manifest deployment-артефакта. Build/.NET/helper Winspool реального Windows ещё NOT RUN. Не использовать старый esbuild single-file bundle: Worker должен запускать отдельный `modules/printing/render.js`.
4. Рабочая папка службы — корень staging (assets разрешаются относительно него). Data dir — отдельный абсолютный путь. Инициализация только новой БД: BASHKAR_DATA_DIR + `node dist/apps/local-server/src/main.js init-db`; запуск с тем же env. Активация новой тестовой ветки — отдельная реальная cloud registration, не автоматически. Существующую branch/MANGO не перерегистрировать. Для upgrade нужен проверенный backup/restore, закрытая смена, остановленный сервер и explicit migrate-db; OPEN guard не обходить.
5. Служба с согласованной Windows identity/ACL/DPAPI. Namespace pin/web/tls и device key должны принадлежать одной service identity и сохраняться при рестарте. Копия одной SQLite без соответствующих protected keys — не полноценное восстановление. Не создавать новые keys поверх потерянных. CurrentUser DPAPI/ACL/restore/4ГБ проверяются отдельно.
6. Установить два драйвера/очереди так, чтобы LocalService видел и открывал их. Уникальные имена, serial/USB labels, разные physical devices. Self-test производителя: receipt ESC/POS mode, paper width80mm; TSPL label mode сначала переключается вручную по официальной инструкции. Не отправлять raster, пока режим неизвестен.

## TLS на локальном IP без домена

Процедура выполняется оператором на изолированном provisioning-компьютере; CLI никогда не запускается startup. Использовать приватную папку вне repo. CA passphrase минимум16 символов передаётся **stdin**, без argv/shell history/log. Примеры ниже содержат placeholders, не готовые секреты:

```
node infrastructure/waiter/certificates.cjs ca BRANCH_LABEL root-ca.crt root-ca.encrypted.pem
node infrastructure/waiter/certificates.cjs csr PRIVATE_IPV4 leaf.private.pem leaf.csr.pem
node infrastructure/waiter/certificates.cjs sign root-ca.crt root-ca.encrypted.pem leaf.csr.pem leaf.crt
node infrastructure/waiter/certificates.cjs bundle PRIVATE_IPV4 3443 leaf.crt root-ca.crt leaf.private.pem restaurant.tls-bundle.json
```

`ca`/`sign` читают passphrase из stdin до EOF; используйте защищённую подачу через password manager/закрытый терминал, не `echo actual-password`. CA key хранится offline encrypted и **не импортируется на кассу**. CSR key/server leaf отличаются от CA key. Leaf максимум180дней; root5лет. Закрепить IP через DHCP reservation/static config с учётом сети; публичный fingerprint сверять вне QR.

В native «Официанты» сотрудник с network.waiter.manage выбирает JSON bundle file. Main process читает private key, renderer показывает только public proposal. Проверить IP/порт/root fingerprint/expiry, подтвердить commit. Удаление plaintext bundle/leaf key после успешного защищённого импорта и offline backup — контролируемая оператором процедура, приложение файлы автоматически не удаляет. В DB только encrypted key; journal/pending без private key.

Native listener3210 остаётся loopback. Windows Firewall разрешает HTTPS web port только нужной служебной подсети; не открывать native LAN, UPnP или WAN forwarding. Эти правила приложение не меняет. Native QR открывает `https://IP:port/waiter/`.

Установить только public root certificate на каждый телефон. Android — доверие CA для выбранного браузера; iPhone — установка профиля и отдельное полное SSL trust в настройках сертификатов. Точные пути проверить по версии OS на стенде. Не вводить PIN через HTTP/предупреждение о недоверенном сертификате. Проверить trusted IP HTTPS, отсутствие предупреждений, TLS expiry/renewal и возможность привязки configured interface.

До смены IP/origin завершить/сохранить старые черновики на прежнем origin. Browser storage привязан к origin; автоматически перенести ciphertext между IP нельзя. При ротации CA сначала установить новый public root на телефоны, затем leaf/import; старый CA удалять только после проверки всех устройств и резервного плана.

## Общий лист аппаратной приёмки — всё пока NOT RUN

| ID | Проверка | Успех |
|---|---|---|
| C-H01 | Windows10/11, LocalService, cold reboot, SCM restart,4ГБ | Native+HTTPS+worker поднимаются; ключи/очереди доступны; нет второго writer |
| C-H02 | Android и iPhone, RU/KY, private IP/trusted CA | Cookie/CSRF, own TABLE/STRICT/SHARED и current grants; без native/Counter/refund доступа |
| C-H03 | Телефон sleep/background>60s, reload, logout, другой Waiter, две вкладки | PIN lock; ciphertext сохраняется, чужие данные недоступны; CAS без потери |
| C-H04 | LAN offline/reconnect/response lost/server restart | Локальная правка; команды без auto resend; исходный receipt/commandId, одна Batch/Settlement |
| C-H05 | Два XP-365B одновременно, реальные LocalService queues | Kitchen и Customer физически разные; роли не перепутаны |
| C-H06 | Короткий и длинный RU/KY чек, Ө/Ү/Ң, варианты/модификаторы/комментарии | Читаемо, нет clipping/неограниченной пустой подачи; default576dots проверен |
| C-H07 | Kitchen NEW/CANCEL/CHANGE/REPLACE, Counter label, manual handoff | Правильный subset/order dependencies; явное решение после manual; нет Batch UI номера |
| C-H08 | Customer CASH/CARD/QR/MIXED/ZERO/discount/fees | Frozen принятые суммы/методы; нет выдуманной оплаты/фискальности |
| C-H09 | USB unplug/driver queue rename/not visible before StartDoc | FAILED_SAFE, максимум5 attempts, ручное дальнейшее решение |
| C-H10 | Отключить питание/USB/spooler/убить helper после начала, бумага кончилась | UNKNOWN без auto duplicate; сверка OS job/бумаги; lease и подтверждённое решение |
| C-H11 | UNKNOWN одной очереди и рабочий второй принтер | Независимая очередь движется; один physicalId не получает параллельные jobs |
| C-H12 | Смена закрывается при отложенной печати/legacy backlog | Учёт закрывается корректно; кухня LATE/LEGACY_REVIEW, customer доступен; нет silent backlog print |
| C-H13 | Backup/restore + protected keys/service identity, полный power loss | Доказано восстановление identity/DB/keys/pending, без новой активации и автоматического повтора UNKNOWN |
| C-H14 | Запрет/отзыв print rights, старые>24h jobs, backup redirect | Нет обхода current rights/history; ПОВТОР+reason/audit; риск показан |

Записывать для каждого ID дату/Windows/телефон/driver/helper hash/исполнителя, PASS/FAIL и фотографии бумаги/OS jobs. SENT в приложении само по себе не PASS аппаратной печати. После общего прогона исправления и повторные проверки фиксируются здесь и в PROGRESS.md.
