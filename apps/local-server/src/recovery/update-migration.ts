import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Storage } from '../storage';
import { latestSchema, validateMigrations, validatePhysicalSchema } from '../migrations';
import { readInstalledSoftwareVersion } from './release-version';
import { UpdateJournal } from './update-journal';

export function assertWindowsServiceStopped() {
  if (process.platform !== 'win32') throw new Error('UPDATE_WINDOWS_REQUIRED');
  const script = String.raw`$s=Get-CimInstance Win32_Service -Filter "Name='BashkarPOSLocalServer'"; if($null -eq $s -or $s.StartMode -ne 'Disabled' -or $s.State -ne 'Stopped' -or $s.ProcessId -ne 0){exit 9}`;
  try { execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10000, windowsHide: true, stdio: 'ignore' }); }
  catch { throw new Error('UPDATE_SERVICE_NOT_QUIESCED'); }
}
function file(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_MIGRATION_FILE_INVALID');
}
export function inspectDatabase(dataDir: string) {
  const markerPath = join(dataDir, 'installation.json'), dbPath = join(dataDir, 'pos.sqlite');
  file(markerPath); file(dbPath);
  const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { format?: number; id?: string };
  if (marker.format !== 1 || typeof marker.id !== 'string') throw new Error('UPDATE_MIGRATION_IDENTITY_INVALID');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('UPDATE_MIGRATION_DATABASE_INVALID');
    const schemaVersion = validateMigrations(db);
    validatePhysicalSchema(db, schemaVersion);
    const instances = db.prepare('SELECT id FROM bootstrap_instance').all() as { id: string }[];
    const activation = db.prepare('SELECT instance_id AS instanceId FROM activation WHERE singleton=1').get() as { instanceId: string } | undefined;
    if (instances.length !== 1 || instances[0].id !== marker.id || (activation && activation.instanceId !== marker.id)) throw new Error('UPDATE_MIGRATION_IDENTITY_INVALID');
    if (db.prepare("SELECT 1 FROM shifts WHERE status='OPEN' LIMIT 1").get()) throw new Error('UPDATE_MIGRATION_OPEN_SHIFT');
    return { schemaVersion, instanceId: marker.id };
  } finally { db.close(); }
}

/** The new signed binary performs migration while the old service is disabled. */
export function runGuardedMigration(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; versionPath: string; operationId: string;
  assertServiceStopped?: () => void; migrate?: (dataDir: string) => void; afterIntent?: () => void;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || !['BINARY_SWITCHED', 'MIGRATION_INTENT'].includes(row.phase) || !row.backup) throw new Error('UPDATE_MIGRATION_STATE_INVALID');
  if (process.platform === 'win32' && (!process.env.ProgramData || resolve(input.dataDir).toLowerCase() !== resolve(process.env.ProgramData, 'BashkarPOS', 'data').toLowerCase())) throw new Error('UPDATE_MIGRATION_PATH_INVALID');
  if (row.targetSchema !== latestSchema || readInstalledSoftwareVersion(input.versionPath) !== row.targetVersion) throw new Error('UPDATE_MIGRATION_TARGET_INVALID');
  const intent = JSON.parse(readFileSync(join(input.configDir, 'update-intent.json'), 'utf8')) as Record<string, unknown>;
  const guard = JSON.parse(readFileSync(join(input.configDir, 'update-guard.json'), 'utf8')) as Record<string, unknown>;
  if (intent.operationId !== row.operationId || intent.backupOperationId !== row.backup.operationId || guard.operationId !== row.operationId) throw new Error('UPDATE_GUARD_MISMATCH');
  (input.assertServiceStopped ?? assertWindowsServiceStopped)();
  const before = inspectDatabase(input.dataDir);
  if (before.schemaVersion !== row.backup.schemaVersion && before.schemaVersion !== row.targetSchema) throw new Error('UPDATE_MIGRATION_SOURCE_INVALID');
  if (row.phase === 'BINARY_SWITCHED') input.journal.recordMigrationIntent(row.operationId);
  input.afterIntent?.();
  if (before.schemaVersion !== row.targetSchema) {
    (input.migrate ?? (dir => new Storage(dir).migrate()))(input.dataDir);
  }
  const after = inspectDatabase(input.dataDir);
  if (after.schemaVersion !== row.targetSchema || after.instanceId !== before.instanceId) throw new Error('UPDATE_MIGRATION_RESULT_INVALID');
  return input.journal.recordMigrated(row.operationId, after.schemaVersion);
}
