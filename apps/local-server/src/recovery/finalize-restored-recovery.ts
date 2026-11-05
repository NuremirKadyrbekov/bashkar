import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { startGuardedServiceProbe } from './guarded-service-probe';
import { verifyOldBinaryInventory } from './old-binary-inventory';
import { restoredDataDigest } from './recovery-probe';
import { guardedStartupMode } from './startup-guard';
import { inspectDatabase, assertWindowsServiceStopped } from './update-migration';
import { UpdateJournal } from './update-journal';
import { stopWindowsService } from './windows-service-control';
import { preMigrationProofName } from './verify-pre-migration-data';

const intentName = 'update-intent.json', guardName = 'update-guard.json';

function marker(path: string) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 1024)
      throw new Error('UPDATE_FINALIZE_GUARD_INVALID');
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function syncDirectory(path: string) {
  if (process.platform === 'win32') return; // Windows power-loss durability requires E2E acceptance.
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function invokeWindows(script: string, failure: string) {
  if (process.platform !== 'win32') throw new Error('UPDATE_WINDOWS_REQUIRED');
  try {
    const result = execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', timeout: 90000, maxBuffer: 4096, windowsHide: true });
    if (result !== 'OK') throw new Error();
  } catch { throw new Error(failure); }
}
const startNormalScript = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$name = 'BashkarPOSLocalServer'
$root = Join-Path $env:ProgramData 'BashkarPOS'
$app = Join-Path $env:ProgramW6432 'Bashkar POS'
$manager = Join-Path $env:ProgramW6432 'Bashkar POS Update Manager'
if ((Test-Path -LiteralPath (Join-Path $root 'config\update-intent.json')) -or
    (Test-Path -LiteralPath (Join-Path $root 'config\update-guard.json'))) { throw 'UPDATE_GUARD_ACTIVE' }
$journal = Get-Content -LiteralPath (Join-Path $root 'config\update-operation.json') -Raw | ConvertFrom-Json
if ($journal.phase -notin @('RECOVERY_READY_TO_START','RECOVERY_QUARANTINE_HEALTHY','RECOVERY_COMMITTED','RECOVERY_COMPLETED','NEW_READY_TO_START','NEW_QUARANTINE_HEALTHY','NEW_UPDATE_COMMITTED','NEW_UPDATE_COMPLETED')) { throw 'UPDATE_FINALIZE_STATE_INVALID' }
$allowedModes = if ($journal.phase -in @('RECOVERY_COMPLETED','NEW_UPDATE_COMPLETED')) { @('Disabled','Manual','Auto') } else { @('Disabled','Manual') }
$xml = [xml](Get-Content -LiteralPath (Join-Path $app "$name.xml") -Raw)
if ($xml.service.executable -ine (Join-Path $manager 'node.exe') -or
    $xml.service.arguments.Trim('"') -ine (Join-Path $manager 'service-bootstrap.js')) { throw 'UPDATE_SERVICE_BOOTSTRAP_REQUIRED' }
$service = Get-CimInstance Win32_Service -Filter "Name='$name'"
if ($null -eq $service -or $service.PathName.Trim('"') -ine (Join-Path $app "$name.exe") -or
    $service.StartName -ine 'NT AUTHORITY\LocalService' -or
    $service.StartMode -notin $allowedModes) { throw 'UPDATE_SERVICE_IDENTITY_INVALID' }
if ($service.StartMode -eq 'Disabled') {
  & "$env:SystemRoot\System32\sc.exe" config $name start= demand | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'UPDATE_SERVICE_MANUAL_FAILED' }
  $service = Get-CimInstance Win32_Service -Filter "Name='$name'"
}
if ($service.State -eq 'Stopped' -and $service.ProcessId -eq 0) {
  Start-Service -Name $name
  (Get-Service -Name $name).WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
} elseif ($service.State -ne 'Running' -or $service.ProcessId -eq 0) { throw 'UPDATE_SERVICE_STATE_INVALID' }
$service = Get-CimInstance Win32_Service -Filter "Name='$name'"
if ($service.StartMode -notin $allowedModes -or $service.State -ne 'Running' -or $service.ProcessId -eq 0) { throw 'UPDATE_SERVICE_START_UNCONFIRMED' }
[Console]::Out.Write('OK')
`;
const enableAutomaticScript = String.raw`
$ErrorActionPreference = 'Stop'
$name = 'BashkarPOSLocalServer'
$root = Join-Path $env:ProgramData 'BashkarPOS'
if ((Test-Path -LiteralPath (Join-Path $root 'config\update-intent.json')) -or
    (Test-Path -LiteralPath (Join-Path $root 'config\update-guard.json'))) { throw 'UPDATE_GUARD_ACTIVE' }
$journal = Get-Content -LiteralPath (Join-Path $root 'config\update-operation.json') -Raw | ConvertFrom-Json
if ($journal.phase -cnotin @('RECOVERY_COMPLETED','NEW_UPDATE_COMPLETED')) { throw 'UPDATE_FINALIZE_STATE_INVALID' }
$service = Get-CimInstance Win32_Service -Filter "Name='$name'"
if ($null -eq $service -or $service.State -ne 'Running' -or $service.ProcessId -eq 0 -or
    $service.StartMode -notin @('Manual','Auto')) { throw 'UPDATE_SERVICE_STATE_INVALID' }
if ($service.StartMode -eq 'Manual') {
  & "$env:SystemRoot\System32\sc.exe" config $name start= auto | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'UPDATE_SERVICE_AUTOMATIC_FAILED' }
}
$service = Get-CimInstance Win32_Service -Filter "Name='$name'"
if ($service.StartMode -ne 'Auto' -or $service.State -ne 'Running') { throw 'UPDATE_SERVICE_AUTOMATIC_UNCONFIRMED' }
[Console]::Out.Write('OK')
`;
const stopUnhealthyScript = String.raw`
$ErrorActionPreference = 'Stop'
$name = 'BashkarPOSLocalServer'
$app = Join-Path $env:ProgramW6432 'Bashkar POS'
$service = Get-CimInstance Win32_Service -Filter "Name='$name'"
if ($null -eq $service -or $service.PathName.Trim('"') -ine (Join-Path $app "$name.exe") -or
    $service.StartName -ine 'NT AUTHORITY\LocalService') { throw 'UPDATE_SERVICE_IDENTITY_INVALID' }
& "$env:SystemRoot\System32\sc.exe" config $name start= disabled | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'UPDATE_SERVICE_DISABLE_FAILED' }
$service = Get-CimInstance Win32_Service -Filter "Name='$name'"
if ($service.State -ne 'Stopped') {
  Stop-Service -Name $name -ErrorAction Stop
  (Get-Service -Name $name).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
}
$service = Get-CimInstance Win32_Service -Filter "Name='$name'"
if ($service.StartMode -ne 'Disabled' -or $service.State -ne 'Stopped' -or $service.ProcessId -ne 0) { throw 'UPDATE_SERVICE_STOP_UNCONFIRMED' }
$wrapper = Join-Path $app "$name.exe"
$node = Join-Path $app 'node.exe'
$managerNode = Join-Path $env:ProgramW6432 'Bashkar POS Update Manager\node.exe'
$remaining = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and ($_.ExecutablePath -ieq $wrapper -or
    (($_.ExecutablePath -ieq $node -or $_.ExecutablePath -ieq $managerNode) -and
      ($_.CommandLine -like '*service-bootstrap.js*' -or $_.CommandLine -like '*server\main.js*' -or
       $_.CommandLine -like '*server\print-worker.js*')))
})
if ($remaining.Count -ne 0) { throw 'UPDATE_SERVICE_PROCESS_REMAINING' }
[Console]::Out.Write('OK')
`;
const restartAfterCommitScript = String.raw`
$ErrorActionPreference = 'Stop'
$name = 'BashkarPOSLocalServer'
$root = Join-Path $env:ProgramData 'BashkarPOS'
$journal = Get-Content -LiteralPath (Join-Path $root 'config\update-operation.json') -Raw | ConvertFrom-Json
if ($journal.phase -cnotin @('RECOVERY_QUARANTINE_HEALTHY','RECOVERY_COMMITTED','NEW_QUARANTINE_HEALTHY','NEW_UPDATE_COMMITTED')) { throw 'UPDATE_FINALIZE_STATE_INVALID' }
if ((Test-Path -LiteralPath (Join-Path $root 'config\update-intent.json')) -or
    (Test-Path -LiteralPath (Join-Path $root 'config\update-guard.json'))) { throw 'UPDATE_GUARD_ACTIVE' }
$service = Get-CimInstance Win32_Service -Filter "Name='$name'"
if ($null -eq $service -or $service.StartMode -ne 'Manual' -or $service.State -ne 'Running') { throw 'UPDATE_SERVICE_STATE_INVALID' }
Stop-Service -Name $name -ErrorAction Stop
(Get-Service -Name $name).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
Start-Service -Name $name -ErrorAction Stop
(Get-Service -Name $name).WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
$service = Get-CimInstance Win32_Service -Filter "Name='$name'"
if ($service.StartMode -ne 'Manual' -or $service.State -ne 'Running' -or $service.ProcessId -eq 0) { throw 'UPDATE_SERVICE_START_UNCONFIRMED' }
[Console]::Out.Write('OK')
`;
async function requestOperationalHealth(port: number, version: string, schemaVersion: number, quarantine: boolean) {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60000;
  do {
    try {
      const [ready, versionResponse, accessResponse] = await Promise.all([
        fetch(`${base}/api/v1/system/health/ready`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${base}/api/v1/system/version`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${base}/api/v1/activation/status`, { signal: AbortSignal.timeout(5000) })]);
      if (ready.status === 200 && versionResponse.status === 200) {
        const health = await ready.json() as Record<string, unknown>;
        const installed = await versionResponse.json() as Record<string, unknown>;
        if (health.ready === true && health.state === 'READY' && installed.releaseVersion === version &&
            installed.schema === schemaVersion && accessResponse.status === (quarantine ? 423 : 200)) return;
      }
    } catch { /* Service may still be starting. */ }
    if (Date.now() < deadline) await new Promise(resolveDelay => setTimeout(resolveDelay, 1000));
  } while (Date.now() < deadline);
  throw new Error('UPDATE_RECOVERY_HEALTH_FAILED');
}

export const windowsFinalizeControls = {
  start: () => invokeWindows(startNormalScript, 'UPDATE_SERVICE_START_FAILED'),
  restart: () => invokeWindows(restartAfterCommitScript, 'UPDATE_SERVICE_RESTART_FAILED'),
  stop: () => invokeWindows(stopUnhealthyScript, 'UPDATE_SERVICE_STOP_FAILED'),
  automatic: () => invokeWindows(enableAutomaticScript, 'UPDATE_SERVICE_AUTOMATIC_FAILED'),
  health: requestOperationalHealth
};

/** Finalize only the restored old installation. No Backup Set key is opened by SYSTEM. */
export async function finalizeRestoredRecovery(input: {
  journal: UpdateJournal; configDir: string; backupRoot: string; dataDir: string; appDir: string;
  operationId: string; port?: number;
  probe?: () => Promise<{ dataDigest: string; version: string; schemaVersion: number }>;
  stopService?: (operationId: string, backupOperationId: string) => void;
  assertServiceStopped?: () => void;
  startNormalService?: () => void;
  requestHealth?: (port: number, version: string, schemaVersion: number, quarantine: boolean) => Promise<void>;
  enableAutomatic?: () => void;
  stopUnhealthyService?: () => void;
  restartAfterCommit?: () => void;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || !row.backup ||
      !['SERVICE_PROBE_HEALTHY', 'RECOVERY_FINALIZE_INTENT', 'RECOVERY_READY_TO_START',
        'RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED', 'RECOVERY_COMPLETED'].includes(row.phase))
    throw new Error('UPDATE_FINALIZE_STATE_INVALID');
  if (basename(input.appDir) !== 'Bashkar POS' || basename(input.dataDir) !== 'data' ||
      (process.platform === 'win32' && (!process.env.ProgramData || !process.env.ProgramW6432 ||
        resolve(input.dataDir).toLowerCase() !== resolve(process.env.ProgramData, 'BashkarPOS', 'data').toLowerCase() ||
        resolve(dirname(input.appDir)).toLowerCase() !== resolve(process.env.ProgramW6432).toLowerCase())))
    throw new Error('UPDATE_FINALIZE_PATH_INVALID');
  const quarantinePath = join(input.appDir, 'server', 'recovery-quarantine.json');
  const quarantineStat = lstatSync(quarantinePath);
  const quarantine = JSON.parse(readFileSync(quarantinePath, 'utf8')) as Record<string, unknown>;
  if (!quarantineStat.isFile() || quarantineStat.isSymbolicLink() || quarantineStat.nlink !== 1 ||
      Object.keys(quarantine).sort().join(',') !== 'capability,format' ||
      quarantine.format !== 1 || quarantine.capability !== 'recovery-quarantine-v1')
    throw new Error('UPDATE_RECOVERY_QUARANTINE_REQUIRED');
  const port = input.port ?? 3210;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('UPDATE_FINALIZE_PORT_INVALID');
  const intentPath = join(input.configDir, intentName), guardPath = join(input.configDir, guardName);
  let intent = marker(intentPath), guard = marker(guardPath);
  if (intent && (intent.format !== 1 || intent.phase !== 'GUARD_REQUESTED' ||
      intent.operationId !== row.operationId || intent.backupOperationId !== row.backup.operationId)) throw new Error('UPDATE_FINALIZE_GUARD_INVALID');
  if (guard && (guard.format !== 1 || guard.operationId !== row.operationId)) throw new Error('UPDATE_FINALIZE_GUARD_INVALID');
  if (!['RECOVERY_READY_TO_START', 'RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED', 'RECOVERY_COMPLETED'].includes(row.phase) && (!intent || !guard))
    throw new Error('UPDATE_GUARD_ACTIVE');
  if (guard && !intent) throw new Error('UPDATE_FINALIZE_GUARD_INVALID');
  if (['RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED', 'RECOVERY_COMPLETED'].includes(row.phase) && (intent || guard)) throw new Error('UPDATE_FINALIZE_GUARD_INVALID');
  if (row.phase === 'RECOVERY_READY_TO_START' && intent && !guard) {
    writeFileSync(guardPath, JSON.stringify({ format: 1, operationId: row.operationId }), { flag: 'wx', mode: 0o600, flush: true });
    syncDirectory(input.configDir);
    guard = marker(guardPath);
  }
  if (intent && guard) {
    const restoredProof = marker(join(input.dataDir, '.update-data-restore.json'));
    const preMigrationProof = marker(join(input.dataDir, preMigrationProofName));
    if (!!restoredProof === !!preMigrationProof) throw new Error('UPDATE_FINALIZE_PROOF_INVALID');
    const oldVersion = (restoredProof ?? preMigrationProof)!.softwareVersion;
    if (typeof oldVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(oldVersion))
      throw new Error('UPDATE_FINALIZE_PROOF_INVALID');
    const proof = await (input.probe ?? (() => startGuardedServiceProbe({ journal: input.journal,
      configDir: input.configDir, dataDir: input.dataDir, appDir: input.appDir,
      operationId: input.operationId, port })))();
    if (proof.version !== oldVersion ||
        proof.schemaVersion !== row.backup.schemaVersion || !/^[0-9a-f]{64}$/.test(proof.dataDigest))
      throw new Error('UPDATE_FINALIZE_PROBE_INVALID');
    if (row.phase === 'SERVICE_PROBE_HEALTHY') input.journal.recordRecoveryFinalizeIntent(row.operationId);
    (input.stopService ?? stopWindowsService)(row.operationId, row.backup.operationId);
    (input.assertServiceStopped ?? assertWindowsServiceStopped)();
    if (restoredDataDigest(input.dataDir) !== proof.dataDigest ||
        verifyOldBinaryInventory(input.configDir, input.appDir, row.operationId) !== proof.version ||
        inspectDatabase(input.dataDir).schemaVersion !== row.backup.schemaVersion)
      throw new Error('UPDATE_FINALIZE_FILES_CHANGED');
    if (row.phase !== 'RECOVERY_READY_TO_START') input.journal.recordRecoveryReadyToStart(row.operationId);
    unlinkSync(guardPath); syncDirectory(input.configDir);
    unlinkSync(intentPath); syncDirectory(input.configDir);
    intent = null; guard = null;
  }
  if (intent || guard || guardedStartupMode(input.configDir, input.backupRoot).kind !== 'NORMAL')
    throw new Error('UPDATE_FINALIZE_GUARD_INVALID');
  (input.startNormalService ?? (() => invokeWindows(startNormalScript, 'UPDATE_RECOVERY_START_FAILED')))();
  try {
    if (['RECOVERY_READY_TO_START', 'RECOVERY_QUARANTINE_HEALTHY'].includes(row.phase) &&
        inspectDatabase(input.dataDir).schemaVersion !== row.backup.schemaVersion)
      throw new Error('UPDATE_RECOVERY_HEALTH_FAILED');
    const version = verifyOldBinaryInventory(input.configDir, input.appDir, row.operationId);
    if (input.journal.read()?.phase === 'RECOVERY_READY_TO_START') {
      await (input.requestHealth ?? requestOperationalHealth)(port, version, row.backup.schemaVersion, true);
      input.journal.recordRecoveryQuarantineHealthy(row.operationId);
    }
    if (input.journal.read()?.phase === 'RECOVERY_QUARANTINE_HEALTHY') {
      (input.restartAfterCommit ?? (() => invokeWindows(restartAfterCommitScript, 'UPDATE_RECOVERY_RESTART_FAILED')))();
      await (input.requestHealth ?? requestOperationalHealth)(port, version, row.backup.schemaVersion, true);
      input.journal.recordRecoveryCommitted(row.operationId);
    }
    if (input.journal.read()?.phase === 'RECOVERY_COMMITTED') {
      (input.restartAfterCommit ?? (() => invokeWindows(restartAfterCommitScript, 'UPDATE_RECOVERY_RESTART_FAILED')))();
      await (input.requestHealth ?? requestOperationalHealth)(port, version, row.backup.schemaVersion, false);
      input.journal.recordRecoveryCompleted(row.operationId);
    } else {
      await (input.requestHealth ?? requestOperationalHealth)(port, version, row.backup.schemaVersion, false);
    }
    if (input.journal.read()?.phase !== 'RECOVERY_COMPLETED') throw new Error('UPDATE_FINALIZE_STATE_INVALID');
    const restoredProof = marker(join(input.dataDir, '.update-data-restore.json'));
    const preMigrationProof = marker(join(input.dataDir, preMigrationProofName));
    if (restoredProof && preMigrationProof) throw new Error('UPDATE_FINALIZE_PROOF_INVALID');
    const proofPath = restoredProof ? join(input.dataDir, '.update-data-restore.json') :
      preMigrationProof ? join(input.dataDir, preMigrationProofName) : null;
    const proofMarker = restoredProof ?? preMigrationProof;
    if (proofMarker && (proofMarker.format !== 1 || proofMarker.operationId !== row.operationId ||
        proofMarker.backupOperationId !== row.backup.operationId || proofMarker.softwareVersion !== version))
      throw new Error('UPDATE_FINALIZE_PROOF_INVALID');
    if (proofPath) { unlinkSync(proofPath); syncDirectory(input.dataDir); }
  } catch (error) {
    if (['RECOVERY_READY_TO_START', 'RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED', 'RECOVERY_COMPLETED'].includes(input.journal.read()?.phase ?? ''))
      input.journal.recordRecoveryActivationFailed(row.operationId);
    (input.stopUnhealthyService ?? (() => invokeWindows(stopUnhealthyScript, 'UPDATE_RECOVERY_STOP_FAILED')))();
    throw error;
  }
  (input.enableAutomatic ?? (() => invokeWindows(enableAutomaticScript, 'UPDATE_SERVICE_AUTOMATIC_FAILED')))();
  return { state: 'RECOVERY_COMPLETED' as const, operationId: row.operationId };
}
