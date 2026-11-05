import Database from 'better-sqlite3';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { inspectDatabase, assertWindowsServiceStopped } from './update-migration';
import { readInstalledSoftwareVersion } from './release-version';
import { UpdateJournal } from './update-journal';

function lstatOptional(path: string) {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

function guarded(configDir: string, operationId: string, backupOperationId: string) {
  const intent = JSON.parse(readFileSync(join(configDir, 'update-intent.json'), 'utf8')) as Record<string, unknown>;
  const guard = JSON.parse(readFileSync(join(configDir, 'update-guard.json'), 'utf8')) as Record<string, unknown>;
  if (intent.format !== 1 || intent.operationId !== operationId || intent.backupOperationId !== backupOperationId ||
      guard.format !== 1 || guard.operationId !== operationId) throw new Error('UPDATE_GUARD_MISMATCH');
}

/** Classify recovery without reading the LocalService DPAPI key or changing files. */
export function classifyGuardedRecovery(input: { journal: UpdateJournal; configDir: string; operationId: string }) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || !row.backup) throw new Error('UPDATE_RECOVERY_STATE_INVALID');
  if (row.phase === 'RECOVERY_ACTIVATION_FAILED')
    return { kind: 'MANUAL_RECONCILIATION_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (row.phase === 'RECOVERY_COMPLETED')
    return { kind: 'RECOVERY_COMPLETED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (['RECOVERY_READY_TO_START', 'RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED'].includes(row.phase) &&
      !lstatOptional(join(input.configDir, 'update-intent.json')) && !lstatOptional(join(input.configDir, 'update-guard.json')))
    return { kind: 'NORMAL_SERVICE_START_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (row.phase === 'RECOVERY_READY_TO_START' &&
      lstatOptional(join(input.configDir, 'update-intent.json')) && !lstatOptional(join(input.configDir, 'update-guard.json')))
    return { kind: 'RECOVERY_GUARD_RECONSTRUCTION_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  guarded(input.configDir, row.operationId, row.backup.operationId);
  if (['PRE_MIGRATION_RECOVERY_INTENT', 'BINARY_SWITCH_INTENT'].includes(row.phase) ||
      (row.phase === 'RECOVERY_REQUIRED' && row.errorCode === 'UPDATE_BINARY_SWITCH_FAILED'))
    return { kind: 'OLD_BINARY_RECOVERY_ALLOWED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (row.phase === 'PRE_MIGRATION_BINARY_RESTORED')
    return { kind: 'PRE_MIGRATION_DATA_VERIFICATION_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (row.phase === 'PRE_MIGRATION_DATA_VERIFIED')
    return { kind: 'OLD_INSTALL_HEALTH_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (['NEW_INSTALL_PRESTART_VERIFIED', 'NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY'].includes(row.phase))
    return { kind: 'NEW_INSTALL_RUNTIME_HEALTH_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (row.phase === 'MIGRATED')
    return { kind: 'NEW_INSTALL_PRESTART_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (['MIGRATION_INTENT', 'MIGRATION_RECOVERY_REQUIRED', 'DATA_RESTORE_INTENT'].includes(row.phase))
    return { kind: 'LOCAL_SERVICE_DATA_RESTORE_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (['DATA_RESTORED', 'OLD_BINARY_RESTORE_INTENT'].includes(row.phase))
    return { kind: 'OLD_BINARY_RECONCILIATION_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (row.phase === 'OLD_BINARY_RESTORED')
    return { kind: 'OLD_INSTALL_HEALTH_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (row.phase === 'OLD_INSTALL_PRESTART_VERIFIED')
    return { kind: 'RECOVERY_FINALIZATION_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (['SERVICE_PROBE_INTENT', 'SERVICE_PROBE_HEALTHY'].includes(row.phase))
    return { kind: 'SERVICE_PROBE_RECONCILIATION_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (row.phase === 'RECOVERY_FINALIZE_INTENT' || row.phase === 'RECOVERY_READY_TO_START')
    return { kind: 'RECOVERY_FINALIZATION_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  if (['BINARY_SWITCH_INTENT', 'BINARY_SWITCHED'].includes(row.phase) ||
      (row.phase === 'RECOVERY_REQUIRED' && row.errorCode === 'UPDATE_BINARY_SWITCH_FAILED'))
    return { kind: 'OLD_BINARY_RECOVERY_ALLOWED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
  return { kind: 'MANUAL_RECONCILIATION_REQUIRED' as const, operationId: row.operationId, backupOperationId: row.backup.operationId };
}

/** Read-only prestart check. It cannot authorize guard removal or service startup. */
export function inspectMigratedInstall(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; appDir: string; operationId: string;
  assertServiceStopped?: () => void; probeMode?: boolean;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId ||
      !(input.probeMode ? ['NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY', 'NEW_FINALIZE_INTENT', 'NEW_READY_TO_START'].includes(row.phase) :
        ['MIGRATED', 'NEW_INSTALL_PRESTART_VERIFIED'].includes(row.phase)) || !row.backup)
    throw new Error('UPDATE_HEALTH_STATE_INVALID');
  guarded(input.configDir, row.operationId, row.backup.operationId);
  if (basename(input.appDir) !== 'Bashkar POS' ||
      (process.platform === 'win32' && (!process.env.ProgramW6432 || resolve(dirname(input.appDir)).toLowerCase() !== resolve(process.env.ProgramW6432).toLowerCase())))
    throw new Error('UPDATE_HEALTH_PATH_INVALID');
  const previous = join(dirname(input.appDir), `Bashkar POS.previous.${row.operationId}`);
  const stat = lstatSync(previous);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UPDATE_PREVIOUS_BINARY_MISSING');
  if (!input.probeMode) (input.assertServiceStopped ?? assertWindowsServiceStopped)();
  if (readInstalledSoftwareVersion(join(input.appDir, 'server', 'version.json')) !== row.targetVersion)
    throw new Error('UPDATE_HEALTH_VERSION_INVALID');
  const checked = inspectDatabase(input.dataDir);
  if (checked.schemaVersion !== row.targetSchema) throw new Error('UPDATE_HEALTH_SCHEMA_INVALID');
  const db = new Database(join(input.dataDir, 'pos.sqlite'), { readonly: true, fileMustExist: true });
  try {
    const counts: Record<string, number> = {};
    for (const table of ['shifts', 'orders', 'payments', 'print_jobs', 'outbox']) {
      const result = db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
      if (!Number.isSafeInteger(result.count) || result.count < 0) throw new Error('UPDATE_HEALTH_DATABASE_INVALID');
      counts[table] = result.count;
    }
    return { operationId: row.operationId, version: row.targetVersion, schemaVersion: checked.schemaVersion,
      instanceId: checked.instanceId, counts, state: 'PRESTART_CHECKED' as const };
  } finally { db.close(); }
}
