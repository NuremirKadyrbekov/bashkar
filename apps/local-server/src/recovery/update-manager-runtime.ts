import Database from 'better-sqlite3';
import { createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, statfsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { InstalledContext } from './release-verifier';
import { readInstalledSoftwareVersion } from './release-version';

const hash = /^[0-9a-f]{64}$/;
const keyId = /^[a-z0-9_-]{1,80}$/;
const version = /^\d+\.\d+\.\d+$/;
type Trust = { format: 2; agentVersion: string; releaseTrust: { keyId: string; publicKey: string }; cloudTrust: { keyId: string; publicKey: string }; signerCertificateSha256: string };

export function validateManagerTrust(value: unknown): Trust {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('UPDATE_TRUST_INVALID');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'agentVersion,cloudTrust,format,releaseTrust,signerCertificateSha256' || row.format !== 2 || typeof row.agentVersion !== 'string' || !version.test(row.agentVersion) || typeof row.signerCertificateSha256 !== 'string' || !hash.test(row.signerCertificateSha256)) throw new Error('UPDATE_TRUST_INVALID');
  for (const field of ['releaseTrust', 'cloudTrust'] as const) {
    const trust = row[field];
    if (!trust || typeof trust !== 'object' || Array.isArray(trust)) throw new Error('UPDATE_TRUST_INVALID');
    const entry = trust as Record<string, unknown>;
    if (Object.keys(entry).sort().join(',') !== 'keyId,publicKey' || typeof entry.keyId !== 'string' || !keyId.test(entry.keyId) || typeof entry.publicKey !== 'string') throw new Error('UPDATE_TRUST_INVALID');
    try { if (createPublicKey(entry.publicKey).asymmetricKeyType !== 'ed25519') throw new Error(); }
    catch { throw new Error('UPDATE_TRUST_INVALID'); }
  }
  if ((row.releaseTrust as { publicKey: string }).publicKey === (row.cloudTrust as { publicKey: string }).publicKey) throw new Error('UPDATE_TRUST_INVALID');
  return row as Trust;
}

function regular(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_INSTALLED_FILE_INVALID');
}

export function readInstalledUpdateContext(dataDir: string, updatesDir: string, versionPath: string, trust: Trust) {
  const markerPath = join(dataDir, 'installation.json'), dbPath = join(dataDir, 'pos.sqlite');
  regular(markerPath); regular(dbPath);
  const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { format?: number; id?: string };
  if (marker.format !== 1 || typeof marker.id !== 'string') throw new Error('UPDATE_INSTALLED_IDENTITY_INVALID');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('UPDATE_INSTALLED_DATABASE_INVALID');
    const bootstrap = db.prepare('SELECT id FROM bootstrap_instance').get() as { id: string } | undefined;
    const activation = db.prepare('SELECT branch_id AS branchId, instance_id AS instanceId, registration_id AS registrationId FROM activation WHERE singleton=1').get() as { branchId: string; instanceId: string; registrationId: string } | undefined;
    const schema = db.prepare('SELECT max(version) AS version FROM schema_migrations').get() as { version: number };
    if (!bootstrap || bootstrap.id !== marker.id || !activation || activation.instanceId !== marker.id || !Number.isSafeInteger(schema.version)) throw new Error('UPDATE_INSTALLED_IDENTITY_INVALID');
    const disk = statfsSync(updatesDir, { bigint: true });
    const free = disk.bavail * disk.bsize;
    const installed: InstalledContext = { appVersion: readInstalledSoftwareVersion(versionPath), agentVersion: trust.agentVersion, schemaVersion: schema.version,
      os: process.platform, arch: process.arch, freeBytes: Number(free > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : free) };
    return { installed, identity: { branchId: activation.branchId, instanceId: activation.instanceId, registrationId: activation.registrationId } };
  } finally { db.close(); }
}

export function productionManagerPaths() {
  if (process.platform !== 'win32' || process.arch !== 'x64' || !process.env.ProgramData || !process.env.ProgramW6432) throw new Error('UPDATE_WINDOWS_REQUIRED');
  const root = resolve(process.env.ProgramData, 'BashkarPOS');
  return { configDir: join(root, 'config'), backupRoot: join(root, 'backups'), updatesDir: join(root, 'updates'),
    dataDir: join(root, 'data'), versionPath: join(process.env.ProgramW6432, 'Bashkar POS', 'server', 'version.json'), trustPath: join(process.env.ProgramW6432, 'Bashkar POS Update Manager', 'update-trust.json') };
}

export function readProductionManagerTrust(path: string) {
  regular(path);
  return validateManagerTrust(JSON.parse(readFileSync(path, 'utf8')));
}

export function assertManagerSystemIdentity() {
  if (process.platform !== 'win32') throw new Error('UPDATE_WINDOWS_REQUIRED');
  const script = "if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-18'){exit 9}";
  try { execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10000, windowsHide: true, stdio: 'ignore' }); }
  catch { throw new Error('UPDATE_MANAGER_IDENTITY_INVALID'); }
}
