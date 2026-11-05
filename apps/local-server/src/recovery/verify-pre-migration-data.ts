import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { withVerifiedBackupRestore } from './backup-acceptance';
import type { KeyProtector } from './backup-set';
import { verifyOldBinaryInventory } from './old-binary-inventory';
import { assertBusinessUnchanged, assertLocalService } from './update-data-restore';
import { inspectDatabase, assertWindowsServiceStopped } from './update-migration';
import { UpdateJournal } from './update-journal';

export const preMigrationProofName = '.update-pre-migration-verified.json';
const transient = new Set(['instance-lock.sqlite', 'instance-lock.sqlite-journal', 'server.lock']);
function optional(path: string) {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function regular(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_PRE_MIGRATION_FILE_INVALID');
  return stat;
}
function syncDirectory(path: string) {
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** LocalService proves that the stopped, unmigrated data still has every confirmed row in the encrypted Backup Set. */
export async function verifyPreMigrationData(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; appDir: string; operationId: string;
  protector: KeyProtector; assertLocalService?: () => void; assertServiceStopped?: () => void;
  probeMode?: boolean; testAuthorityPublicKey?: string;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || !row.backup ||
      !['PRE_MIGRATION_BINARY_RESTORED', 'PRE_MIGRATION_DATA_VERIFIED', 'OLD_INSTALL_PRESTART_VERIFIED',
        'SERVICE_PROBE_INTENT', 'SERVICE_PROBE_HEALTHY', 'RECOVERY_FINALIZE_INTENT',
        'RECOVERY_READY_TO_START'].includes(row.phase)) throw new Error('UPDATE_PRE_MIGRATION_STATE_INVALID');
  if (basename(input.appDir) !== 'Bashkar POS' || basename(input.dataDir) !== 'data' ||
      (process.platform === 'win32' && (!process.env.ProgramData || !process.env.ProgramW6432 ||
        resolve(input.dataDir).toLowerCase() !== resolve(process.env.ProgramData, 'BashkarPOS', 'data').toLowerCase() ||
        resolve(dirname(input.appDir)).toLowerCase() !== resolve(process.env.ProgramW6432).toLowerCase())))
    throw new Error('UPDATE_PRE_MIGRATION_PATH_INVALID');
  (input.assertLocalService ?? assertLocalService)();
  if (!input.probeMode) (input.assertServiceStopped ?? assertWindowsServiceStopped)();
  const intent = JSON.parse(readFileSync(join(input.configDir, 'update-intent.json'), 'utf8')) as Record<string, unknown>;
  const guard = JSON.parse(readFileSync(join(input.configDir, 'update-guard.json'), 'utf8')) as Record<string, unknown>;
  if (intent.format !== 1 || intent.operationId !== row.operationId ||
      intent.backupOperationId !== row.backup.operationId || guard.format !== 1 ||
      guard.operationId !== row.operationId) throw new Error('UPDATE_GUARD_MISMATCH');
  if (optional(join(input.dataDir, '.update-data-restore.json'))) throw new Error('UPDATE_PRE_MIGRATION_PROOF_CONFLICT');
  const oldVersion = verifyOldBinaryInventory(input.configDir, input.appDir, row.operationId);
  regular(join(row.backup.path, 'manifest.json'));
  const manifest = JSON.parse(readFileSync(join(row.backup.path, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const current = inspectDatabase(input.dataDir);
  if (manifest.operationId !== row.backup.operationId || manifest.softwareVersion !== oldVersion ||
      manifest.schemaVersion !== row.backup.schemaVersion || manifest.instanceId !== current.instanceId ||
      (manifest.registrationId !== null && typeof manifest.registrationId !== 'string') ||
      current.schemaVersion !== row.backup.schemaVersion)
    throw new Error('UPDATE_PRE_MIGRATION_BACKUP_MISMATCH');
  const proofPath = join(input.dataDir, preMigrationProofName);
  const expectedProof = { format: 1, operationId: row.operationId, backupOperationId: row.backup.operationId,
    instanceId: current.instanceId, softwareVersion: oldVersion };
  const existing = optional(proofPath);
  if (existing) {
    regular(proofPath);
    const proof = JSON.parse(readFileSync(proofPath, 'utf8')) as Record<string, unknown>;
    if (Object.keys(proof).sort().join(',') !== Object.keys(expectedProof).sort().join(',') ||
        Object.entries(expectedProof).some(([key, value]) => proof[key] !== value))
      throw new Error('UPDATE_PRE_MIGRATION_PROOF_INVALID');
  } else if (row.phase !== 'PRE_MIGRATION_BINARY_RESTORED') {
    throw new Error('UPDATE_PRE_MIGRATION_PROOF_MISSING');
  }
  await withVerifiedBackupRestore({ path: row.backup.path, backupOperationId: row.backup.operationId,
    schemaVersion: row.backup.schemaVersion,
    expectedIdentity: { instanceId: current.instanceId, registrationId: manifest.registrationId as string | null },
    protector: input.protector, testAuthorityPublicKey: input.testAuthorityPublicKey }, files => {
    const actual = readdirSync(input.dataDir);
    const expected = new Set(files.keys());
    if (actual.includes('pos.sqlite-wal') !== actual.includes('pos.sqlite-shm'))
      throw new Error('UPDATE_PRE_MIGRATION_FILES_CHANGED');
    for (const name of actual) {
      if (name === preMigrationProofName) continue;
      const stat = regular(join(input.dataDir, name));
      if (transient.has(name)) continue;
      if (name === 'pos.sqlite-wal' || name === 'pos.sqlite-shm') {
        if (name === 'pos.sqlite-wal' && stat.size !== 0) throw new Error('UPDATE_PRE_MIGRATION_WAL_ACTIVE');
        continue;
      }
      if (!expected.has(name)) throw new Error('UPDATE_PRE_MIGRATION_FILES_CHANGED');
    }
    for (const [name, bytes] of files) {
      if (!actual.includes(name)) throw new Error('UPDATE_PRE_MIGRATION_FILES_CHANGED');
      regular(join(input.dataDir, name));
      if (name === 'pos.sqlite') assertBusinessUnchanged(input.dataDir, bytes);
      else if (createHash('sha256').update(readFileSync(join(input.dataDir, name))).digest('hex') !==
          createHash('sha256').update(bytes).digest('hex')) throw new Error('UPDATE_PRE_MIGRATION_FILES_CHANGED');
    }
  });
  if (!existing) {
    writeFileSync(proofPath, JSON.stringify(expectedProof), { flag: 'wx', mode: 0o600, flush: true });
    syncDirectory(input.dataDir);
  }
  if (row.phase === 'PRE_MIGRATION_BINARY_RESTORED') input.journal.recordPreMigrationDataVerified(row.operationId);
  return { state: 'PRE_MIGRATION_DATA_VERIFIED' as const, operationId: row.operationId,
    version: oldVersion, schemaVersion: current.schemaVersion, instanceId: current.instanceId };
}
