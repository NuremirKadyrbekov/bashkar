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

For a production candidate, use a clean, fixed Git checkout and run `build-installer.ps1 -Production -CertificateThumbprint <40-hex-thumbprint> -TimestampUrl <https-timestamp-url> -SignToolPath <path-to-signtool.exe> -ManifestDraftPath <absolute-draft-json-path> -ManifestPrivateKeyPath <absolute-ed25519-private-pem-path> -ManifestPublicKeyPath <absolute-ed25519-public-pem-path> -CloudGrantKeyId <key-id> -CloudGrantPublicKeyPath <absolute-cloud-grant-public-pem-path>` on the Windows build computer. The Authenticode publisher certificate must be available to SignTool and in the CurrentUser or LocalMachine certificate store for Update Manager pinning. The release and Cloud grant Ed25519 public keys must differ. Private keys remain outside the repository; do not reuse the activation key. The draft contains the release manifest fields (`format`, `releaseId`, `version`, `gitCommit`, `keyId`, `platform`, `compatibility`, `minFreeBytes`) and `artifact: { "fileName": "Bashkar-POS-Setup-0.1.0.exe" }`. Its `gitCommit` must match the clean checkout. `compatibility.migrationVersions` lists every integer schema version from `minSchema + 1` through `targetSchema`.

The production build also embeds `payload-manifest.signed.json`, a signed inventory of extracted application files. The `/BASHKAR_STAGE=` installer option only extracts this payload to a new operation-named sibling directory after the update journal, startup guard, and stopped service pass preflight. It does not run the upgrade. The independent Update Manager and Windows E2E must verify the extracted inventory before any binary switch.

The production script signs the final NSIS file, verifies Authenticode and the signer thumbprint, then calculates the size and SHA-256 of those final bytes and signs `release-manifest.signed.json`. It fails closed if any required input, signature, or output is missing. The manifest public key still needs to be pinned in the future Update Manager before any restaurant installation can trust it. The ordinary build and CI artifact remain unsigned test builds and must not be published as production releases.

For a packaging-only CI run, open GitHub **Actions → Windows installer test build → Run workflow**, select `main`, check **Build Only**, then click **Run workflow**. This mode keeps dependency checks, type and syntax checks, the Desktop and Local POS Server build, Windows Service staging, NSIS, and installer output verification. It skips Vitest, Desktop QA, and the install/uninstall smoke test. Leave **Build Only** unchecked for the full test mode. Both modes upload the installer only after a successful build and verify that the `.exe` exists and is nonempty. A Build Only artifact is still unaccepted and needs Windows installation testing.

## Install and use

Copy the `.exe` to a Windows 10/11 x64 test computer. Run it as administrator and approve the service installation. It installs to `%ProgramFiles%\Bashkar POS`, registers `BashkarPOSLocalServer` with automatic startup under LocalService, and creates Desktop and Start Menu shortcuts. Double click **Bashkar POS**. During server startup the window shows a connection message and a retry button. A newly initialized branch still needs the existing cloud Owner activation and employee setup; this build does not bypass those rules. Normal supported local operations use the server after activation.

Check the service in an elevated PowerShell:

```powershell
Get-Service BashkarPOSLocalServer
Invoke-RestMethod http://127.0.0.1:3210/api/v1/system/health/live
Invoke-WebRequest http://127.0.0.1:3210/api/v1/system/health/ready -SkipHttpErrorCheck
Get-Content "$env:ProgramData\BashkarPOS\logs\BashkarPOSLocalServer.wrapper.log" -Tail 50
```

`live` proves that HTTP is listening. `ready` returns 503 before activation or if the database needs review; it is not an installer failure. The app should never start another server. Closing the app leaves the service running. Restaurant files remain in `%ProgramData%\BashkarPOS\data`; logs, configuration and backups have separate sibling folders. Uninstall removes the service and application files but leaves the entire `%ProgramData%\BashkarPOS` tree intact. This installer rejects a repeat installation when it finds application files, the service, the uninstall registration, or the data tree. It also rejects installation after uninstall while preserved data remains. Do not remove that data to make an upgrade pass; recovery and upgrade need a separately accepted procedure.

The installer does not automatically migrate an older SQLite schema. When the server reports `SCHEMA_UPGRADE_REQUIRED`, stop and plan a verified backup and migration separately. Do not delete or replace the database. Existing prototype services using port 3210 must be stopped by an administrator before installation.

## Windows acceptance on an isolated test profile

1. Clean install; verify shortcuts, Installed Apps, LocalService identity, `live`, and first activation screen.
2. Activate a disposable branch, sign in, open a shift, create a table order, edit menu and stop list, register a **test-only** local payment, and inspect kitchen queue without a physical printer.
3. Close and reopen Desktop; verify the same shift, tables, and orders and a still running service.
4. Disconnect the internet; verify local login, orders, local WebSocket updates, payments, and Waiter Web over the configured LAN. Reconnect for any Owner cloud sign-in required by existing auth rules.
5. Reboot; verify automatic service startup and persisted data. Force terminate only the test service's Node process; verify bounded recovery and the logs.
6. Run the installer again and verify it refuses the installation without stopping the service or changing the data. Uninstall and verify `%ProgramData%\BashkarPOS` still exists. Test 4 GB RAM if hardware is available.

No real payment or physical printing belongs in automated acceptance. A successful CI build verifies packaging inputs; it does not prove Windows 10, hardware, LAN, restart, uninstall, or restaurant acceptance.

The full disposable Windows smoke test also runs the bundled recovery command under a temporary LocalService service, verifies the encrypted Backup Set, and checks that a persistent update guard prevents server startup. It does not establish restoration of an activated restaurant or PIN credentials; see [RECOVERY-001](RECOVERY-001.md).

## Known CI test issue on 2026-11-04

GitHub Actions Run #4 (`41827754200`) completed 51 Vitest files and 291 tests, then Vitest 3.2.4 exited with an unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"`. The full workflow stopped before packaging, so its missing-artifact message was a consequence of the test failure. Earlier attempts to increase the test timeout and limit workers did not resolve the worker RPC timeout. Keep the full mode as a test gate and investigate this separately; the Build Only mode is for obtaining a test installer while that issue remains open. Vitest remains at 3.2.4.

## Earlier local verification

On macOS, `pnpm run check` passed, `pnpm test` passed (51 server test files / 291 tests plus 8 Node Desktop tests), and the three esbuild bundles completed. `pnpm run test:desktop` launched with an isolated profile but timed out because its selector expects the former heading “Кассовая смена”; the current screen heading is “История смен”. The test has not been updated in this packaging task. The Windows build script, NSIS compiler, service installation, native Windows modules, and actual `.exe` cannot be executed in this macOS workspace. No Windows installer artifact is present locally. The workflow labels the output unaccepted; physical Windows acceptance remains separate.
