import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { Storage } from '../src/storage';
import { InstanceLock } from '../src/instance-lock';
import { createBackupSet, inspectRestoredBackupSet, verifyBackupSet } from '../src/recovery/backup-set';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-backup-test-'));
  dirs.push(root);
  const data = join(root, 'data'), backups = join(root, 'backups');
  mkdirSync(backups);
  new Storage(data).initialize();
  const storage = new Storage(data);
  expect(storage.open().state).toBe('NEEDS_ACTIVATION');
  const protector = { protect: (key: Buffer) => key.toString('base64'), unprotect: (value: string) => Buffer.from(value, 'base64') };
  return { data, backups, storage, protector };
}

it('snapshots SQLite and installation identity, encrypts files and verifies an isolated restore', async () => {
  const { data, backups, storage, protector } = fixture();
  try {
    const marker = readFileSync(join(data, 'installation.json'), 'utf8');
    const result = await createBackupSet(data, backups, storage.connection(), protector, '0.1.0');
    const verified = await verifyBackupSet(result.path, protector);
    expect(verified).toMatchObject({ operationId: result.operationId, verified: true });
    expect(readdirSync(result.path).sort()).toEqual(['installation.json.enc', 'key.dpapi', 'manifest.json', 'pos.sqlite.enc']);
    expect(readFileSync(join(result.path, 'installation.json.enc'), 'utf8')).not.toContain(marker);
    expect(readdirSync(backups)).toEqual([result.operationId]);
  } finally { storage.close(); }
});

it('rejects missing protected material and altered backup bytes', async () => {
  const { data, backups, storage, protector } = fixture();
  try {
    writeFileSync(join(data, 'pin-keys.marker'), 'incomplete');
    await expect(createBackupSet(data, backups, storage.connection(), protector, '0.1.0')).rejects.toThrow('RECOVERY_PREREQUISITE_MISSING');
    expect(readdirSync(backups)).toEqual([]);
    rmSync(join(data, 'pin-keys.marker'));
    const result = await createBackupSet(data, backups, storage.connection(), protector, '0.1.0');
    writeFileSync(join(result.path, 'pos.sqlite.enc'), 'tampered');
    await expect(verifyBackupSet(result.path, protector)).rejects.toThrow();
  } finally { storage.close(); }
});

it('refuses an update backup while a cashier shift is open', async () => {
  const { data, backups, storage, protector } = fixture();
  try {
    const db = storage.connection(), instance = JSON.parse(readFileSync(join(data, 'installation.json'), 'utf8')).id as string;
    const branch = randomUUID(), employee = randomUUID();
    db.prepare('INSERT INTO activation VALUES(1,?,?,?,?,?,?,?)').run(instance, branch, randomUUID(), randomUUID(), randomUUID(), '{}', Date.now());
    db.prepare("INSERT INTO employees(id,branch_id,login,name,role,status,password_hash,must_change,created_at) VALUES(?,?,'owner','Fixture','OWNER','ACTIVE','fixture-hash',0,?)").run(employee, branch, Date.now());
    db.prepare("INSERT INTO shifts(id,branch_id,status,opened_by,opened_at) VALUES(?,?,'OPEN',?,?)").run(randomUUID(), branch, employee, Date.now());
    await expect(createBackupSet(data, backups, db, protector, '0.1.0')).rejects.toThrow('RECOVERY_OPEN_SHIFT');
    expect(readdirSync(backups)).toEqual([]);
  } finally { storage.close(); }
});

it('works from the read-only database connection used by the recovery command', async () => {
  const { data, backups, storage, protector } = fixture();
  storage.close();
  const lock = new InstanceLock(data);
  lock.acquire();
  const db = new Database(join(data, 'pos.sqlite'), { readonly: true, fileMustExist: true });
  try {
    const result = await createBackupSet(data, backups, db, protector, '0.1.0');
    expect((await verifyBackupSet(result.path, protector)).verified).toBe(true);
  } finally { db.close(); lock.release(); }
});

it('refuses a new backup while a crashed operation may have left plaintext staging files', async () => {
  const { data, backups, storage, protector } = fixture();
  try {
    mkdirSync(join(backups, '.backup-stage-interrupted'));
    await expect(createBackupSet(data, backups, storage.connection(), protector, '0.1.0')).rejects.toThrow('RECOVERY_INCOMPLETE_PREVIOUS_OPERATION');
  } finally { storage.close(); }
});

it('refuses a SQLite PIN binding when its protected key file is absent', async () => {
  const { data, backups, storage, protector } = fixture();
  try {
    storage.connection().prepare('INSERT INTO pin_key_binding(singleton,fingerprint) VALUES(1,?)').run('fixture-fingerprint');
    await expect(createBackupSet(data, backups, storage.connection(), protector, '0.1.0')).rejects.toThrow('RECOVERY_PREREQUISITE_MISSING');
    expect(readdirSync(backups)).toEqual([]);
  } finally { storage.close(); }
});

it('refuses a web draft key binding when its protected key file is absent', async () => {
  const { data, backups, storage, protector } = fixture();
  try {
    storage.connection().prepare('INSERT INTO web_key_binding(singleton,fingerprint) VALUES(1,?)').run('fixture-fingerprint');
    await expect(createBackupSet(data, backups, storage.connection(), protector, '0.1.0')).rejects.toThrow('RECOVERY_PREREQUISITE_MISSING');
    expect(readdirSync(backups)).toEqual([]);
  } finally { storage.close(); }
});

it.skipIf(process.platform !== 'darwin')('streams a WAL snapshot from memory directly into encrypted backup files', async () => {
  const build = mkdtempSync(join(tmpdir(), 'bashkar-memory-helper-test-'));
  dirs.push(build);
  const sqlite = join(dirname(require.resolve('better-sqlite3/package.json')), 'deps', 'sqlite3');
  const helper = join(build, 'memory-backup');
  execFileSync('clang', ['-O1', '-DSQLITE_THREADSAFE=1', '-I', sqlite, 'infrastructure/sqlite-memory-backup/memory-backup.c', join(sqlite, 'sqlite3.c'), '-o', helper], { cwd: process.cwd() });
  const { data, backups, storage, protector } = fixture();
  try {
    const result = await createBackupSet(data, backups, storage.connection(), protector, '0.1.0', helper);
    expect(readdirSync(backups)).toEqual([result.operationId]);
    const restored = await inspectRestoredBackupSet(result.path, protector, path => {
      const db = new Database(join(path, 'pos.sqlite'), { readonly: true, fileMustExist: true });
      try { return db.prepare('SELECT id FROM bootstrap_instance').get(); }
      finally { db.close(); }
    });
    expect(restored.inspection).toEqual(storage.connection().prepare('SELECT id FROM bootstrap_instance').get());
  } finally { storage.close(); }
}, 15000);

it('lets an isolated restored copy be inspected, then removes it even when inspection fails', async () => {
  const { data, backups, storage, protector } = fixture();
  try {
    const result = await createBackupSet(data, backups, storage.connection(), protector, '0.1.0');
    let restoredPath = '';
    const inspected = await inspectRestoredBackupSet(result.path, protector, path => {
      restoredPath = path;
      const restored = new Storage(path);
      try {
        expect(restored.open().state).toBe('NEEDS_ACTIVATION');
        return restored.connection().prepare('SELECT id FROM bootstrap_instance').get();
      } finally { restored.close(); }
    });
    expect(inspected.inspection).toEqual(storage.connection().prepare('SELECT id FROM bootstrap_instance').get());
    expect(() => readFileSync(join(restoredPath, 'installation.json'))).toThrow();
    await expect(inspectRestoredBackupSet(result.path, protector, () => { throw new Error('INSPECTION_FAILED'); })).rejects.toThrow('INSPECTION_FAILED');
    expect(readdirSync(backups)).toEqual([result.operationId]);
  } finally { storage.close(); }
});
