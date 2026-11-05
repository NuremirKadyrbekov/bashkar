import { afterEach, expect, it } from 'vitest';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateJournal } from '../src/recovery/update-journal';
import { verifySignedRelease, type ReleaseManifest } from '../src/recovery/release-verifier';
import { verifyUpdateInstallGrant, type InstallGrantClaims } from '../src/recovery/update-authorization';
import { canonical } from '../src/command-bus';
import { quiesceVerifiedUpdate } from '../src/recovery/windows-service-control';
import { acceptBackupCandidate } from '../src/recovery/backup-acceptance';
import { createBackupSet } from '../src/recovery/backup-set';
import { Storage } from '../src/storage';
import { beginGuardedOperation, guardedStartupMode } from '../src/recovery/startup-guard';
import { restoreOldBinaryBeforeMigration, switchVerifiedBinary } from '../src/recovery/binary-switch';
import { signPayloadManifest } from '../src/recovery/payload-manifest';
import { runGuardedMigration } from '../src/recovery/update-migration';
import { captureOldBinaryInventory } from '../src/recovery/old-binary-inventory';
import { classifyGuardedRecovery, inspectMigratedInstall } from '../src/recovery/update-health';
import { restoreOldBinaryAfterData } from '../src/recovery/restore-old-binary-after-data';
import { verifyNewInstallPrestart } from '../src/recovery/verify-new-install';
import { inspectNewServiceProbe, startGuardedNewServiceProbe } from '../src/recovery/new-service-probe';
import { finalizeNewUpdate } from '../src/recovery/finalize-new-update';
import { restoredDataDigest } from '../src/recovery/recovery-probe';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-update-journal-'));
  roots.push(root);
  const config = join(root, 'config'), backups = join(root, 'backups');
  mkdirSync(config, { mode: 0o700 }); mkdirSync(backups, { mode: 0o700 });
  return { root, config, backups, journal: new UpdateJournal(config, backups) };
}
function release() {
  const pair = generateKeyPairSync('ed25519');
  const manifest: ReleaseManifest = {
    format: 1, releaseId: 'release_020', version: '0.2.0', gitCommit: 'a'.repeat(40), keyId: 'test',
    platform: { os: 'win32', arch: 'x64' },
    compatibility: { minSourceVersion: '0.1.0', maxSourceVersion: '0.1.0', minAgentVersion: '0.1.0', minSchema: 26, maxSchema: 26, targetSchema: 26, migrationVersions: [] },
    artifact: { fileName: 'BashkarPOS-Setup-0.2.0-win-x64.exe', sizeBytes: 1, sha256: 'a'.repeat(64) }, minFreeBytes: 0
  };
  return verifySignedRelease({ manifest, signature: sign(null, Buffer.from(canonical(manifest)), pair.privateKey).toString('base64url') }, { keyId: 'test', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, { appVersion: '0.1.0', agentVersion: '0.1.0', schemaVersion: 26, os: 'win32', arch: 'x64', freeBytes: 1 });
}
function authorization(operationId = randomUUID()) {
  const verified = release(), pair = generateKeyPairSync('ed25519'), branchId = randomUUID(), actorId = randomUUID(), now = Date.now();
  const identity = { branchId, instanceId: randomUUID(), registrationId: randomUUID() };
  const actor = { id: actorId, branchId, role: 'OWNER', audience: 'LOCAL_ADMIN', method: 'CLOUD_OWNER' };
  const claims: InstallGrantClaims = { format: 1, action: 'INSTALL', keyId: 'test', operationId, ...identity, actorId, releaseId: verified.manifest.releaseId, manifestSha256: verified.manifestSha256, artifactSha256: verified.manifest.artifact.sha256, issuedAt: now, expiresAt: now + 60000, nonce: randomUUID(), requiresClosedShift: true, requiresBackup: true };
  const grant = { claims, signature: sign(null, Buffer.from(canonical(claims)), pair.privateKey).toString('base64url') };
  return verifyUpdateInstallGrant(grant, { keyId: 'test', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, identity, actor, verified, operationId, now);
}

it('persists intent before maintenance, then records only a backup candidate across restart', () => {
  const { config, backups, journal } = fixture();
  const operationId = randomUUID(), backupId = randomUUID(), path = join(backups, backupId);
  const authorized = authorization(operationId), verified = authorized.release;
  const started = journal.start(authorized);
  expect(started).toMatchObject({ operationId, actorId: authorized.actorId, grantSha256: authorized.grantSha256, releaseId: verified.manifest.releaseId, manifestSha256: verified.manifestSha256, artifactSha256: verified.manifest.artifact.sha256, phase: 'WAITING_FOR_MAINTENANCE', backup: null });
  expect(new UpdateJournal(config, backups).read()).toEqual(started);
  expect(() => journal.start(authorization())).toThrow('UPDATE_OPERATION_EXISTS');
  mkdirSync(path, { mode: 0o700 }); writeFileSync(join(path, 'manifest.json'), '{}');
  const candidate = journal.recordCandidate(operationId, { state: 'MAINTENANCE_READY', schemaVersion: 26, backupCandidate: { operationId: backupId, path, verified: true } });
  expect(candidate).toMatchObject({ phase: 'BACKUP_CANDIDATE', backup: { operationId: backupId, schemaVersion: 26 }, errorCode: null });
  expect(new UpdateJournal(config, backups).read()).toEqual(candidate);
  expect(() => journal.recordCandidate(operationId, { state: 'MAINTENANCE_READY', schemaVersion: 26, backupCandidate: { operationId: backupId, path, verified: true } })).toThrow('UPDATE_OPERATION_STATE_INVALID');
});

it('requires a matching Backup Set path and preserves intent on rejection', () => {
  const { root, backups, journal } = fixture();
  const operationId = randomUUID(), backupId = randomUUID();
  journal.start(authorization(operationId));
  const outside = join(root, backupId);
  mkdirSync(outside, { mode: 0o700 }); writeFileSync(join(outside, 'manifest.json'), '{}');
  expect(() => journal.recordCandidate(operationId, { state: 'MAINTENANCE_READY', schemaVersion: 26, backupCandidate: { operationId: backupId, path: outside, verified: true } })).toThrow('UPDATE_BACKUP_CANDIDATE_INVALID');
  expect(journal.read()?.phase).toBe('WAITING_FOR_MAINTENANCE');
  expect(() => journal.recordCandidate(operationId, { state: 'MAINTENANCE_READY', schemaVersion: 26, backupCandidate: { operationId: backupId, path: join(backups, backupId), verified: true } })).toThrow();
  expect(journal.read()?.phase).toBe('WAITING_FOR_MAINTENANCE');
});

it('fails closed on interrupted, corrupt, or linked journal files', () => {
  const { config, journal } = fixture();
  writeFileSync(join(config, '.update-operation-interrupted.tmp'), '{');
  expect(() => journal.read()).toThrow('UPDATE_JOURNAL_INCOMPLETE');
  rmSync(join(config, '.update-operation-interrupted.tmp'));
  writeFileSync(join(config, 'update-operation.json'), '{');
  expect(() => journal.read()).toThrow('UPDATE_JOURNAL_INVALID');
  rmSync(join(config, 'update-operation.json'));
  symlinkSync(join(config, 'missing'), join(config, 'update-operation.json'));
  expect(() => journal.read()).toThrow('UPDATE_JOURNAL_INVALID');
});

it('records an ambiguous interruption as recovery required without retrying', () => {
  const { config, backups, journal } = fixture();
  const operationId = randomUUID();
  journal.start(authorization(operationId));
  const interrupted = journal.markRecoveryRequired(operationId, 'UPDATE_CONTROL_CLOSED');
  expect(interrupted).toMatchObject({ phase: 'RECOVERY_REQUIRED', errorCode: 'UPDATE_CONTROL_CLOSED', backup: null });
  expect(new UpdateJournal(config, backups).read()).toEqual(interrupted);
  expect(() => journal.start(authorization())).toThrow('UPDATE_OPERATION_EXISTS');
});

it('does not touch SCM for a backup candidate', () => {
  const { config, backups, journal } = fixture();
  const operationId = randomUUID(), backupId = randomUUID(), path = join(backups, backupId);
  journal.start(authorization(operationId));
  mkdirSync(path, { mode: 0o700 }); writeFileSync(join(path, 'manifest.json'), '{}');
  journal.recordCandidate(operationId, { state: 'MAINTENANCE_READY', schemaVersion: 26, backupCandidate: { operationId: backupId, path, verified: true } });
  let called = false;
  expect(() => quiesceVerifiedUpdate({ journal, configDir: config, operationId, stopService: () => { called = true; } })).toThrow('UPDATE_BACKUP_NOT_VERIFIED');
  expect(called).toBe(false);
});

it('writes the startup guard before SCM and retains recovery state on failure', () => {
  const { config, backups, journal } = fixture();
  const operationId = randomUUID(), backupId = randomUUID(), path = join(backups, backupId);
  journal.start(authorization(operationId));
  mkdirSync(path, { mode: 0o700 }); writeFileSync(join(path, 'manifest.json'), '{}');
  journal.recordCandidate(operationId, { state: 'MAINTENANCE_READY', schemaVersion: 26, backupCandidate: { operationId: backupId, path, verified: true } });
  // Future Windows restore acceptance will own this transition. Inject only
  // a valid verified journal fixture to test the service-control boundary.
  const journalPath = join(config, 'update-operation.json');
  const row = JSON.parse(readFileSync(journalPath, 'utf8'));
  writeFileSync(journalPath, JSON.stringify({ ...row, phase: 'BACKUP_VERIFIED' }));
  expect(() => quiesceVerifiedUpdate({ journal, configDir: config, operationId, stopService: (actualOperation, actualBackup) => {
    expect(actualOperation).toBe(operationId);
    expect(actualBackup).toBe(backupId);
    expect(JSON.parse(readFileSync(join(config, 'update-intent.json'), 'utf8')).backupOperationId).toBe(backupId);
    expect(JSON.parse(readFileSync(join(config, 'update-guard.json'), 'utf8')).operationId).toBe(operationId);
    throw new Error('SCM_FAILED');
  } })).toThrow('SCM_FAILED');
  expect(journal.read()).toMatchObject({ phase: 'RECOVERY_REQUIRED', errorCode: 'UPDATE_SERVICE_UNCONFIRMED' });
  expect(() => quiesceVerifiedUpdate({ journal, configDir: config, operationId, stopService: () => {} })).toThrow('UPDATE_BACKUP_NOT_VERIFIED');
});

it('returns only a quiesced result after the guarded service stop succeeds', () => {
  const { config, backups, journal } = fixture();
  const operationId = randomUUID(), backupId = randomUUID(), path = join(backups, backupId);
  journal.start(authorization(operationId));
  mkdirSync(path, { mode: 0o700 }); writeFileSync(join(path, 'manifest.json'), '{}');
  journal.recordCandidate(operationId, { state: 'MAINTENANCE_READY', schemaVersion: 26, backupCandidate: { operationId: backupId, path, verified: true } });
  const journalPath = join(config, 'update-operation.json');
  writeFileSync(journalPath, JSON.stringify({ ...JSON.parse(readFileSync(journalPath, 'utf8')), phase: 'BACKUP_VERIFIED' }));
  const result = quiesceVerifiedUpdate({ journal, configDir: config, operationId, stopService: () => {
    expect(readFileSync(join(config, 'update-intent.json'), 'utf8')).toContain(operationId);
  }, appDir: join(config, '..', 'Bashkar POS'), captureInventory: (_config, _app, actualOperation) => {
    expect(actualOperation).toBe(operationId);
    expect(journal.read()?.phase).toBe('BACKUP_VERIFIED');
    return '0.1.0';
  } });
  expect(result).toEqual({ serviceName: 'BashkarPOSLocalServer', operationId, backupPath: path, state: 'SERVICE_QUIESCED' });
  expect(journal.read()?.phase).toBe('SERVICE_QUIESCED');
});

it('accepts a matching encrypted Backup Set after checking the SQLite restore in RAM', async () => {
  const { root, config, backups, journal } = fixture();
  const data = join(root, 'data');
  new Storage(data).initialize();
  const storage = new Storage(data);
  storage.open();
  const protector = { protect: (value: Buffer) => value.toString('base64'), unprotect: (value: string) => Buffer.from(value, 'base64') };
  const operationId = randomUUID();
  try {
    const backup = await createBackupSet(data, backups, storage.connection(), protector, '0.1.0');
    const instanceId = JSON.parse(readFileSync(join(data, 'installation.json'), 'utf8')).id as string;
    journal.start(authorization(operationId));
    journal.recordCandidate(operationId, { state: 'MAINTENANCE_READY', schemaVersion: 26, backupCandidate: { ...backup, verified: true } });
    await expect(acceptBackupCandidate({ journal, operationId, expectedIdentity: { instanceId: randomUUID(), registrationId: null }, protector })).rejects.toThrow('RECOVERY_IDENTITY_INVALID');
    expect(journal.read()?.phase).toBe('BACKUP_CANDIDATE');
    const accepted = await acceptBackupCandidate({ journal, operationId, expectedIdentity: { instanceId, registrationId: null }, protector });
    expect(accepted.phase).toBe('BACKUP_VERIFIED');
  } finally { storage.close(); }
});

async function binaryFixture() {
  const f = fixture(), operationId = randomUUID(), backupId = randomUUID(), backupPath = join(f.backups, backupId);
  mkdirSync(backupPath, { mode: 0o700 }); writeFileSync(join(backupPath, 'manifest.json'), '{}');
  f.journal.start(authorization(operationId));
  f.journal.recordCandidate(operationId, { state: 'MAINTENANCE_READY', schemaVersion: 26, backupCandidate: { operationId: backupId, path: backupPath, verified: true } });
  const journalPath = join(f.config, 'update-operation.json');
  writeFileSync(journalPath, JSON.stringify({ ...JSON.parse(readFileSync(journalPath, 'utf8')), phase: 'SERVICE_QUIESCED' }));
  beginGuardedOperation(f.config, operationId, backupId);
  const appDir = join(f.root, 'Bashkar POS'), incoming = join(f.root, `Bashkar POS.incoming.${operationId}`);
  for (const dir of [appDir, incoming]) {
    mkdirSync(join(dir, 'server'), { recursive: true });
    for (const name of ['Bashkar POS.exe', 'BashkarPOSLocalServer.exe', 'service.ps1', 'node.exe', join('server', 'main.js'), ...(dir === appDir ? ['BashkarPOSLocalServer.xml', 'Uninstall.exe'] : [])]) writeFileSync(join(dir, name), dir === appDir ? 'old' : 'new');
    writeFileSync(join(dir, 'server', 'version.json'), JSON.stringify({ format: 1, version: dir === appDir ? '0.1.0' : '0.2.0' }));
    if (dir === incoming) writeFileSync(join(dir, 'server', 'recovery-quarantine.json'), JSON.stringify({ format: 1, capability: 'recovery-quarantine-v1' }));
  }
  const signer = generateKeyPairSync('ed25519'), publicKey = signer.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signed = await signPayloadManifest(incoming, 'release_020', '0.2.0', signer.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey);
  writeFileSync(join(incoming, 'payload-manifest.signed.json'), JSON.stringify(signed));
  return { ...f, operationId, appDir, incoming, releaseTrust: { publicKey }, release: { releaseId: 'release_020', version: '0.2.0' }, previous: join(f.root, `Bashkar POS.previous.${operationId}`) };
}

it('retains the old program directory after switching to verified incoming files', async () => {
  const f = await binaryFixture();
  const row = await switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId,
    releaseTrust: f.releaseTrust, release: f.release });
  expect(row.phase).toBe('BINARY_SWITCHED');
  expect(readFileSync(join(f.appDir, 'node.exe'), 'utf8')).toBe('new');
  expect(readFileSync(join(f.previous, 'node.exe'), 'utf8')).toBe('old');
  expect(restoreOldBinaryBeforeMigration({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId }).state).toBe('PRE_MIGRATION_BINARY_RESTORED');
  expect(readFileSync(join(f.appDir, 'node.exe'), 'utf8')).toBe('old');
  expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_BINARY_RESTORED');
});

it('rechecks that the service is stopped before switching or recovering old files', async () => {
  const f = await binaryFixture();
  await expect(switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir,
    operationId: f.operationId, releaseTrust: f.releaseTrust, release: f.release,
    assertServiceStopped: () => { throw new Error('SERVICE_RUNNING'); } })).rejects.toThrow('SERVICE_RUNNING');
  expect(f.journal.read()?.phase).toBe('SERVICE_QUIESCED');
  expect(readFileSync(join(f.appDir, 'node.exe'), 'utf8')).toBe('old');
  await switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir,
    operationId: f.operationId, releaseTrust: f.releaseTrust, release: f.release,
    assertServiceStopped: () => {} });
  expect(() => restoreOldBinaryBeforeMigration({ journal: f.journal, configDir: f.config,
    appDir: f.appDir, operationId: f.operationId,
    assertServiceStopped: () => { throw new Error('SERVICE_RUNNING'); } })).toThrow('SERVICE_RUNNING');
  expect(f.journal.read()?.phase).toBe('BINARY_SWITCHED');
  expect(readFileSync(join(f.appDir, 'node.exe'), 'utf8')).toBe('new');
});

it('resumes staging when a crash left one copied wrapper file in the verified payload', async () => {
  const f = await binaryFixture();
  copyFileSync(join(f.appDir, 'BashkarPOSLocalServer.xml'), join(f.incoming, 'BashkarPOSLocalServer.xml'));
  const result = await switchVerifiedBinary({ journal: f.journal, configDir: f.config,
    appDir: f.appDir, operationId: f.operationId, releaseTrust: f.releaseTrust, release: f.release });
  expect(result.phase).toBe('BINARY_SWITCHED');
  expect(readFileSync(join(f.appDir, 'Uninstall.exe'), 'utf8')).toBe('old');
});

it('records migration intent and verifies the installed version, database identity, and resulting schema', async () => {
  const f = await binaryFixture(), dataDir = join(f.root, 'data');
  new Storage(dataDir).initialize();
  await switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId,
    releaseTrust: f.releaseTrust, release: f.release });
  const migrated = runGuardedMigration({ journal: f.journal, configDir: f.config, dataDir,
    versionPath: join(f.appDir, 'server', 'version.json'), operationId: f.operationId,
    assertServiceStopped: () => {}, migrate: () => { throw new Error('UNEXPECTED_MIGRATION'); } });
  expect(migrated.phase).toBe('MIGRATED');
  expect(migrated.targetSchema).toBe(26);
  expect(() => restoreOldBinaryBeforeMigration({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId })).toThrow('UPDATE_BINARY_RECOVERY_DENIED');
});

it('keeps the post-migration recovery boundary after a recorded failure', async () => {
  const f = await binaryFixture(), dataDir = join(f.root, 'data');
  new Storage(dataDir).initialize();
  await switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId,
    releaseTrust: f.releaseTrust, release: f.release });
  expect(classifyGuardedRecovery({ journal: f.journal, configDir: f.config, operationId: f.operationId }).kind).toBe('OLD_BINARY_RECOVERY_ALLOWED');
  f.journal.recordMigrationIntent(f.operationId);
  expect(classifyGuardedRecovery({ journal: f.journal, configDir: f.config, operationId: f.operationId }).kind).toBe('LOCAL_SERVICE_DATA_RESTORE_REQUIRED');
  const failed = f.journal.markRecoveryRequired(f.operationId, 'UPDATE_MIGRATION_FAILED');
  expect(failed.phase).toBe('MIGRATION_RECOVERY_REQUIRED');
  expect(new UpdateJournal(f.config, f.backups).read()?.phase).toBe('MIGRATION_RECOVERY_REQUIRED');
  expect(classifyGuardedRecovery({ journal: f.journal, configDir: f.config, operationId: f.operationId }).kind).toBe('LOCAL_SERVICE_DATA_RESTORE_REQUIRED');
  expect(() => restoreOldBinaryBeforeMigration({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId })).toThrow('UPDATE_BINARY_RECOVERY_DENIED');
});

it('checks the migrated install without starting the service or opening the backup key', async () => {
  const f = await binaryFixture(), dataDir = join(f.root, 'data');
  new Storage(dataDir).initialize();
  await switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId,
    releaseTrust: f.releaseTrust, release: f.release });
  runGuardedMigration({ journal: f.journal, configDir: f.config, dataDir,
    versionPath: join(f.appDir, 'server', 'version.json'), operationId: f.operationId,
    assertServiceStopped: () => {}, migrate: () => { throw new Error('UNEXPECTED_MIGRATION'); } });
  const checked = inspectMigratedInstall({ journal: f.journal, configDir: f.config, dataDir, appDir: f.appDir,
    operationId: f.operationId, assertServiceStopped: () => {} });
  expect(checked).toMatchObject({ state: 'PRESTART_CHECKED', version: '0.2.0', schemaVersion: 26,
    counts: { shifts: 0, orders: 0, payments: 0, print_jobs: 0, outbox: 0 } });
  writeFileSync(join(f.appDir, 'server', 'version.json'), JSON.stringify({ format: 1, version: '0.3.0' }));
  expect(() => inspectMigratedInstall({ journal: f.journal, configDir: f.config, dataDir, appDir: f.appDir,
    operationId: f.operationId, assertServiceStopped: () => {} })).toThrow('UPDATE_HEALTH_VERSION_INVALID');
  expect(f.journal.markRecoveryRequired(f.operationId, 'UPDATE_HEALTH_FAILED').phase).toBe('MIGRATION_RECOVERY_REQUIRED');
  expect(classifyGuardedRecovery({ journal: f.journal, configDir: f.config, operationId: f.operationId }).kind).toBe('LOCAL_SERVICE_DATA_RESTORE_REQUIRED');
  expect(() => restoreOldBinaryBeforeMigration({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId })).toThrow('UPDATE_BINARY_RECOVERY_DENIED');
  expect(() => inspectMigratedInstall({ journal: f.journal, configDir: f.config, dataDir, appDir: f.appDir,
    operationId: f.operationId, assertServiceStopped: () => {} })).toThrow('UPDATE_HEALTH_STATE_INVALID');
  expect(f.journal.read()?.phase).toBe('MIGRATION_RECOVERY_REQUIRED');
});

it('accepts a signed new install only after matching the retained old files and migrated data', async () => {
  const f = await binaryFixture(), dataDir = join(f.root, 'data');
  new Storage(dataDir).initialize();
  const instanceId = JSON.parse(readFileSync(join(dataDir, 'installation.json'), 'utf8')).id as string;
  const backup = f.journal.read()!.backup!;
  writeFileSync(join(backup.path, 'manifest.json'), JSON.stringify({ operationId: backup.operationId,
    instanceId, softwareVersion: '0.1.0', schemaVersion: 26 }));
  await switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir,
    operationId: f.operationId, releaseTrust: f.releaseTrust, release: f.release });
  runGuardedMigration({ journal: f.journal, configDir: f.config, dataDir,
    versionPath: join(f.appDir, 'server', 'version.json'), operationId: f.operationId,
    assertServiceStopped: () => {}, migrate: () => { throw new Error('UNEXPECTED_MIGRATION'); } });
  const check = () => verifyNewInstallPrestart({ journal: f.journal, configDir: f.config,
    dataDir, appDir: f.appDir, operationId: f.operationId,
    releaseTrust: f.releaseTrust, assertServiceStopped: () => {} });
  await expect(check()).resolves.toMatchObject({ state: 'NEW_INSTALL_PRESTART_VERIFIED',
    version: '0.2.0', schemaVersion: 26, instanceId });
  expect(f.journal.read()?.phase).toBe('NEW_INSTALL_PRESTART_VERIFIED');
  await expect(check()).resolves.toMatchObject({ state: 'NEW_INSTALL_PRESTART_VERIFIED' });
  writeFileSync(join(f.appDir, 'server', 'main.js'), 'changed');
  await expect(check()).rejects.toThrow('UPDATE_PAYLOAD_CONTENT_MISMATCH');
  expect(f.journal.read()?.phase).toBe('NEW_INSTALL_PRESTART_VERIFIED');
  writeFileSync(join(f.appDir, 'server', 'main.js'), 'new');
  writeFileSync(join(f.previous, 'server', 'main.js'), 'changed');
  await expect(check()).rejects.toThrow('UPDATE_OLD_INVENTORY_MISMATCH');
  writeFileSync(join(f.previous, 'server', 'main.js'), 'old');
  writeFileSync(join(backup.path, 'manifest.json'), JSON.stringify({ operationId: backup.operationId,
    instanceId: randomUUID(), softwareVersion: '0.1.0', schemaVersion: 26 }));
  await expect(check()).rejects.toThrow('UPDATE_NEW_PRESTART_IDENTITY_INVALID');
});

it('runs the new signed build only as a guarded, nonce-proven service probe', async () => {
  const f = await binaryFixture(), dataDir = join(f.root, 'data');
  new Storage(dataDir).initialize();
  const instanceId = JSON.parse(readFileSync(join(dataDir, 'installation.json'), 'utf8')).id as string;
  const backup = f.journal.read()!.backup!;
  writeFileSync(join(backup.path, 'manifest.json'), JSON.stringify({ operationId: backup.operationId,
    instanceId, softwareVersion: '0.1.0', schemaVersion: 26 }));
  const key = randomBytes(32);
  writeFileSync(join(f.config, 'update-control.key'), key.toString('base64url'));
  await switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir,
    operationId: f.operationId, releaseTrust: f.releaseTrust, release: f.release });
  runGuardedMigration({ journal: f.journal, configDir: f.config, dataDir,
    versionPath: join(f.appDir, 'server', 'version.json'), operationId: f.operationId,
    assertServiceStopped: () => {}, migrate: () => { throw new Error('UNEXPECTED_MIGRATION'); } });
  await verifyNewInstallPrestart({ journal: f.journal, configDir: f.config, dataDir,
    appDir: f.appDir, operationId: f.operationId, releaseTrust: f.releaseTrust, assertServiceStopped: () => {} });
  let starts = 0;
  const start = () => startGuardedNewServiceProbe({ journal: f.journal, configDir: f.config,
    dataDir, appDir: f.appDir, operationId: f.operationId, releaseTrust: f.releaseTrust,
    assertBootstrap: () => {}, assertServiceStopped: () => {},
    startService: () => { starts++; expect(guardedStartupMode(f.config, f.backups).kind).toBe('NEW_PROBE'); },
    requestHealth: nonce => inspectNewServiceProbe({ journal: f.journal, configDir: f.config,
      dataDir, appDir: f.appDir, operationId: f.operationId, releaseTrust: f.releaseTrust,
      nonce, key, assertLocalService: () => {} }) });
  await expect(start()).resolves.toMatchObject({ state: 'NEW_SERVICE_PROBE_HEALTHY', version: '0.2.0', schemaVersion: 26 });
  expect(starts).toBe(1);
  expect(f.journal.read()?.phase).toBe('NEW_SERVICE_PROBE_HEALTHY');
  expect(readFileSync(join(f.config, 'update-guard.json'), 'utf8')).toContain(f.operationId);
  await expect(start()).resolves.toMatchObject({ state: 'NEW_SERVICE_PROBE_HEALTHY' });
  writeFileSync(join(f.appDir, 'server', 'main.js'), 'tampered');
  await expect(start()).rejects.toThrow('UPDATE_PAYLOAD_CONTENT_MISMATCH');
  expect(f.journal.read()?.phase).toBe('NEW_SERVICE_PROBE_HEALTHY');
});

async function newFinalizeFixture() {
  const f = await binaryFixture(), dataDir = join(f.root, 'data');
  new Storage(dataDir).initialize();
  const instanceId = JSON.parse(readFileSync(join(dataDir, 'installation.json'), 'utf8')).id as string;
  const backup = f.journal.read()!.backup!;
  writeFileSync(join(backup.path, 'manifest.json'), JSON.stringify({ operationId: backup.operationId,
    instanceId, softwareVersion: '0.1.0', schemaVersion: 26 }));
  await switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir,
    operationId: f.operationId, releaseTrust: f.releaseTrust, release: f.release });
  runGuardedMigration({ journal: f.journal, configDir: f.config, dataDir,
    versionPath: join(f.appDir, 'server', 'version.json'), operationId: f.operationId,
    assertServiceStopped: () => {}, migrate: () => { throw new Error('UNEXPECTED_MIGRATION'); } });
  await verifyNewInstallPrestart({ journal: f.journal, configDir: f.config, dataDir,
    appDir: f.appDir, operationId: f.operationId, releaseTrust: f.releaseTrust,
    assertServiceStopped: () => {} });
  f.journal.recordNewServiceProbeIntent(f.operationId);
  f.journal.recordNewServiceProbeHealthy(f.operationId);
  const finish = (hooks: { stopService?: () => void; requestHealth?: (closed: boolean) => Promise<void>;
    restartService?: () => void; stopUnhealthyService?: () => void } = {}) => finalizeNewUpdate({
    journal: f.journal, configDir: f.config, backupRoot: f.backups, dataDir, appDir: f.appDir,
    operationId: f.operationId, releaseTrust: f.releaseTrust,
    probe: async () => ({ dataDigest: restoredDataDigest(dataDir), version: '0.2.0', schemaVersion: 26 }),
    stopService: hooks.stopService ?? (() => {}), assertServiceStopped: () => {},
    startService: () => { expect(guardedStartupMode(f.config, f.backups).kind).toBe('NORMAL');
      expect(['NEW_READY_TO_START', 'NEW_UPDATE_COMPLETED']).toContain(f.journal.read()?.phase); },
    restartService: hooks.restartService ?? (() => {}),
    requestHealth: async (_port, _version, _schema, closed) => hooks.requestHealth?.(closed),
    stopUnhealthyService: hooks.stopUnhealthyService ?? (() => {}), enableAutomatic: () => {}
  });
  return { ...f, dataDir, finish };
}

it('activates the signed update only after two closed service boots and a healthy ordinary boot', async () => {
  const f = await newFinalizeFixture(), checks: boolean[] = [], restarts: string[] = [];
  await expect(f.finish({ stopService: () => {
    expect(f.journal.read()?.phase).toBe('NEW_FINALIZE_INTENT');
    expect(guardedStartupMode(f.config, f.backups).kind).toBe('NEW_PROBE');
  }, requestHealth: async closed => { checks.push(closed); },
  restartService: () => { restarts.push(f.journal.read()!.phase); } })).resolves.toMatchObject({ state: 'NEW_UPDATE_COMPLETED' });
  expect(checks).toEqual([true, true, false, false]);
  expect(restarts).toEqual(['NEW_QUARANTINE_HEALTHY', 'NEW_UPDATE_COMMITTED']);
  expect(f.journal.read()?.phase).toBe('NEW_UPDATE_COMPLETED');
  expect(() => f.journal.recordDataRestoreIntent(f.operationId)).toThrow('UPDATE_OPERATION_STATE_INVALID');
});

it('keeps the new guard after a stop failure and reconstructs an interrupted guard removal', async () => {
  const f = await newFinalizeFixture();
  await expect(f.finish({ stopService: () => { throw new Error('STOP_FAILED'); } })).rejects.toThrow('STOP_FAILED');
  expect(f.journal.read()?.phase).toBe('NEW_FINALIZE_INTENT');
  expect(guardedStartupMode(f.config, f.backups).kind).toBe('NEW_PROBE');
  f.journal.recordNewReadyToStart(f.operationId);
  rmSync(join(f.config, 'update-guard.json'));
  expect(() => guardedStartupMode(f.config, f.backups)).toThrow('UPDATE_GUARD_ACTIVE');
  await expect(f.finish()).resolves.toMatchObject({ state: 'NEW_UPDATE_COMPLETED' });
});

it('blocks new starts after a failed closed boot without restoring possible sales', async () => {
  const f = await newFinalizeFixture();
  let stopped = false;
  await expect(f.finish({ requestHealth: async () => { throw new Error('HEALTH_FAILED'); },
    stopUnhealthyService: () => { stopped = true; } })).rejects.toThrow('HEALTH_FAILED');
  expect(stopped).toBe(true);
  expect(f.journal.read()?.phase).toBe('NEW_ACTIVATION_FAILED');
  expect(() => guardedStartupMode(f.config, f.backups)).toThrow('UPDATE_GUARD_ACTIVE');
  await expect(f.finish()).rejects.toThrow('UPDATE_NEW_FINALIZE_STATE_INVALID');
});

it('never offers a data rollback after the ordinary service has been exposed', async () => {
  const f = await newFinalizeFixture();
  let stopped = false;
  await expect(f.finish({ requestHealth: async closed => {
    if (!closed) throw new Error('NORMAL_HEALTH_FAILED');
  }, stopUnhealthyService: () => { stopped = true; } })).rejects.toThrow('NORMAL_HEALTH_FAILED');
  expect(stopped).toBe(true);
  expect(f.journal.read()?.phase).toBe('NEW_ACTIVATION_FAILED');
  expect(() => f.journal.recordDataRestoreIntent(f.operationId)).toThrow('UPDATE_OPERATION_STATE_INVALID');
  expect(() => guardedStartupMode(f.config, f.backups)).toThrow('UPDATE_GUARD_ACTIVE');
});

it('rejects a mismatched guard and a failed stopped-service check before inspecting migrated SQLite', async () => {
  const f = await binaryFixture(), dataDir = join(f.root, 'data');
  new Storage(dataDir).initialize();
  await switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId,
    releaseTrust: f.releaseTrust, release: f.release });
  runGuardedMigration({ journal: f.journal, configDir: f.config, dataDir,
    versionPath: join(f.appDir, 'server', 'version.json'), operationId: f.operationId,
    assertServiceStopped: () => {}, migrate: () => { throw new Error('UNEXPECTED_MIGRATION'); } });
  const check = (assertServiceStopped = () => {}) => inspectMigratedInstall({ journal: f.journal, configDir: f.config,
    dataDir, appDir: f.appDir, operationId: f.operationId, assertServiceStopped });
  expect(() => check(() => { throw new Error('SERVICE_RUNNING'); })).toThrow('SERVICE_RUNNING');
  writeFileSync(join(f.config, 'update-guard.json'), JSON.stringify({ format: 1, operationId: randomUUID() }));
  expect(() => check()).toThrow('UPDATE_GUARD_MISMATCH');
  expect(() => classifyGuardedRecovery({ journal: f.journal, configDir: f.config, operationId: f.operationId })).toThrow('UPDATE_GUARD_MISMATCH');
});

async function postDataFixture() {
  const f = await binaryFixture(), dataDir = join(f.root, 'data');
  new Storage(dataDir).initialize();
  await switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId,
    releaseTrust: f.releaseTrust, release: f.release });
  f.journal.recordMigrationIntent(f.operationId);
  f.journal.recordMigrated(f.operationId, 26);
  f.journal.recordDataRestoreIntent(f.operationId);
  f.journal.recordDataRestored(f.operationId);
  const instanceId = JSON.parse(readFileSync(join(dataDir, 'installation.json'), 'utf8')).id as string;
  const backup = f.journal.read()!.backup!;
  writeFileSync(join(dataDir, '.update-data-restore.json'), JSON.stringify({ format: 1, operationId: f.operationId,
    backupOperationId: backup.operationId, instanceId, softwareVersion: '0.1.0' }));
  return { ...f, dataDir };
}

it('restores compatible old files only after data restoration and keeps the guard', async () => {
  const f = await postDataFixture();
  const restore = () => restoreOldBinaryAfterData({ journal: f.journal, configDir: f.config, dataDir: f.dataDir,
    appDir: f.appDir, operationId: f.operationId, assertServiceStopped: () => {} });
  expect(restore().state).toBe('OLD_BINARY_RESTORED_GUARDED');
  expect(readFileSync(join(f.appDir, 'node.exe'), 'utf8')).toBe('old');
  expect(readFileSync(join(f.root, `Bashkar POS.failed.${f.operationId}`, 'node.exe'), 'utf8')).toBe('new');
  expect(f.journal.read()?.phase).toBe('OLD_BINARY_RESTORED');
  expect(classifyGuardedRecovery({ journal: f.journal, configDir: f.config, operationId: f.operationId }).kind).toBe('OLD_INSTALL_HEALTH_REQUIRED');
  expect(readFileSync(join(f.config, 'update-guard.json'), 'utf8')).toContain(f.operationId);
  expect(() => restore()).toThrow('UPDATE_OLD_BINARY_RESTORE_DENIED');
});

it('resumes the old-file switch after a failure between directory moves', async () => {
  const f = await postDataFixture();
  let moves = 0;
  expect(() => restoreOldBinaryAfterData({ journal: f.journal, configDir: f.config, dataDir: f.dataDir,
    appDir: f.appDir, operationId: f.operationId, assertServiceStopped: () => {},
    move: (from, to) => { if (++moves === 2) throw new Error('MOVE_FAILED'); renameSync(from, to); } })).toThrow('MOVE_FAILED');
  expect(f.journal.read()?.phase).toBe('OLD_BINARY_RESTORE_INTENT');
  expect(() => f.journal.markRecoveryRequired(f.operationId, 'UPDATE_OLD_BINARY_SWITCH_FAILED')).toThrow('UPDATE_OPERATION_STATE_INVALID');
  expect(() => readFileSync(join(f.appDir, 'node.exe'))).toThrow();
  expect(restoreOldBinaryAfterData({ journal: f.journal, configDir: f.config, dataDir: f.dataDir,
    appDir: f.appDir, operationId: f.operationId, assertServiceStopped: () => {} }).state).toBe('OLD_BINARY_RESTORED_GUARDED');
});

it('refuses an incompatible previous version before any rename', async () => {
  const f = await postDataFixture();
  writeFileSync(join(f.previous, 'server', 'version.json'), JSON.stringify({ format: 1, version: '0.9.0' }));
  expect(() => restoreOldBinaryAfterData({ journal: f.journal, configDir: f.config, dataDir: f.dataDir,
    appDir: f.appDir, operationId: f.operationId, assertServiceStopped: () => {} })).toThrow('UPDATE_OLD_BINARY_RECONCILIATION_REQUIRED');
  expect(f.journal.read()?.phase).toBe('DATA_RESTORED');
  expect(readFileSync(join(f.appDir, 'node.exe'), 'utf8')).toBe('new');
  expect(readFileSync(join(f.previous, 'node.exe'), 'utf8')).toBe('old');
});

it('refuses a modified previous program even with the expected version', async () => {
  const f = await postDataFixture();
  writeFileSync(join(f.previous, 'server', 'main.js'), 'tampered');
  expect(() => restoreOldBinaryAfterData({ journal: f.journal, configDir: f.config, dataDir: f.dataDir,
    appDir: f.appDir, operationId: f.operationId, assertServiceStopped: () => {} })).toThrow('UPDATE_OLD_INVENTORY_MISMATCH');
  expect(f.journal.read()?.phase).toBe('DATA_RESTORED');
});

it('refuses a mismatched LocalService restore marker or running service', async () => {
  const f = await postDataFixture();
  const run = (assertServiceStopped = () => {}) => restoreOldBinaryAfterData({ journal: f.journal,
    configDir: f.config, dataDir: f.dataDir, appDir: f.appDir, operationId: f.operationId, assertServiceStopped });
  expect(() => run(() => { throw new Error('SERVICE_RUNNING'); })).toThrow('SERVICE_RUNNING');
  writeFileSync(join(f.dataDir, '.update-data-restore.json'), JSON.stringify({ format: 1, operationId: f.operationId,
    backupOperationId: f.journal.read()!.backup!.operationId, instanceId: randomUUID(), softwareVersion: '0.1.0' }));
  expect(() => run()).toThrow('UPDATE_OLD_BINARY_DATA_INVALID');
  expect(f.journal.read()?.phase).toBe('DATA_RESTORED');
  expect(readFileSync(join(f.appDir, 'node.exe'), 'utf8')).toBe('new');
});

it('rejects a wrong installed version before opening the database for migration', async () => {
  const f = await binaryFixture(), dataDir = join(f.root, 'data');
  new Storage(dataDir).initialize();
  await switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId,
    releaseTrust: f.releaseTrust, release: f.release });
  writeFileSync(join(f.appDir, 'server', 'version.json'), JSON.stringify({ format: 1, version: '0.3.0' }));
  expect(() => runGuardedMigration({ journal: f.journal, configDir: f.config, dataDir,
    versionPath: join(f.appDir, 'server', 'version.json'), operationId: f.operationId,
    assertServiceStopped: () => {}, migrate: () => { throw new Error('UNEXPECTED_MIGRATION'); } })).toThrow('UPDATE_MIGRATION_TARGET_INVALID');
  expect(f.journal.read()?.phase).toBe('BINARY_SWITCHED');
});

it('restores the old directory if the second move fails', async () => {
  const f = await binaryFixture();
  let moves = 0;
  await expect(switchVerifiedBinary({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId,
    releaseTrust: f.releaseTrust, release: f.release, move: (from, to) => { if (++moves === 2) throw new Error('MOVE_FAILED'); renameSync(from, to); } })).rejects.toThrow('MOVE_FAILED');
  expect(readFileSync(join(f.appDir, 'node.exe'), 'utf8')).toBe('old');
  expect(f.journal.read()).toMatchObject({ phase: 'RECOVERY_REQUIRED', errorCode: 'UPDATE_BINARY_SWITCH_FAILED' });
});

it('recovers a power loss after moving the old directory but before installing the new one', async () => {
  const f = await binaryFixture();
  captureOldBinaryInventory(f.config, f.appDir, f.operationId);
  f.journal.recordBinarySwitchIntent(f.operationId);
  renameSync(f.appDir, f.previous);
  expect(restoreOldBinaryBeforeMigration({ journal: f.journal, configDir: f.config, appDir: f.appDir, operationId: f.operationId }).state).toBe('PRE_MIGRATION_BINARY_RESTORED');
  expect(readFileSync(join(f.appDir, 'node.exe'), 'utf8')).toBe('old');
  expect(f.journal.read()?.phase).toBe('PRE_MIGRATION_BINARY_RESTORED');
});
