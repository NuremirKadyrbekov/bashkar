import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { windowsBackupProtector, type KeyProtector } from './backup-set';
import { UpdateJournal } from './update-journal';
import { verifyRestoredInstallPrestart } from './verify-restored-install';
import { assertLocalService } from './update-data-restore';

const noncePattern = /^[A-Za-z0-9_-]{43}$/;
const proofPattern = /^[A-Za-z0-9_-]{43}$/;
const route = '/api/v1/system/update-probe';
const digestPattern = /^[0-9a-f]{64}$/;

export function restoredDataDigest(dataDir: string) {
  const hash = createHash('sha256');
  const names = readdirSync(dataDir).sort();
  const walPresent = names.includes('pos.sqlite-wal'), shmPresent = names.includes('pos.sqlite-shm');
  if (walPresent !== shmPresent) throw new Error('UPDATE_PROBE_DATA_INVALID');
  if (walPresent) {
    const wal = lstatSync(join(dataDir, 'pos.sqlite-wal'));
    const shm = lstatSync(join(dataDir, 'pos.sqlite-shm'));
    if (!wal.isFile() || wal.isSymbolicLink() || wal.nlink !== 1 || wal.size !== 0 ||
        !shm.isFile() || shm.isSymbolicLink() || shm.nlink !== 1) throw new Error('UPDATE_PROBE_DATA_INVALID');
  }
  for (const name of names) {
    if (name === 'pos.sqlite-wal' || name === 'pos.sqlite-shm') continue;
    const path = join(dataDir, name), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_PROBE_DATA_INVALID');
    hash.update(name); hash.update('\0'); hash.update(createHash('sha256').update(readFileSync(path)).digest());
  }
  return hash.digest('hex');
}

function probeKey(configDir: string) {
  const path = join(configDir, 'update-control.key'), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== 43) throw new Error('UPDATE_PROBE_KEY_INVALID');
  const encoded = readFileSync(path, 'utf8');
  if (!noncePattern.test(encoded)) throw new Error('UPDATE_PROBE_KEY_INVALID');
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) throw new Error('UPDATE_PROBE_KEY_INVALID');
  return key;
}
export function recoveryProbeProof(key: Buffer, nonce: string, operationId: string, version: string, schemaVersion: number, dataDigest: string) {
  if (key.length !== 32 || !noncePattern.test(nonce) || !digestPattern.test(dataDigest)) throw new Error('UPDATE_PROBE_INPUT_INVALID');
  return createHmac('sha256', key).update(JSON.stringify(['bashkar-recovery-probe-v2', nonce, operationId, version, schemaVersion, dataDigest])).digest('base64url');
}
export function verifyRecoveryProbeResponse(configDir: string, value: unknown, expected: {
  nonce: string; operationId: string; version: string; schemaVersion: number;
}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('UPDATE_PROBE_UNTRUSTED');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'dataDigest,operationId,proof,schemaVersion,state,version' || row.state !== 'RECOVERY_PROBE_HEALTHY' ||
      row.operationId !== expected.operationId || row.version !== expected.version || row.schemaVersion !== expected.schemaVersion ||
      typeof row.dataDigest !== 'string' || !digestPattern.test(row.dataDigest) ||
      typeof row.proof !== 'string' || !proofPattern.test(row.proof)) throw new Error('UPDATE_PROBE_UNTRUSTED');
  const key = probeKey(configDir);
  try {
    const expectedProof = Buffer.from(recoveryProbeProof(key, expected.nonce, expected.operationId, expected.version, expected.schemaVersion, row.dataDigest as string), 'base64url');
    const actual = Buffer.from(row.proof, 'base64url');
    if (actual.length !== expectedProof.length || !timingSafeEqual(actual, expectedProof)) throw new Error('UPDATE_PROBE_UNTRUSTED');
  } finally { key.fill(0); }
  return { dataDigest: row.dataDigest as string };
}

export async function inspectRecoveryProbe(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; appDir: string; operationId: string;
  nonce: string; protector: KeyProtector; assertLocalService?: () => void; key?: Buffer; testAuthorityPublicKey?: string;
}) {
  if (!noncePattern.test(input.nonce)) throw new Error('UPDATE_PROBE_INPUT_INVALID');
  const result = await verifyRestoredInstallPrestart({ journal: input.journal, configDir: input.configDir,
    dataDir: input.dataDir, appDir: input.appDir, operationId: input.operationId,
    protector: input.protector, probeMode: true, assertLocalService: input.assertLocalService,
    testAuthorityPublicKey: input.testAuthorityPublicKey });
  const key = input.key ?? probeKey(input.configDir);
  try {
    const dataDigest = restoredDataDigest(input.dataDir);
    return { state: 'RECOVERY_PROBE_HEALTHY' as const, operationId: result.operationId,
      version: result.version, schemaVersion: result.schemaVersion, dataDigest,
      proof: recoveryProbeProof(key, input.nonce, result.operationId, result.version, result.schemaVersion, dataDigest) };
  } finally { if (!input.key) key.fill(0); }
}

/** This listener never creates OperationalServices or accepts POS commands. */
export async function startRecoveryProbe(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; appDir: string; operationId: string;
  port: number; protector?: KeyProtector; assertLocalService?: () => void;
  inspect?: (nonce: string, key: Buffer) => Promise<{
    state: 'RECOVERY_PROBE_HEALTHY'; operationId: string; version: string;
    schemaVersion: number; dataDigest: string; proof: string;
  }>;
}) {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error('UPDATE_PROBE_PORT_INVALID');
  (input.assertLocalService ?? assertLocalService)();
  const key = probeKey(input.configDir);
  const protector = input.inspect ? undefined : input.protector ?? windowsBackupProtector();
  let busy = false;
  const server: Server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const nonce = request.headers['x-bashkar-probe-nonce'];
    if (request.method !== 'GET' || request.url !== route || typeof nonce !== 'string' || !noncePattern.test(nonce) || busy) {
      response.writeHead(503).end(); return;
    }
    busy = true;
    void Promise.resolve().then(() => input.inspect ? input.inspect(nonce, key) : inspectRecoveryProbe({ journal: input.journal,
      configDir: input.configDir, dataDir: input.dataDir, appDir: input.appDir,
      operationId: input.operationId, protector: protector!, nonce, key,
      assertLocalService: input.assertLocalService })).then(result => {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    }, () => { response.writeHead(503).end(); }).finally(() => { busy = false; });
  });
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(input.port, '127.0.0.1', () => { server.off('error', reject); resolveListen(); });
    });
  } catch (error) { key.fill(0); throw error; }
  return { close: async () => {
    await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    key.fill(0);
  } };
}
