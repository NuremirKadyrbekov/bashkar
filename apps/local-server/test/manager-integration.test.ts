import { afterEach, expect, it } from 'vitest';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Storage } from '../src/storage';
import { canonical, digest } from '../src/command-bus';
import { ActivationService } from '../src/modules/activation/activation-service';
import { createBackupSet } from '../src/recovery/backup-set';
import { verifyBackupRestore, acceptBackupCandidate } from '../src/recovery/backup-acceptance';
import { signPayloadManifest } from '../src/recovery/payload-manifest';
import { verifySignedRelease, type ReleaseManifest } from '../src/recovery/release-verifier';
import { verifyUpdateInstallGrant, type InstallGrantClaims } from '../src/recovery/update-authorization';
import { writeUpdateJob, readUpdateJob } from '../src/recovery/update-job';
import { UpdateJournal } from '../src/recovery/update-journal';
import { prepareAuthorizedUpdate } from '../src/recovery/update-manager';
import { runDurableMaintenance } from '../src/recovery/maintenance-receipt';
import { productionManagerHandlers } from '../src/recovery/manager-production-handlers';
import { runManagerOperation } from '../src/recovery/manager-runner';
import { captureOldBinaryInventory } from '../src/recovery/old-binary-inventory';
import { runGuardedMigration } from '../src/recovery/update-migration';
import { verifyPreMigrationData } from '../src/recovery/verify-pre-migration-data';
import { restoreGuardedData } from '../src/recovery/update-data-restore';
import { verifyRestoredInstallPrestart } from '../src/recovery/verify-restored-install';
import { inspectNewServiceProbe } from '../src/recovery/new-service-probe';
import { inspectRecoveryProbe, restoredDataDigest } from '../src/recovery/recovery-probe';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const protector = { protect: (value: Buffer) => value.toString('base64'),
  unprotect: (value: string) => Buffer.from(value, 'base64') };
const signerCertificateSha256 = 'a'.repeat(64);

async function fixture(failure: 'none' | 'stage' | 'migration' | 'migration-after-write' | 'switch-first' | 'switch-second' | 'normal-health' = 'none',
  schemaUpgrade = false) {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-manager-e2e-')); roots.push(root);
  const configDir = join(root, 'config'), backupRoot = join(root, 'backups'), updatesDir = join(root, 'updates'),
    dataDir = join(root, 'data'), appDir = join(root, 'Bashkar POS'), payload = join(root, 'payload');
  for (const path of [configDir, backupRoot, updatesDir]) mkdirSync(path, { mode: 0o700 });
  new Storage(dataDir).initialize();
  const instanceId = JSON.parse(readFileSync(join(dataDir, 'installation.json'), 'utf8')).id as string;
  const activationSigner = generateKeyPairSync('ed25519'), deviceKeys = generateKeyPairSync('ed25519');
  const testAuthorityPublicKey = activationSigner.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const devicePublicKey = deviceKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const devicePrivateKey = deviceKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  writeFileSync(join(dataDir, 'device-public.pem'), devicePublicKey);
  writeFileSync(join(dataDir, 'device-key.dpapi'), protector.protect(Buffer.from(devicePrivateKey)));
  const branchId = randomUUID(), registrationId = randomUUID(), ownerCloudId = randomUUID(), organizationId = randomUUID();
  const activationClaims = { version: 1 as const, instanceId, branchId, organizationId, ownerCloudId, registrationId,
    devicePublicKeyHash: digest(devicePublicKey), nonce: randomUUID(), issuedAt: Date.now() - 1000,
    expiresAt: Date.now() + 60000 };
  const activationReceipt = { claims: activationClaims,
    signature: sign(null, Buffer.from(canonical(activationClaims)), activationSigner.privateKey).toString('base64url') };
  const device = { publicKey: () => devicePublicKey, assertAvailable: () => {} };
  const activated = new Storage(dataDir); activated.open();
  try {
    await new ActivationService(activated.connection(), { publicKey: testAuthorityPublicKey }, device)
      .activateCloudOwner(activationReceipt, { email: 'owner@example.test', ownerCloudId }, activationClaims.nonce);
    const owner = activated.connection().prepare("SELECT id FROM employees WHERE role='OWNER'").get() as { id: string };
    activated.connection().prepare("INSERT INTO shifts(id,branch_id,status,opened_by,opened_at) VALUES(?,?,'CLOSED',?,?)")
      .run(randomUUID(), branchId, owner.id, Date.now() - 1000);
  } finally { activated.close(); }
  const sourceSchema = schemaUpgrade ? 25 : 26;
  if (schemaUpgrade) {
    const db = new Database(join(dataDir, 'pos.sqlite'));
    try { db.exec(`DROP TRIGGER queue_closed_shift_sales;
      DROP TRIGGER queue_refund_cloud;
      DROP TRIGGER queue_closed_shift_staff;
      DROP TABLE shift_cloud_delivery;
      DROP TABLE sale_cloud_delivery;
      DROP TABLE refund_cloud_delivery;
      DROP TABLE staff_cloud_delivery;
      DELETE FROM schema_migrations WHERE version=26;`); }
    finally { db.close(); }
  }
  const originalRows = (() => {
    const db = new Database(join(dataDir, 'pos.sqlite'), { readonly: true });
    try { return JSON.stringify({ activation: db.prepare('SELECT * FROM activation').all(),
      employees: db.prepare('SELECT * FROM employees').all(), shifts: db.prepare('SELECT * FROM shifts').all(),
      audit: db.prepare('SELECT * FROM audit_events').all() }); }
    finally { db.close(); }
  })();
  const testProtectedFiles = (dir: string, isActivated: boolean) => {
    expect(isActivated).toBe(true);
    const privateKey = createPrivateKey(protector.unprotect(readFileSync(join(dir, 'device-key.dpapi'), 'utf8')));
    expect(createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString())
      .toBe(readFileSync(join(dir, 'device-public.pem'), 'utf8'));
    const db = new Database(join(dir, 'pos.sqlite'), { readonly: true });
    try { expect(new ActivationService(db, { publicKey: testAuthorityPublicKey }, device).binding()).toMatchObject({ branchId }); }
    finally { db.close(); }
  };
  const oldFiles = ['Bashkar POS.exe', 'BashkarPOSLocalServer.exe', 'service.ps1', 'node.exe',
    'BashkarPOSLocalServer.xml', 'Uninstall.exe'];
  const newFiles = ['Bashkar POS.exe', 'BashkarPOSLocalServer.exe', 'service.ps1', 'node.exe'];
  for (const [dir, version, files] of [[appDir, '0.1.0', oldFiles], [payload, '0.2.0', newFiles]] as const) {
    mkdirSync(join(dir, 'server'), { recursive: true });
    for (const name of files) writeFileSync(join(dir, name), version);
    writeFileSync(join(dir, 'server', 'main.js'), version);
    writeFileSync(join(dir, 'server', 'version.json'), JSON.stringify({ format: 1, version }));
    writeFileSync(join(dir, 'server', 'recovery-quarantine.json'), JSON.stringify({ format: 1, capability: 'recovery-quarantine-v1' }));
  }
  writeFileSync(join(payload, 'server', 'update-migrate.js'), 'signed-test-migration');
  const publisher = generateKeyPairSync('ed25519'), cloud = generateKeyPairSync('ed25519');
  const releaseTrust = { keyId: 'test_publisher', publicKey: publisher.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  const cloudTrust = { keyId: 'test_cloud', publicKey: cloud.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  const payloadSigned = await signPayloadManifest(payload, 'release_020', '0.2.0',
    publisher.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), releaseTrust.publicKey);
  writeFileSync(join(payload, 'payload-manifest.signed.json'), JSON.stringify(payloadSigned));
  const artifactName = 'BashkarPOS-Setup-0.2.0-win-x64.exe', artifact = join(updatesDir, artifactName), bytes = Buffer.from('signed-test-installer');
  writeFileSync(artifact, bytes);
  const manifest: ReleaseManifest = { format: 1, releaseId: 'release_020', version: '0.2.0', gitCommit: 'a'.repeat(40),
    keyId: releaseTrust.keyId, platform: { os: 'win32', arch: 'x64' }, compatibility: { minSourceVersion: '0.1.0',
      maxSourceVersion: '0.1.0', minAgentVersion: '0.1.0', minSchema: sourceSchema, maxSchema: sourceSchema, targetSchema: 26,
      migrationVersions: schemaUpgrade ? [26] : [] }, artifact: { fileName: artifactName, sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') }, minFreeBytes: 0 };
  const signedRelease = { manifest, signature: sign(null, Buffer.from(canonical(manifest)), publisher.privateKey).toString('base64url') };
  const installed = { appVersion: '0.1.0', agentVersion: '0.1.0', schemaVersion: sourceSchema, os: 'win32', arch: 'x64', freeBytes: 1 };
  const verified = verifySignedRelease(signedRelease, releaseTrust, installed);
  const operationId = randomUUID(), actorId = randomUUID(), now = Date.now();
  const identity = { branchId, instanceId, registrationId };
  const actor = { id: actorId, branchId, role: 'OWNER', audience: 'LOCAL_ADMIN', method: 'CLOUD_OWNER' };
  const claims: InstallGrantClaims = { format: 1, action: 'INSTALL', keyId: cloudTrust.keyId, operationId, ...identity,
    actorId, releaseId: manifest.releaseId, manifestSha256: verified.manifestSha256, artifactSha256: manifest.artifact.sha256,
    issuedAt: now, expiresAt: now + 60000, nonce: randomUUID(), requiresClosedShift: true, requiresBackup: true };
  const signedGrant = { claims, signature: sign(null, Buffer.from(canonical(claims)), cloud.privateKey).toString('base64url') };
  const authorization = verifyUpdateInstallGrant(signedGrant, cloudTrust, identity, actor, verified, operationId, now);
  writeUpdateJob(configDir, authorization, signedRelease, signedGrant);
  const key = randomBytes(32);
  writeFileSync(join(configDir, 'update-control.key'), key.toString('base64url'));
  const journal = new UpdateJournal(configDir, backupRoot);
  const paths = { configDir, backupRoot, updatesDir, dataDir, versionPath: join(appDir, 'server', 'version.json') };
  const trust = { agentVersion: '0.1.0', releaseTrust, cloudTrust, signerCertificateSha256 };
  let backupsCreated = 0, stages = 0, migrations = 0, serviceStops = 0;
  let moves = 0;
  const requestMaintenance = async (id: string) => runDurableMaintenance(configDir, id, async () => {
    backupsCreated++;
    const storage = new Storage(dataDir); storage.open();
    let backup: Awaited<ReturnType<typeof createBackupSet>>;
    try { backup = await createBackupSet(dataDir, backupRoot, storage.connection(), protector, '0.1.0', undefined, testProtectedFiles); }
    finally { storage.close(); }
    const checked = await verifyBackupRestore({ path: backup.path, backupOperationId: backup.operationId,
      schemaVersion: sourceSchema, expectedIdentity: { instanceId, registrationId }, protector, testAuthorityPublicKey });
    return { state: 'MAINTENANCE_READY', schemaVersion: sourceSchema,
      backupCandidate: { operationId: backup.operationId, path: backup.path, verified: true }, restoreChecked: checked };
  }, async (_id, result) => {
    await verifyBackupRestore({ path: result.backupCandidate.path, backupOperationId: result.backupCandidate.operationId,
      schemaVersion: sourceSchema, expectedIdentity: { instanceId, registrationId }, protector, testAuthorityPublicKey });
  });
  const newProbe = (nonce: string) => inspectNewServiceProbe({ journal, configDir, dataDir, appDir, operationId,
    releaseTrust, nonce, key, assertLocalService: () => {} });
  const oldProbe = (nonce: string) => inspectRecoveryProbe({ journal, configDir, dataDir, appDir, operationId,
    nonce, protector, assertLocalService: () => {}, testAuthorityPublicKey });
  const handlers = productionManagerHandlers(paths, trust, journal, {
    readContext: () => ({ installed, identity }),
    prepare: async () => { await prepareAuthorizedUpdate({ authorization, artifactPath: artifact, journal,
      configDir, signerCertificateSha256, verifyAuthenticode: () => {}, requestMaintenance }); return journal.read()!; },
    requestMaintenance: async (_config, _pipe, id) => requestMaintenance(id!),
    localTask: async (action, id) => {
      if (action === 'verify-backup') await acceptBackupCandidate({ journal, operationId: id,
        expectedIdentity: { instanceId, registrationId }, protector, testAuthorityPublicKey });
      else if (action === 'verify-pre-migration') await verifyPreMigrationData({ journal, configDir, dataDir, appDir,
        operationId: id, protector, assertLocalService: () => {}, assertServiceStopped: () => {}, testAuthorityPublicKey });
      else if (action === 'restore-data') await restoreGuardedData({ journal, configDir, dataDir, operationId: id,
        protector, assertLocalService: () => {}, assertServiceStopped: () => {}, testAuthorityPublicKey, testProtectedFiles });
      else await verifyRestoredInstallPrestart({ journal, configDir, dataDir, appDir, operationId: id,
        protector, assertLocalService: () => {}, assertServiceStopped: () => {}, testAuthorityPublicKey });
    },
    stopService: () => { serviceStops++; }, captureInventory: captureOldBinaryInventory,
    stage: (_artifact, stage) => { stages++; if (failure === 'stage') throw new Error('NSIS_FAILED'); cpSync(payload, stage, { recursive: true }); },
    migrate: (_node, _script, id) => { migrations++; runGuardedMigration({ journal, configDir, dataDir,
      versionPath: join(appDir, 'server', 'version.json'), operationId: id, assertServiceStopped: () => {},
      afterIntent: () => { if (failure === 'migration') throw new Error('MIGRATION_FAILED'); },
      migrate: dir => { new Storage(dir).migrate(); if (failure === 'migration-after-write') throw new Error('MIGRATION_AFTER_WRITE'); } }); },
    authenticode: () => {}, serviceStopped: () => {}, noMigrationProcess: () => {},
    switchMove: (from, to) => { renameSync(from, to); moves++;
      if ((failure === 'switch-first' && moves === 1) || (failure === 'switch-second' && moves === 2))
        throw new Error('INTERRUPTED_RENAME'); },
    newProbe: { assertBootstrap: () => {}, assertServiceStopped: () => {}, startService: () => {}, requestHealth: nonce => newProbe(nonce) },
    oldProbe: { assertBootstrap: () => {}, startService: () => {}, requestHealth: nonce => oldProbe(nonce) },
    newFinalizer: { probe: async () => ({ dataDigest: restoredDataDigest(dataDir), version: '0.2.0', schemaVersion: 26 }),
      stopService: () => {}, assertServiceStopped: () => {}, startService: () => {}, restartService: () => {},
      stopUnhealthyService: () => {}, enableAutomatic: () => {}, requestHealth: async (_port, _version, _schema, quarantine) => {
        if (failure === 'normal-health' && !quarantine) throw new Error('NORMAL_HEALTH_FAILED');
      } },
    oldFinalizer: { probe: () => oldProbe(randomBytes(32).toString('base64url')).then(result => ({
      dataDigest: result.dataDigest, version: result.version, schemaVersion: result.schemaVersion })),
      stopService: () => {}, assertServiceStopped: () => {}, startNormalService: () => {}, restartAfterCommit: () => {},
      stopUnhealthyService: () => {}, enableAutomatic: () => {}, requestHealth: async () => {} }
  });
  const job = readUpdateJob(configDir)!;
  const run = (maxSteps?: number) => runManagerOperation({ journal, configDir, job, handlers,
    lockPath: join(root, 'manager.sock'), maxSteps });
  return { root, configDir, backupRoot, dataDir, appDir, operationId, journal, run,
    schemaVersion: () => { const db = new Database(join(dataDir, 'pos.sqlite'), { readonly: true });
      try { return (db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version; }
      finally { db.close(); } },
    counts: () => ({ backupsCreated, stages, migrations, serviceStops }),
    assertRows: () => { const db = new Database(join(dataDir, 'pos.sqlite'), { readonly: true });
      try { expect(JSON.stringify({ activation: db.prepare('SELECT * FROM activation').all(),
        employees: db.prepare('SELECT * FROM employees').all(), shifts: db.prepare('SELECT * FROM shifts').all(),
        audit: db.prepare('SELECT * FROM audit_events').all() })).toBe(originalRows); }
      finally { db.close(); } } };
}

it.skipIf(process.platform === 'win32')('executes signed A → B through one Manager and preserves SQLite rows', async () => {
  const f = await fixture();
  const result = await f.run();
  expect(result.action).toBe('NEW_UPDATE_COMPLETED');
  expect(f.journal.read()?.phase).toBe('NEW_UPDATE_COMPLETED');
  expect(readFileSync(join(f.appDir, 'server', 'version.json'), 'utf8')).toContain('0.2.0');
  expect(f.counts()).toMatchObject({ backupsCreated: 1, stages: 1, migrations: 1 });
  f.assertRows();
});

it.skipIf(process.platform === 'win32')('returns old files and data after stage failure before migration intent', async () => {
  const f = await fixture('stage');
  const result = await f.run();
  expect(result.action).toBe('RECOVERY_COMPLETED');
  expect(readFileSync(join(f.appDir, 'server', 'version.json'), 'utf8')).toContain('0.1.0');
  expect(f.counts()).toMatchObject({ backupsCreated: 1, stages: 1, migrations: 0 });
  f.assertRows();
});

it.skipIf(process.platform === 'win32')('restores data under LocalService after migration intent', async () => {
  const f = await fixture('migration');
  const result = await f.run();
  expect(result.action).toBe('RECOVERY_COMPLETED');
  expect(readFileSync(join(f.appDir, 'server', 'version.json'), 'utf8')).toContain('0.1.0');
  expect(f.counts()).toMatchObject({ backupsCreated: 1, stages: 1, migrations: 1 });
  f.assertRows();
});

it.skipIf(process.platform === 'win32')('migrates an isolated SQLite schema 25 → 26 and preserves committed rows', async () => {
  const f = await fixture('none', true);
  expect(f.schemaVersion()).toBe(25);
  expect((await f.run()).action).toBe('NEW_UPDATE_COMPLETED');
  expect(f.schemaVersion()).toBe(26);
  expect(readFileSync(join(f.appDir, 'server', 'version.json'), 'utf8')).toContain('0.2.0');
  f.assertRows();
});

it.skipIf(process.platform === 'win32')('restores schema 25 and old files after migration changed SQLite then failed', async () => {
  const f = await fixture('migration-after-write', true);
  expect(f.schemaVersion()).toBe(25);
  expect((await f.run()).action).toBe('RECOVERY_COMPLETED');
  expect(f.schemaVersion()).toBe(25);
  expect(readFileSync(join(f.appDir, 'server', 'version.json'), 'utf8')).toContain('0.1.0');
  f.assertRows();
});

it.skipIf(process.platform === 'win32')('resumes after each Manager step without repeating Backup Set or stage', async () => {
  for (const steps of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const f = await fixture();
    await expect(f.run(steps)).rejects.toThrow('UPDATE_MANAGER_STEP_LIMIT');
    expect((await f.run()).action).toBe('NEW_UPDATE_COMPLETED');
    expect(f.counts()).toMatchObject({ backupsCreated: 1, stages: 1, migrations: 1 });
    f.assertRows();
  }
}, 30000);

it.skipIf(process.platform === 'win32')('routes a failed new prestart check to guarded post-intent recovery', async () => {
  const f = await fixture();
  await expect(f.run(5)).rejects.toThrow('UPDATE_MANAGER_STEP_LIMIT');
  expect(f.journal.read()?.phase).toBe('MIGRATED');
  writeFileSync(join(f.appDir, 'server', 'main.js'), 'corrupt-new-payload');
  expect((await f.run()).action).toBe('RECOVERY_COMPLETED');
  f.assertRows();
});

it.skipIf(process.platform === 'win32')('never rolls data back after ordinary POS exposure fails health', async () => {
  const f = await fixture('normal-health');
  await expect(f.run()).rejects.toThrow('NORMAL_HEALTH_FAILED');
  expect(f.journal.read()?.phase).toBe('NEW_ACTIVATION_FAILED');
  expect(() => f.journal.recordDataRestoreIntent(f.operationId)).toThrow('UPDATE_OPERATION_STATE_INVALID');
  await expect(f.run()).rejects.toThrow('UPDATE_MANAGER_MANUAL_RECONCILIATION_REQUIRED');
  f.assertRows();
});

it.skipIf(process.platform === 'win32')('refuses a changed job or guard before another dangerous step', async () => {
  const job = await fixture();
  const jobPath = join(job.configDir, 'update-job.json');
  writeFileSync(jobPath, JSON.stringify({ ...JSON.parse(readFileSync(jobPath, 'utf8')), actorId: randomUUID() }));
  await expect(job.run()).rejects.toThrow('UPDATE_JOB_INVALID');
  expect(job.journal.read()).toBeNull();
  job.assertRows();
  const guard = await fixture();
  await expect(guard.run(3)).rejects.toThrow('UPDATE_MANAGER_STEP_LIMIT');
  const phase = guard.journal.read()?.phase;
  writeFileSync(join(guard.configDir, 'update-guard.json'), JSON.stringify({ format: 1, operationId: randomUUID() }));
  await expect(guard.run()).rejects.toThrow('UPDATE_MANAGER_GUARD_INVALID');
  expect(guard.journal.read()?.phase).toBe(phase);
  guard.assertRows();
});

it.skipIf(process.platform === 'win32')('recovers after interruption following either binary rename', async () => {
  for (const point of ['switch-first', 'switch-second'] as const) {
    const f = await fixture(point);
    expect((await f.run()).action).toBe('RECOVERY_COMPLETED');
    expect(f.counts()).toMatchObject({ backupsCreated: 1, stages: 1, migrations: 0 });
    f.assertRows();
  }
});

it.skipIf(process.platform === 'win32')('resumes both recovery paths at each durable Manager boundary', async () => {
  for (const failure of ['stage', 'migration'] as const) {
    for (const steps of [1, 2, 3, 4, 5, 6, 7]) {
      const f = await fixture(failure);
      await expect(f.run(steps)).rejects.toThrow('UPDATE_MANAGER_STEP_LIMIT');
      expect((await f.run()).action).toBe('RECOVERY_COMPLETED');
      expect(f.counts().backupsCreated).toBe(1);
      f.assertRows();
    }
  }
}, 30000);
