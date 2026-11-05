import Database from 'better-sqlite3';
import { execFileSync, spawn } from 'node:child_process';
import { X509Certificate, createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Transform, Writable, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PlatformDeviceIdentity } from '../modules/activation/platform-device';
import { ActivationService } from '../modules/activation/activation-service';
import { cloudConfig } from '../modules/activation/cloud-config';
import { PlatformPinKeys, keyFingerprint } from '../modules/auth/pin-crypto';
import { canonical } from '../command-bus';
import { unseal } from '../modules/waiter/secrets';

export type KeyProtector = { protect(key: Buffer): string; unprotect(value: string): Buffer };
type Entry = { name: string; sha256: string; nonce: string; tag: string };
type Manifest = { format: 1; operationId: string; createdAt: string; softwareVersion: string; instanceId: string; registrationId: string | null; schemaVersion: number; files: Entry[] };
const optional = ['branch-display.json', 'waiter-http.json', 'device-public.pem', 'device-key.dpapi', 'pin-keys.dpapi', 'pin-keys.marker', 'web-keys.dpapi', 'web-keys.marker', 'tls-keys.dpapi', 'tls-keys.marker'];
const allowed = new Set(['installation.json', 'pos.sqlite', ...optional]);
const transient = new Set(['pos.sqlite-wal', 'pos.sqlite-shm', 'pos.sqlite-journal', 'instance-lock.sqlite', 'instance-lock.sqlite-journal', 'server.lock']);
const windowsProtectors = new WeakSet<object>();

function regular(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('RECOVERY_PREREQUISITE_MISSING');
}
function safeDirectory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('RECOVERY_DIRECTORY_INVALID');
}
function assertWindowsPaths(data: string, backups: string) {
  if (process.platform !== 'win32') return;
  if (!process.env.ProgramData) throw new Error('RECOVERY_DIRECTORY_INVALID');
  const base = realpathSync(join(process.env.ProgramData, 'BashkarPOS'));
  if (data.toLowerCase() !== join(base, 'data').toLowerCase() || backups.toLowerCase() !== join(base, 'backups').toLowerCase()) throw new Error('RECOVERY_DIRECTORY_INVALID');
}
async function hash(path: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
function verifyDatabase(path: string, markerPath: string) {
  regular(path); regular(markerPath);
  const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { format?: number; id?: string };
  if (marker.format !== 1 || typeof marker.id !== 'string') throw new Error('RECOVERY_IDENTITY_INVALID');
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('RECOVERY_DATABASE_INVALID');
    const bootstrap = db.prepare('SELECT id FROM bootstrap_instance').get() as { id: string } | undefined;
    if (bootstrap?.id !== marker.id) throw new Error('RECOVERY_IDENTITY_INVALID');
    const version = db.prepare('SELECT max(version) AS version FROM schema_migrations').get() as { version: number };
    if (!Number.isSafeInteger(version.version) || version.version < 1) throw new Error('RECOVERY_SCHEMA_INVALID');
    const hasActivation = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='activation'").get();
    const activation = hasActivation ? db.prepare('SELECT instance_id AS instanceId, registration_id AS registrationId FROM activation WHERE singleton=1').get() as { instanceId: string; registrationId: string } | undefined : undefined;
    if (activation && activation.instanceId !== marker.id) throw new Error('RECOVERY_IDENTITY_INVALID');
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='shifts'").get() && db.prepare("SELECT 1 FROM shifts WHERE status='OPEN' LIMIT 1").get()) throw new Error('RECOVERY_OPEN_SHIFT');
    return { instanceId: marker.id, registrationId: activation?.registrationId ?? null, schemaVersion: version.version, activated: !!activation };
  } finally { db.close(); }
}
export function verifyProtectedFiles(dir: string, activated: boolean) {
  const publicKey = join(dir, 'device-public.pem'), privateKey = join(dir, 'device-key.dpapi');
  const device = new PlatformDeviceIdentity(dir);
  if (activated || existsSync(publicKey) || existsSync(privateKey)) {
    if (!existsSync(publicKey) || !existsSync(privateKey)) throw new Error('RECOVERY_PREREQUISITE_MISSING');
    device.assertAvailable();
  }
  for (const namespace of ['pin', 'web', 'tls'] as const) {
    const key = join(dir, `${namespace}-keys.dpapi`), marker = join(dir, `${namespace}-keys.marker`);
    if (existsSync(key) || existsSync(marker)) {
      if (!existsSync(key) || !existsSync(marker)) throw new Error('RECOVERY_PREREQUISITE_MISSING');
      const material = new PlatformPinKeys(dir, namespace).get(false);
      material.fill(0);
    }
  }
  const db = new Database(join(dir, 'pos.sqlite'), { readonly: true, fileMustExist: true });
  try {
    const table = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    if (activated && !new ActivationService(db, { publicKey: cloudConfig.authorityPublicKey }, device).binding()) throw new Error('RECOVERY_ACTIVATION_INVALID');
    if (table('pin_key_binding')) {
      const binding = db.prepare('SELECT fingerprint FROM pin_key_binding WHERE singleton=1').get() as { fingerprint: string } | undefined;
      const hasPins = !!db.prepare('SELECT 1 FROM employee_pins LIMIT 1').get();
      if (hasPins && !binding) throw new Error('RECOVERY_PREREQUISITE_MISSING');
      if (binding) {
        if (!existsSync(join(dir, 'pin-keys.marker'))) throw new Error('RECOVERY_PREREQUISITE_MISSING');
        const keys = new PlatformPinKeys(dir).get(false);
        try { if (keyFingerprint(keys) !== binding.fingerprint) throw new Error('RECOVERY_PIN_BINDING_MISMATCH'); }
        finally { keys.fill(0); }
      }
    }
    if (table('web_key_binding')) {
      const binding = db.prepare('SELECT fingerprint FROM web_key_binding WHERE singleton=1').get() as { fingerprint: string } | undefined;
      if (table('web_draft_key_contexts') && db.prepare('SELECT 1 FROM web_draft_key_contexts LIMIT 1').get() && !binding) throw new Error('RECOVERY_PREREQUISITE_MISSING');
      if (binding) {
        if (!existsSync(join(dir, 'web-keys.marker'))) throw new Error('RECOVERY_PREREQUISITE_MISSING');
        const keys = new PlatformPinKeys(dir, 'web').get(false);
        try { if (keyFingerprint(keys) !== binding.fingerprint) throw new Error('RECOVERY_WEB_BINDING_MISMATCH'); }
        finally { keys.fill(0); }
      }
    }
    if (table('waiter_network_revisions')) {
      const network = db.prepare('SELECT branch_id AS branchId, ip, port, wrapped_private_key AS wrappedKey, leaf_certificate AS leaf FROM waiter_network_revisions ORDER BY revision DESC LIMIT 1').get() as { branchId: string; ip: string; port: number; wrappedKey: string; leaf: string } | undefined;
      if (network) {
        if (!existsSync(join(dir, 'tls-keys.marker'))) throw new Error('RECOVERY_PREREQUISITE_MISSING');
        const keys = new PlatformPinKeys(dir, 'tls').get(false);
        try {
          const aad = canonical({ kind: 'waiter-tls', branchId: network.branchId, ip: network.ip, port: network.port });
          const privateKey = createPrivateKey(unseal(keys, aad, network.wrappedKey));
          if (!new X509Certificate(network.leaf).checkPrivateKey(privateKey)) throw new Error('RECOVERY_TLS_KEY_MISMATCH');
        } finally { keys.fill(0); }
      }
    }
  } finally { db.close(); }
}
function inventory(dir: string) {
  safeDirectory(dir);
  const names = readdirSync(dir);
  for (const name of names) {
    if (!allowed.has(name) && !transient.has(name)) throw new Error('RECOVERY_UNKNOWN_DATA_FILE');
    if (allowed.has(name)) regular(join(dir, name));
  }
  if (!names.includes('installation.json') || !names.includes('pos.sqlite')) throw new Error('RECOVERY_PREREQUISITE_MISSING');
  return ['installation.json', ...optional.filter(name => names.includes(name))];
}
async function encryptReadable(source: Readable, name: string, destination: string, key: Buffer): Promise<Entry> {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  const digest = createHash('sha256');
  const collect = new Transform({ transform(chunk: Buffer, _encoding, done) { digest.update(chunk); done(null, chunk); } });
  await pipeline(source, collect, cipher, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  return { name, sha256: digest.digest('hex'), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
function encryptFile(source: string, destination: string, key: Buffer) { return encryptReadable(createReadStream(source), source.split(/[\\/]/).at(-1)!, destination, key); }
async function encryptMemorySnapshot(helper: string, source: string, destination: string, key: Buffer) {
  regular(helper);
  const child = spawn(helper, [source], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const completed = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 1));
  });
  try {
    const entry = await encryptReadable(child.stdout, 'pos.sqlite', destination, key);
    if (await completed !== 0) throw new Error('RECOVERY_MEMORY_BACKUP_FAILED');
    return entry;
  } catch (error) { child.kill(); await completed.catch(() => {}); throw error; }
}
async function decryptFile(source: string, destination: string, entry: Entry, key: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
  await pipeline(createReadStream(source), decipher, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  if (await hash(destination) !== entry.sha256) throw new Error('RECOVERY_CHECKSUM_MISMATCH');
}
async function verifyEncryptedFile(source: string, entry: Entry, key: Buffer) {
  regular(source);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
  const digest = createHash('sha256');
  const discard = new Writable({ write(chunk: Buffer, _encoding, done) { digest.update(chunk); done(); } });
  await pipeline(createReadStream(source), decipher, discard);
  if (digest.digest('hex') !== entry.sha256) throw new Error('RECOVERY_CHECKSUM_MISMATCH');
}
function manifestMac(manifest: Manifest, key: Buffer) { return createHmac('sha256', key).update(JSON.stringify(manifest)).digest('hex'); }

export function windowsBackupProtector(): KeyProtector {
  if (process.platform !== 'win32') throw new Error('RECOVERY_WINDOWS_REQUIRED');
  const run = (value: string, action: 'Protect' | 'Unprotect') => {
    const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-19'){throw 'IDENTITY'}; $v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${action}($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r));`;
    return execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: value, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000, maxBuffer: 16384 }).trim();
  };
  const protector = { protect: (key: Buffer) => run(key.toString('base64'), 'Protect'), unprotect: (value: string) => Buffer.from(run(value, 'Unprotect'), 'base64') };
  windowsProtectors.add(protector);
  return protector;
}

// The caller must quiesce writes and hold the service's data directory ACL/identity.
// This creates a candidate only; an update must never infer BACKUP_VERIFIED from its existence.
export async function createBackupSet(dataDir: string, backupRoot: string, db: Database.Database, protector: KeyProtector,
  softwareVersion: string, testMemoryHelper?: string, testProtectedFiles?: (dir: string, activated: boolean) => void) {
  if (!/^\d+\.\d+\.\d+$/.test(softwareVersion)) throw new Error('RECOVERY_VERSION_REQUIRED');
  const source = realpathSync(dataDir), root = realpathSync(backupRoot);
  safeDirectory(source); safeDirectory(root);
  assertWindowsPaths(source, root);
  if (process.platform === 'win32' && !windowsProtectors.has(protector)) throw new Error('RECOVERY_PROTECTION_REQUIRED');
  if (realpathSync(db.name) !== realpathSync(join(source, 'pos.sqlite'))) throw new Error('RECOVERY_DATABASE_MISMATCH');
  if (!relative(source, root).startsWith('..') || !relative(root, source).startsWith('..')) throw new Error('RECOVERY_PATH_OVERLAP');
  if (readdirSync(root).some(name => name.startsWith('.backup-stage-') || name.startsWith('.backup-verify-') || name.startsWith('.partial-'))) throw new Error('RECOVERY_INCOMPLETE_PREVIOUS_OPERATION');
  const names = inventory(source);
  if (process.platform === 'win32' && (testMemoryHelper || testProtectedFiles)) throw new Error('RECOVERY_HELPER_OVERRIDE_DENIED');
  const memoryHelper = process.platform === 'win32' ? join(process.env.ProgramW6432 ?? '', 'Bashkar POS', 'server', 'memory-backup.exe') : testMemoryHelper;
  if (process.platform === 'win32' && !process.env.ProgramW6432) throw new Error('RECOVERY_HELPER_UNAVAILABLE');
  const stage = memoryHelper ? undefined : mkdtempSync(join(root, '.backup-stage-'));
  const operationId = randomUUID(), partial = join(root, `.partial-${operationId}`), final = join(root, operationId);
  const key = randomBytes(32);
  try {
    mkdirSync(partial, { mode: 0o700 });
    const snapshot = stage ? join(stage, 'pos.sqlite') : undefined;
    if (snapshot) await db.backup(snapshot);
    const identity = verifyDatabase(snapshot ?? join(source, 'pos.sqlite'), join(source, 'installation.json'));
    (testProtectedFiles ?? verifyProtectedFiles)(source, identity.activated);
    const files: Entry[] = [];
    files.push(memoryHelper ? await encryptMemorySnapshot(memoryHelper, join(source, 'pos.sqlite'), join(partial, 'pos.sqlite.enc'), key) : await encryptFile(snapshot!, join(partial, 'pos.sqlite.enc'), key));
    for (const name of names) files.push(await encryptFile(join(source, name), join(partial, `${name}.enc`), key));
    const manifest: Manifest = { format: 1, operationId, createdAt: new Date().toISOString(), softwareVersion, instanceId: identity.instanceId, registrationId: identity.registrationId, schemaVersion: identity.schemaVersion, files };
    writeFileSync(join(partial, 'key.dpapi'), protector.protect(key), { flag: 'wx', mode: 0o600, flush: true });
    writeFileSync(join(partial, 'manifest.json'), JSON.stringify({ ...manifest, mac: manifestMac(manifest, key) }), { flag: 'wx', mode: 0o600, flush: true });
    await verifyBackupSet(partial, protector);
    renameSync(partial, final);
    return { operationId, path: final };
  } catch (error) { rmSync(partial, { recursive: true, force: true }); throw error; }
  finally { key.fill(0); if (stage) rmSync(stage, { recursive: true, force: true }); }
}

// The callback can inspect a restored copy while it exists. The directory is
// always removed before return, and the live installation is never replaced.
export async function inspectRestoredBackupSet<T>(setDir: string, protector: KeyProtector, inspect: (restoredDir: string) => T | Promise<T>) {
  await verifyBackupSet(setDir, protector);
  const set = realpathSync(setDir); safeDirectory(set);
  if (process.platform === 'win32' && !windowsProtectors.has(protector)) throw new Error('RECOVERY_PROTECTION_REQUIRED');
  if (process.platform === 'win32') {
    if (!process.env.ProgramData || relative(realpathSync(join(process.env.ProgramData, 'BashkarPOS', 'backups')), set).startsWith('..')) throw new Error('RECOVERY_DIRECTORY_INVALID');
  }
  const raw = JSON.parse(readFileSync(join(set, 'manifest.json'), 'utf8')) as Manifest & { mac: string };
  const { mac, ...manifest } = raw;
  const key = protector.unprotect(readFileSync(join(set, 'key.dpapi'), 'utf8'));
  let temp: string | undefined;
  try {
    const expectedMac = Buffer.from(manifestMac(manifest, key), 'hex');
    if (key.length !== 32 || manifest.format !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.softwareVersion) || typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac) || !timingSafeEqual(expectedMac, Buffer.from(mac, 'hex'))) throw new Error('RECOVERY_MANIFEST_INVALID');
    if (!Array.isArray(manifest.files) || !manifest.files.some(file => file.name === 'pos.sqlite') || !manifest.files.some(file => file.name === 'installation.json')) throw new Error('RECOVERY_MANIFEST_INVALID');
    temp = mkdtempSync(join(resolve(set, '..'), '.backup-verify-'));
    const seen = new Set<string>();
    for (const entry of manifest.files) {
      if (!entry || typeof entry.name !== 'string' || !allowed.has(entry.name) || seen.has(entry.name)) throw new Error('RECOVERY_MANIFEST_INVALID');
      seen.add(entry.name);
      await decryptFile(join(set, `${entry.name}.enc`), join(temp, entry.name), entry, key);
    }
    const identity = verifyDatabase(join(temp, 'pos.sqlite'), join(temp, 'installation.json'));
    if (identity.instanceId !== manifest.instanceId || identity.registrationId !== manifest.registrationId || identity.schemaVersion !== manifest.schemaVersion) throw new Error('RECOVERY_MANIFEST_INVALID');
    verifyProtectedFiles(temp, identity.activated);
    const inspection = await inspect(temp);
    return { operationId: manifest.operationId, instanceId: identity.instanceId, schemaVersion: identity.schemaVersion, verified: true as const, inspection };
  } finally { key.fill(0); if (temp) rmSync(temp, { recursive: true, force: true }); }
}

export async function verifyBackupSet(setDir: string, protector: KeyProtector) {
  const set = realpathSync(setDir); safeDirectory(set);
  if (process.platform === 'win32') {
    if (!windowsProtectors.has(protector) || !process.env.ProgramData || relative(realpathSync(join(process.env.ProgramData, 'BashkarPOS', 'backups')), set).startsWith('..')) throw new Error('RECOVERY_DIRECTORY_INVALID');
  }
  regular(join(set, 'manifest.json')); regular(join(set, 'key.dpapi'));
  const raw = JSON.parse(readFileSync(join(set, 'manifest.json'), 'utf8')) as Manifest & { mac: string };
  const { mac, ...manifest } = raw;
  const key = protector.unprotect(readFileSync(join(set, 'key.dpapi'), 'utf8'));
  try {
    const expectedMac = Buffer.from(manifestMac(manifest, key), 'hex');
    if (key.length !== 32 || manifest.format !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.softwareVersion) || typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac) || !timingSafeEqual(expectedMac, Buffer.from(mac, 'hex'))) throw new Error('RECOVERY_MANIFEST_INVALID');
    if (!Array.isArray(manifest.files) || !manifest.files.some(file => file.name === 'pos.sqlite') || !manifest.files.some(file => file.name === 'installation.json')) throw new Error('RECOVERY_MANIFEST_INVALID');
    const seen = new Set<string>();
    for (const entry of manifest.files) {
      if (!entry || typeof entry.name !== 'string' || !allowed.has(entry.name) || seen.has(entry.name)) throw new Error('RECOVERY_MANIFEST_INVALID');
      seen.add(entry.name);
      await verifyEncryptedFile(join(set, `${entry.name}.enc`), entry, key);
    }
    return { operationId: manifest.operationId, instanceId: manifest.instanceId, schemaVersion: manifest.schemaVersion, verified: true as const };
  } finally { key.fill(0); }
}

// Opens no plaintext file. The callback must close any SQLite connection before
// returning; all decrypted buffers are cleared after it completes.
export async function inspectBackupSetInMemory<T>(setDir: string, protector: KeyProtector, inspect: (files: ReadonlyMap<string, Buffer>) => T | Promise<T>) {
  const verified = await verifyBackupSet(setDir, protector);
  const set = realpathSync(setDir);
  const raw = JSON.parse(readFileSync(join(set, 'manifest.json'), 'utf8')) as Manifest & { mac: string };
  const { mac, ...manifest } = raw;
  const key = protector.unprotect(readFileSync(join(set, 'key.dpapi'), 'utf8'));
  const files = new Map<string, Buffer>();
  try {
    if (key.length !== 32 || typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac) ||
        !timingSafeEqual(Buffer.from(manifestMac(manifest, key), 'hex'), Buffer.from(mac, 'hex')) ||
        manifest.operationId !== verified.operationId || manifest.instanceId !== verified.instanceId || manifest.schemaVersion !== verified.schemaVersion) throw new Error('RECOVERY_MANIFEST_INVALID');
    let total = 0;
    for (const entry of manifest.files) {
      if (!entry || !allowed.has(entry.name) || files.has(entry.name)) throw new Error('RECOVERY_MANIFEST_INVALID');
      const source = join(set, `${entry.name}.enc`);
      regular(source);
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.nonce, 'base64'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      const parts: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of createReadStream(source).pipe(decipher)) {
          const part = chunk as Buffer;
          size += part.length;
          total += part.length;
          if (size > 256 * 1024 * 1024 || total > 280 * 1024 * 1024) throw new Error('RECOVERY_MEMORY_LIMIT');
          parts.push(part);
        }
        const value = Buffer.concat(parts, size);
        if (createHash('sha256').update(value).digest('hex') !== entry.sha256) { value.fill(0); throw new Error('RECOVERY_CHECKSUM_MISMATCH'); }
        files.set(entry.name, value);
      } finally { for (const part of parts) part.fill(0); }
    }
    if (!files.has('pos.sqlite') || !files.has('installation.json')) throw new Error('RECOVERY_MANIFEST_INVALID');
    return { ...verified, inspection: await inspect(files) };
  } finally { key.fill(0); for (const value of files.values()) value.fill(0); }
}
