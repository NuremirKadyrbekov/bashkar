import { constants, copyFileSync, lstatSync, readFileSync, realpathSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { UpdateJournal } from './update-journal';
import { verifyStagedPayload } from './payload-manifest';
import { assertWindowsServiceStopped } from './update-migration';
import { captureOldBinaryInventory, verifyOldBinaryInventory } from './old-binary-inventory';

function exists(path: string) {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function directory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UPDATE_BINARY_DIRECTORY_INVALID');
  return stat;
}
function file(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_BINARY_FILE_INVALID');
}
function paths(appDir: string, operationId: string) {
  if (!isAbsolute(appDir) || basename(appDir) !== 'Bashkar POS' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) throw new Error('UPDATE_BINARY_PATH_INVALID');
  const parent = realpathSync(dirname(appDir));
  if (process.platform === 'win32' && (!process.env.ProgramW6432 || parent.toLowerCase() !== resolve(process.env.ProgramW6432).toLowerCase())) throw new Error('UPDATE_BINARY_PATH_INVALID');
  return { app: join(parent, 'Bashkar POS'), incoming: join(parent, `Bashkar POS.incoming.${operationId}`), previous: join(parent, `Bashkar POS.previous.${operationId}`) };
}
function assertGuard(configDir: string, operationId: string, backupOperationId: string) {
  const intent = JSON.parse(readFileSync(join(configDir, 'update-intent.json'), 'utf8')) as Record<string, unknown>;
  const guard = JSON.parse(readFileSync(join(configDir, 'update-guard.json'), 'utf8')) as Record<string, unknown>;
  if (intent.operationId !== operationId || intent.backupOperationId !== backupOperationId || guard.operationId !== operationId) throw new Error('UPDATE_GUARD_MISMATCH');
}

/** Switch only a complete payload signed by the pinned release publisher. */
export async function switchVerifiedBinary(input: {
  journal: UpdateJournal; configDir: string; appDir: string; operationId: string;
  releaseTrust: { publicKey: string }; release: { releaseId: string; version: string };
  assertServiceStopped?: () => void;
  move?: (from: string, to: string) => void;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || row.phase !== 'SERVICE_QUIESCED' || !row.backup) throw new Error('UPDATE_SERVICE_NOT_QUIESCED');
  if (row.releaseId !== input.release.releaseId || row.targetVersion !== input.release.version) throw new Error('UPDATE_PAYLOAD_RELEASE_MISMATCH');
  assertGuard(input.configDir, row.operationId, row.backup.operationId);
  const target = paths(input.appDir, row.operationId);
  const current = directory(target.app), next = directory(target.incoming);
  if (current.dev !== next.dev || exists(target.previous)) throw new Error('UPDATE_BINARY_STAGE_INVALID');
  for (const name of ['Bashkar POS.exe', 'BashkarPOSLocalServer.exe', 'service.ps1', 'node.exe', join('server', 'main.js')]) file(join(target.incoming, name));
  const copied = ['BashkarPOSLocalServer.xml', 'Uninstall.exe'];
  await verifyStagedPayload(target.incoming, input.releaseTrust, input.release, copied);
  (input.assertServiceStopped ?? (process.platform === 'win32' ? assertWindowsServiceStopped : () => {}))();
  captureOldBinaryInventory(input.configDir, target.app, row.operationId);
  for (const name of copied) {
    const source = join(target.app, name), destination = join(target.incoming, name);
    file(source);
    if (!exists(destination)) copyFileSync(source, destination, constants.COPYFILE_EXCL);
    file(destination);
    const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    if (digest(source) !== digest(destination)) throw new Error('UPDATE_BINARY_COPY_MISMATCH');
  }
  // Recheck after validation, before writing the durable switch intent.
  directory(target.app); directory(target.incoming);
  if (exists(target.previous)) throw new Error('UPDATE_BINARY_STAGE_INVALID');
  verifyOldBinaryInventory(input.configDir, target.app, row.operationId);
  (input.assertServiceStopped ?? (process.platform === 'win32' ? assertWindowsServiceStopped : () => {}))();
  input.journal.recordBinarySwitchIntent(row.operationId);
  const move = input.move ?? renameSync;
  try {
    move(target.app, target.previous);
    move(target.incoming, target.app);
    verifyOldBinaryInventory(input.configDir, target.previous, row.operationId);
    return input.journal.recordBinarySwitched(row.operationId);
  } catch (error) {
    // The journal/guard keep the system closed if either move or this undo fails.
    if (!exists(target.app) && exists(target.previous)) {
      try { move(target.previous, target.app); } catch { /* Explicit recovery retains the old directory. */ }
    }
    try { input.journal.markRecoveryRequired(row.operationId, 'UPDATE_BINARY_SWITCH_FAILED'); }
    catch { /* A damaged journal is itself a blocker. */ }
    throw error;
  }
}

/** Recover the old program only before any database migration has begun. */
export function restoreOldBinaryBeforeMigration(input: {
  journal: UpdateJournal; configDir: string; appDir: string; operationId: string;
  assertServiceStopped?: () => void;
  move?: (from: string, to: string) => void;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || !row.backup ||
      !(['SERVICE_QUIESCED', 'BINARY_SWITCH_INTENT', 'BINARY_SWITCHED', 'PRE_MIGRATION_RECOVERY_INTENT',
        'PRE_MIGRATION_BINARY_RESTORED'].includes(row.phase) ||
        (row.phase === 'RECOVERY_REQUIRED' && row.errorCode === 'UPDATE_BINARY_SWITCH_FAILED'))) throw new Error('UPDATE_BINARY_RECOVERY_DENIED');
  assertGuard(input.configDir, row.operationId, row.backup.operationId);
  const target = paths(input.appDir, row.operationId);
  const app = exists(target.app), previous = exists(target.previous), incoming = exists(target.incoming);
  (input.assertServiceStopped ?? (process.platform === 'win32' ? assertWindowsServiceStopped : () => {}))();
  const move = input.move ?? renameSync;
  if (row.phase === 'PRE_MIGRATION_BINARY_RESTORED') {
    if (previous || !app) throw new Error('UPDATE_BINARY_RECOVERY_AMBIGUOUS');
    verifyOldBinaryInventory(input.configDir, target.app, row.operationId);
    return { state: 'PRE_MIGRATION_BINARY_RESTORED' as const, operationId: row.operationId };
  }
  if (row.phase !== 'PRE_MIGRATION_RECOVERY_INTENT') input.journal.recordPreMigrationRecoveryIntent(row.operationId);
  if (previous) {
    directory(target.previous);
    verifyOldBinaryInventory(input.configDir, target.previous, row.operationId);
    if (app && !incoming) { directory(target.app); move(target.app, target.incoming); }
    else if (app || !incoming) throw new Error('UPDATE_BINARY_RECOVERY_AMBIGUOUS');
    move(target.previous, target.app);
  } else if (!app) throw new Error('UPDATE_BINARY_RECOVERY_AMBIGUOUS');
  directory(target.app);
  verifyOldBinaryInventory(input.configDir, target.app, row.operationId);
  return { state: 'PRE_MIGRATION_BINARY_RESTORED' as const,
    operationId: input.journal.recordPreMigrationBinaryRestored(row.operationId).operationId };
}
