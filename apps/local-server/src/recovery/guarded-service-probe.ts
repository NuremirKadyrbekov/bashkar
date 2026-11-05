import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { verifyOldBinaryInventory } from './old-binary-inventory';
import { verifyRecoveryProbeResponse } from './recovery-probe';
import { inspectDatabase } from './update-migration';
import { UpdateJournal } from './update-journal';
import { preMigrationProofName } from './verify-pre-migration-data';

const script = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$name = 'BashkarPOSLocalServer'
$app = Join-Path $env:ProgramW6432 'Bashkar POS'
$manager = Join-Path $env:ProgramW6432 'Bashkar POS Update Manager'
$wrapper = Join-Path $app "$name.exe"
$xmlPath = Join-Path $app "$name.xml"
$expectedNode = Join-Path $manager 'node.exe'
$expectedBootstrap = Join-Path $manager 'service-bootstrap.js'
$config = Join-Path $env:ProgramData 'BashkarPOS\config'
$intent = Get-Content -LiteralPath (Join-Path $config 'update-intent.json') -Raw | ConvertFrom-Json
$guard = Get-Content -LiteralPath (Join-Path $config 'update-guard.json') -Raw | ConvertFrom-Json
if ($intent.operationId -cne $inputData.operationId -or $intent.backupOperationId -cne $inputData.backupOperationId -or
    $guard.operationId -cne $inputData.operationId) { throw 'UPDATE_GUARD_MISMATCH' }
$xml = [xml](Get-Content -LiteralPath $xmlPath -Raw)
if ($xml.service.executable -ine $expectedNode -or $xml.service.arguments.Trim('"') -ine $expectedBootstrap) {
  throw 'UPDATE_SERVICE_BOOTSTRAP_REQUIRED'
}
function ServiceRow { Get-CimInstance Win32_Service -Filter "Name='$name'" }
$service = ServiceRow
if ($null -eq $service -or $service.PathName.Trim('"') -ine $wrapper -or
    $service.StartName -ine 'NT AUTHORITY\LocalService') { throw 'UPDATE_SERVICE_IDENTITY_INVALID' }
if ($service.StartMode -eq 'Disabled') {
  if ($service.State -ne 'Stopped' -or $service.ProcessId -ne 0) { throw 'UPDATE_SERVICE_STATE_INVALID' }
  & "$env:SystemRoot\System32\sc.exe" config $name start= demand | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'UPDATE_SERVICE_MANUAL_FAILED' }
  $service = ServiceRow
}
if ($service.StartMode -ne 'Manual') { throw 'UPDATE_SERVICE_MANUAL_UNCONFIRMED' }
if ($service.State -ne 'Running') {
  if ($service.State -ne 'Stopped' -or $service.ProcessId -ne 0) { throw 'UPDATE_SERVICE_STATE_INVALID' }
  Start-Service -Name $name -ErrorAction Stop
  (Get-Service -Name $name).WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
}
$service = ServiceRow
if ($service.StartMode -ne 'Manual' -or $service.State -ne 'Running' -or $service.ProcessId -eq 0) {
  throw 'UPDATE_SERVICE_START_UNCONFIRMED'
}
[Console]::Out.Write('SERVICE_PROBE_RUNNING')
`;

export function startWindowsProbeService(operationId: string, backupOperationId: string) {
  if (process.platform !== 'win32') throw new Error('UPDATE_WINDOWS_REQUIRED');
  try {
    const output = execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { input: JSON.stringify({ operationId, backupOperationId }), encoding: 'utf8', timeout: 90000,
        maxBuffer: 4096, windowsHide: true });
    if (output !== 'SERVICE_PROBE_RUNNING') throw new Error();
  } catch { throw new Error('UPDATE_SERVICE_PROBE_START_FAILED'); }
}

export function assertInstalledStableBootstrap() {
  if (process.platform !== 'win32' || !process.env.ProgramW6432) throw new Error('UPDATE_WINDOWS_REQUIRED');
  const appDir = join(process.env.ProgramW6432, 'Bashkar POS');
  const managerDir = join(process.env.ProgramW6432, 'Bashkar POS Update Manager');
  const nodePath = join(managerDir, 'node.exe');
  const bootstrapPath = join(managerDir, 'service-bootstrap.js');
  for (const path of [nodePath, bootstrapPath]) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_SERVICE_BOOTSTRAP_REQUIRED');
  }
  const xmlPath = join(appDir, 'BashkarPOSLocalServer.xml');
  const stat = lstatSync(xmlPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_SERVICE_BOOTSTRAP_REQUIRED');
  const xml = readFileSync(xmlPath, 'utf8');
  const element = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`, 'i').exec(xml)?.[1];
  const decode = (value: string) => value.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
  if (element('executable') === undefined || element('arguments') === undefined ||
      decode(element('executable')!).toLowerCase() !== nodePath.toLowerCase() ||
      decode(element('arguments')!).replace(/^"|"$/g, '').toLowerCase() !== bootstrapPath.toLowerCase())
    throw new Error('UPDATE_SERVICE_BOOTSTRAP_REQUIRED');
}

export async function requestProbe(port: number, nonce: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/system/update-probe`, {
    method: 'GET', headers: { 'x-bashkar-probe-nonce': nonce }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (response.status !== 200) throw new Error('UPDATE_PROBE_UNAVAILABLE');
  return response.json() as Promise<unknown>;
}

/** Start only the stable, non-operational recovery probe. Both guards remain on disk. */
export async function startGuardedServiceProbe(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; appDir: string; operationId: string; port?: number;
  startService?: (operationId: string, backupOperationId: string) => void;
  requestHealth?: (nonce: string, port: number) => Promise<unknown>;
  assertBootstrap?: () => void;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || !row.backup ||
      !['OLD_INSTALL_PRESTART_VERIFIED', 'SERVICE_PROBE_INTENT', 'SERVICE_PROBE_HEALTHY',
        'RECOVERY_FINALIZE_INTENT', 'RECOVERY_READY_TO_START'].includes(row.phase))
    throw new Error('UPDATE_SERVICE_PROBE_STATE_INVALID');
  if (basename(input.appDir) !== 'Bashkar POS' || basename(input.dataDir) !== 'data' ||
      (process.platform === 'win32' && (!process.env.ProgramData || !process.env.ProgramW6432 ||
        resolve(input.dataDir).toLowerCase() !== resolve(process.env.ProgramData, 'BashkarPOS', 'data').toLowerCase() ||
        realpathSync(dirname(input.appDir)).toLowerCase() !== resolve(process.env.ProgramW6432).toLowerCase())))
    throw new Error('UPDATE_SERVICE_PROBE_PATH_INVALID');
  const intent = JSON.parse(readFileSync(join(input.configDir, 'update-intent.json'), 'utf8')) as Record<string, unknown>;
  const guard = JSON.parse(readFileSync(join(input.configDir, 'update-guard.json'), 'utf8')) as Record<string, unknown>;
  if (intent.format !== 1 || intent.operationId !== row.operationId || intent.backupOperationId !== row.backup.operationId ||
      guard.format !== 1 || guard.operationId !== row.operationId) throw new Error('UPDATE_GUARD_MISMATCH');
  const restoredPath = join(input.dataDir, '.update-data-restore.json');
  const prePath = join(input.dataDir, preMigrationProofName);
  const exists = (path: string) => {
    try { lstatSync(path); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  };
  if (exists(restoredPath) === exists(prePath)) throw new Error('UPDATE_SERVICE_PROBE_DATA_INVALID');
  const markerPath = exists(restoredPath) ? restoredPath : prePath;
  const markerStat = lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1) throw new Error('UPDATE_SERVICE_PROBE_DATA_INVALID');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown>;
  const data = inspectDatabase(input.dataDir);
  if (marker.operationId !== row.operationId || marker.backupOperationId !== row.backup.operationId ||
      marker.instanceId !== data.instanceId || data.schemaVersion !== row.backup.schemaVersion ||
      marker.softwareVersion !== verifyOldBinaryInventory(input.configDir, input.appDir, row.operationId))
    throw new Error('UPDATE_SERVICE_PROBE_DATA_INVALID');
  const port = input.port ?? 3210;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('UPDATE_SERVICE_PROBE_PORT_INVALID');
  (input.assertBootstrap ?? assertInstalledStableBootstrap)();
  if (row.phase === 'OLD_INSTALL_PRESTART_VERIFIED') input.journal.recordServiceProbeIntent(row.operationId);
  (input.startService ?? startWindowsProbeService)(row.operationId, row.backup.operationId);
  const nonce = randomBytes(32).toString('base64url');
  let lastError: unknown;
  const deadline = Date.now() + (input.requestHealth ? 1 : 60000);
  do {
    try {
      const response = await (input.requestHealth ?? ((value, targetPort) => requestProbe(targetPort, value)))(nonce, port);
      const verified = verifyRecoveryProbeResponse(input.configDir, response, { nonce, operationId: row.operationId,
        version: marker.softwareVersion as string, schemaVersion: row.backup.schemaVersion });
      if (row.phase === 'SERVICE_PROBE_INTENT' || row.phase === 'OLD_INSTALL_PRESTART_VERIFIED')
        input.journal.recordServiceProbeHealthy(row.operationId);
      return { state: 'SERVICE_PROBE_HEALTHY' as const, operationId: row.operationId,
        version: marker.softwareVersion as string, schemaVersion: row.backup.schemaVersion,
        dataDigest: verified.dataDigest };
    } catch (error) { lastError = error; }
    if (Date.now() < deadline) await new Promise(resolveDelay => setTimeout(resolveDelay, 1000));
  } while (Date.now() < deadline);
  throw lastError instanceof Error ? lastError : new Error('UPDATE_SERVICE_PROBE_FAILED');
}
