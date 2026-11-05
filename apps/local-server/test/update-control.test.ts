import { afterEach, expect, it } from 'vitest';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server';
import { Storage } from '../src/storage';
import { requestUpdateMaintenance, startUpdateControl } from '../src/recovery/update-control';
import { UpdateJournal } from '../src/recovery/update-journal';
import { verifySignedRelease, type ReleaseManifest } from '../src/recovery/release-verifier';
import { verifyUpdateInstallGrant, type InstallGrantClaims } from '../src/recovery/update-authorization';
import { canonical } from '../src/command-bus';

function testRelease() {
  const pair = generateKeyPairSync('ed25519');
  const manifest: ReleaseManifest = { format: 1, releaseId: 'release_020', version: '0.2.0', gitCommit: 'a'.repeat(40), keyId: 'test', platform: { os: 'win32', arch: 'x64' }, compatibility: { minSourceVersion: '0.1.0', maxSourceVersion: '0.1.0', minAgentVersion: '0.1.0', minSchema: 26, maxSchema: 26, targetSchema: 26, migrationVersions: [] }, artifact: { fileName: 'BashkarPOS-Setup-0.2.0-win-x64.exe', sizeBytes: 1, sha256: 'a'.repeat(64) }, minFreeBytes: 0 };
  return verifySignedRelease({ manifest, signature: sign(null, Buffer.from(canonical(manifest)), pair.privateKey).toString('base64url') }, { keyId: 'test', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, { appVersion: '0.1.0', agentVersion: '0.1.0', schemaVersion: 26, os: 'win32', arch: 'x64', freeBytes: 1 });
}
function testAuthorization(operationId: string) {
  const release = testRelease(), pair = generateKeyPairSync('ed25519'), branchId = randomUUID(), actorId = randomUUID(), now = Date.now();
  const identity = { branchId, instanceId: randomUUID(), registrationId: randomUUID() };
  const actor = { id: actorId, branchId, role: 'OWNER', audience: 'LOCAL_ADMIN', method: 'CLOUD_OWNER' };
  const claims: InstallGrantClaims = { format: 1, action: 'INSTALL', keyId: 'test', operationId, ...identity, actorId, releaseId: release.manifest.releaseId, manifestSha256: release.manifestSha256, artifactSha256: release.manifest.artifact.sha256, issuedAt: now, expiresAt: now + 60000, nonce: randomUUID(), requiresClosedShift: true, requiresBackup: true };
  return verifyUpdateInstallGrant({ claims, signature: sign(null, Buffer.from(canonical(claims)), pair.privateKey).toString('base64url') }, { keyId: 'test', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, identity, actor, release, operationId, now);
}

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it.skipIf(process.platform === 'win32')('authenticates the IPC request and creates a Backup Set under the server lock', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-update-ipc-'));
  roots.push(root);
  const data = join(root, 'data'), backups = join(root, 'backups'), config = join(root, 'config'), socketPath = join(root, 'control.sock');
  mkdirSync(backups, { mode: 0o700 });
  mkdirSync(config, { mode: 0o700 });
  new Storage(data).initialize();
  const protector = { protect: (key: Buffer) => key.toString('base64'), unprotect: (value: string) => Buffer.from(value, 'base64') };
  const app = await createServer(data, 0, false, { authority: { publicKey: '' }, device: { publicKey: () => '', assertAvailable: () => {} }, maintenanceBackup: { backupRoot: backups, softwareVersion: '0.1.0', protector }, updateControl: { configDir: config, socketPath } });
  try {
    const key = readFileSync(join(config, 'update-control.key'), 'utf8');
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const operationId = randomUUID();
    const journal = new UpdateJournal(config, backups);
    journal.start(testAuthorization(operationId));
    const result = await requestUpdateMaintenance(config, socketPath, operationId);
    expect(result).toMatchObject({ state: 'MAINTENANCE_READY', backupCandidate: { verified: true }, restoreChecked: { verified: true, pinCount: 0, registrationId: null } });
    expect(result.restoreChecked?.operationId).toBe(result.backupCandidate.operationId);
    expect(result.restoreChecked?.instanceId).toBe(JSON.parse(readFileSync(join(data, 'installation.json'), 'utf8')).id);
    const repeated = await requestUpdateMaintenance(config, socketPath, operationId);
    expect(repeated).toEqual(result);
    expect(readFileSync(join(config, `update-maintenance-${operationId}.receipt.json`), 'utf8')).toContain(result.backupCandidate.operationId);
    expect(journal.recordCandidate(operationId, result).phase).toBe('BACKUP_CANDIDATE');
    expect(new UpdateJournal(config, backups).read()?.backup?.operationId).toBe(result.backupCandidate.operationId);
    expect(readFileSync(join(backups, result.backupCandidate.operationId, 'manifest.json'), 'utf8')).not.toContain(key);
    expect((await app.inject('/api/v1/system/health/live')).statusCode).toBe(423);
    await expect(requestUpdateMaintenance(config, socketPath, randomUUID())).rejects.toThrow('UPDATE_OPERATION_STATE_INVALID');
  } finally { await app.close(); }
});

it.skipIf(process.platform === 'win32')('refuses a saved receipt when protected installation data changed after preparation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-update-ipc-recheck-')); roots.push(root);
  const data = join(root, 'data'), backups = join(root, 'backups'), config = join(root, 'config'), socketPath = join(root, 'control.sock');
  mkdirSync(backups, { mode: 0o700 }); mkdirSync(config, { mode: 0o700 });
  new Storage(data).initialize();
  const protector = { protect: (key: Buffer) => key.toString('base64'), unprotect: (value: string) => Buffer.from(value, 'base64') };
  const app = await createServer(data, 0, false, { authority: { publicKey: '' }, device: { publicKey: () => '', assertAvailable: () => {} },
    maintenanceBackup: { backupRoot: backups, softwareVersion: '0.1.0', protector }, updateControl: { configDir: config, socketPath } });
  try {
    const operationId = randomUUID();
    new UpdateJournal(config, backups).start(testAuthorization(operationId));
    const result = await requestUpdateMaintenance(config, socketPath, operationId);
    writeFileSync(join(data, 'installation.json'), JSON.stringify({ format: 1, id: randomUUID() }));
    await expect(requestUpdateMaintenance(config, socketPath, operationId)).rejects.toThrow();
    expect(readFileSync(join(config, `update-maintenance-${operationId}.receipt.json`), 'utf8')).toContain(result.backupCandidate.operationId);
    expect(new UpdateJournal(config, backups).read()?.phase).toBe('WAITING_FOR_MAINTENANCE');
  } finally { await app.close(); }
});

it.skipIf(process.platform === 'win32')('rejects a forged client proof without entering maintenance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-update-ipc-deny-'));
  roots.push(root);
  const data = join(root, 'data'), backups = join(root, 'backups'), config = join(root, 'config'), socketPath = join(root, 'control.sock');
  mkdirSync(backups, { mode: 0o700 }); mkdirSync(config, { mode: 0o700 });
  new Storage(data).initialize();
  const protector = { protect: (key: Buffer) => key.toString('base64'), unprotect: (value: string) => Buffer.from(value, 'base64') };
  const app = await createServer(data, 0, false, { authority: { publicKey: '' }, device: { publicKey: () => '', assertAvailable: () => {} }, maintenanceBackup: { backupRoot: backups, softwareVersion: '0.1.0', protector }, updateControl: { configDir: config, socketPath } });
  try {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(socketPath), nonce = Buffer.alloc(32, 7).toString('base64url');
      let frames = 0, received = '';
      socket.setEncoding('utf8'); socket.setTimeout(5000, () => reject(new Error('IPC_TIMEOUT')));
      socket.once('error', reject);
      socket.once('connect', () => socket.write(JSON.stringify({ v: 1, kind: 'hello', nonce }) + '\n'));
      socket.on('data', (text: string) => {
        received += text;
        while (received.includes('\n')) {
          const index = received.indexOf('\n'), frame = JSON.parse(received.slice(0, index));
          received = received.slice(index + 1);
          if (frames++ === 0) socket.write(JSON.stringify({ v: 1, kind: 'prepare', operationId: randomUUID(), proof: Buffer.alloc(32).toString('base64url') }) + '\n');
          else { socket.destroy(); resolve(frame.code); }
        }
      });
    });
    expect(response).toBe('UPDATE_CONTROL_DENIED');
    expect((await app.inject('/api/v1/system/health/live')).statusCode).toBe(200);
  } finally { await app.close(); }
});

it.skipIf(process.platform === 'win32')('refuses a socket endpoint that cannot prove the server key', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-update-ipc-impostor-'));
  roots.push(root);
  const data = join(root, 'data'), backups = join(root, 'backups'), config = join(root, 'config'), socketPath = join(root, 'control.sock');
  mkdirSync(backups, { mode: 0o700 }); mkdirSync(config, { mode: 0o700 });
  new Storage(data).initialize();
  const protector = { protect: (key: Buffer) => key.toString('base64'), unprotect: (value: string) => Buffer.from(value, 'base64') };
  const app = await createServer(data, 0, false, { authority: { publicKey: '' }, device: { publicKey: () => '', assertAvailable: () => {} }, maintenanceBackup: { backupRoot: backups, softwareVersion: '0.1.0', protector }, updateControl: { configDir: config, socketPath: join(root, 'real.sock') } });
  const impostor = createNetServer(socket => { socket.once('data', () => socket.end(JSON.stringify({ v: 1, kind: 'challenge', nonce: Buffer.alloc(32, 1).toString('base64url'), proof: Buffer.alloc(32, 2).toString('base64url') }) + '\n')); });
  try {
    await new Promise<void>(resolve => impostor.listen(socketPath, resolve));
    await expect(requestUpdateMaintenance(config, socketPath, randomUUID())).rejects.toThrow('UPDATE_CONTROL_SERVER_UNTRUSTED');
    expect((await app.inject('/api/v1/system/health/live')).statusCode).toBe(200);
  } finally { await new Promise<void>(resolve => impostor.close(() => resolve())); await app.close(); }
});

it.skipIf(process.platform === 'win32')('waits for an accepted backup task before closing the control server', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-update-ipc-close-'));
  roots.push(root);
  const config = join(root, 'config'), socketPath = join(root, 'control.sock');
  mkdirSync(config, { mode: 0o700 });
  const backup = join(root, randomUUID());
  mkdirSync(backup, { mode: 0o700 });
  writeFileSync(join(backup, 'manifest.json'), '{}');
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const control = await startUpdateControl(config, socketPath, async () => {
    entered(); await held;
    return { state: 'MAINTENANCE_READY', schemaVersion: 1, backupCandidate: { operationId: backup.split('/').at(-1)!, path: backup, verified: true }, restoreChecked: { operationId: backup.split('/').at(-1)!, instanceId: randomUUID(), registrationId: null, schemaVersion: 1, pinCount: 0, verified: true } };
  }, async () => {});
  try {
    const request = requestUpdateMaintenance(config, socketPath, randomUUID()).catch(() => undefined);
    await started;
    let closed = false;
    const closing = control.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(closed).toBe(false);
    release();
    await closing;
    await request;
    expect(closed).toBe(true);
  } finally { release(); }
});
