import { execFileSync } from 'node:child_process';
import { beginGuardedOperation } from './startup-guard';
import { UpdateJournal } from './update-journal';
import { captureOldBinaryInventory } from './old-binary-inventory';
import { join, resolve } from 'node:path';

const serviceName = 'BashkarPOSLocalServer';

// Keep SCM disabled until a separate, accepted recovery/health step.
const quiesceScript = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$name = 'BashkarPOSLocalServer'
$config = Join-Path $env:ProgramData 'BashkarPOS\config'
$wrapper = Join-Path $env:ProgramW6432 'Bashkar POS\BashkarPOSLocalServer.exe'
$node = Join-Path $env:ProgramW6432 'Bashkar POS\node.exe'
$managerNode = Join-Path $env:ProgramW6432 'Bashkar POS Update Manager\node.exe'
$expected = [Console]::In.ReadToEnd() | ConvertFrom-Json
if (-not (Test-Path -LiteralPath (Join-Path $config 'update-intent.json')) -or
    -not (Test-Path -LiteralPath (Join-Path $config 'update-guard.json'))) { throw 'UPDATE_GUARD_REQUIRED' }
$intent = Get-Content -LiteralPath (Join-Path $config 'update-intent.json') -Raw | ConvertFrom-Json
$guard = Get-Content -LiteralPath (Join-Path $config 'update-guard.json') -Raw | ConvertFrom-Json
if ($intent.operationId -cne $expected.operationId -or $intent.backupOperationId -cne $expected.backupOperationId -or
    $guard.operationId -cne $expected.operationId) { throw 'UPDATE_GUARD_MISMATCH' }
function ServiceRow { Get-CimInstance Win32_Service -Filter "Name='$name'" }
$service = ServiceRow
if ($null -eq $service) { throw 'UPDATE_SERVICE_MISSING' }
if ($service.PathName.Trim('"') -ine $wrapper -or
    $service.StartName -ine 'NT AUTHORITY\LocalService') { throw 'UPDATE_SERVICE_IDENTITY_INVALID' }
& "$env:SystemRoot\System32\sc.exe" config $name start= disabled | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'UPDATE_SERVICE_DISABLE_FAILED' }
$service = ServiceRow
if ($null -eq $service -or $service.StartMode -ne 'Disabled') { throw 'UPDATE_SERVICE_DISABLE_UNCONFIRMED' }
if ($service.State -ne 'Stopped') {
  Stop-Service -Name $name -ErrorAction Stop
  (Get-Service -Name $name).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
}
for ($attempt = 0; $attempt -lt 2; $attempt++) {
  $service = ServiceRow
  if ($null -eq $service -or $service.StartMode -ne 'Disabled' -or $service.State -ne 'Stopped' -or $service.ProcessId -ne 0) { throw 'UPDATE_SERVICE_STOP_UNCONFIRMED' }
  $remaining = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and ($_.ExecutablePath -ieq $wrapper -or
      (($_.ExecutablePath -ieq $node -or $_.ExecutablePath -ieq $managerNode) -and
        ($_.CommandLine -like '*service-bootstrap.js*' -or $_.CommandLine -like '*server\main.js*' -or
         $_.CommandLine -like '*server\print-worker.js*')))
  })
  if ($remaining.Count -ne 0) { throw 'UPDATE_SERVICE_PROCESS_REMAINING' }
  if ($attempt -eq 0) { Start-Sleep -Seconds 1 }
}
[Console]::Out.Write('SERVICE_QUIESCED')
`;

export function stopWindowsService(operationId: string, backupOperationId: string) {
  if (process.platform !== 'win32') throw new Error('UPDATE_WINDOWS_REQUIRED');
  try {
    const output = execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(quiesceScript, 'utf16le').toString('base64')],
      { input: JSON.stringify({ operationId, backupOperationId }), encoding: 'utf8', timeout: 90000, maxBuffer: 4096, windowsHide: true });
    if (output !== 'SERVICE_QUIESCED') throw new Error('UPDATE_SERVICE_UNCONFIRMED');
  } catch { throw new Error('UPDATE_SERVICE_UNCONFIRMED'); }
}

/** The caller must first persist BACKUP_VERIFIED through a future accepted restore gate. */
export function quiesceVerifiedUpdate(input: {
  journal: UpdateJournal;
  configDir: string;
  operationId: string;
  stopService?: (operationId: string, backupOperationId: string) => void;
  captureInventory?: (configDir: string, appDir: string, operationId: string) => string;
  appDir?: string;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || row.phase !== 'BACKUP_VERIFIED' || !row.backup) {
    throw new Error('UPDATE_BACKUP_NOT_VERIFIED');
  }
  // The marker is durable before changing SCM. A failed stop leaves it in place.
  beginGuardedOperation(input.configDir, row.operationId, row.backup.operationId);
  let stopped = false;
  try {
    (input.stopService ?? stopWindowsService)(row.operationId, row.backup.operationId);
    stopped = true;
    if (process.platform === 'win32' || input.captureInventory) {
      if (!input.appDir && !process.env.ProgramW6432) throw new Error('UPDATE_WINDOWS_REQUIRED');
      if (process.platform === 'win32' && input.appDir &&
          resolve(input.appDir).toLowerCase() !== resolve(process.env.ProgramW6432!, 'Bashkar POS').toLowerCase())
        throw new Error('UPDATE_BINARY_PATH_INVALID');
      (input.captureInventory ?? captureOldBinaryInventory)(input.configDir,
        input.appDir ?? join(process.env.ProgramW6432!, 'Bashkar POS'), row.operationId);
    }
    input.journal.recordServiceQuiesced(row.operationId);
  } catch (error) {
    try { input.journal.markRecoveryRequired(row.operationId,
      stopped ? 'UPDATE_BINARY_INVENTORY_FAILED' : 'UPDATE_SERVICE_UNCONFIRMED'); }
    catch { /* An incomplete journal also blocks a new operation. */ }
    throw error;
  }
  return { serviceName, operationId: row.operationId, backupPath: row.backup.path, state: 'SERVICE_QUIESCED' as const };
}
