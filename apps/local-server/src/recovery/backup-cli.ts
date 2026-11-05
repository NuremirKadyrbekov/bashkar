import Database from 'better-sqlite3';
import { isAbsolute, join } from 'node:path';
import { InstanceLock } from '../instance-lock';
import { Storage } from '../storage';
import { createBackupSet, inspectRestoredBackupSet, verifyBackupSet, windowsBackupProtector } from './backup-set';

async function main() {
  if (process.platform !== 'win32') throw new Error('RECOVERY_WINDOWS_REQUIRED');
  const action = process.argv[2];
  if (process.argv.length !== 3 || !['create', 'verify', 'restore-check'].includes(action)) throw new Error('RECOVERY_COMMAND_INVALID');
  if (action === 'restore-check' && process.env.BASHKAR_RECOVERY_DISPOSABLE_TEST !== '1') throw new Error('RECOVERY_DISPOSABLE_TEST_REQUIRED');
  const data = process.env.BASHKAR_DATA_DIR, backups = process.env.BASHKAR_BACKUP_DIR;
  if (!data || !backups || !isAbsolute(data) || !isAbsolute(backups)) throw new Error('RECOVERY_DIRECTORY_INVALID');
  const protector = windowsBackupProtector();
  if (action === 'verify' || action === 'restore-check') {
    const operationId = process.env.BASHKAR_BACKUP_OPERATION_ID;
    if (!operationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) throw new Error('RECOVERY_OPERATION_ID_REQUIRED');
    const set = join(backups, operationId);
    if (action === 'verify') {
      const result = await verifyBackupSet(set, protector);
      process.stdout.write(JSON.stringify({ event: 'backup-verified', ...result }) + '\n');
    } else {
      const result = await inspectRestoredBackupSet(set, protector, restoredDir => {
        const storage = new Storage(restoredDir);
        try {
          const state = storage.open();
          if (state.state === 'BLOCKED') throw new Error('RECOVERY_RESTORE_OPEN_FAILED');
          return { state: state.state, schemaVersion: state.schemaVersion };
        } finally { storage.close(); }
      });
      process.stdout.write(JSON.stringify({ event: 'backup-restore-checked', operationId: result.operationId, instanceId: result.instanceId, ...result.inspection }) + '\n');
    }
    return;
  }
  const version = process.env.BASHKAR_SOFTWARE_VERSION;
  if (!version) throw new Error('RECOVERY_VERSION_REQUIRED');
  const lock = new InstanceLock(data);
  lock.acquire();
  try {
    const db = new Database(join(data, 'pos.sqlite'), { readonly: true, fileMustExist: true });
    try {
      const result = await createBackupSet(data, backups, db, protector, version);
      process.stdout.write(JSON.stringify({ event: 'backup-created-and-verified', operationId: result.operationId }) + '\n');
    } finally { db.close(); }
  } finally { lock.release(); }
}

main().catch(error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'RECOVERY_FAILED';
  process.stderr.write(JSON.stringify({ event: 'backup-failed', code }) + '\n');
  process.exitCode = 1;
});
