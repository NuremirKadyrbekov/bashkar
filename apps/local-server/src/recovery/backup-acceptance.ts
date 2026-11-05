import Database from 'better-sqlite3';
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { ActivationService } from '../modules/activation/activation-service';
import { cloudConfig } from '../modules/activation/cloud-config';
import { decryptPin, keyFingerprint, pinLookup } from '../modules/auth/pin-crypto';
import { verifyPassword } from '../modules/auth/passwords';
import { canonical } from '../command-bus';
import { unseal } from '../modules/waiter/secrets';
import { validateMigrations, validatePhysicalSchema } from '../migrations';
import { inspectBackupSetInMemory, verifyBackupSet, type KeyProtector } from './backup-set';
import { UpdateJournal } from './update-journal';

function inspectFiles(files: ReadonlyMap<string, Buffer>, protector: KeyProtector, testAuthorityPublicKey?: string) {
  if (testAuthorityPublicKey && process.platform === 'win32') throw new Error('RECOVERY_TEST_AUTHORITY_DENIED');
  const file = (name: string) => files.get(name);
  const markerBytes = file('installation.json');
  const dbBytes = file('pos.sqlite');
  if (!markerBytes || !dbBytes) throw new Error('RECOVERY_PREREQUISITE_MISSING');
  if (dbBytes.length < 100 || dbBytes.subarray(0, 16).toString('ascii') !== 'SQLite format 3\0') throw new Error('RECOVERY_DATABASE_INVALID');
  // SQLite cannot deserialize a WAL-mode file. Only the in-memory view gets
  // rollback-mode header bytes; the authenticated Backup Set stays unchanged.
  const walHeader = dbBytes[18] === 2 && dbBytes[19] === 2;
  if (walHeader) { dbBytes[18] = 1; dbBytes[19] = 1; }
  const marker = JSON.parse(markerBytes.toString('utf8')) as { format?: number; id?: string };
  if (marker.format !== 1 || typeof marker.id !== 'string') throw new Error('RECOVERY_IDENTITY_INVALID');
  const key = (namespace: 'pin' | 'web' | 'tls') => {
    const protectedBytes = file(`${namespace}-keys.dpapi`), fingerprint = file(`${namespace}-keys.marker`);
    if (!protectedBytes && !fingerprint) return null;
    if (!protectedBytes || !fingerprint) throw new Error('RECOVERY_PREREQUISITE_MISSING');
    const raw = protector.unprotect(protectedBytes.toString('utf8'));
    if (raw.length !== 64 || fingerprint.toString('utf8') !== keyFingerprint(raw)) { raw.fill(0); throw new Error('RECOVERY_KEY_MISMATCH'); }
    return raw;
  };
  let pin: Buffer | null = null, web: Buffer | null = null, tls: Buffer | null = null;
  let db: Database.Database | undefined;
  try {
    pin = key('pin'); web = key('web'); tls = key('tls');
    db = new Database(dbBytes, { readonly: true });
    if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('RECOVERY_DATABASE_INVALID');
    const schemaVersion = validateMigrations(db);
    validatePhysicalSchema(db, schemaVersion);
    const instance = db.prepare('SELECT id FROM bootstrap_instance').get() as { id: string } | undefined;
    if (instance?.id !== marker.id) throw new Error('RECOVERY_IDENTITY_INVALID');
    if (db.prepare("SELECT 1 FROM shifts WHERE status='OPEN' LIMIT 1").get()) throw new Error('RECOVERY_OPEN_SHIFT');
    const activation = db.prepare('SELECT instance_id AS instanceId, registration_id AS registrationId FROM activation WHERE singleton=1').get() as { instanceId: string; registrationId: string } | undefined;
    if (activation && activation.instanceId !== marker.id) throw new Error('RECOVERY_IDENTITY_INVALID');
    const publicBytes = file('device-public.pem'), privateBytes = file('device-key.dpapi');
    if (activation || publicBytes || privateBytes) {
      if (!publicBytes || !privateBytes) throw new Error('RECOVERY_PREREQUISITE_MISSING');
      const privatePem = protector.unprotect(privateBytes.toString('utf8'));
      try {
        const privateKey = createPrivateKey(privatePem);
        if (privateKey.asymmetricKeyType !== 'ed25519' || createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString() !== publicBytes.toString('utf8')) throw new Error('RECOVERY_DEVICE_KEY_MISMATCH');
      } finally { privatePem.fill(0); }
      if (activation && !new ActivationService(db, { publicKey: testAuthorityPublicKey ?? cloudConfig.authorityPublicKey }, {
        assertAvailable() {}, publicKey: () => publicBytes.toString('utf8')
      }).binding()) throw new Error('RECOVERY_ACTIVATION_INVALID');
    }
    const pinBinding = db.prepare('SELECT fingerprint FROM pin_key_binding WHERE singleton=1').get() as { fingerprint: string } | undefined;
    const pins = db.prepare('SELECT employee_id AS employeeId, branch_id AS branchId, version, lookup, hash, ciphertext FROM employee_pins').all() as { employeeId: string; branchId: string; version: number; lookup: string; hash: string; ciphertext: string }[];
    if ((pins.length || pinBinding) && (!pin || !pinBinding || pinBinding.fingerprint !== keyFingerprint(pin))) throw new Error('RECOVERY_PIN_BINDING_MISMATCH');
    const webBinding = db.prepare('SELECT fingerprint FROM web_key_binding WHERE singleton=1').get() as { fingerprint: string } | undefined;
    if (webBinding && (!web || webBinding.fingerprint !== keyFingerprint(web))) throw new Error('RECOVERY_WEB_BINDING_MISMATCH');
    if (db.prepare('SELECT 1 FROM web_draft_key_contexts LIMIT 1').get() && !webBinding) throw new Error('RECOVERY_WEB_BINDING_MISMATCH');
    const network = db.prepare('SELECT branch_id AS branchId, ip, port, wrapped_private_key AS wrappedKey, leaf_certificate AS leaf FROM waiter_network_revisions ORDER BY revision DESC LIMIT 1').get() as { branchId: string; ip: string; port: number; wrappedKey: string; leaf: string } | undefined;
    if (network) {
      if (!tls) throw new Error('RECOVERY_TLS_KEY_MISMATCH');
      const aad = canonical({ kind: 'waiter-tls', branchId: network.branchId, ip: network.ip, port: network.port });
      if (!new X509Certificate(network.leaf).checkPrivateKey(createPrivateKey(unseal(tls, aad, network.wrappedKey)))) throw new Error('RECOVERY_TLS_KEY_MISMATCH');
    }
    return { instanceId: marker.id, registrationId: activation?.registrationId ?? null, schemaVersion, pins, pin };
  } catch (error) {
    pin?.fill(0); web?.fill(0); tls?.fill(0);
    throw error;
  } finally { db?.close(); web?.fill(0); tls?.fill(0); if (walHeader) { dbBytes[18] = 2; dbBytes[19] = 2; } }
}

/** Verify the encrypted restore in RAM under the LocalService DPAPI identity. */
export async function withVerifiedBackupRestore<T>(input: {
  path: string;
  backupOperationId: string;
  schemaVersion: number;
  expectedIdentity: { instanceId: string; registrationId: string | null };
  protector: KeyProtector;
  testAuthorityPublicKey?: string;
}, use: (files: ReadonlyMap<string, Buffer>) => T | Promise<T>) {
  const envelope = await verifyBackupSet(input.path, input.protector);
  if (envelope.operationId !== input.backupOperationId) throw new Error('RECOVERY_OPERATION_MISMATCH');
  if (envelope.schemaVersion !== input.schemaVersion || envelope.instanceId !== input.expectedIdentity.instanceId) throw new Error('RECOVERY_IDENTITY_INVALID');
  const result = await inspectBackupSetInMemory(input.path, input.protector, async files => {
    const checked = inspectFiles(files, input.protector, input.testAuthorityPublicKey);
    try {
      if (checked.instanceId !== input.expectedIdentity.instanceId || checked.registrationId !== input.expectedIdentity.registrationId || checked.schemaVersion !== input.schemaVersion) throw new Error('RECOVERY_IDENTITY_INVALID');
      for (const credential of checked.pins) {
        const pin = decryptPin(checked.pin!, credential.branchId, credential.employeeId, credential.version, credential.ciphertext);
        if (pinLookup(checked.pin!, credential.branchId, pin) !== credential.lookup || !await verifyPassword(pin, credential.hash)) throw new Error('RECOVERY_PIN_INVALID');
      }
      return { proof: { instanceId: checked.instanceId, registrationId: checked.registrationId, schemaVersion: checked.schemaVersion, pinCount: checked.pins.length }, value: await use(files) };
    } finally { checked.pin?.fill(0); }
  });
  if (result.operationId !== input.backupOperationId) throw new Error('RECOVERY_OPERATION_MISMATCH');
  return { operationId: result.operationId, ...result.inspection.proof, verified: true as const, value: result.inspection.value };
}

export async function verifyBackupRestore(input: Parameters<typeof withVerifiedBackupRestore>[0]) {
  const { value: _value, ...proof } = await withVerifiedBackupRestore(input, () => undefined);
  return proof;
}

/** Bind the independently verified restore to the pending journal operation. */
export async function acceptBackupCandidate(input: {
  journal: UpdateJournal;
  operationId: string;
  expectedIdentity: { instanceId: string; registrationId: string | null };
  protector: KeyProtector;
  testAuthorityPublicKey?: string;
}) {
  const row = input.journal.read();
  if (!row || row.phase !== 'BACKUP_CANDIDATE' || row.operationId !== input.operationId || !row.backup) throw new Error('UPDATE_BACKUP_CANDIDATE_REQUIRED');
  const result = await verifyBackupRestore({ path: row.backup.path, backupOperationId: row.backup.operationId,
    schemaVersion: row.backup.schemaVersion, expectedIdentity: input.expectedIdentity, protector: input.protector,
    testAuthorityPublicKey: input.testAuthorityPublicKey });
  return input.journal.recordBackupVerified(row.operationId, result.operationId, result.schemaVersion);
}
