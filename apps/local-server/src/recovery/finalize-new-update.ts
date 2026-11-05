import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { windowsFinalizeControls } from './finalize-restored-recovery';
import { startGuardedNewServiceProbe } from './new-service-probe';
import { verifyOldBinaryInventory } from './old-binary-inventory';
import { verifyStagedPayload } from './payload-manifest';
import { restoredDataDigest } from './recovery-probe';
import { guardedStartupMode } from './startup-guard';
import { inspectDatabase, assertWindowsServiceStopped } from './update-migration';
import { UpdateJournal } from './update-journal';
import { stopWindowsService } from './windows-service-control';

function syncDirectory(path: string) {
  if (process.platform === 'win32') return; // Windows rename durability requires E2E acceptance.
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function marker(path: string) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 1024)
      throw new Error('UPDATE_NEW_FINALIZE_GUARD_INVALID');
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Keep every start closed to sales until two independent quarantine boots pass. */
export async function finalizeNewUpdate(input: {
  journal: UpdateJournal; configDir: string; backupRoot: string; dataDir: string; appDir: string;
  operationId: string; releaseTrust: { publicKey: string }; port?: number;
  probe?: () => Promise<{ dataDigest: string; version: string; schemaVersion: number }>;
  stopService?: (operationId: string, backupOperationId: string) => void;
  assertServiceStopped?: () => void; startService?: () => void; restartService?: () => void;
  stopUnhealthyService?: () => void; enableAutomatic?: () => void;
  requestHealth?: (port: number, version: string, schemaVersion: number, quarantine: boolean) => Promise<void>;
}) {
  let row = input.journal.read();
  if (!row || row.operationId !== input.operationId || !row.backup ||
      !['NEW_SERVICE_PROBE_HEALTHY', 'NEW_FINALIZE_INTENT', 'NEW_READY_TO_START',
        'NEW_QUARANTINE_HEALTHY', 'NEW_UPDATE_COMMITTED', 'NEW_UPDATE_COMPLETED'].includes(row.phase))
    throw new Error('UPDATE_NEW_FINALIZE_STATE_INVALID');
  if (basename(input.appDir) !== 'Bashkar POS' || basename(input.dataDir) !== 'data' ||
      (process.platform === 'win32' && (!process.env.ProgramData || !process.env.ProgramW6432 ||
        resolve(input.dataDir).toLowerCase() !== resolve(process.env.ProgramData, 'BashkarPOS', 'data').toLowerCase() ||
        resolve(dirname(input.appDir)).toLowerCase() !== resolve(process.env.ProgramW6432).toLowerCase())))
    throw new Error('UPDATE_NEW_FINALIZE_PATH_INVALID');
  const capability = join(input.appDir, 'server', 'recovery-quarantine.json');
  const capabilityStat = lstatSync(capability);
  const capabilityValue = JSON.parse(readFileSync(capability, 'utf8')) as Record<string, unknown>;
  if (!capabilityStat.isFile() || capabilityStat.isSymbolicLink() || capabilityStat.nlink !== 1 ||
      Object.keys(capabilityValue).sort().join(',') !== 'capability,format' ||
      capabilityValue.format !== 1 || capabilityValue.capability !== 'recovery-quarantine-v1')
    throw new Error('UPDATE_NEW_QUARANTINE_REQUIRED');
  const port = input.port ?? 3210;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('UPDATE_NEW_FINALIZE_PORT_INVALID');
  const intentPath = join(input.configDir, 'update-intent.json');
  const guardPath = join(input.configDir, 'update-guard.json');
  let intent = marker(intentPath), guard = marker(guardPath);
  if (intent && (Object.keys(intent).sort().join(',') !== 'backupOperationId,format,operationId,phase' ||
      intent.format !== 1 || intent.phase !== 'GUARD_REQUESTED' || intent.operationId !== row.operationId ||
      intent.backupOperationId !== row.backup.operationId)) throw new Error('UPDATE_NEW_FINALIZE_GUARD_INVALID');
  if (guard && (Object.keys(guard).sort().join(',') !== 'format,operationId' ||
      guard.format !== 1 || guard.operationId !== row.operationId)) throw new Error('UPDATE_NEW_FINALIZE_GUARD_INVALID');
  if (guard && !intent) throw new Error('UPDATE_NEW_FINALIZE_GUARD_INVALID');
  if (['NEW_SERVICE_PROBE_HEALTHY', 'NEW_FINALIZE_INTENT'].includes(row.phase) && (!guard || !intent))
    throw new Error('UPDATE_GUARD_ACTIVE');
  if (['NEW_QUARANTINE_HEALTHY', 'NEW_UPDATE_COMMITTED', 'NEW_UPDATE_COMPLETED'].includes(row.phase) && (guard || intent))
    throw new Error('UPDATE_NEW_FINALIZE_GUARD_INVALID');
  if (row.phase === 'NEW_READY_TO_START' && intent && !guard) {
    writeFileSync(guardPath, JSON.stringify({ format: 1, operationId: row.operationId }),
      { flag: 'wx', mode: 0o600, flush: true });
    syncDirectory(input.configDir);
    guard = marker(guardPath);
  }
  if (intent && guard) {
    const proof = await (input.probe ?? (() => startGuardedNewServiceProbe({ journal: input.journal,
      configDir: input.configDir, dataDir: input.dataDir, appDir: input.appDir,
      operationId: input.operationId, releaseTrust: input.releaseTrust, port })))();
    if (proof.version !== row.targetVersion || proof.schemaVersion !== row.targetSchema ||
        !/^[0-9a-f]{64}$/.test(proof.dataDigest)) throw new Error('UPDATE_NEW_FINALIZE_PROBE_INVALID');
    if (row.phase === 'NEW_SERVICE_PROBE_HEALTHY') input.journal.recordNewFinalizeIntent(row.operationId);
    (input.stopService ?? stopWindowsService)(row.operationId, row.backup.operationId);
    (input.assertServiceStopped ?? assertWindowsServiceStopped)();
    if (restoredDataDigest(input.dataDir) !== proof.dataDigest) throw new Error('UPDATE_NEW_FINALIZE_DATA_CHANGED');
    await verifyStagedPayload(input.appDir, input.releaseTrust,
      { releaseId: row.releaseId, version: row.targetVersion }, ['BashkarPOSLocalServer.xml', 'Uninstall.exe']);
    verifyOldBinaryInventory(input.configDir, join(dirname(input.appDir), `Bashkar POS.previous.${row.operationId}`), row.operationId);
    if (inspectDatabase(input.dataDir).schemaVersion !== row.targetSchema) throw new Error('UPDATE_NEW_FINALIZE_SCHEMA_CHANGED');
    if (row.phase !== 'NEW_READY_TO_START') input.journal.recordNewReadyToStart(row.operationId);
    unlinkSync(guardPath); syncDirectory(input.configDir);
    unlinkSync(intentPath); syncDirectory(input.configDir);
    intent = null; guard = null;
  }
  if (intent || guard || guardedStartupMode(input.configDir, input.backupRoot).kind !== 'NORMAL')
    throw new Error('UPDATE_NEW_FINALIZE_GUARD_INVALID');
  try {
    await verifyStagedPayload(input.appDir, input.releaseTrust,
      { releaseId: row.releaseId, version: row.targetVersion }, ['BashkarPOSLocalServer.xml', 'Uninstall.exe']);
    verifyOldBinaryInventory(input.configDir, join(dirname(input.appDir), `Bashkar POS.previous.${row.operationId}`), row.operationId);
    if (['NEW_READY_TO_START', 'NEW_QUARANTINE_HEALTHY'].includes(row.phase) &&
        inspectDatabase(input.dataDir).schemaVersion !== row.targetSchema)
      throw new Error('UPDATE_NEW_FINALIZE_SCHEMA_CHANGED');
    if (input.journal.read()?.phase === 'NEW_READY_TO_START') {
      (input.startService ?? windowsFinalizeControls.start)();
      await (input.requestHealth ?? windowsFinalizeControls.health)(port, row.targetVersion, row.targetSchema, true);
      input.journal.recordNewQuarantineHealthy(row.operationId);
    }
    if (input.journal.read()?.phase === 'NEW_QUARANTINE_HEALTHY') {
      (input.restartService ?? windowsFinalizeControls.restart)();
      await (input.requestHealth ?? windowsFinalizeControls.health)(port, row.targetVersion, row.targetSchema, true);
      input.journal.recordNewUpdateCommitted(row.operationId);
    }
    if (input.journal.read()?.phase === 'NEW_UPDATE_COMMITTED') {
      (input.restartService ?? windowsFinalizeControls.restart)();
      await (input.requestHealth ?? windowsFinalizeControls.health)(port, row.targetVersion, row.targetSchema, false);
      input.journal.recordNewUpdateCompleted(row.operationId);
    }
    row = input.journal.read()!;
    if (row.phase !== 'NEW_UPDATE_COMPLETED') throw new Error('UPDATE_NEW_FINALIZE_STATE_INVALID');
    (input.startService ?? windowsFinalizeControls.start)();
    await (input.requestHealth ?? windowsFinalizeControls.health)(port, row.targetVersion, row.targetSchema, false);
    (input.enableAutomatic ?? windowsFinalizeControls.automatic)();
  } catch (error) {
    const phase = input.journal.read()?.phase;
    if (phase && ['NEW_READY_TO_START', 'NEW_QUARANTINE_HEALTHY', 'NEW_UPDATE_COMMITTED', 'NEW_UPDATE_COMPLETED'].includes(phase))
      input.journal.recordNewActivationFailed(row.operationId);
    (input.stopUnhealthyService ?? windowsFinalizeControls.stop)();
    throw error;
  }
  return { state: 'NEW_UPDATE_COMPLETED' as const, operationId: row.operationId };
}
