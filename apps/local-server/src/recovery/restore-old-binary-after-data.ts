import { lstatSync, readFileSync, realpathSync, renameSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { readInstalledSoftwareVersion } from './release-version';
import { inspectDatabase, assertWindowsServiceStopped } from './update-migration';
import { UpdateJournal } from './update-journal';
import { verifyOldBinaryInventory } from './old-binary-inventory';

function exists(path: string) {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function directory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UPDATE_OLD_BINARY_DIRECTORY_INVALID');
  return stat;
}
function file(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_OLD_BINARY_FILE_INVALID');
}
function version(dir: string) {
  directory(dir);
  for (const name of ['Bashkar POS.exe', 'BashkarPOSLocalServer.exe', 'service.ps1', 'node.exe',
    'BashkarPOSLocalServer.xml', 'Uninstall.exe', join('server', 'main.js')]) file(join(dir, name));
  return readInstalledSoftwareVersion(join(dir, 'server', 'version.json'));
}

/** Reconcile old program files only after LocalService has restored the old data. Guard stays active. */
export function restoreOldBinaryAfterData(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; appDir: string; operationId: string;
  assertServiceStopped?: () => void; move?: (from: string, to: string) => void;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || !row.backup ||
      !['DATA_RESTORED', 'OLD_BINARY_RESTORE_INTENT'].includes(row.phase)) throw new Error('UPDATE_OLD_BINARY_RESTORE_DENIED');
  if (!isAbsolute(input.appDir) || basename(input.appDir) !== 'Bashkar POS') throw new Error('UPDATE_OLD_BINARY_PATH_INVALID');
  const parent = realpathSync(dirname(input.appDir));
  if (process.platform === 'win32' && (!process.env.ProgramW6432 || parent.toLowerCase() !== resolve(process.env.ProgramW6432).toLowerCase() ||
      !process.env.ProgramData || resolve(input.dataDir).toLowerCase() !== resolve(process.env.ProgramData, 'BashkarPOS', 'data').toLowerCase()))
    throw new Error('UPDATE_OLD_BINARY_PATH_INVALID');
  const app = join(parent, 'Bashkar POS'), previous = join(parent, `Bashkar POS.previous.${row.operationId}`),
    failed = join(parent, `Bashkar POS.failed.${row.operationId}`);
  const intent = JSON.parse(readFileSync(join(input.configDir, 'update-intent.json'), 'utf8')) as Record<string, unknown>;
  const guard = JSON.parse(readFileSync(join(input.configDir, 'update-guard.json'), 'utf8')) as Record<string, unknown>;
  if (intent.format !== 1 || intent.operationId !== row.operationId || intent.backupOperationId !== row.backup.operationId ||
      guard.format !== 1 || guard.operationId !== row.operationId) throw new Error('UPDATE_GUARD_MISMATCH');
  (input.assertServiceStopped ?? assertWindowsServiceStopped)();
  file(join(input.dataDir, '.update-data-restore.json'));
  const restoredMarker = JSON.parse(readFileSync(join(input.dataDir, '.update-data-restore.json'), 'utf8')) as Record<string, unknown>;
  const restored = inspectDatabase(input.dataDir);
  if (Object.keys(restoredMarker).sort().join(',') !== 'backupOperationId,format,instanceId,operationId,softwareVersion' ||
      restoredMarker.format !== 1 || restoredMarker.operationId !== row.operationId ||
      restoredMarker.backupOperationId !== row.backup.operationId || restoredMarker.instanceId !== restored.instanceId ||
      restored.schemaVersion !== row.backup.schemaVersion) throw new Error('UPDATE_OLD_BINARY_DATA_INVALID');
  const move = input.move ?? renameSync;
  const appExists = !!exists(app), previousExists = !!exists(previous), failedExists = !!exists(failed);
  const oldVersion = restoredMarker.softwareVersion;
  if (typeof oldVersion !== 'string') throw new Error('UPDATE_OLD_BINARY_DATA_INVALID');
  if (!/^\d+\.\d+\.\d+$/.test(oldVersion) || oldVersion === row.targetVersion) throw new Error('UPDATE_OLD_BINARY_BACKUP_INVALID');
  if (row.phase === 'DATA_RESTORED') {
    if (!appExists || !previousExists || failedExists || version(app) !== row.targetVersion || version(previous) !== oldVersion ||
        directory(app).dev !== directory(previous).dev) throw new Error('UPDATE_OLD_BINARY_RECONCILIATION_REQUIRED');
    verifyOldBinaryInventory(input.configDir, previous, row.operationId);
    input.journal.recordOldBinaryRestoreIntent(row.operationId);
    move(app, failed);
    move(previous, app);
  } else if (appExists && previousExists && !failedExists) {
    if (version(app) !== row.targetVersion || version(previous) !== oldVersion || directory(app).dev !== directory(previous).dev)
      throw new Error('UPDATE_OLD_BINARY_RECONCILIATION_REQUIRED');
    verifyOldBinaryInventory(input.configDir, previous, row.operationId);
    move(app, failed);
    move(previous, app);
  } else if (!appExists && previousExists && failedExists) {
    if (version(previous) !== oldVersion || version(failed) !== row.targetVersion || directory(previous).dev !== directory(failed).dev)
      throw new Error('UPDATE_OLD_BINARY_RECONCILIATION_REQUIRED');
    verifyOldBinaryInventory(input.configDir, previous, row.operationId);
    move(previous, app);
  } else if (!(appExists && !previousExists && failedExists)) {
    throw new Error('UPDATE_OLD_BINARY_RECONCILIATION_REQUIRED');
  }
  if (version(app) !== oldVersion || !exists(failed) || version(failed) !== row.targetVersion || exists(previous))
    throw new Error('UPDATE_OLD_BINARY_RECONCILIATION_REQUIRED');
  verifyOldBinaryInventory(input.configDir, app, row.operationId);
  return { state: 'OLD_BINARY_RESTORED_GUARDED' as const,
    operationId: input.journal.recordOldBinaryRestored(row.operationId).operationId };
}
