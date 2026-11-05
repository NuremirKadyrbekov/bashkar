import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UpdateJournal, type UpdateJournalState } from './update-journal';
import type { UpdateJob } from './update-job';
import { readMaintenanceReceipt } from './maintenance-receipt';
import type { MaintenanceResult } from '../server';

export type ManagerAction =
  | 'PREPARE_NEW_OPERATION' | 'RECONCILE_MAINTENANCE' | 'VERIFY_BACKUP_WITH_LOCAL_SERVICE' | 'QUIESCE_SERVICE'
  | 'STAGE_AND_SWITCH_BINARY' | 'RECOVER_BINARY_BEFORE_MIGRATION' | 'VERIFY_PRE_MIGRATION_DATA_WITH_LOCAL_SERVICE' | 'MIGRATE_NEW_BINARY'
  | 'RESTORE_DATA_WITH_LOCAL_SERVICE' | 'RESTORE_OLD_BINARY' | 'VERIFY_OLD_INSTALL_WITH_LOCAL_SERVICE'
  | 'START_GUARDED_SERVICE_PROBE' | 'FINALIZE_RESTORED_INSTALL'
  | 'VERIFY_NEW_INSTALL_PRESTART' | 'START_NEW_SERVICE_PROBE' | 'FINALIZE_NEW_INSTALL'
  | 'MANUAL_RECONCILIATION_REQUIRED' | 'RECOVERY_COMPLETED' | 'NEW_UPDATE_COMPLETED';

const guardedPhases = new Set<UpdateJournalState['phase']>([
  'SERVICE_QUIESCED', 'BINARY_SWITCH_INTENT', 'BINARY_SWITCHED', 'PRE_MIGRATION_RECOVERY_INTENT',
  'PRE_MIGRATION_BINARY_RESTORED', 'PRE_MIGRATION_DATA_VERIFIED', 'MIGRATION_INTENT', 'MIGRATED',
  'NEW_INSTALL_PRESTART_VERIFIED', 'NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY', 'NEW_FINALIZE_INTENT',
  'MIGRATION_RECOVERY_REQUIRED', 'DATA_RESTORE_INTENT', 'DATA_RESTORED', 'OLD_BINARY_RESTORE_INTENT',
  'OLD_BINARY_RESTORED', 'OLD_INSTALL_PRESTART_VERIFIED', 'SERVICE_PROBE_INTENT', 'SERVICE_PROBE_HEALTHY',
  'RECOVERY_FINALIZE_INTENT', 'RECOVERY_READY_TO_START'
]);
function marker(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 1024)
    throw new Error('UPDATE_MANAGER_GUARD_INVALID');
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; }
  catch { throw new Error('UPDATE_MANAGER_GUARD_INVALID'); }
}
function matchingGuards(configDir: string, row: UpdateJournalState) {
  if (!row.backup) throw new Error('UPDATE_MANAGER_JOURNAL_INVALID');
  const intent = marker(join(configDir, 'update-intent.json'));
  const guard = marker(join(configDir, 'update-guard.json'));
  if (Object.keys(intent).sort().join(',') !== 'backupOperationId,format,operationId,phase' ||
      intent.format !== 1 || intent.phase !== 'GUARD_REQUESTED' || intent.operationId !== row.operationId ||
      intent.backupOperationId !== row.backup.operationId ||
      Object.keys(guard).sort().join(',') !== 'format,operationId' || guard.format !== 1 ||
      guard.operationId !== row.operationId) throw new Error('UPDATE_MANAGER_GUARD_INVALID');
}
function markerExists(path: string) {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Read-only routing. No phase is inferred from a fresh Cloud grant on a retry. */
export function planManagerResume(input: { journal: UpdateJournal; configDir: string; job: UpdateJob | null }) {
  const row = input.journal.read();
  if (!row) {
    if (!input.job) throw new Error('UPDATE_JOB_REQUIRED');
    return { operationId: input.job.operationId, phase: null, action: 'PREPARE_NEW_OPERATION' as ManagerAction };
  }
  if (input.job && (input.job.operationId !== row.operationId || input.job.actorId !== row.actorId ||
      input.job.manifestSha256 !== row.manifestSha256 || input.job.grantSha256 !== row.grantSha256))
    throw new Error('UPDATE_MANAGER_JOB_JOURNAL_MISMATCH');
  if (guardedPhases.has(row.phase)) matchingGuards(input.configDir, row);
  if (row.phase === 'RECOVERY_REQUIRED' && row.errorCode === 'UPDATE_BINARY_SWITCH_FAILED' && row.backup)
    matchingGuards(input.configDir, row);
  if (['RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED', 'RECOVERY_COMPLETED', 'NEW_QUARANTINE_HEALTHY',
    'NEW_UPDATE_COMMITTED', 'NEW_UPDATE_COMPLETED'].includes(row.phase) &&
      (markerExists(join(input.configDir, 'update-intent.json')) || markerExists(join(input.configDir, 'update-guard.json'))))
    throw new Error('UPDATE_MANAGER_GUARD_INVALID');
  let action: ManagerAction;
  switch (row.phase) {
    case 'WAITING_FOR_MAINTENANCE': {
      try { action = readMaintenanceReceipt(input.configDir, row.operationId) ? 'RECONCILE_MAINTENANCE' : 'MANUAL_RECONCILIATION_REQUIRED'; }
      catch { action = 'MANUAL_RECONCILIATION_REQUIRED'; }
      break;
    }
    case 'BACKUP_CANDIDATE': action = 'VERIFY_BACKUP_WITH_LOCAL_SERVICE'; break;
    case 'BACKUP_VERIFIED': action = 'QUIESCE_SERVICE'; break;
    case 'SERVICE_QUIESCED': action = 'STAGE_AND_SWITCH_BINARY'; break;
    case 'BINARY_SWITCH_INTENT':
    case 'PRE_MIGRATION_RECOVERY_INTENT': action = 'RECOVER_BINARY_BEFORE_MIGRATION'; break;
    case 'PRE_MIGRATION_BINARY_RESTORED': action = 'VERIFY_PRE_MIGRATION_DATA_WITH_LOCAL_SERVICE'; break;
    case 'PRE_MIGRATION_DATA_VERIFIED': action = 'VERIFY_OLD_INSTALL_WITH_LOCAL_SERVICE'; break;
    case 'BINARY_SWITCHED': action = 'MIGRATE_NEW_BINARY'; break;
    case 'MIGRATION_INTENT':
    case 'MIGRATION_RECOVERY_REQUIRED':
    case 'DATA_RESTORE_INTENT': action = 'RESTORE_DATA_WITH_LOCAL_SERVICE'; break;
    case 'MIGRATED': action = 'VERIFY_NEW_INSTALL_PRESTART'; break;
    case 'NEW_INSTALL_PRESTART_VERIFIED':
    case 'NEW_SERVICE_PROBE_INTENT': action = 'START_NEW_SERVICE_PROBE'; break;
    case 'NEW_SERVICE_PROBE_HEALTHY':
    case 'NEW_FINALIZE_INTENT':
    case 'NEW_READY_TO_START':
    case 'NEW_QUARANTINE_HEALTHY':
    case 'NEW_UPDATE_COMMITTED': action = 'FINALIZE_NEW_INSTALL'; break;
    case 'NEW_UPDATE_COMPLETED': action = 'NEW_UPDATE_COMPLETED'; break;
    case 'DATA_RESTORED':
    case 'OLD_BINARY_RESTORE_INTENT': action = 'RESTORE_OLD_BINARY'; break;
    case 'OLD_BINARY_RESTORED': action = 'VERIFY_OLD_INSTALL_WITH_LOCAL_SERVICE'; break;
    case 'OLD_INSTALL_PRESTART_VERIFIED':
    case 'SERVICE_PROBE_INTENT': action = 'START_GUARDED_SERVICE_PROBE'; break;
    case 'SERVICE_PROBE_HEALTHY':
    case 'RECOVERY_FINALIZE_INTENT':
    case 'RECOVERY_READY_TO_START':
    case 'RECOVERY_QUARANTINE_HEALTHY': action = 'FINALIZE_RESTORED_INSTALL'; break;
    case 'RECOVERY_COMMITTED': action = 'FINALIZE_RESTORED_INSTALL'; break;
    case 'RECOVERY_COMPLETED': action = 'RECOVERY_COMPLETED'; break;
    case 'RECOVERY_REQUIRED': action = row.errorCode === 'UPDATE_BINARY_SWITCH_FAILED' && row.backup
      ? 'RECOVER_BINARY_BEFORE_MIGRATION' : 'MANUAL_RECONCILIATION_REQUIRED'; break;
    default: action = 'MANUAL_RECONCILIATION_REQUIRED';
  }
  return { operationId: row.operationId, phase: row.phase, action };
}

const nextPhases: Partial<Record<ManagerAction, ReadonlySet<UpdateJournalState['phase']>>> = {
  PREPARE_NEW_OPERATION: new Set(['WAITING_FOR_MAINTENANCE', 'BACKUP_CANDIDATE', 'BACKUP_VERIFIED', 'RECOVERY_REQUIRED']),
  RECONCILE_MAINTENANCE: new Set(['BACKUP_CANDIDATE']),
  VERIFY_BACKUP_WITH_LOCAL_SERVICE: new Set(['BACKUP_VERIFIED']),
  QUIESCE_SERVICE: new Set(['SERVICE_QUIESCED', 'RECOVERY_REQUIRED']),
  STAGE_AND_SWITCH_BINARY: new Set(['BINARY_SWITCH_INTENT', 'BINARY_SWITCHED', 'RECOVERY_REQUIRED',
    'PRE_MIGRATION_RECOVERY_INTENT', 'PRE_MIGRATION_BINARY_RESTORED']),
  RECOVER_BINARY_BEFORE_MIGRATION: new Set(['PRE_MIGRATION_RECOVERY_INTENT', 'PRE_MIGRATION_BINARY_RESTORED']),
  VERIFY_PRE_MIGRATION_DATA_WITH_LOCAL_SERVICE: new Set(['PRE_MIGRATION_DATA_VERIFIED']),
  MIGRATE_NEW_BINARY: new Set(['MIGRATION_INTENT', 'MIGRATED', 'MIGRATION_RECOVERY_REQUIRED',
    'PRE_MIGRATION_RECOVERY_INTENT', 'PRE_MIGRATION_BINARY_RESTORED']),
  VERIFY_NEW_INSTALL_PRESTART: new Set(['NEW_INSTALL_PRESTART_VERIFIED']),
  START_NEW_SERVICE_PROBE: new Set(['NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY']),
  FINALIZE_NEW_INSTALL: new Set(['NEW_FINALIZE_INTENT', 'NEW_READY_TO_START', 'NEW_QUARANTINE_HEALTHY',
    'NEW_UPDATE_COMMITTED', 'NEW_UPDATE_COMPLETED', 'NEW_ACTIVATION_FAILED']),
  RESTORE_DATA_WITH_LOCAL_SERVICE: new Set(['DATA_RESTORE_INTENT', 'DATA_RESTORED']),
  RESTORE_OLD_BINARY: new Set(['OLD_BINARY_RESTORE_INTENT', 'OLD_BINARY_RESTORED']),
  VERIFY_OLD_INSTALL_WITH_LOCAL_SERVICE: new Set(['OLD_INSTALL_PRESTART_VERIFIED']),
  START_GUARDED_SERVICE_PROBE: new Set(['SERVICE_PROBE_INTENT', 'SERVICE_PROBE_HEALTHY']),
  FINALIZE_RESTORED_INSTALL: new Set(['RECOVERY_FINALIZE_INTENT', 'RECOVERY_READY_TO_START',
    'RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED', 'RECOVERY_ACTIVATION_FAILED', 'RECOVERY_COMPLETED'])
};

/** A receipt is only a candidate. Independent LocalService verification must follow. */
export async function reconcileMaintenanceReceipt(journal: UpdateJournal, configDir: string, operationId: string,
  requestMaintenance: (operationId: string) => Promise<MaintenanceResult>) {
  const row = journal.read();
  if (!row || row.operationId !== operationId || row.phase !== 'WAITING_FOR_MAINTENANCE')
    throw new Error('UPDATE_OPERATION_STATE_INVALID');
  const result = readMaintenanceReceipt(configDir, operationId);
  if (!result) throw new Error('UPDATE_MAINTENANCE_UNCERTAIN');
  // The LocalService process must recheck the encrypted set and compare live
  // business rows after restart. SYSTEM cannot promote its own file read.
  const checked = await requestMaintenance(operationId);
  if (JSON.stringify(checked) !== JSON.stringify(result)) throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID');
  return journal.recordCandidate(operationId, result);
}

/** One journal step per call. Callers must supply the exact guarded implementation. */
export async function runManagerStep(input: {
  journal: UpdateJournal; configDir: string; job: UpdateJob | null;
  handlers: Partial<Record<ManagerAction, (operationId: string) => void | Promise<void>>>;
}) {
  const before = planManagerResume(input);
  const allowed = nextPhases[before.action];
  if (!allowed) throw new Error('UPDATE_MANAGER_GATE_REQUIRED');
  const handler = input.handlers[before.action];
  if (!handler) throw new Error('UPDATE_MANAGER_ACTION_UNAVAILABLE');
  await handler(before.operationId);
  const after = input.journal.read();
  if (!after || after.operationId !== before.operationId || after.phase === before.phase || !allowed.has(after.phase))
    throw new Error('UPDATE_MANAGER_TRANSITION_UNCONFIRMED');
  return planManagerResume(input);
}

/** A failed migration may return to old files only while its durable intent is absent. */
export async function migrateOrRecoverBeforeIntent(input: {
  journal: UpdateJournal; operationId: string;
  migrate: () => void | Promise<void>; restoreOldBinary: () => void | Promise<void>;
}) {
  const before = input.journal.read();
  if (!before || before.operationId !== input.operationId || before.phase !== 'BINARY_SWITCHED')
    throw new Error('UPDATE_MANAGER_MIGRATION_STATE_INVALID');
  try { await input.migrate(); }
  catch (error) {
    const after = input.journal.read();
    if (!after || after.operationId !== input.operationId || after.phase !== 'BINARY_SWITCHED') throw error;
    await input.restoreOldBinary();
  }
}
