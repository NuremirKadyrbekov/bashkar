import { afterEach, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Storage } from '../src/storage';
import { createBackupSet } from '../src/recovery/backup-set';
import { captureOldBinaryInventory } from '../src/recovery/old-binary-inventory';
import { restoreOldBinaryBeforeMigration } from '../src/recovery/binary-switch';
import { verifyPreMigrationData, preMigrationProofName } from '../src/recovery/verify-pre-migration-data';
import { verifyRestoredInstallPrestart } from '../src/recovery/verify-restored-install';
import { inspectRecoveryProbe } from '../src/recovery/recovery-probe';
import { startGuardedServiceProbe } from '../src/recovery/guarded-service-probe';
import { finalizeRestoredRecovery } from '../src/recovery/finalize-restored-recovery';
import { guardedStartupMode } from '../src/recovery/startup-guard';
import { UpdateJournal } from '../src/recovery/update-journal';
import { runManagerStep } from '../src/recovery/manager-coordinator';
import { localServiceManagerHandlers } from '../src/recovery/manager-local-service';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const protector = { protect: (value: Buffer) => value.toString('base64'),
  unprotect: (value: string) => Buffer.from(value, 'base64') };

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-pre-migration-'));
  roots.push(root);
  const configDir = join(root, 'config'), backupRoot = join(root, 'backups'), dataDir = join(root, 'data');
  mkdirSync(configDir, { mode: 0o700 }); mkdirSync(backupRoot, { mode: 0o700 });
  new Storage(dataDir).initialize();
  const storage = new Storage(dataDir);
  storage.open();
  const backup = await createBackupSet(dataDir, backupRoot, storage.connection(), protector, '0.1.0');
  storage.close();
  const operationId = randomUUID(), now = new Date().toISOString();
  writeFileSync(join(configDir, 'update-operation.json'), JSON.stringify({ format: 4, operationId,
    actorId: randomUUID(), authorizationExpiresAt: Date.now() + 60000, grantSha256: 'a'.repeat(64),
    releaseId: 'release_020', targetVersion: '0.2.0', targetSchema: 26, manifestSha256: 'b'.repeat(64),
    artifactSha256: 'c'.repeat(64), phase: 'BINARY_SWITCH_INTENT', createdAt: now, updatedAt: now,
    backup: { operationId: backup.operationId, path: backup.path, schemaVersion: 26 }, errorCode: null }));
  writeFileSync(join(configDir, 'update-intent.json'), JSON.stringify({ format: 1, operationId,
    backupOperationId: backup.operationId, phase: 'GUARD_REQUESTED' }));
  writeFileSync(join(configDir, 'update-guard.json'), JSON.stringify({ format: 1, operationId }));
  writeFileSync(join(configDir, 'update-control.key'), randomBytes(32).toString('base64url'));
  const appDir = join(root, 'Bashkar POS'), incoming = join(root, `Bashkar POS.incoming.${operationId}`),
    previous = join(root, `Bashkar POS.previous.${operationId}`);
  for (const [dir, version] of [[appDir, '0.1.0'], [incoming, '0.2.0']]) {
    mkdirSync(join(dir, 'server'), { recursive: true });
    for (const name of ['Bashkar POS.exe', 'BashkarPOSLocalServer.exe', 'service.ps1', 'node.exe',
      'BashkarPOSLocalServer.xml', 'Uninstall.exe', join('server', 'main.js')])
      writeFileSync(join(dir, name), version);
    writeFileSync(join(dir, 'server', 'version.json'), JSON.stringify({ format: 1, version }));
    writeFileSync(join(dir, 'server', 'recovery-quarantine.json'),
      JSON.stringify({ format: 1, capability: 'recovery-quarantine-v1' }));
  }
  captureOldBinaryInventory(configDir, appDir, operationId);
  const journal = new UpdateJournal(configDir, backupRoot);
  const restoreBinary = (move?: (from: string, to: string) => void) =>
    restoreOldBinaryBeforeMigration({ journal, configDir, appDir, operationId,
      assertServiceStopped: () => {}, move });
  const verifyData = (assertLocalService = () => {}) => verifyPreMigrationData({ journal, configDir,
    dataDir, appDir, operationId, protector, assertLocalService, assertServiceStopped: () => {} });
  const verifyInstall = () => verifyRestoredInstallPrestart({ journal, configDir, dataDir, appDir,
    operationId, protector, assertLocalService: () => {}, assertServiceStopped: () => {} });
  return { root, configDir, backupRoot, dataDir, appDir, incoming, previous, journal, operationId,
    backup, restoreBinary, verifyData, verifyInstall };
}

it('returns old files, proves unchanged data in memory, then restarts the old service through quarantine', async () => {
  const f = await fixture();
  renameSync(f.appDir, f.previous);
  renameSync(f.incoming, f.appDir);
  expect(f.restoreBinary().state).toBe('PRE_MIGRATION_BINARY_RESTORED');
  expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_BINARY_RESTORED');
  expect(readFileSync(join(f.appDir, 'node.exe'), 'utf8')).toBe('0.1.0');
  await expect(f.verifyData()).resolves.toMatchObject({ version: '0.1.0', schemaVersion: 26 });
  expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_DATA_VERIFIED');
  await expect(f.verifyInstall()).resolves.toMatchObject({ state: 'OLD_INSTALL_PRESTART_VERIFIED' });
  const probe = (nonce: string) => inspectRecoveryProbe({ journal: f.journal, configDir: f.configDir,
    dataDir: f.dataDir, appDir: f.appDir, operationId: f.operationId, nonce, protector,
    assertLocalService: () => {} });
  await startGuardedServiceProbe({ journal: f.journal, configDir: f.configDir, dataDir: f.dataDir,
    appDir: f.appDir, operationId: f.operationId, assertBootstrap: () => {},
    startService: () => { expect(guardedStartupMode(f.configDir, f.backupRoot).kind).toBe('PROBE'); },
    requestHealth: probe });
  const checks: boolean[] = [];
  await expect(finalizeRestoredRecovery({ journal: f.journal, configDir: f.configDir,
    backupRoot: f.backupRoot, dataDir: f.dataDir, appDir: f.appDir, operationId: f.operationId,
    probe: () => probe(randomBytes(32).toString('base64url')),
    stopService: () => {}, assertServiceStopped: () => {}, startNormalService: () => {},
    restartAfterCommit: () => {}, enableAutomatic: () => {}, stopUnhealthyService: () => {},
    requestHealth: async (_port, _version, _schema, closed) => { checks.push(closed); } }))
    .resolves.toMatchObject({ state: 'RECOVERY_COMPLETED' });
  expect(checks).toEqual([true, true, false]);
  expect(f.journal.read()?.phase).toBe('RECOVERY_COMPLETED');
  expect(readdirSync(f.dataDir)).not.toContain(preMigrationProofName);
  expect(readdirSync(f.root).filter(name => name.startsWith('data.before-restore.'))).toEqual([]);
  const nextStorage = new Storage(f.dataDir);
  try {
    nextStorage.open();
    await expect(createBackupSet(f.dataDir, f.backupRoot, nextStorage.connection(), protector, '0.1.0'))
      .resolves.toMatchObject({ path: expect.any(String) });
  } finally { nextStorage.close(); }
});

it('runs every pre-migration recovery action through journal-selected Manager handlers', async () => {
  const f = await fixture();
  renameSync(f.appDir, f.previous);
  renameSync(f.incoming, f.appDir);
  const tasks: string[] = [];
  const handlers = {
    RECOVER_BINARY_BEFORE_MIGRATION: () => { f.restoreBinary(); },
    ...localServiceManagerHandlers(async (action, operationId) => {
      expect(operationId).toBe(f.operationId); tasks.push(action);
      if (action === 'verify-pre-migration') await f.verifyData();
      else if (action === 'verify-old-install') await f.verifyInstall();
      else throw new Error('UNEXPECTED_LOCAL_TASK');
    }),
    START_GUARDED_SERVICE_PROBE: async () => { await startGuardedServiceProbe({ journal: f.journal,
      configDir: f.configDir, dataDir: f.dataDir, appDir: f.appDir, operationId: f.operationId,
      assertBootstrap: () => {}, startService: () => {},
      requestHealth: nonce => inspectRecoveryProbe({ journal: f.journal, configDir: f.configDir,
        dataDir: f.dataDir, appDir: f.appDir, operationId: f.operationId, nonce, protector,
        assertLocalService: () => {} }) }); },
    FINALIZE_RESTORED_INSTALL: async () => { await finalizeRestoredRecovery({ journal: f.journal,
      configDir: f.configDir, backupRoot: f.backupRoot, dataDir: f.dataDir,
      appDir: f.appDir, operationId: f.operationId,
      probe: () => inspectRecoveryProbe({ journal: f.journal, configDir: f.configDir,
        dataDir: f.dataDir, appDir: f.appDir, operationId: f.operationId,
        nonce: randomBytes(32).toString('base64url'), protector, assertLocalService: () => {} }),
      stopService: () => {}, assertServiceStopped: () => {}, startNormalService: () => {},
      restartAfterCommit: () => {}, enableAutomatic: () => {}, stopUnhealthyService: () => {},
      requestHealth: async () => {} }); }
  };
  const step = () => runManagerStep({ journal: f.journal, configDir: f.configDir, job: null, handlers });
  expect((await step()).action).toBe('VERIFY_PRE_MIGRATION_DATA_WITH_LOCAL_SERVICE');
  expect((await step()).action).toBe('VERIFY_OLD_INSTALL_WITH_LOCAL_SERVICE');
  expect((await step()).action).toBe('START_GUARDED_SERVICE_PROBE');
  expect((await step()).action).toBe('FINALIZE_RESTORED_INSTALL');
  expect((await step()).action).toBe('RECOVERY_COMPLETED');
  expect(tasks).toEqual(['verify-pre-migration', 'verify-old-install']);
});

it('resumes the binary move after interruption between two renames', async () => {
  const f = await fixture();
  renameSync(f.appDir, f.previous);
  renameSync(f.incoming, f.appDir);
  let moves = 0;
  expect(() => f.restoreBinary((from, to) => {
    renameSync(from, to);
    if (++moves === 1) throw new Error('INTERRUPTED');
  })).toThrow('INTERRUPTED');
  expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_RECOVERY_INTENT');
  expect(() => guardedStartupMode(f.configDir, f.backupRoot)).toThrow('UPDATE_GUARD_ACTIVE');
  expect(f.restoreBinary().state).toBe('PRE_MIGRATION_BINARY_RESTORED');
  await expect(f.verifyData()).resolves.toMatchObject({ state: 'PRE_MIGRATION_DATA_VERIFIED' });
});

it('records the old binary after both renames completed but before the journal did', async () => {
  const f = await fixture();
  renameSync(f.appDir, f.previous);
  renameSync(f.incoming, f.appDir);
  f.journal.recordPreMigrationRecoveryIntent(f.operationId);
  renameSync(f.appDir, f.incoming);
  renameSync(f.previous, f.appDir);
  expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_RECOVERY_INTENT');
  expect(f.restoreBinary().state).toBe('PRE_MIGRATION_BINARY_RESTORED');
  await expect(f.verifyData()).resolves.toMatchObject({ state: 'PRE_MIGRATION_DATA_VERIFIED' });
});

it('rechecks a durable proof marker left before the journal transition', async () => {
  const f = await fixture();
  f.restoreBinary();
  const identity = JSON.parse(readFileSync(join(f.dataDir, 'installation.json'), 'utf8')).id as string;
  writeFileSync(join(f.dataDir, preMigrationProofName), JSON.stringify({ format: 1,
    operationId: f.operationId, backupOperationId: f.backup.operationId,
    instanceId: identity, softwareVersion: '0.1.0' }));
  await expect(f.verifyData()).resolves.toMatchObject({ state: 'PRE_MIGRATION_DATA_VERIFIED' });
  await expect(f.verifyData()).resolves.toMatchObject({ state: 'PRE_MIGRATION_DATA_VERIFIED' });
});

it('keeps the guard and data when any business row changed after backup', async () => {
  const f = await fixture();
  f.restoreBinary();
  const db = new Database(join(f.dataDir, 'pos.sqlite'));
  try { db.prepare("INSERT INTO audit_events(id,action,result,occurred_at,details) VALUES(?,'UPDATE_TEST','SUCCESS',?,'{}')")
    .run(randomUUID(), Date.now()); }
  finally { db.close(); }
  await expect(f.verifyData()).rejects.toThrow('UPDATE_RESTORE_RECONCILIATION_REQUIRED');
  expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_BINARY_RESTORED');
  expect(() => guardedStartupMode(f.configDir, f.backupRoot)).toThrow('UPDATE_GUARD_ACTIVE');
  expect(readdirSync(f.dataDir)).not.toContain(preMigrationProofName);
});

it('requires LocalService proof and never returns old files after migration intent', async () => {
  const f = await fixture();
  f.restoreBinary();
  await expect(f.verifyData(() => { throw new Error('WRONG_ACCOUNT'); })).rejects.toThrow('WRONG_ACCOUNT');
  expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_BINARY_RESTORED');
  const g = await fixture();
  writeFileSync(join(g.configDir, 'update-operation.json'), JSON.stringify({ ...g.journal.read(), phase: 'MIGRATION_INTENT' }));
  expect(() => g.restoreBinary()).toThrow('UPDATE_BINARY_RECOVERY_DENIED');
});

it('enforces each pre-migration journal transition and never enters migration after recovery starts', async () => {
  const f = await fixture();
  expect(() => f.journal.recordPreMigrationDataVerified(f.operationId)).toThrow('UPDATE_OPERATION_STATE_INVALID');
  expect(() => f.journal.recordPreMigrationBinaryRestored(f.operationId)).toThrow('UPDATE_OPERATION_STATE_INVALID');
  f.journal.recordPreMigrationRecoveryIntent(f.operationId);
  expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_RECOVERY_INTENT');
  expect(() => f.journal.recordMigrationIntent(f.operationId)).toThrow('UPDATE_OPERATION_STATE_INVALID');
  expect(() => f.journal.recordPreMigrationDataVerified(f.operationId)).toThrow('UPDATE_OPERATION_STATE_INVALID');
  expect(() => f.journal.markRecoveryRequired(f.operationId, 'UPDATE_OTHER_FAILED')).toThrow('UPDATE_OPERATION_STATE_INVALID');
  expect(f.restoreBinary().state).toBe('PRE_MIGRATION_BINARY_RESTORED');
  expect(() => f.journal.recordOldInstallPrestartVerified(f.operationId)).toThrow('UPDATE_OPERATION_STATE_INVALID');
  await f.verifyData();
  expect(() => f.journal.recordPreMigrationDataVerified(f.operationId)).toThrow('UPDATE_OPERATION_STATE_INVALID');
  await f.verifyInstall();
  expect(f.journal.read()?.phase).toBe('OLD_INSTALL_PRESTART_VERIFIED');
});

it('resumes a previously recorded switch failure without repeating the dangerous switch', async () => {
  const f = await fixture();
  f.journal.markRecoveryRequired(f.operationId, 'UPDATE_BINARY_SWITCH_FAILED');
  expect(f.restoreBinary().state).toBe('PRE_MIGRATION_BINARY_RESTORED');
  await expect(f.verifyData()).resolves.toMatchObject({ state: 'PRE_MIGRATION_DATA_VERIFIED' });
});

it('recovers after extraction failure while the old binary was never switched', async () => {
  const f = await fixture();
  writeFileSync(join(f.configDir, 'update-operation.json'),
    JSON.stringify({ ...f.journal.read(), phase: 'SERVICE_QUIESCED' }));
  expect(f.restoreBinary().state).toBe('PRE_MIGRATION_BINARY_RESTORED');
  expect(readFileSync(join(f.appDir, 'node.exe'), 'utf8')).toBe('0.1.0');
  await expect(f.verifyData()).resolves.toMatchObject({ state: 'PRE_MIGRATION_DATA_VERIFIED' });
});

it('rejects a changed identity file and a corrupt pre-migration proof without removing guards', async () => {
  const f = await fixture();
  f.restoreBinary();
  writeFileSync(join(f.dataDir, 'installation.json'), '{"format":1,"id":"changed"}');
  await expect(f.verifyData()).rejects.toThrow();
  expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_BINARY_RESTORED');
  const g = await fixture();
  g.restoreBinary();
  writeFileSync(join(g.dataDir, preMigrationProofName), '{}');
  await expect(g.verifyData()).rejects.toThrow('UPDATE_PRE_MIGRATION_PROOF_INVALID');
  expect(() => guardedStartupMode(g.configDir, g.backupRoot)).toThrow('UPDATE_GUARD_ACTIVE');
});

it('rejects a damaged encrypted Backup Set before recording a data proof', async () => {
  const f = await fixture();
  f.restoreBinary();
  writeFileSync(join(f.backup.path, 'pos.sqlite.enc'), 'corrupt');
  await expect(f.verifyData()).rejects.toThrow();
  expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_BINARY_RESTORED');
  expect(readdirSync(f.dataDir)).not.toContain(preMigrationProofName);
  expect(() => guardedStartupMode(f.configDir, f.backupRoot)).toThrow('UPDATE_GUARD_ACTIVE');
});

it('resumes proof cleanup after recovery was committed before the last unlink', async () => {
  const f = await fixture();
  f.restoreBinary();
  await f.verifyData();
  await f.verifyInstall();
  f.journal.recordServiceProbeIntent(f.operationId);
  f.journal.recordServiceProbeHealthy(f.operationId);
  f.journal.recordRecoveryFinalizeIntent(f.operationId);
  f.journal.recordRecoveryReadyToStart(f.operationId);
  unlinkSync(join(f.configDir, 'update-guard.json'));
  unlinkSync(join(f.configDir, 'update-intent.json'));
  f.journal.recordRecoveryQuarantineHealthy(f.operationId);
  f.journal.recordRecoveryCommitted(f.operationId);
  f.journal.recordRecoveryCompleted(f.operationId);
  expect(readdirSync(f.dataDir)).toContain(preMigrationProofName);
  await expect(finalizeRestoredRecovery({ journal: f.journal, configDir: f.configDir,
    backupRoot: f.backupRoot, dataDir: f.dataDir, appDir: f.appDir, operationId: f.operationId,
    startNormalService: () => {}, enableAutomatic: () => {}, stopUnhealthyService: () => {},
    requestHealth: async (_port, _version, _schema, closed) => { expect(closed).toBe(false); } }))
    .resolves.toMatchObject({ state: 'RECOVERY_COMPLETED' });
  expect(readdirSync(f.dataDir)).not.toContain(preMigrationProofName);
});

it('reconstructs the first removed guard before repeating the LocalService proof', async () => {
  const f = await fixture();
  f.restoreBinary();
  await f.verifyData();
  await f.verifyInstall();
  f.journal.recordServiceProbeIntent(f.operationId);
  f.journal.recordServiceProbeHealthy(f.operationId);
  f.journal.recordRecoveryFinalizeIntent(f.operationId);
  f.journal.recordRecoveryReadyToStart(f.operationId);
  unlinkSync(join(f.configDir, 'update-guard.json'));
  expect(() => guardedStartupMode(f.configDir, f.backupRoot)).toThrow('UPDATE_GUARD_ACTIVE');
  await expect(finalizeRestoredRecovery({ journal: f.journal, configDir: f.configDir,
    backupRoot: f.backupRoot, dataDir: f.dataDir, appDir: f.appDir, operationId: f.operationId,
    probe: () => inspectRecoveryProbe({ journal: f.journal, configDir: f.configDir,
      dataDir: f.dataDir, appDir: f.appDir, operationId: f.operationId,
      nonce: randomBytes(32).toString('base64url'), protector, assertLocalService: () => {} }),
    stopService: () => {}, assertServiceStopped: () => {}, startNormalService: () => {},
    restartAfterCommit: () => {}, enableAutomatic: () => {}, stopUnhealthyService: () => {},
    requestHealth: async () => {} })).resolves.toMatchObject({ state: 'RECOVERY_COMPLETED' });
  expect(readdirSync(f.dataDir)).not.toContain(preMigrationProofName);
});
