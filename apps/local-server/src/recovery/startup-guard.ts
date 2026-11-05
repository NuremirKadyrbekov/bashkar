import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UpdateJournal } from './update-journal';

const guardName = 'update-guard.json';
const intentName = 'update-intent.json';
const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertConfigDirectory(configDir: string) {
  try {
    const directory = lstatSync(configDir);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('UPDATE_GUARD_UNAVAILABLE');
  } catch {
    throw new Error('UPDATE_GUARD_UNAVAILABLE');
  }
}

function markerExists(path: string) {
  try { lstatSync(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error('UPDATE_GUARD_UNAVAILABLE');
  }
}

// The intent is written first. Even if power fails before the guard is written,
// the older server must not open SQLite until recovery inspects the operation.
export function beginGuardedOperation(configDir: string, operationId: string, backupOperationId: string) {
  if (!operationIdPattern.test(operationId) || !operationIdPattern.test(backupOperationId)) throw new Error('UPDATE_OPERATION_ID_INVALID');
  assertConfigDirectory(configDir);
  const intent = join(configDir, intentName), guard = join(configDir, guardName);
  if (markerExists(intent) || markerExists(guard)) throw new Error('UPDATE_GUARD_ACTIVE');
  writeFileSync(intent, JSON.stringify({ format: 1, operationId, backupOperationId, phase: 'GUARD_REQUESTED' }), { flag: 'wx', mode: 0o600, flush: true });
  writeFileSync(guard, JSON.stringify({ format: 1, operationId }), { flag: 'wx', mode: 0o600, flush: true });
}

// Presence alone blocks startup. Damaged or incomplete markers are blockers.
export function assertStartupAllowed(configDir: string, backupRoot?: string) {
  assertConfigDirectory(configDir);
  if (markerExists(join(configDir, intentName)) || markerExists(join(configDir, guardName))) throw new Error('UPDATE_GUARD_ACTIVE');
  if (backupRoot && guardedStartupMode(configDir, backupRoot).kind !== 'NORMAL') throw new Error('UPDATE_GUARD_ACTIVE');
}

function readMarker(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 1024)
    throw new Error('UPDATE_GUARD_INVALID');
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** The stable service bootstrap may enter only a non-operational recovery probe. */
export function guardedStartupMode(configDir: string, backupRoot: string) {
  assertConfigDirectory(configDir);
  const intentPath = join(configDir, intentName), guardPath = join(configDir, guardName);
  const intentPresent = markerExists(intentPath), guardPresent = markerExists(guardPath);
  if (!intentPresent && !guardPresent) {
    const journal = new UpdateJournal(configDir, backupRoot).read();
    if (journal && !['WAITING_FOR_MAINTENANCE', 'BACKUP_CANDIDATE', 'BACKUP_VERIFIED',
      'RECOVERY_READY_TO_START', 'RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED', 'RECOVERY_COMPLETED',
      'NEW_READY_TO_START', 'NEW_QUARANTINE_HEALTHY', 'NEW_UPDATE_COMMITTED', 'NEW_UPDATE_COMPLETED'].includes(journal.phase)) throw new Error('UPDATE_GUARD_ACTIVE');
    return { kind: 'NORMAL' as const };
  }
  if (!intentPresent || !guardPresent) throw new Error('UPDATE_GUARD_ACTIVE');
  const intent = readMarker(intentPath), guard = readMarker(guardPath);
  const journal = new UpdateJournal(configDir, backupRoot).read();
  if (!journal || !journal.backup || !['SERVICE_PROBE_INTENT', 'SERVICE_PROBE_HEALTHY',
    'RECOVERY_FINALIZE_INTENT', 'RECOVERY_READY_TO_START',
    'NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY', 'NEW_FINALIZE_INTENT', 'NEW_READY_TO_START'].includes(journal.phase) ||
      intent.format !== 1 || intent.phase !== 'GUARD_REQUESTED' || intent.operationId !== journal.operationId ||
      intent.backupOperationId !== journal.backup.operationId || guard.format !== 1 ||
      guard.operationId !== journal.operationId) throw new Error('UPDATE_GUARD_ACTIVE');
  if (['NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY', 'NEW_FINALIZE_INTENT', 'NEW_READY_TO_START'].includes(journal.phase))
    return { kind: 'NEW_PROBE' as const, operationId: journal.operationId };
  return { kind: 'PROBE' as const, operationId: journal.operationId };
}
