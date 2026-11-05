import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { MaintenanceResult } from '../server';
import type { AuthorizedUpdate } from './update-authorization';

const journalName = 'update-operation.json';
const lockName = 'update-operation.lock';
const tempPrefix = '.update-operation-';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const version = /^\d+\.\d+\.\d+$/;
const hash = /^[0-9a-f]{64}$/;

export type UpdateJournalState = {
  format: 4;
  operationId: string;
  actorId: string;
  authorizationExpiresAt: number;
  grantSha256: string;
  releaseId: string;
  targetVersion: string;
  targetSchema: number;
  manifestSha256: string;
  artifactSha256: string;
  phase: 'WAITING_FOR_MAINTENANCE' | 'BACKUP_CANDIDATE' | 'BACKUP_VERIFIED' | 'SERVICE_QUIESCED' | 'BINARY_SWITCH_INTENT' | 'BINARY_SWITCHED' | 'PRE_MIGRATION_RECOVERY_INTENT' | 'PRE_MIGRATION_BINARY_RESTORED' | 'PRE_MIGRATION_DATA_VERIFIED' | 'MIGRATION_INTENT' | 'MIGRATED' | 'NEW_INSTALL_PRESTART_VERIFIED' | 'NEW_SERVICE_PROBE_INTENT' | 'NEW_SERVICE_PROBE_HEALTHY' | 'NEW_FINALIZE_INTENT' | 'NEW_READY_TO_START' | 'NEW_QUARANTINE_HEALTHY' | 'NEW_UPDATE_COMMITTED' | 'NEW_UPDATE_COMPLETED' | 'NEW_ACTIVATION_FAILED' | 'RECOVERY_REQUIRED' | 'MIGRATION_RECOVERY_REQUIRED' | 'DATA_RESTORE_INTENT' | 'DATA_RESTORED' | 'OLD_BINARY_RESTORE_INTENT' | 'OLD_BINARY_RESTORED' | 'OLD_INSTALL_PRESTART_VERIFIED' | 'SERVICE_PROBE_INTENT' | 'SERVICE_PROBE_HEALTHY' | 'RECOVERY_FINALIZE_INTENT' | 'RECOVERY_READY_TO_START' | 'RECOVERY_QUARANTINE_HEALTHY' | 'RECOVERY_COMMITTED' | 'RECOVERY_ACTIVATION_FAILED' | 'RECOVERY_COMPLETED';
  createdAt: string;
  updatedAt: string;
  backup: { operationId: string; path: string; schemaVersion: number } | null;
  errorCode: string | null;
};

function regular(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_JOURNAL_INVALID');
}

function directory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UPDATE_JOURNAL_DIRECTORY_INVALID');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('UPDATE_JOURNAL_DIRECTORY_UNSAFE');
}

function syncDirectory(path: string) {
  // Windows does not allow opening directories through Node's fs.openSync.
  // Power-loss durability of the rename must be accepted on Windows E2E.
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function validate(value: unknown): UpdateJournalState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('UPDATE_JOURNAL_INVALID');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'actorId,artifactSha256,authorizationExpiresAt,backup,createdAt,errorCode,format,grantSha256,manifestSha256,operationId,phase,releaseId,targetSchema,targetVersion,updatedAt') throw new Error('UPDATE_JOURNAL_INVALID');
  if (row.format !== 4 || typeof row.operationId !== 'string' || !uuid.test(row.operationId) || typeof row.actorId !== 'string' || !uuid.test(row.actorId) || !Number.isSafeInteger(row.authorizationExpiresAt) || Number(row.authorizationExpiresAt) < 0 || typeof row.grantSha256 !== 'string' || !hash.test(row.grantSha256) || typeof row.releaseId !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(row.releaseId) || typeof row.targetVersion !== 'string' || !version.test(row.targetVersion) || !Number.isSafeInteger(row.targetSchema) || Number(row.targetSchema) < 1 || typeof row.manifestSha256 !== 'string' || !hash.test(row.manifestSha256) || typeof row.artifactSha256 !== 'string' || !hash.test(row.artifactSha256)) throw new Error('UPDATE_JOURNAL_INVALID');
  if (typeof row.createdAt !== 'string' || Number.isNaN(Date.parse(row.createdAt)) || typeof row.updatedAt !== 'string' || Number.isNaN(Date.parse(row.updatedAt))) throw new Error('UPDATE_JOURNAL_INVALID');
  if (!['WAITING_FOR_MAINTENANCE', 'BACKUP_CANDIDATE', 'BACKUP_VERIFIED', 'SERVICE_QUIESCED', 'BINARY_SWITCH_INTENT', 'MIGRATED', 'NEW_INSTALL_PRESTART_VERIFIED', 'NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY', 'NEW_FINALIZE_INTENT', 'NEW_READY_TO_START', 'NEW_QUARANTINE_HEALTHY', 'NEW_UPDATE_COMMITTED', 'NEW_UPDATE_COMPLETED', 'NEW_ACTIVATION_FAILED', 'BINARY_SWITCHED', 'PRE_MIGRATION_RECOVERY_INTENT', 'PRE_MIGRATION_BINARY_RESTORED', 'PRE_MIGRATION_DATA_VERIFIED', 'MIGRATION_INTENT', 'RECOVERY_REQUIRED', 'MIGRATION_RECOVERY_REQUIRED', 'DATA_RESTORE_INTENT', 'DATA_RESTORED', 'OLD_BINARY_RESTORE_INTENT', 'OLD_BINARY_RESTORED', 'OLD_INSTALL_PRESTART_VERIFIED', 'SERVICE_PROBE_INTENT', 'SERVICE_PROBE_HEALTHY', 'RECOVERY_FINALIZE_INTENT', 'RECOVERY_READY_TO_START', 'RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED', 'RECOVERY_ACTIVATION_FAILED', 'RECOVERY_COMPLETED'].includes(String(row.phase))) throw new Error('UPDATE_JOURNAL_INVALID');
  if (row.backup !== null) {
    if (!row.backup || typeof row.backup !== 'object' || Array.isArray(row.backup)) throw new Error('UPDATE_JOURNAL_INVALID');
    const backup = row.backup as Record<string, unknown>;
    if (Object.keys(backup).sort().join(',') !== 'operationId,path,schemaVersion' || typeof backup.operationId !== 'string' || !uuid.test(backup.operationId) || typeof backup.path !== 'string' || !isAbsolute(backup.path) || basename(backup.path) !== backup.operationId || !Number.isSafeInteger(backup.schemaVersion) || Number(backup.schemaVersion) < 1) throw new Error('UPDATE_JOURNAL_INVALID');
    if (Number(backup.schemaVersion) > Number(row.targetSchema)) throw new Error('UPDATE_JOURNAL_INVALID');
  }
  if (row.errorCode !== null && (typeof row.errorCode !== 'string' || !/^[A-Z_]+$/.test(row.errorCode))) throw new Error('UPDATE_JOURNAL_INVALID');
  if (row.phase === 'WAITING_FOR_MAINTENANCE' && (row.backup !== null || row.errorCode !== null)) throw new Error('UPDATE_JOURNAL_INVALID');
  if (['BACKUP_CANDIDATE', 'BACKUP_VERIFIED', 'SERVICE_QUIESCED', 'BINARY_SWITCH_INTENT', 'BINARY_SWITCHED', 'PRE_MIGRATION_RECOVERY_INTENT', 'PRE_MIGRATION_BINARY_RESTORED', 'PRE_MIGRATION_DATA_VERIFIED', 'MIGRATION_INTENT', 'MIGRATED', 'NEW_INSTALL_PRESTART_VERIFIED', 'NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY', 'NEW_FINALIZE_INTENT', 'NEW_READY_TO_START', 'NEW_QUARANTINE_HEALTHY', 'NEW_UPDATE_COMMITTED', 'NEW_UPDATE_COMPLETED', 'DATA_RESTORED', 'OLD_BINARY_RESTORE_INTENT', 'OLD_BINARY_RESTORED', 'OLD_INSTALL_PRESTART_VERIFIED', 'SERVICE_PROBE_INTENT', 'SERVICE_PROBE_HEALTHY', 'RECOVERY_FINALIZE_INTENT', 'RECOVERY_READY_TO_START', 'RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED', 'RECOVERY_COMPLETED'].includes(String(row.phase)) && (row.backup === null || row.errorCode !== null)) throw new Error('UPDATE_JOURNAL_INVALID');
  if (row.phase === 'DATA_RESTORE_INTENT' && row.backup === null) throw new Error('UPDATE_JOURNAL_INVALID');
  if (row.phase === 'RECOVERY_REQUIRED' && row.errorCode === null) throw new Error('UPDATE_JOURNAL_INVALID');
  if (row.phase === 'MIGRATION_RECOVERY_REQUIRED' && (row.backup === null || row.errorCode === null)) throw new Error('UPDATE_JOURNAL_INVALID');
  if (row.phase === 'RECOVERY_ACTIVATION_FAILED' && (row.backup === null || row.errorCode !== 'UPDATE_RECOVERY_HEALTH_FAILED')) throw new Error('UPDATE_JOURNAL_INVALID');
  if (row.phase === 'NEW_ACTIVATION_FAILED' && (row.backup === null || row.errorCode !== 'UPDATE_NEW_HEALTH_FAILED')) throw new Error('UPDATE_JOURNAL_INVALID');
  return row as UpdateJournalState;
}

export class UpdateJournal {
  constructor(private readonly configDir: string, private readonly backupRoot: string) {
    directory(configDir);
    directory(backupRoot);
  }

  private path() { return join(this.configDir, journalName); }

  private assertNoIncompleteFiles() {
    if (readdirSync(this.configDir).some(name => name === lockName || name.startsWith(tempPrefix))) throw new Error('UPDATE_JOURNAL_INCOMPLETE');
  }

  private readUnlocked(): UpdateJournalState | null {
    const path = this.path();
    try { lstatSync(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('UPDATE_JOURNAL_INVALID');
    }
    regular(path);
    try { return validate(JSON.parse(readFileSync(path, 'utf8'))); }
    catch { throw new Error('UPDATE_JOURNAL_INVALID'); }
  }

  read() {
    directory(this.configDir);
    this.assertNoIncompleteFiles();
    return this.readUnlocked();
  }

  private withLock<T>(write: () => T): T {
    directory(this.configDir);
    this.assertNoIncompleteFiles();
    const path = join(this.configDir, lockName);
    let fd: number;
    try { fd = openSync(path, 'wx', 0o600); } catch { throw new Error('UPDATE_JOURNAL_BUSY'); }
    try { return write(); }
    finally { closeSync(fd); unlinkSync(path); syncDirectory(this.configDir); }
  }

  private persist(row: UpdateJournalState) {
    const path = join(this.configDir, `${tempPrefix}${randomUUID()}.tmp`);
    writeFileSync(path, JSON.stringify(row), { flag: 'wx', mode: 0o600, flush: true });
    renameSync(path, this.path());
    syncDirectory(this.configDir);
    return row;
  }

  start(authorization: AuthorizedUpdate, nowMs = Date.now()) {
    const { operationId, release, actorId, expiresAt, grantSha256 } = authorization;
    const { manifest, manifestSha256 } = release;
    if (!uuid.test(operationId) || !uuid.test(actorId) || !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(expiresAt) || expiresAt <= nowMs || !hash.test(grantSha256) || !manifest || !version.test(manifest.version) || !/^[a-z0-9_-]{1,80}$/.test(manifest.releaseId) || !hash.test(manifestSha256) || !hash.test(manifest.artifact.sha256)) throw new Error('UPDATE_OPERATION_INVALID');
    return this.withLock(() => {
      if (this.readUnlocked()) throw new Error('UPDATE_OPERATION_EXISTS');
      const now = new Date().toISOString();
      return this.persist({ format: 4, operationId, actorId, authorizationExpiresAt: expiresAt, grantSha256, releaseId: manifest.releaseId, targetVersion: manifest.version, targetSchema: manifest.compatibility.targetSchema, manifestSha256, artifactSha256: manifest.artifact.sha256, phase: 'WAITING_FOR_MAINTENANCE', createdAt: now, updatedAt: now, backup: null, errorCode: null });
    });
  }

  recordCandidate(operationId: string, result: MaintenanceResult) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'WAITING_FOR_MAINTENANCE') throw new Error('UPDATE_OPERATION_STATE_INVALID');
      const backup = result?.backupCandidate;
      if (result.state !== 'MAINTENANCE_READY' || !backup || backup.verified !== true || !uuid.test(backup.operationId) || !isAbsolute(backup.path) || basename(backup.path) !== backup.operationId || !Number.isSafeInteger(result.schemaVersion) || Number(result.schemaVersion) < 1 || Number(result.schemaVersion) > row.targetSchema) throw new Error('UPDATE_BACKUP_CANDIDATE_INVALID');
      directory(backup.path);
      if (resolve(realpathSync(backup.path), '..') !== resolve(realpathSync(this.backupRoot))) throw new Error('UPDATE_BACKUP_CANDIDATE_INVALID');
      regular(join(backup.path, 'manifest.json'));
      return this.persist({ ...row, phase: 'BACKUP_CANDIDATE', updatedAt: new Date().toISOString(), backup: { operationId: backup.operationId, path: backup.path, schemaVersion: result.schemaVersion! } });
    });
  }

  recordBackupVerified(operationId: string, backupOperationId: string, schemaVersion: number) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.phase !== 'BACKUP_CANDIDATE' || row.operationId !== operationId || !row.backup ||
          row.backup.operationId !== backupOperationId || row.backup.schemaVersion !== schemaVersion) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'BACKUP_VERIFIED', updatedAt: new Date().toISOString() });
    });
  }

  recordServiceQuiesced(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'BACKUP_VERIFIED' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'SERVICE_QUIESCED', updatedAt: new Date().toISOString() });
    });
  }

  recordBinarySwitchIntent(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'SERVICE_QUIESCED' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'BINARY_SWITCH_INTENT', updatedAt: new Date().toISOString() });
    });
  }

  recordBinarySwitched(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'BINARY_SWITCH_INTENT' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'BINARY_SWITCHED', updatedAt: new Date().toISOString() });
    });
  }

  recordPreMigrationRecoveryIntent(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || !row.backup ||
          !(['SERVICE_QUIESCED', 'BINARY_SWITCH_INTENT', 'BINARY_SWITCHED'].includes(row.phase) ||
            (row.phase === 'RECOVERY_REQUIRED' && row.errorCode === 'UPDATE_BINARY_SWITCH_FAILED')))
        throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'PRE_MIGRATION_RECOVERY_INTENT',
        updatedAt: new Date().toISOString(), errorCode: null });
    });
  }

  recordPreMigrationBinaryRestored(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'PRE_MIGRATION_RECOVERY_INTENT' || !row.backup)
        throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'PRE_MIGRATION_BINARY_RESTORED', updatedAt: new Date().toISOString() });
    });
  }

  recordPreMigrationDataVerified(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'PRE_MIGRATION_BINARY_RESTORED' || !row.backup)
        throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'PRE_MIGRATION_DATA_VERIFIED', updatedAt: new Date().toISOString() });
    });
  }

  recordMigrationIntent(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'BINARY_SWITCHED' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'MIGRATION_INTENT', updatedAt: new Date().toISOString() });
    });
  }

  recordMigrated(operationId: string, schemaVersion: number) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'MIGRATION_INTENT' || row.targetSchema !== schemaVersion || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'MIGRATED', updatedAt: new Date().toISOString() });
    });
  }

  recordNewInstallPrestartVerified(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'MIGRATED' || !row.backup)
        throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'NEW_INSTALL_PRESTART_VERIFIED', updatedAt: new Date().toISOString() });
    });
  }

  recordNewServiceProbeIntent(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'NEW_INSTALL_PRESTART_VERIFIED' || !row.backup)
        throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'NEW_SERVICE_PROBE_INTENT', updatedAt: new Date().toISOString() });
    });
  }

  recordNewServiceProbeHealthy(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'NEW_SERVICE_PROBE_INTENT' || !row.backup)
        throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'NEW_SERVICE_PROBE_HEALTHY', updatedAt: new Date().toISOString() });
    });
  }

  private advanceNew(operationId: string, from: UpdateJournalState['phase'], to: UpdateJournalState['phase']) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== from || !row.backup)
        throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: to, updatedAt: new Date().toISOString() });
    });
  }

  recordNewFinalizeIntent(operationId: string) { return this.advanceNew(operationId, 'NEW_SERVICE_PROBE_HEALTHY', 'NEW_FINALIZE_INTENT'); }
  recordNewReadyToStart(operationId: string) { return this.advanceNew(operationId, 'NEW_FINALIZE_INTENT', 'NEW_READY_TO_START'); }
  recordNewQuarantineHealthy(operationId: string) { return this.advanceNew(operationId, 'NEW_READY_TO_START', 'NEW_QUARANTINE_HEALTHY'); }
  recordNewUpdateCommitted(operationId: string) { return this.advanceNew(operationId, 'NEW_QUARANTINE_HEALTHY', 'NEW_UPDATE_COMMITTED'); }
  recordNewUpdateCompleted(operationId: string) { return this.advanceNew(operationId, 'NEW_UPDATE_COMMITTED', 'NEW_UPDATE_COMPLETED'); }

  recordNewActivationFailed(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || !row.backup ||
          !['NEW_READY_TO_START', 'NEW_QUARANTINE_HEALTHY', 'NEW_UPDATE_COMMITTED', 'NEW_UPDATE_COMPLETED'].includes(row.phase))
        throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'NEW_ACTIVATION_FAILED',
        updatedAt: new Date().toISOString(), errorCode: 'UPDATE_NEW_HEALTH_FAILED' });
    });
  }

  recordDataRestoreIntent(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || !row.backup || !['MIGRATION_INTENT', 'MIGRATED', 'NEW_INSTALL_PRESTART_VERIFIED', 'NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY', 'MIGRATION_RECOVERY_REQUIRED'].includes(row.phase)) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'DATA_RESTORE_INTENT', updatedAt: new Date().toISOString() });
    });
  }

  recordDataRestored(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'DATA_RESTORE_INTENT' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'DATA_RESTORED', updatedAt: new Date().toISOString(), errorCode: null });
    });
  }

  recordOldBinaryRestoreIntent(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'DATA_RESTORED' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'OLD_BINARY_RESTORE_INTENT', updatedAt: new Date().toISOString() });
    });
  }

  recordOldBinaryRestored(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'OLD_BINARY_RESTORE_INTENT' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'OLD_BINARY_RESTORED', updatedAt: new Date().toISOString() });
    });
  }

  recordOldInstallPrestartVerified(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || !['OLD_BINARY_RESTORED', 'PRE_MIGRATION_DATA_VERIFIED'].includes(row.phase) || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'OLD_INSTALL_PRESTART_VERIFIED', updatedAt: new Date().toISOString() });
    });
  }

  recordServiceProbeIntent(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'OLD_INSTALL_PRESTART_VERIFIED' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'SERVICE_PROBE_INTENT', updatedAt: new Date().toISOString() });
    });
  }

  recordServiceProbeHealthy(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'SERVICE_PROBE_INTENT' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'SERVICE_PROBE_HEALTHY', updatedAt: new Date().toISOString() });
    });
  }

  recordRecoveryFinalizeIntent(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'SERVICE_PROBE_HEALTHY' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'RECOVERY_FINALIZE_INTENT', updatedAt: new Date().toISOString() });
    });
  }

  recordRecoveryReadyToStart(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'RECOVERY_FINALIZE_INTENT' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'RECOVERY_READY_TO_START', updatedAt: new Date().toISOString() });
    });
  }

  recordRecoveryQuarantineHealthy(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'RECOVERY_READY_TO_START' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'RECOVERY_QUARANTINE_HEALTHY', updatedAt: new Date().toISOString() });
    });
  }

  recordRecoveryCompleted(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'RECOVERY_COMMITTED' || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'RECOVERY_COMPLETED', updatedAt: new Date().toISOString() });
    });
  }

  recordRecoveryCommitted(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || row.phase !== 'RECOVERY_QUARANTINE_HEALTHY' || !row.backup)
        throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'RECOVERY_COMMITTED', updatedAt: new Date().toISOString() });
    });
  }

  recordRecoveryActivationFailed(operationId: string) {
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId || !['RECOVERY_READY_TO_START', 'RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED', 'RECOVERY_COMPLETED'].includes(row.phase) || !row.backup) throw new Error('UPDATE_OPERATION_STATE_INVALID');
      return this.persist({ ...row, phase: 'RECOVERY_ACTIVATION_FAILED',
        updatedAt: new Date().toISOString(), errorCode: 'UPDATE_RECOVERY_HEALTH_FAILED' });
    });
  }

  markRecoveryRequired(operationId: string, errorCode: string) {
    if (!/^[A-Z_]+$/.test(errorCode)) throw new Error('UPDATE_ERROR_CODE_INVALID');
    return this.withLock(() => {
      const row = this.readUnlocked();
      if (!row || row.operationId !== operationId ||
          ['RECOVERY_REQUIRED', 'MIGRATION_RECOVERY_REQUIRED', 'DATA_RESTORE_INTENT', 'DATA_RESTORED',
            'NEW_INSTALL_PRESTART_VERIFIED', 'NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY',
            'NEW_FINALIZE_INTENT', 'NEW_READY_TO_START', 'NEW_QUARANTINE_HEALTHY', 'NEW_UPDATE_COMMITTED', 'NEW_UPDATE_COMPLETED', 'NEW_ACTIVATION_FAILED',
            'PRE_MIGRATION_RECOVERY_INTENT', 'PRE_MIGRATION_BINARY_RESTORED', 'PRE_MIGRATION_DATA_VERIFIED',
            'OLD_BINARY_RESTORE_INTENT', 'OLD_BINARY_RESTORED', 'OLD_INSTALL_PRESTART_VERIFIED',
            'SERVICE_PROBE_INTENT', 'SERVICE_PROBE_HEALTHY', 'RECOVERY_FINALIZE_INTENT',
            'RECOVERY_READY_TO_START', 'RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED', 'RECOVERY_ACTIVATION_FAILED', 'RECOVERY_COMPLETED'].includes(row.phase))
        throw new Error('UPDATE_OPERATION_STATE_INVALID');
      const phase = ['MIGRATION_INTENT', 'MIGRATED'].includes(row.phase) ? 'MIGRATION_RECOVERY_REQUIRED' : 'RECOVERY_REQUIRED';
      return this.persist({ ...row, phase, updatedAt: new Date().toISOString(), errorCode });
    });
  }
}
