import { afterEach, expect, it } from 'vitest';
import Fastify from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../src/storage';
import { createBackupSet } from '../src/recovery/backup-set';
import { UpdateJournal } from '../src/recovery/update-journal';
import { restoreGuardedData } from '../src/recovery/update-data-restore';
import { verifyRestoredInstallPrestart } from '../src/recovery/verify-restored-install';
import { classifyGuardedRecovery } from '../src/recovery/update-health';
import { captureOldBinaryInventory } from '../src/recovery/old-binary-inventory';
import { guardedStartupMode } from '../src/recovery/startup-guard';
import { inspectRecoveryProbe, verifyRecoveryProbeResponse } from '../src/recovery/recovery-probe';
import { startGuardedServiceProbe } from '../src/recovery/guarded-service-probe';
import { finalizeRestoredRecovery } from '../src/recovery/finalize-restored-recovery';
import { MaintenanceGate } from '../src/recovery/maintenance-gate';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-prestart-'));
  roots.push(root);
  const configDir = join(root, 'config'), backupRoot = join(root, 'backups'), dataDir = join(root, 'data');
  mkdirSync(configDir, { mode: 0o700 }); mkdirSync(backupRoot, { mode: 0o700 });
  new Storage(dataDir).initialize();
  const storage = new Storage(dataDir);
  storage.open();
  const protector = { protect: (key: Buffer) => key.toString('base64'), unprotect: (value: string) => Buffer.from(value, 'base64') };
  const backup = await createBackupSet(dataDir, backupRoot, storage.connection(), protector, '0.1.0');
  storage.close();
  const operationId = randomUUID(), now = new Date().toISOString();
  writeFileSync(join(configDir, 'update-operation.json'), JSON.stringify({ format: 4, operationId,
    actorId: randomUUID(), authorizationExpiresAt: Date.now() + 60000, grantSha256: 'a'.repeat(64),
    releaseId: 'release_020', targetVersion: '0.2.0', targetSchema: 26, manifestSha256: 'b'.repeat(64),
    artifactSha256: 'c'.repeat(64), phase: 'MIGRATION_INTENT', createdAt: now, updatedAt: now,
    backup: { operationId: backup.operationId, path: backup.path, schemaVersion: 26 }, errorCode: null }));
  writeFileSync(join(configDir, 'update-intent.json'), JSON.stringify({ format: 1, operationId, backupOperationId: backup.operationId, phase: 'GUARD_REQUESTED' }));
  writeFileSync(join(configDir, 'update-guard.json'), JSON.stringify({ format: 1, operationId }));
  writeFileSync(join(configDir, 'update-control.key'), randomBytes(32).toString('base64url'));
  const journal = new UpdateJournal(configDir, backupRoot);
  await restoreGuardedData({ journal, configDir, dataDir, operationId, protector,
    assertLocalService: () => {}, assertServiceStopped: () => {} });
  journal.recordOldBinaryRestoreIntent(operationId);
  journal.recordOldBinaryRestored(operationId);
  const appDir = join(root, 'Bashkar POS'), failedDir = join(root, `Bashkar POS.failed.${operationId}`);
  for (const [dir, version] of [[appDir, '0.1.0'], [failedDir, '0.2.0']]) {
    mkdirSync(join(dir, 'server'), { recursive: true });
    for (const name of ['Bashkar POS.exe', 'BashkarPOSLocalServer.exe', 'service.ps1', 'node.exe',
      'BashkarPOSLocalServer.xml', 'Uninstall.exe', join('server', 'main.js')]) writeFileSync(join(dir, name), version);
    writeFileSync(join(dir, 'server', 'version.json'), JSON.stringify({ format: 1, version }));
    writeFileSync(join(dir, 'server', 'recovery-quarantine.json'), JSON.stringify({ format: 1, capability: 'recovery-quarantine-v1' }));
  }
  captureOldBinaryInventory(configDir, appDir, operationId);
  const check = (assertServiceStopped = () => {}) => verifyRestoredInstallPrestart({ journal, configDir, dataDir,
    appDir, operationId, protector, assertLocalService: () => {}, assertServiceStopped });
  const probeHealth = (nonce: string) => inspectRecoveryProbe({ journal, configDir, dataDir, appDir,
    operationId, nonce, protector, assertLocalService: () => {} });
  const startProbe = (startService: () => void, requestHealth = (nonce: string) => probeHealth(nonce)) =>
    startGuardedServiceProbe({ journal, configDir, dataDir, appDir, operationId,
      startService, requestHealth, assertBootstrap: () => {} });
  return { root, configDir, backupRoot, dataDir, appDir, failedDir, journal, operationId, check, probeHealth, startProbe };
}

it('records a guarded prestart proof only after matching all restored files and the old version', async () => {
  const f = await fixture();
  await expect(f.check()).resolves.toMatchObject({ state: 'OLD_INSTALL_PRESTART_VERIFIED', version: '0.1.0', schemaVersion: 26 });
  expect(f.journal.read()?.phase).toBe('OLD_INSTALL_PRESTART_VERIFIED');
  expect(classifyGuardedRecovery({ journal: f.journal, configDir: f.configDir, operationId: f.operationId }).kind).toBe('RECOVERY_FINALIZATION_REQUIRED');
  expect(readFileSync(join(f.configDir, 'update-guard.json'), 'utf8')).toContain(f.operationId);
  await expect(f.check()).resolves.toMatchObject({ state: 'OLD_INSTALL_PRESTART_VERIFIED' });
  writeFileSync(join(f.appDir, 'server', 'version.json'), JSON.stringify({ format: 1, version: '0.9.0' }));
  await expect(f.check()).rejects.toThrow('UPDATE_PRESTART_VERSION_INVALID');
});

it('refuses changed or additional data files without advancing the journal', async () => {
  const f = await fixture();
  writeFileSync(join(f.dataDir, 'installation.json'), '{"format":1,"id":"changed"}');
  await expect(f.check()).rejects.toThrow();
  expect(f.journal.read()?.phase).toBe('OLD_BINARY_RESTORED');

  const g = await fixture();
  writeFileSync(join(g.dataDir, 'untracked.txt'), 'unexpected');
  await expect(g.check()).rejects.toThrow('UPDATE_PRESTART_FILES_MISMATCH');
  expect(g.journal.read()?.phase).toBe('OLD_BINARY_RESTORED');

  const h = await fixture();
  const marker = JSON.parse(readFileSync(join(h.dataDir, 'installation.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(h.dataDir, 'installation.json'), JSON.stringify({ ...marker, harmlessLookingField: true }));
  await expect(h.check()).rejects.toThrow('UPDATE_PRESTART_FILES_MISMATCH');
  expect(h.journal.read()?.phase).toBe('OLD_BINARY_RESTORED');
});

it('refuses a wrong old version, missing guard, or running service', async () => {
  const f = await fixture();
  await expect(f.check(() => { throw new Error('SERVICE_RUNNING'); })).rejects.toThrow('SERVICE_RUNNING');
  writeFileSync(join(f.appDir, 'server', 'version.json'), JSON.stringify({ format: 1, version: '0.9.0' }));
  await expect(f.check()).rejects.toThrow('UPDATE_PRESTART_VERSION_INVALID');
  const g = await fixture();
  writeFileSync(join(g.configDir, 'update-guard.json'), JSON.stringify({ format: 1, operationId: randomUUID() }));
  await expect(g.check()).rejects.toThrow('UPDATE_GUARD_MISMATCH');
});

it('detects altered old application code even when the version file still matches', async () => {
  const f = await fixture();
  writeFileSync(join(f.appDir, 'server', 'main.js'), 'altered');
  await expect(f.check()).rejects.toThrow('UPDATE_OLD_INVENTORY_MISMATCH');
  expect(f.journal.read()?.phase).toBe('OLD_BINARY_RESTORED');
});

it('starts only the guarded probe and accepts a fresh LocalService proof', async () => {
  const f = await fixture();
  expect(() => guardedStartupMode(f.configDir, f.backupRoot)).toThrow('UPDATE_GUARD_ACTIVE');
  await f.check();
  let starts = 0;
  const result = await f.startProbe(() => {
    starts++;
    expect(f.journal.read()?.phase).toBe('SERVICE_PROBE_INTENT');
    expect(guardedStartupMode(f.configDir, f.backupRoot)).toEqual({ kind: 'PROBE', operationId: f.operationId });
  });
  expect(result).toMatchObject({ state: 'SERVICE_PROBE_HEALTHY', version: '0.1.0', schemaVersion: 26 });
  expect(starts).toBe(1);
  expect(f.journal.read()?.phase).toBe('SERVICE_PROBE_HEALTHY');
  expect(readFileSync(join(f.configDir, 'update-guard.json'), 'utf8')).toContain(f.operationId);
  await expect(f.startProbe(() => { starts++; })).resolves.toMatchObject({ state: 'SERVICE_PROBE_HEALTHY' });
  expect(starts).toBe(2);
});

it('keeps probe intent after a failed service start and permits a guarded retry', async () => {
  const f = await fixture();
  await f.check();
  await expect(f.startProbe(() => { throw new Error('SCM_FAILED'); })).rejects.toThrow('SCM_FAILED');
  expect(f.journal.read()?.phase).toBe('SERVICE_PROBE_INTENT');
  expect(guardedStartupMode(f.configDir, f.backupRoot).kind).toBe('PROBE');
  await expect(f.startProbe(() => {})).resolves.toMatchObject({ state: 'SERVICE_PROBE_HEALTHY' });
});

it('refuses an installation without the stable bootstrap before advancing the journal', async () => {
  const f = await fixture();
  await f.check();
  await expect(startGuardedServiceProbe({ journal: f.journal, configDir: f.configDir, dataDir: f.dataDir,
    appDir: f.appDir, operationId: f.operationId, assertBootstrap: () => { throw new Error('UPDATE_SERVICE_BOOTSTRAP_REQUIRED'); },
    startService: () => { throw new Error('UNEXPECTED_START'); } })).rejects.toThrow('UPDATE_SERVICE_BOOTSTRAP_REQUIRED');
  expect(f.journal.read()?.phase).toBe('OLD_INSTALL_PRESTART_VERIFIED');
});

it('rejects forged probe responses and changed files while retaining the guard', async () => {
  const f = await fixture();
  await f.check();
  f.journal.recordServiceProbeIntent(f.operationId);
  const firstNonce = randomBytes(32).toString('base64url');
  const signed = await f.probeHealth(firstNonce);
  expect(verifyRecoveryProbeResponse(f.configDir, signed, { nonce: firstNonce,
    operationId: f.operationId, version: '0.1.0', schemaVersion: 26 })).toMatchObject({ dataDigest: signed.dataDigest });
  expect(() => verifyRecoveryProbeResponse(f.configDir, signed, { nonce: randomBytes(32).toString('base64url'),
    operationId: f.operationId, version: '0.1.0', schemaVersion: 26 })).toThrow('UPDATE_PROBE_UNTRUSTED');
  await expect(f.startProbe(() => {}, async () => ({ state: 'RECOVERY_PROBE_HEALTHY', operationId: f.operationId,
    version: '0.1.0', schemaVersion: 26, dataDigest: 'a'.repeat(64), proof: randomBytes(32).toString('base64url') }))).rejects.toThrow('UPDATE_PROBE_UNTRUSTED');
  expect(f.journal.read()?.phase).toBe('SERVICE_PROBE_INTENT');
  writeFileSync(join(f.appDir, 'server', 'main.js'), 'tampered');
  await expect(f.probeHealth(randomBytes(32).toString('base64url'))).rejects.toThrow('UPDATE_OLD_INVENTORY_MISMATCH');
  expect(f.journal.read()?.phase).toBe('SERVICE_PROBE_INTENT');
  const nonce = randomBytes(32).toString('base64url');
  expect(() => verifyRecoveryProbeResponse(f.configDir, {}, { nonce, operationId: f.operationId,
    version: '0.1.0', schemaVersion: 26 })).toThrow('UPDATE_PROBE_UNTRUSTED');
});

async function readyFixture() {
  const f = await fixture();
  await f.check();
  await f.startProbe(() => {});
  const finish = (hooks: {
    stopService?: () => void; startNormalService?: () => void; restartAfterCommit?: () => void;
    requestHealth?: (quarantine: boolean) => Promise<void>;
  } = {}) => finalizeRestoredRecovery({ journal: f.journal, configDir: f.configDir,
    backupRoot: f.backupRoot, dataDir: f.dataDir, appDir: f.appDir, operationId: f.operationId,
    probe: async () => f.probeHealth(randomBytes(32).toString('base64url')),
    stopService: hooks.stopService ?? (() => {}), assertServiceStopped: () => {},
    startNormalService: hooks.startNormalService ?? (() => {}),
    requestHealth: (_port, _version, _schema, quarantine) => hooks.requestHealth?.(quarantine) ?? Promise.resolve(),
    enableAutomatic: () => {}, restartAfterCommit: hooks.restartAfterCommit ?? (() => {}), stopUnhealthyService: () => {} });
  return { ...f, finish };
}

it('releases both guards only after a stopped, unchanged, proven restored install', async () => {
  const f = await readyFixture();
  let starts = 0;
  const checks: boolean[] = [];
  await expect(f.finish({ stopService: () => {
    expect(f.journal.read()?.phase).toBe('RECOVERY_FINALIZE_INTENT');
    expect(guardedStartupMode(f.configDir, f.backupRoot).kind).toBe('PROBE');
  }, startNormalService: () => {
    starts++;
    expect(f.journal.read()?.phase).toBe('RECOVERY_READY_TO_START');
    expect(guardedStartupMode(f.configDir, f.backupRoot).kind).toBe('NORMAL');
  }, requestHealth: async quarantine => { checks.push(quarantine); },
  restartAfterCommit: () => { expect(['RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED']).toContain(f.journal.read()?.phase); } })).resolves.toMatchObject({ state: 'RECOVERY_COMPLETED' });
  expect(starts).toBe(1);
  expect(checks).toEqual([true, true, false]);
  expect(f.journal.read()?.phase).toBe('RECOVERY_COMPLETED');
  expect(readdirSync(f.dataDir)).not.toContain('.update-data-restore.json');
  await expect(f.finish({ startNormalService: () => { starts++; } })).resolves.toMatchObject({ state: 'RECOVERY_COMPLETED' });
  expect(starts).toBe(2);
});

it('keeps the guard when stop fails or data changes before clearance', async () => {
  const f = await readyFixture();
  await expect(f.finish({ stopService: () => { throw new Error('SCM_FAILED'); } })).rejects.toThrow('SCM_FAILED');
  expect(f.journal.read()?.phase).toBe('RECOVERY_FINALIZE_INTENT');
  expect(guardedStartupMode(f.configDir, f.backupRoot).kind).toBe('PROBE');
  await expect(f.finish({ stopService: () => {
    writeFileSync(join(f.dataDir, 'branch-display.json'), '{"changed":true}');
  } })).rejects.toThrow('UPDATE_FINALIZE_FILES_CHANGED');
  expect(f.journal.read()?.phase).toBe('RECOVERY_FINALIZE_INTENT');
  expect(guardedStartupMode(f.configDir, f.backupRoot).kind).toBe('PROBE');

  const g = await readyFixture();
  await expect(g.finish({ stopService: () => {
    writeFileSync(join(g.dataDir, 'pos.sqlite-wal'), 'unexpected WAL content');
    writeFileSync(join(g.dataDir, 'pos.sqlite-shm'), 'sidecar');
  } })).rejects.toThrow('UPDATE_PROBE_DATA_INVALID');
  expect(g.journal.read()?.phase).toBe('RECOVERY_FINALIZE_INTENT');
  expect(guardedStartupMode(g.configDir, g.backupRoot).kind).toBe('PROBE');
});

it('requires the old application to advertise recovery quarantine support', async () => {
  const f = await readyFixture();
  writeFileSync(join(f.appDir, 'server', 'recovery-quarantine.json'), '{}');
  await expect(f.finish()).rejects.toThrow('UPDATE_RECOVERY_QUARANTINE_REQUIRED');
  expect(f.journal.read()?.phase).toBe('SERVICE_PROBE_HEALTHY');
  expect(guardedStartupMode(f.configDir, f.backupRoot).kind).toBe('PROBE');
});

it('reconstructs a guard after an interrupted first unlink and retries proof', async () => {
  const f = await readyFixture();
  f.journal.recordRecoveryFinalizeIntent(f.operationId);
  f.journal.recordRecoveryReadyToStart(f.operationId);
  unlinkSync(join(f.configDir, 'update-guard.json'));
  expect(() => guardedStartupMode(f.configDir, f.backupRoot)).toThrow('UPDATE_GUARD_ACTIVE');
  await expect(f.finish()).resolves.toMatchObject({ state: 'RECOVERY_COMPLETED' });
  expect(f.journal.read()?.phase).toBe('RECOVERY_COMPLETED');
});

it('blocks future service startups after an ordinary service health failure', async () => {
  const f = await readyFixture();
  await expect(f.finish({ requestHealth: async () => { throw new Error('HEALTH_FAILED'); } })).rejects.toThrow('HEALTH_FAILED');
  expect(f.journal.read()?.phase).toBe('RECOVERY_ACTIVATION_FAILED');
  expect(() => guardedStartupMode(f.configDir, f.backupRoot)).toThrow('UPDATE_GUARD_ACTIVE');
  await expect(f.finish()).rejects.toThrow('UPDATE_FINALIZE_STATE_INVALID');
});

it('fails closed when the restart after quarantine health is unhealthy', async () => {
  const f = await readyFixture();
  let stopped = false;
  await expect(finalizeRestoredRecovery({ journal: f.journal, configDir: f.configDir,
    backupRoot: f.backupRoot, dataDir: f.dataDir, appDir: f.appDir, operationId: f.operationId,
    probe: async () => f.probeHealth(randomBytes(32).toString('base64url')),
    stopService: () => {}, assertServiceStopped: () => {}, startNormalService: () => {},
    requestHealth: async (_port, _version, _schema, quarantine) => {
      if (!quarantine) throw new Error('NORMAL_HEALTH_FAILED');
    }, restartAfterCommit: () => {}, stopUnhealthyService: () => { stopped = true; },
    enableAutomatic: () => { throw new Error('UNEXPECTED_AUTO'); } })).rejects.toThrow('NORMAL_HEALTH_FAILED');
  expect(stopped).toBe(true);
  expect(f.journal.read()?.phase).toBe('RECOVERY_ACTIVATION_FAILED');
  expect(() => guardedStartupMode(f.configDir, f.backupRoot)).toThrow('UPDATE_GUARD_ACTIVE');
});

it('resumes after quarantine health was committed before the service restart', async () => {
  const f = await readyFixture();
  f.journal.recordRecoveryFinalizeIntent(f.operationId);
  f.journal.recordRecoveryReadyToStart(f.operationId);
  unlinkSync(join(f.configDir, 'update-guard.json'));
  unlinkSync(join(f.configDir, 'update-intent.json'));
  f.journal.recordRecoveryQuarantineHealthy(f.operationId);
  const checks: boolean[] = [];
  await expect(f.finish({ requestHealth: async quarantine => { checks.push(quarantine); },
    restartAfterCommit: () => { expect(['RECOVERY_QUARANTINE_HEALTHY', 'RECOVERY_COMMITTED']).toContain(f.journal.read()?.phase); } }))
    .resolves.toMatchObject({ state: 'RECOVERY_COMPLETED' });
  expect(checks).toEqual([true, false]);
});

it('allows health inspection while recovery quarantine blocks POS requests', async () => {
  const app = Fastify(), gate = new MaintenanceGate();
  gate.enterRecoveryQuarantine();
  gate.install(app);
  app.get('/api/v1/system/health/ready', async () => ({ ready: true }));
  app.get('/api/v1/system/version', async () => ({ releaseVersion: '0.1.0' }));
  app.post('/api/v1/orders', async () => ({ accepted: true }));
  try {
    expect((await app.inject({ method: 'GET', url: '/api/v1/system/health/ready' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/system/version' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/orders' })).statusCode).toBe(423);
    expect((await app.inject({ method: 'GET', url: '/api/v1/orders' })).statusCode).toBe(423);
    expect(() => gate.assertWritable()).toThrow('MAINTENANCE_PENDING');
  } finally { await app.close(); }
});
