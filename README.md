# BASHKAR.KG — Local POS foundation

Documentation: [current behavior and conflict resolutions](documents/DOCS-AUDIT-001.md), [document index](documents/INDEX.md). Earlier release contracts retain their historical source/schema numbers; they do not describe the current release in isolation.

Work in progress, not a production POS. Current source is 0.13.0-cash-workspace / SQLite schema 14, durable business-command results, local employees/sessions, cashier PIN login and protected scoped PIN reveal, permissions, shift opening, menu/pricing and a separate Electron Desktop. Stage 4 adds zones, tables, visits, STRICT/SHARED and EMPTY closure. Substage 4.2 adds accepted TABLE orders/batches, persistent Desktop drafts, fixed discounts and durable PENDING kitchen jobs. Block A adds full TABLE/COUNTER settlements, two-method mixed payment, ZERO_SETTLED without fake payments, accepted-item corrections and 24h sales history. Block B adds full individual Payment refunds, documented incident resolution, recovery holds, atomic shift closure and immutable local reports. Block C adds the isolated HTTPS Waiter Web client, encrypted mobile drafts and durable Windows USB print dispatch. Windows/Android/iPhone/physical printer acceptance remains pending; report delivery, financial MANUAL_RECOVERY and Reversal remain pending. See [Waiter API](documents/API-WAITER-009.md), [printing API](documents/API-PRINT-010.md) and [Block C acceptance](documents/BLOCK-C-ACCEPTANCE-001.md). See [Block A contract](documents/API-FINANCE-007.md) and [Block B contract](documents/API-SHIFT-FINANCE-008.md).

**Cloud activation is connected:** Supabase organizations/branches, Owner-scoped RLS, atomic server registry and signed receipts are deployed to the test project. Desktop has the agreed cloud login/branch/local Owner flow. A fresh server remains `NEEDS_ACTIVATION` until activation commits. Device identity uses macOS Keychain for development and LocalService CurrentUser DPAPI on Windows; Windows acceptance is pending. See [cloud activation](documents/CLOUD-ACTIVATION-001.md) and `PROGRESS.md` for actual evidence.

**Menu Cloud sync:** durable outgoing versions, signed device transport, startup/periodic pull, safe apply and conflict resolution are implemented. Cloud SQL and `menu-sync` are deployed; live synchronization is enabled in source configuration after a successful isolated real-Cloud upload/history/download/apply/ACK test. Existing working profiles were not migrated or restarted. See [menu sync API and deployment status](documents/API-MENU-SYNC-012.md).

## Временный ресторан для проверки

```sh
pnpm run desktop:clean-preview
```

Открывает изолированный тестовый ресторан без облачной активации: 60 позиций в 10 категориях (суши, пицца, горячее, десерты, напитки, 5 сетов, упаковка), размеры и варианты, 21 стол в зонах «Основной зал», «Терраса», «VIP». Меню сразу опубликовано; смену можно открыть вручную.

Фотографии блюд в этом временном ресторане недоступны: у него нет регистрации в Cloud, а данные запуска удаляются после закрытия. Для проверки Bunny нужен отдельный зарегистрированный тестовый филиал по инструкции ниже.

Тестовый вход: `owner` / `correct horse battery staple`. При закрытии окна временная база и профиль удаляются; следующий запуск создаёт исходные данные заново. Рабочие установки не изменяются.

## Development

Node.js 24.7+ within major 24 (packaged runtime 24.18.0), pnpm 10.20.0. Versions are pinned in `pnpm-lock.yaml`. Server SQLite native binary belongs to standalone Node, not Electron's ABI. Desktop has its own Electron runtime (45.0.0); no SQLite access in the renderer.

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run test:desktop
pnpm run test:tables-desktop
pnpm run test:orders-desktop
pnpm run test:pin-desktop
pnpm run test:finance-desktop
```

`test:desktop` launches real Electron/HTTP against a throwaway test authority and database, captures `artifacts/desktop-qa/`, then removes temporary data. Requires an interactive OS session and available protected storage (macOS checked; Windows not checked). It does not open the production entrypoint for test activation. Playwright 1.62.1 is pinned; the test needs Electron, not a separately downloaded browser. No restaurant data is needed.

Corepack may need an explicitly writable `COREPACK_HOME` in a sandbox. Current local runs used `/private/tmp/bashkar-corepack` and `/private/tmp/bashkar-pnpm-store`; these are environment paths, not deployment requirements.

## Manual macOS test with real cloud

Для текущей версии с фотографиями создайте новый изолированный профиль (команду `init` выполняйте только один раз):

```sh
pnpm run build
node infrastructure/local/run-desktop.cjs init photo-qa
BASHKAR_LOCAL_PORT=3216 node infrastructure/local/run-desktop.cjs start photo-qa
```

Профиль сохраняется в `.local/photo-qa/`. При активации выберите свободный тестовый филиал в Cloud. После публикации товара дождитесь ACK синхронизации меню, затем откройте товар в редакторе и загрузите фото. Для повторного запуска используйте только команду `start` с тем же профилем и портом. Не подключайте рабочий филиал MANGO для этой проверки.

Блок «Фото блюда» виден уже при создании позиции, но кнопка становится доступной после публикации и появления позиции в Cloud. Если Desktop был открыт во время обновления исходного кода, закройте окно и запустите `BASHKAR_LOCAL_PORT=3216 node infrastructure/local/run-desktop.cjs window photo-qa`, когда локальный сервер всё ещё работает; повторно `init` выполнять нельзя.

Существующий профиль `.local/branch` создан на старой схеме; не запускайте его как способ проверить фото без отдельной оценки миграции его данных.

```sh
pnpm run desktop:local:init  # once, explicit new installation
pnpm run desktop:local
```

Persistent isolated data lives in `.local/branch` and `.local/desktop`. Select only the configured test branch: this is real cloud registration. Enter cloud Owner credentials, choose the branch, then set separate local credentials. Closing Electron leaves the server running; Ctrl+C stops the local launcher/server. `desktop:local:window` opens the window again. Never delete a database/marker/key to bypass activation or retry initialization.

## Local server and Desktop

Set `BASHKAR_DATA_DIR` to a new, empty, absolute **test** directory. Explicit initialization only:

```sh
pnpm run build
BASHKAR_DATA_DIR=/absolute/new-test-dir pnpm run init-db
BASHKAR_DATA_DIR=/absolute/new-test-dir pnpm start
pnpm run desktop
```

Server listens on `127.0.0.1:3210` (`BASHKAR_PORT`). Desktop uses the same port; `BASHKAR_DESKTOP_PORT` may select another validated loopback port. GET `/api/v1/system/health/live`, `/ready`, `/api/v1/system/version` distinguish liveness/readiness/schema. Browser origins and non-loopback Host are rejected; no browser/LAN transport, cookies or permissive CORS. The shipped entrypoint offers real cloud activation with public installation trust configuration; no universal Owner/password or test activation bypass is shipped.

Desktop renderer has no session token/Node API; sandbox/contextIsolation/CSP and narrow native IPC are enabled. Main encrypts session and pending commands via safeStorage; unavailable/basic_text storage blocks access. Only safe pending payloads/IDs survive lost responses and app restart, scoped to the authenticated employee. Reconfirmation passwords are requested again and are never persisted. Polling does not update idle activity. Closing Desktop does not stop the server/close a shift.

## Storage and updates

Ordinary startup never creates a missing database. Initialization writes a marker before database creation; partial artifacts intentionally block a retry. Missing/mismatched/corrupt/incompatible files are preserved and block mutations. Losing both marker and database cannot be distinguished from an empty directory by software alone. No automatic rollback/restore.

SQLite: WAL, synchronous FULL, foreign keys per connection, 5000 ms busy timeout, quick/FK checks, migration checksum and physical schema comparison, marker/instance verification and a real changing write probe. The separate SQLite instance lock plus compatibility sentinel and identity checks still depend on protected directory ACLs. Never remove/replace locks while any old/new server could be running. Detection is not a defense against a privileged administrator controlling files/processes.

A schema 1, 2, 3, 4, 5 or 6 installation remains unchanged on startup and reports `SCHEMA_UPGRADE_REQUIRED`. Only on an isolated stopped test copy:

```sh
BASHKAR_DATA_DIR=/absolute/stopped-test-copy pnpm run migrate-db
```

The instance ID is preserved, migration is transactional, pending updates reject an OPEN shift. Unknown future versions/checksums/structures are blocked. Verified independent backups, full restore and a production upgrade/rollback procedure remain D11/D13 work. Current API has no shift-close operation capable of bypassing missing orders/payments/incidents/report dependencies.

## Contracts and limits

See [ITERATION-001](documents/ITERATION-001.md) for D03/D04/D10/D02/D13/D15, migration and UI boundaries. Business data/audit/outbox/result commit atomically before success; replay rechecks current access, same UUID with different semantic request conflicts. Temporary credentials are returned once and never journaled; a lost secret requires an explicit new reset. Payments/accepted-item corrections are implemented by block A; physical printing and cloud delivery remain unavailable. Production backup/preflight and the transition of old OPEN installations require a separate approved runbook.

Money is integer tyiyn, price/total ≤999999999; quantity 1…9999; fee rates in hundredths of a percent, each 0…10000, total ≤10000. TABLE fees independently ROUND_HALF_UP after fixed discount; COUNTER has none. Quotes are not sales. Accepted TABLE batches persist historical snapshots and freeze the TABLE fee configuration at first acceptance.

## Windows and evidence

The isolated Windows test package and procedure are described in `infrastructure/windows-service/ITERATION-001-ACCEPTANCE.md`. It installs a NEW `BashkarPOSFoundationTest`, port 3212, separate data; it does not update old services/databases or include test authority/Owner. Restart policy is 5s/15s/none, still unverified in the actual new Windows service. `package-iteration.py` builds it from verified runtime artifacts and produces a per-file manifest.

`PROGRESS.md` separates local automated/macOS Desktop evidence from Windows/cloud/hardware. Windows 10/11, target 4 GB, LocalService identity/ACL/restart/DPAPI, printers/phones/network, power loss and restore are not accepted by macOS/cloud tests. Use `artifacts/bashkar-cloud-iteration-002-win-x64.zip` for the new activation test. The retained iteration-001 ZIP predates cloud integration and has schema 2. Logs contain lifecycle/error codes only; technical retention/production audit quotas and full D18 remain open.

Third-party password data: `third-party/SecLists-PROVENANCE.md` and license. The dictionary is vendored and requires no internet during login/password setup.

Current tables contracts and verification: [API-TABLES-004](documents/API-TABLES-004.md). Existing MANGO installs and Windows iteration-002 ZIP remain schema 3; they were not upgraded for this substage. Never bypass the OPEN-shift migration guard.

Current orders contracts: [API-ORDERS-005](documents/API-ORDERS-005.md). Open a visit, then “Заказ и черновик”. A draft is not an accepted order; immutable kitchen jobs retain their business PENDING value; schema10 shows effective dispatch states from the separate delivery history. After a Batch, EMPTY closure is forbidden, including zero-price batches. TABLE payment/zero settlement/full cancellation are available by permission in schema7. Schema8 supports shift closure with personal password, actual blockers and immutable financial report. Existing OPEN installations still require a separately approved D11/D13 transition; use disposable QA data until deployment/restore gates are accepted.

AUTH-002 A is implemented locally: [PIN API](documents/API-AUTH-006.md), [technical contract](documents/AUTH-002-A-TECHNICAL-CONTRACT.md). Active installs open the cashier PIN screen; password fallback retains the transitional local Owner and explicit Manager. No default PIN is assigned on migration. Owner Dashboard and remote reveal remain later; Waiter HTTPS transport is implemented locally by block C; financial sales are implemented by block A; subscription enforcement is excluded. Existing MANGO/Windows installations remain unchanged.


Platform administrator website: https://bashkar-platform-admin.nuremirdev.chatgpt.site (private hosting plus Supabase admin allowlist). New Owner + organization + first branches, manual initial passwords without emails. Owner website is deferred; local Owner remains. Backend/deployment/setup details: [PLATFORM-ADMIN-001](documents/PLATFORM-ADMIN-001.md). Checks: `pnpm test`, `pnpm run test:platform-admin-ui`. First administrator enters their password personally through the one-use local `infrastructure/platform-admin/setup-admin.cjs` form.

Block A verification: `pnpm run check`, full `pnpm test`, and native Electron finance QA on disposable macOS data, including original-command recovery after lost response and both process restarts. `artifacts/finance-qa/` contains screenshots. No real bank, printer, Windows upgrade, restore or production pilot is implied. Existing installations/keys/registrations were not changed.

Block B isolated Electron QA: `pnpm run test:shift-finance-desktop`. This uses temporary fixtures and does not perform real bank transfers or update `.local` / MANGO / Windows installations.

Block C isolated HTTPS/mobile/native QA: `pnpm run test:service-clients-desktop`. An explicit local HTTP MVP mode for Waiter Web is described in [WAITER-HTTP-MVP-018](documents/WAITER-HTTP-MVP-018.md) and checked with `pnpm run test:waiter-http`; it does not encrypt network traffic. Deployment fields, offline certificate provisioning, two USB queues and consolidated hardware acceptance: [BLOCK-C-ACCEPTANCE-001](documents/BLOCK-C-ACCEPTANCE-001.md). No Windows runtime/helper binary or physical device acceptance is implied by these macOS fixtures.

Desktop cash register now renders TABLE_FIRST or FAST_FIRST from terminal settings, with one navigation entry, shared toasts and modal discount/table/waiter actions. TABLE/COUNTER use one server order sequence per branch/shift. See [Cash UX](documents/POS-CASH-UX-002.md), [numbering/migration](documents/API-ORDER-NUMBERS-013.md), and [message standard](documents/UI-MESSAGES-001.md). Existing installations require explicit migration with the shift closed.

Cashier item UX is documented in [POS-CASH-UX-003](documents/POS-CASH-UX-003.md): direct plain-item add, server-priced choice tiles, per-item comments, compact basket and two-row categories. Popular items remain a [future feature](documents/POS-POPULAR-001-DRAFT.md).

Cash workspace schema 14: real TABLE service contexts without a physical table, audited late assignment, permission-protected custom amount items excluded from kitchen jobs, shared cart with accepted batches and separate durable add-on drafts, independent persisted issue marks. See [API-CASH-WORKSPACE-014](documents/API-CASH-WORKSPACE-014.md). Migration requires a closed shift; production profiles were not migrated.

Table-first quick sale now opens a full-viewport COUNTER dialog using the shared catalog/cart and a separate protected workspace; table status/zone groups share one 50/50 scroll row. No schema/API change. See [POS-TABLE-FIRST-QUICK-SALE-005](documents/POS-TABLE-FIRST-QUICK-SALE-005-DRAFT.md). UI QA: `pnpm test:table-quick-sale-desktop`.

Shift proof handling: rejected first PIN/password attempts show inline dialog errors and do not leave a false pending card. Truly uncertain openings retain the original command, Header indicator and modal recovery across restarts. See [POS-SHIFT-PIN-ERRORS-006](documents/POS-SHIFT-PIN-ERRORS-006-DRAFT.md); QA: `pnpm test:shift-pin-errors-desktop`. No server/schema change.
