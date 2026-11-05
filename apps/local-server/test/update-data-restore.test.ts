import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Storage } from '../src/storage';
import { createBackupSet } from '../src/recovery/backup-set';
import { UpdateJournal } from '../src/recovery/update-journal';
import { restoreGuardedData } from '../src/recovery/update-data-restore';
import { classifyGuardedRecovery } from '../src/recovery/update-health';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-data-restore-'));
  roots.push(root);
  const configDir = join(root, 'config'), backupRoot = join(root, 'backups'), dataDir = join(root, 'data');
  mkdirSync(configDir, { mode: 0o700 }); mkdirSync(backupRoot, { mode: 0o700 });
  new Storage(dataDir).initialize();
  const storage = new Storage(dataDir);
  storage.open();
  const protector = { protect: (key: Buffer) => key.toString('base64'), unprotect: (value: string) => Buffer.from(value, 'base64') };
  const backup = await createBackupSet(dataDir, backupRoot, storage.connection(), protector, '0.1.0');
  storage.close();
  const operationId = randomUUID(), instanceId = JSON.parse(readFileSync(join(dataDir, 'installation.json'), 'utf8')).id as string;
  const now = new Date().toISOString();
  writeFileSync(join(configDir, 'update-operation.json'), JSON.stringify({ format: 4, operationId,
    actorId: randomUUID(), authorizationExpiresAt: Date.now() + 60000, grantSha256: 'a'.repeat(64),
    releaseId: 'release_020', targetVersion: '0.2.0', targetSchema: 26, manifestSha256: 'b'.repeat(64),
    artifactSha256: 'c'.repeat(64), phase: 'MIGRATION_INTENT', createdAt: now, updatedAt: now,
    backup: { operationId: backup.operationId, path: backup.path, schemaVersion: 26 }, errorCode: null }));
  writeFileSync(join(configDir, 'update-intent.json'), JSON.stringify({ format: 1, operationId, backupOperationId: backup.operationId, phase: 'GUARD_REQUESTED' }));
  writeFileSync(join(configDir, 'update-guard.json'), JSON.stringify({ format: 1, operationId }));
  const journal = new UpdateJournal(configDir, backupRoot);
  const restore = () => restoreGuardedData({ journal, configDir, dataDir, operationId, protector,
    assertLocalService: () => {}, assertServiceStopped: () => {} });
  return { root, configDir, backupRoot, dataDir, backup, journal, operationId, instanceId, restore };
}

it('restores encrypted data directly to the final path while retaining the guard', async () => {
  const f = await fixture();
  const db = new Database(join(f.dataDir, 'pos.sqlite'));
  db.exec('CREATE TABLE migration_probe(value TEXT)');
  db.close();
  const result = await f.restore();
  expect(result).toMatchObject({ state: 'DATA_RESTORED_GUARDED', operationId: f.operationId, schemaVersion: 26 });
  expect(f.journal.read()?.phase).toBe('DATA_RESTORED');
  expect(classifyGuardedRecovery({ journal: f.journal, configDir: f.configDir, operationId: f.operationId }).kind).toBe('OLD_BINARY_RECONCILIATION_REQUIRED');
  await expect(f.restore()).rejects.toThrow('UPDATE_RESTORE_STATE_INVALID');
  const restored = new Database(join(f.dataDir, 'pos.sqlite'), { readonly: true });
  try { expect(restored.prepare("SELECT 1 FROM sqlite_master WHERE name='migration_probe'").get()).toBeUndefined(); }
  finally { restored.close(); }
  expect(readFileSync(join(f.configDir, 'update-guard.json'), 'utf8')).toContain(f.operationId);
  expect(readdirSync(f.backupRoot)).toEqual([f.backup.operationId]);
  expect(readdirSync(f.root).filter(name => name.startsWith('data.before-restore.'))).toEqual([]);
});

it('resumes after interruption during final-path writing', async () => {
  const f = await fixture();
  f.journal.recordDataRestoreIntent(f.operationId);
  expect(classifyGuardedRecovery({ journal: f.journal, configDir: f.configDir, operationId: f.operationId }).kind).toBe('LOCAL_SERVICE_DATA_RESTORE_REQUIRED');
  writeFileSync(join(f.dataDir, '.update-data-restore.json'), JSON.stringify({ format: 1, operationId: f.operationId,
    backupOperationId: f.backup.operationId, instanceId: f.instanceId, softwareVersion: '0.1.0' }));
  writeFileSync(join(f.dataDir, 'pos.sqlite'), 'partial');
  expect((await f.restore()).state).toBe('DATA_RESTORED_GUARDED');
  expect(readFileSync(join(f.dataDir, 'installation.json'), 'utf8')).toContain(f.instanceId);
  expect(readFileSync(join(f.dataDir, 'pos.sqlite')).subarray(0, 16).toString('ascii')).toBe('SQLite format 3\0');
});

it('resumes after intent before the recovery marker is written', async () => {
  const beforeRename = await fixture();
  beforeRename.journal.recordDataRestoreIntent(beforeRename.operationId);
  expect((await beforeRename.restore()).state).toBe('DATA_RESTORED_GUARDED');
});

it('leaves an unknown file untouched and keeps the guard after an interrupted restore', async () => {
  const f = await fixture();
  f.journal.recordDataRestoreIntent(f.operationId);
  writeFileSync(join(f.dataDir, '.update-data-restore.json'), JSON.stringify({ format: 1, operationId: f.operationId,
    backupOperationId: f.backup.operationId, instanceId: f.instanceId, softwareVersion: '0.1.0' }));
  writeFileSync(join(f.dataDir, 'unexpected.txt'), 'do-not-touch');
  await expect(f.restore()).rejects.toThrow('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
  expect(readFileSync(join(f.dataDir, 'unexpected.txt'), 'utf8')).toBe('do-not-touch');
  expect(f.journal.read()?.phase).toBe('DATA_RESTORE_INTENT');
  expect(readFileSync(join(f.configDir, 'update-guard.json'), 'utf8')).toContain(f.operationId);
});

it('rejects a wrong guard, identity, and altered Backup Set before moving data', async () => {
  const f = await fixture();
  const original = readFileSync(join(f.dataDir, 'installation.json'), 'utf8');
  writeFileSync(join(f.configDir, 'update-guard.json'), JSON.stringify({ format: 1, operationId: randomUUID() }));
  await expect(f.restore()).rejects.toThrow('UPDATE_GUARD_MISMATCH');
  writeFileSync(join(f.configDir, 'update-guard.json'), JSON.stringify({ format: 1, operationId: f.operationId }));
  const denied = () => restoreGuardedData({ journal: f.journal, configDir: f.configDir, dataDir: f.dataDir,
    operationId: f.operationId, protector: { protect: (key: Buffer) => key.toString('base64'), unprotect: (value: string) => Buffer.from(value, 'base64') },
    assertLocalService: () => { throw new Error('WRONG_IDENTITY'); }, assertServiceStopped: () => {} });
  await expect(denied()).rejects.toThrow('WRONG_IDENTITY');
  writeFileSync(join(f.backup.path, 'pos.sqlite.enc'), 'corrupt');
  await expect(f.restore()).rejects.toThrow();
  expect(readFileSync(join(f.dataDir, 'installation.json'), 'utf8')).toBe(original);
  expect(f.journal.read()?.phase).toBe('MIGRATION_INTENT');
});

it('requires reconciliation when business rows changed after the Backup Set', async () => {
  const f = await fixture();
  const db = new Database(join(f.dataDir, 'pos.sqlite'));
  try {
    db.pragma('foreign_keys = OFF');
    db.prepare("INSERT INTO outbox(id,branch_id,type,payload,created_at) VALUES(?,?,?,?,?)")
      .run(randomUUID(), randomUUID(), 'ORDER', '{}', Date.now());
  } finally { db.close(); }
  await expect(f.restore()).rejects.toThrow('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
  expect(f.journal.read()?.phase).toBe('MIGRATION_INTENT');
  expect(readdirSync(f.dataDir)).not.toContain('.update-data-restore.json');
  const current = new Database(join(f.dataDir, 'pos.sqlite'), { readonly: true });
  try { expect((current.prepare('SELECT count(*) AS count FROM outbox').get() as { count: number }).count).toBe(1); }
  finally { current.close(); }
});

it('also catches changes in linked business tables outside the earlier five-table check', async () => {
  const f = await fixture();
  const db = new Database(join(f.dataDir, 'pos.sqlite'));
  try {
    db.prepare("INSERT INTO audit_events(id,action,result,occurred_at,details) VALUES(?,'UPDATE_TEST','SUCCESS',?,'{}')")
      .run(randomUUID(), Date.now());
  } finally { db.close(); }
  await expect(f.restore()).rejects.toThrow('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
  expect(f.journal.read()?.phase).toBe('MIGRATION_INTENT');
  expect(readdirSync(f.dataDir)).not.toContain('.update-data-restore.json');
});
