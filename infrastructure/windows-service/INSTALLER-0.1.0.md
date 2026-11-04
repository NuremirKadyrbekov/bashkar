# Bashkar POS 0.1.0 — Windows x64 test installer

## Build

On a Windows x64 development machine with Node.js 24.18.0, pnpm 10.20.0 and NSIS installed:

```powershell
pnpm run check
pnpm test
pnpm run test:desktop
.\infrastructure\windows-service\build-installer.ps1
```

The output is `artifacts\windows-installer\Bashkar-POS-Setup-0.1.0.exe`. The same commands run in `.github/workflows/windows-installer.yml` when manually dispatched; download the workflow artifact. The installer is an **unaccepted test build** until the checklist below passes on the target Windows computer. The build script pins and verifies Node 24.18.0 and WinSW 2.12.0, uses the lockfile for Electron 45.0.0 and better-sqlite3 12.4.1, and stages native modules built/installed on Windows. The Desktop's Excel import is bundled separately. The server and print worker are bundled separately for the supplied Node ABI. The Windows print helper is compiled on the build runner. The runtime needs no development tools on the restaurant computer.

## Install and use

Copy the `.exe` to a Windows 10/11 x64 test computer. Run it as administrator and approve the service installation. It installs to `%ProgramFiles%\Bashkar POS`, registers `BashkarPOSLocalServer` with automatic startup under LocalService, and creates Desktop and Start Menu shortcuts. Double click **Bashkar POS**. During server startup the window shows a connection message and a retry button. A newly initialized branch still needs the existing cloud Owner activation and employee setup; this build does not bypass those rules. Normal supported local operations use the server after activation.

Check the service in an elevated PowerShell:

```powershell
Get-Service BashkarPOSLocalServer
Invoke-RestMethod http://127.0.0.1:3210/api/v1/system/health/live
Invoke-WebRequest http://127.0.0.1:3210/api/v1/system/health/ready -SkipHttpErrorCheck
Get-Content "$env:ProgramData\BashkarPOS\logs\BashkarPOSLocalServer.wrapper.log" -Tail 50
```

`live` proves that HTTP is listening. `ready` returns 503 before activation or if the database needs review; it is not an installer failure. The app should never start another server. Closing the app leaves the service running. Restaurant files remain in `%ProgramData%\BashkarPOS\data`; logs, configuration and backups have separate sibling folders. Uninstall removes the service and application files but leaves the entire `%ProgramData%\BashkarPOS` tree intact. A reinstall reuses the database and never runs `init-db` when the database exists.

The installer does not automatically migrate an older SQLite schema. When the server reports `SCHEMA_UPGRADE_REQUIRED`, stop and plan a verified backup and migration separately. Do not delete or replace the database. Existing prototype services using port 3210 must be stopped by an administrator before installation.

## Windows acceptance on an isolated test profile

1. Clean install; verify shortcuts, Installed Apps, LocalService identity, `live`, and first activation screen.
2. Activate a disposable branch, sign in, open a shift, create a table order, edit menu and stop list, register a **test-only** local payment, and inspect kitchen queue without a physical printer.
3. Close and reopen Desktop; verify the same shift, tables, and orders and a still running service.
4. Disconnect the internet; verify local login, orders, local WebSocket updates, payments, and Waiter Web over the configured LAN. Reconnect for any Owner cloud sign-in required by existing auth rules.
5. Reboot; verify automatic service startup and persisted data. Force terminate only the test service's Node process; verify bounded recovery and the logs.
6. Reinstall the same version and verify the data. Uninstall and verify `%ProgramData%\BashkarPOS` still exists. Test 4 GB RAM if hardware is available.

No real payment or physical printing belongs in automated acceptance. A successful CI build verifies packaging inputs; it does not prove Windows 10, hardware, LAN, restart, uninstall, or restaurant acceptance.

## Verification state on 2026-11-04

On macOS, `pnpm run check` passed, `pnpm test` passed (51 server test files / 291 tests plus 8 Node Desktop tests), and the three esbuild bundles completed. `pnpm run test:desktop` launched with an isolated profile but timed out because its selector expects the former heading “Кассовая смена”; the current screen heading is “История смен”. The test has not been updated in this packaging task. The Windows build script, NSIS compiler, service installation, native Windows modules, and actual `.exe` cannot be executed in this macOS workspace. No Windows installer artifact is present locally. The workflow must be run from a repository with GitHub Actions; this checkout currently has no Git remote configured. The workflow labels the output unaccepted and runs a disposable installer smoke test on its Windows runner; physical Windows acceptance remains separate.
