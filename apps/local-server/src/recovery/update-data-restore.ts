import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { withVerifiedBackupRestore } from './backup-acceptance';
import { type KeyProtector, verifyProtectedFiles } from './backup-set';
import { inspectDatabase, assertWindowsServiceStopped } from './update-migration';
import { UpdateJournal } from './update-journal';

const markerName = '.update-data-restore.json';
const allowed = new Set(['pos.sqlite', 'installation.json', 'branch-display.json', 'waiter-http.json', 'device-public.pem',
  'device-key.dpapi', 'pin-keys.dpapi', 'pin-keys.marker', 'web-keys.dpapi', 'web-keys.marker', 'tls-keys.dpapi', 'tls-keys.marker']);
const transient = new Set(['pos.sqlite-wal', 'pos.sqlite-shm', 'pos.sqlite-journal', 'instance-lock.sqlite', 'instance-lock.sqlite-journal', 'server.lock']);

function stat(path: string) {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function directory(path: string) {
  const value = lstatSync(path);
  if (!value.isDirectory() || value.isSymbolicLink()) throw new Error('UPDATE_RESTORE_DIRECTORY_INVALID');
}
function regular(path: string) {
  const value = lstatSync(path);
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1) throw new Error('UPDATE_RESTORE_FILE_INVALID');
}
function syncDirectory(path: string) {
  if (process.platform === 'win32') return; // Windows rename durability needs power-loss acceptance.
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
async function digestFile(path: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
function marker(path: string, operationId: string, backupOperationId: string, softwareVersion: string) {
  regular(path);
  const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'backupOperationId,format,instanceId,operationId,softwareVersion' || value.format !== 1 ||
      value.operationId !== operationId || value.backupOperationId !== backupOperationId ||
      value.softwareVersion !== softwareVersion || typeof value.instanceId !== 'string') throw new Error('UPDATE_RESTORE_MARKER_INVALID');
  return value.instanceId;
}
function guard(configDir: string, operationId: string, backupOperationId: string) {
  const intent = JSON.parse(readFileSync(join(configDir, 'update-intent.json'), 'utf8')) as Record<string, unknown>;
  const active = JSON.parse(readFileSync(join(configDir, 'update-guard.json'), 'utf8')) as Record<string, unknown>;
  if (intent.format !== 1 || intent.operationId !== operationId || intent.backupOperationId !== backupOperationId ||
      active.format !== 1 || active.operationId !== operationId) throw new Error('UPDATE_GUARD_MISMATCH');
}
function installationId(dir: string) {
  const path = join(dir, 'installation.json');
  regular(path);
  const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (value.format !== 1 || typeof value.id !== 'string') throw new Error('UPDATE_RESTORE_IDENTITY_INVALID');
  return value.id;
}
function quoted(name: string) { return `"${name.replaceAll('"', '""')}"`; }
function businessDigest(db: Database.Database, table: string) {
  const columns = db.prepare(`PRAGMA table_info(${quoted(table)})`).all() as { name: string }[];
  if (!columns.length) throw new Error('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
  const digest = createHash('sha256');
  for (const row of db.prepare(`SELECT * FROM ${quoted(table)} ORDER BY rowid`).iterate()) {
    digest.update(JSON.stringify(row)); digest.update('\n');
  }
  return { columns: columns.map(column => column.name).join(','), digest: digest.digest('hex') };
}
function userTables(db: Database.Database) {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name")
    .all() as { name: string }[]).map(row => row.name);
}
export function assertBusinessUnchanged(dataDir: string, bytes: Buffer) {
  // The stored WAL header is restored immediately after the in-memory read.
  const wal = bytes[18] === 2 && bytes[19] === 2;
  if (wal) { bytes[18] = 1; bytes[19] = 1; }
  let backup: Database.Database | undefined;
  let current: Database.Database | undefined;
  try {
    backup = new Database(bytes, { readonly: true });
    current = new Database(join(dataDir, 'pos.sqlite'), { readonly: true, fileMustExist: true });
    if (current.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
    const beforeTables = userTables(backup), afterTables = userTables(current);
    const afterSet = new Set(afterTables), beforeSet = new Set(beforeTables);
    for (const table of beforeTables) if (!afterSet.has(table)) throw new Error('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
    for (const table of afterTables) {
      if (!beforeSet.has(table) && current.prepare(`SELECT 1 FROM ${quoted(table)} LIMIT 1`).get())
        throw new Error('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
    }
    for (const table of beforeTables) {
      const before = businessDigest(backup, table), after = businessDigest(current, table);
      if (before.columns !== after.columns || before.digest !== after.digest) throw new Error('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'UPDATE_RESTORE_RECONCILIATION_REQUIRED') throw error;
    throw new Error('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
  } finally { backup?.close(); current?.close(); if (wal) { bytes[18] = 2; bytes[19] = 2; } }
}
export function assertLocalService() {
  if (process.platform !== 'win32') throw new Error('UPDATE_WINDOWS_REQUIRED');
  const script = "if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-19'){exit 9}";
  try { execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10000, windowsHide: true, stdio: 'ignore' }); }
  catch { throw new Error('UPDATE_RESTORE_IDENTITY_REQUIRED'); }
}

/** Restore the verified Backup Set under LocalService. Never removes the guard or starts a binary. */
export async function restoreGuardedData(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; operationId: string; protector: KeyProtector;
  assertServiceStopped?: () => void; assertLocalService?: () => void; testAuthorityPublicKey?: string;
  testProtectedFiles?: (dir: string, activated: boolean) => void;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || !row.backup ||
      !['MIGRATION_INTENT', 'MIGRATED', 'NEW_INSTALL_PRESTART_VERIFIED', 'NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY', 'MIGRATION_RECOVERY_REQUIRED', 'DATA_RESTORE_INTENT'].includes(row.phase))
    throw new Error('UPDATE_RESTORE_STATE_INVALID');
  guard(input.configDir, row.operationId, row.backup.operationId);
  if (basename(input.dataDir) !== 'data' ||
      (process.platform === 'win32' && (!process.env.ProgramData || resolve(input.dataDir).toLowerCase() !== resolve(process.env.ProgramData, 'BashkarPOS', 'data').toLowerCase())))
    throw new Error('UPDATE_RESTORE_PATH_INVALID');
  directory(dirname(input.dataDir));
  directory(input.dataDir);
  (input.assertLocalService ?? assertLocalService)();
  (input.assertServiceStopped ?? assertWindowsServiceStopped)();
  // This phase is never entered after the POS service has been restarted.
  // Future service-start orchestration must add a durable phase before SCM changes.
  const backupManifest = JSON.parse(readFileSync(join(row.backup.path, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  if (backupManifest.operationId !== row.backup.operationId || backupManifest.schemaVersion !== row.backup.schemaVersion ||
      (backupManifest.registrationId !== null && typeof backupManifest.registrationId !== 'string') ||
      typeof backupManifest.softwareVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(backupManifest.softwareVersion)) throw new Error('UPDATE_RESTORE_BACKUP_MISMATCH');
  const softwareVersion = backupManifest.softwareVersion;
  const restoreMarker = join(input.dataDir, markerName);
  const instanceId = stat(restoreMarker) ? marker(restoreMarker, row.operationId, row.backup.operationId, softwareVersion) : installationId(input.dataDir);
  const result = await withVerifiedBackupRestore({ path: row.backup.path, backupOperationId: row.backup.operationId,
    schemaVersion: row.backup.schemaVersion, expectedIdentity: {
      instanceId,
      registrationId: backupManifest.registrationId as string | null
    }, protector: input.protector, testAuthorityPublicKey: input.testAuthorityPublicKey }, async files => {
    const present = readdirSync(input.dataDir);
    for (const name of present) {
      if (name === markerName) continue;
      if (!allowed.has(name) && !transient.has(name)) throw new Error('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
      regular(join(input.dataDir, name));
    }
    if (stat(restoreMarker)) {
      if (row.phase !== 'DATA_RESTORE_INTENT') throw new Error('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
      if (marker(restoreMarker, row.operationId, row.backup!.operationId, softwareVersion) !== instanceId) throw new Error('UPDATE_RESTORE_IDENTITY_INVALID');
    } else {
      const source = files.get('pos.sqlite');
      if (!source) throw new Error('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
      assertBusinessUnchanged(input.dataDir, source);
      if (row.phase !== 'DATA_RESTORE_INTENT') input.journal.recordDataRestoreIntent(row.operationId);
      writeFileSync(restoreMarker, JSON.stringify({ format: 1, operationId: row.operationId,
        backupOperationId: row.backup!.operationId, instanceId, softwareVersion }), { flag: 'wx', mode: 0o600, flush: true });
      syncDirectory(input.dataDir);
    }
    for (const name of present) {
      if (name === markerName) continue;
      unlinkSync(join(input.dataDir, name));
    }
    for (const [name, bytes] of files) {
      if (!allowed.has(name)) throw new Error('UPDATE_RESTORE_FILE_INVALID');
      writeFileSync(join(input.dataDir, name), bytes, { flag: 'wx', mode: 0o600, flush: true });
      regular(join(input.dataDir, name));
      if (await digestFile(join(input.dataDir, name)) !== createHash('sha256').update(bytes).digest('hex'))
        throw new Error('UPDATE_RESTORE_WRITE_MISMATCH');
    }
    syncDirectory(input.dataDir);
    const restored = inspectDatabase(input.dataDir);
    if (restored.instanceId !== instanceId || restored.schemaVersion !== row.backup!.schemaVersion)
      throw new Error('UPDATE_RESTORE_RESULT_INVALID');
    const db = new Database(join(input.dataDir, 'pos.sqlite'), { readonly: true, fileMustExist: true });
    let activated: boolean;
    try { activated = !!db.prepare('SELECT 1 FROM activation WHERE singleton=1').get(); }
    finally { db.close(); }
    if (input.testProtectedFiles && process.platform === 'win32') throw new Error('UPDATE_RESTORE_TEST_OVERRIDE_DENIED');
    (input.testProtectedFiles ?? verifyProtectedFiles)(input.dataDir, activated);
    return restored;
  });
  const restored = input.journal.recordDataRestored(row.operationId);
  return { state: 'DATA_RESTORED_GUARDED' as const, operationId: restored.operationId,
    schemaVersion: result.value.schemaVersion };
}
