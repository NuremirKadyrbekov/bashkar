import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { withVerifiedBackupRestore } from './backup-acceptance';
import { type KeyProtector } from './backup-set';
import { readInstalledSoftwareVersion } from './release-version';
import { assertLocalService } from './update-data-restore';
import { inspectDatabase, assertWindowsServiceStopped } from './update-migration';
import { UpdateJournal } from './update-journal';
import { verifyOldBinaryInventory } from './old-binary-inventory';
import { preMigrationProofName, verifyPreMigrationData } from './verify-pre-migration-data';

const restoreMarkerName = '.update-data-restore.json';
const requiredAppFiles = ['Bashkar POS.exe', 'BashkarPOSLocalServer.exe', 'service.ps1', 'node.exe',
  'BashkarPOSLocalServer.xml', 'Uninstall.exe', join('server', 'main.js'), join('server', 'recovery-quarantine.json')];

function regular(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_PRESTART_FILE_INVALID');
}
function directory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UPDATE_PRESTART_DIRECTORY_INVALID');
}
async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function readMarker(path: string, operationId: string, backupOperationId: string) {
  regular(path);
  const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'backupOperationId,format,instanceId,operationId,softwareVersion' ||
      value.format !== 1 || value.operationId !== operationId || value.backupOperationId !== backupOperationId ||
      typeof value.instanceId !== 'string' || typeof value.softwareVersion !== 'string' ||
      !/^\d+\.\d+\.\d+$/.test(value.softwareVersion)) throw new Error('UPDATE_PRESTART_MARKER_INVALID');
  return { instanceId: value.instanceId, softwareVersion: value.softwareVersion };
}

/** LocalService verifies the exact restored files and old program before any service restart. */
export async function verifyRestoredInstallPrestart(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; appDir: string; operationId: string; protector: KeyProtector;
  assertLocalService?: () => void; assertServiceStopped?: () => void; probeMode?: boolean; testAuthorityPublicKey?: string;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId ||
      !(input.probeMode ? ['SERVICE_PROBE_INTENT', 'SERVICE_PROBE_HEALTHY',
        'RECOVERY_FINALIZE_INTENT', 'RECOVERY_READY_TO_START'].includes(row.phase) :
        ['OLD_BINARY_RESTORED', 'PRE_MIGRATION_DATA_VERIFIED', 'OLD_INSTALL_PRESTART_VERIFIED'].includes(row.phase)) || !row.backup)
    throw new Error('UPDATE_PRESTART_STATE_INVALID');
  const preProof = join(input.dataDir, preMigrationProofName);
  let hasPreProof = false;
  try { lstatSync(preProof); hasPreProof = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (hasPreProof || row.phase === 'PRE_MIGRATION_DATA_VERIFIED') {
    if (!hasPreProof) throw new Error('UPDATE_PRE_MIGRATION_PROOF_MISSING');
    const checked = await verifyPreMigrationData(input);
    if (row.phase === 'PRE_MIGRATION_DATA_VERIFIED') input.journal.recordOldInstallPrestartVerified(row.operationId);
    return { state: 'OLD_INSTALL_PRESTART_VERIFIED' as const, operationId: row.operationId,
      version: checked.version, schemaVersion: checked.schemaVersion };
  }
  if (!isAbsolute(input.appDir) || basename(input.appDir) !== 'Bashkar POS' || basename(input.dataDir) !== 'data')
    throw new Error('UPDATE_PRESTART_PATH_INVALID');
  if (process.platform === 'win32' && (!process.env.ProgramData || !process.env.ProgramW6432 ||
      resolve(input.dataDir).toLowerCase() !== resolve(process.env.ProgramData, 'BashkarPOS', 'data').toLowerCase() ||
      realpathSync(dirname(input.appDir)).toLowerCase() !== resolve(process.env.ProgramW6432).toLowerCase()))
    throw new Error('UPDATE_PRESTART_PATH_INVALID');
  (input.assertLocalService ?? assertLocalService)();
  if (!input.probeMode) (input.assertServiceStopped ?? assertWindowsServiceStopped)();
  directory(input.configDir); directory(input.dataDir); directory(input.appDir);
  const intent = JSON.parse(readFileSync(join(input.configDir, 'update-intent.json'), 'utf8')) as Record<string, unknown>;
  const guard = JSON.parse(readFileSync(join(input.configDir, 'update-guard.json'), 'utf8')) as Record<string, unknown>;
  if (intent.format !== 1 || intent.operationId !== row.operationId || intent.backupOperationId !== row.backup.operationId ||
      guard.format !== 1 || guard.operationId !== row.operationId) throw new Error('UPDATE_GUARD_MISMATCH');
  const marker = readMarker(join(input.dataDir, restoreMarkerName), row.operationId, row.backup.operationId);
  const backupManifest = JSON.parse(readFileSync(join(row.backup.path, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  if (backupManifest.operationId !== row.backup.operationId || backupManifest.schemaVersion !== row.backup.schemaVersion ||
      backupManifest.instanceId !== marker.instanceId || backupManifest.softwareVersion !== marker.softwareVersion ||
      (backupManifest.registrationId !== null && typeof backupManifest.registrationId !== 'string'))
    throw new Error('UPDATE_PRESTART_BACKUP_INVALID');
  for (const name of requiredAppFiles) regular(join(input.appDir, name));
  const failedDir = join(dirname(input.appDir), `Bashkar POS.failed.${row.operationId}`);
  directory(failedDir);
  if (readInstalledSoftwareVersion(join(input.appDir, 'server', 'version.json')) !== marker.softwareVersion ||
      readInstalledSoftwareVersion(join(failedDir, 'server', 'version.json')) !== row.targetVersion)
    throw new Error('UPDATE_PRESTART_VERSION_INVALID');
  if (verifyOldBinaryInventory(input.configDir, input.appDir, row.operationId) !== marker.softwareVersion)
    throw new Error('UPDATE_PRESTART_VERSION_INVALID');
  const restored = inspectDatabase(input.dataDir);
  if (restored.instanceId !== marker.instanceId || restored.schemaVersion !== row.backup.schemaVersion)
    throw new Error('UPDATE_PRESTART_DATABASE_INVALID');
  await withVerifiedBackupRestore({ path: row.backup.path, backupOperationId: row.backup.operationId,
    schemaVersion: row.backup.schemaVersion,
    expectedIdentity: { instanceId: marker.instanceId, registrationId: backupManifest.registrationId as string | null },
    protector: input.protector, testAuthorityPublicKey: input.testAuthorityPublicKey }, async files => {
    const present = readdirSync(input.dataDir);
    const wal = join(input.dataDir, 'pos.sqlite-wal'), shm = join(input.dataDir, 'pos.sqlite-shm');
    if (present.includes('pos.sqlite-wal') || present.includes('pos.sqlite-shm')) {
      if (!present.includes('pos.sqlite-wal') || !present.includes('pos.sqlite-shm')) throw new Error('UPDATE_PRESTART_FILES_MISMATCH');
      regular(wal); regular(shm);
      // Read-only inspection may create these sidecars. A nonempty WAL can hold later writes.
      if (lstatSync(wal).size !== 0) throw new Error('UPDATE_PRESTART_FILES_MISMATCH');
    }
    const actual = present.filter(name => name !== restoreMarkerName && name !== 'pos.sqlite-wal' && name !== 'pos.sqlite-shm').sort();
    const expected = [...files.keys()].sort();
    if (actual.join('\0') !== expected.join('\0')) throw new Error('UPDATE_PRESTART_FILES_MISMATCH');
    for (const [name, bytes] of files) {
      const path = join(input.dataDir, name);
      regular(path);
      if (await digest(path) !== createHash('sha256').update(bytes).digest('hex'))
        throw new Error('UPDATE_PRESTART_FILES_MISMATCH');
    }
  });
  // The proof remains guarded. A later restart step must recheck for changes.
  if (row.phase === 'OLD_BINARY_RESTORED') input.journal.recordOldInstallPrestartVerified(row.operationId);
  return { state: 'OLD_INSTALL_PRESTART_VERIFIED' as const, operationId: row.operationId,
    version: marker.softwareVersion, schemaVersion: restored.schemaVersion };
}
