import { createHash, createPublicKey, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { canonical } from '../command-bus';

export type ReleaseManifest = {
  format: 1;
  releaseId: string;
  version: string;
  gitCommit: string;
  keyId: string;
  platform: { os: 'win32'; arch: 'x64' };
  compatibility: {
    minSourceVersion: string;
    maxSourceVersion: string;
    minAgentVersion: string;
    minSchema: number;
    maxSchema: number;
    targetSchema: number;
    migrationVersions: number[];
  };
  artifact: { fileName: string; sizeBytes: number; sha256: string };
  minFreeBytes: number;
};
export type SignedRelease = { manifest: ReleaseManifest; signature: string };
export type InstalledContext = { appVersion: string; agentVersion: string; schemaVersion: number; os: string; arch: string; freeBytes: number };
declare const verifiedReleaseBrand: unique symbol;
export type VerifiedRelease = { readonly manifest: ReleaseManifest; readonly manifestSha256: string; readonly [verifiedReleaseBrand]: true };

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const hex64 = /^[0-9a-f]{64}$/;
const hex40 = /^[0-9a-f]{40}$/;
const base64urlSignature = /^[A-Za-z0-9_-]{86}$/;
function keys(value: unknown, expected: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) throw new Error('UPDATE_MANIFEST_INVALID');
  return value as Record<string, unknown>;
}
function positive(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function nonNegative(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function versionParts(value: string) {
  if (!semver.test(value)) throw new Error('UPDATE_VERSION_INVALID');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('UPDATE_VERSION_INVALID');
  return parts;
}
function compareVersions(a: string, b: string) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}
export function validateReleaseManifest(input: unknown): ReleaseManifest {
  const row = keys(input, ['format', 'releaseId', 'version', 'gitCommit', 'keyId', 'platform', 'compatibility', 'artifact', 'minFreeBytes']);
  if (row.format !== 1 || typeof row.releaseId !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(row.releaseId) || typeof row.keyId !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(row.keyId) || typeof row.version !== 'string' || !semver.test(row.version) || typeof row.gitCommit !== 'string' || !hex40.test(row.gitCommit) || !nonNegative(row.minFreeBytes)) throw new Error('UPDATE_MANIFEST_INVALID');
  const platform = keys(row.platform, ['os', 'arch']);
  if (platform.os !== 'win32' || platform.arch !== 'x64') throw new Error('UPDATE_PLATFORM_UNSUPPORTED');
  const c = keys(row.compatibility, ['minSourceVersion', 'maxSourceVersion', 'minAgentVersion', 'minSchema', 'maxSchema', 'targetSchema', 'migrationVersions']);
  if (typeof c.minSourceVersion !== 'string' || typeof c.maxSourceVersion !== 'string' || typeof c.minAgentVersion !== 'string' || !semver.test(c.minSourceVersion) || !semver.test(c.maxSourceVersion) || !semver.test(c.minAgentVersion) || !positive(c.minSchema) || !positive(c.maxSchema) || !positive(c.targetSchema) || !Array.isArray(c.migrationVersions) || !c.migrationVersions.every(positive)) throw new Error('UPDATE_MANIFEST_INVALID');
  if (compareVersions(c.minSourceVersion, c.maxSourceVersion) > 0 || Number(c.minSchema) > Number(c.maxSchema) || Number(c.targetSchema) < Number(c.minSchema) || Number(c.targetSchema) - Number(c.minSchema) > 256 || c.migrationVersions.length > 256) throw new Error('UPDATE_MANIFEST_INVALID');
  const a = keys(row.artifact, ['fileName', 'sizeBytes', 'sha256']);
  if (typeof a.fileName !== 'string' || !/^Bashkar(?:-POS|POS)-Setup-[A-Za-z0-9._-]+\.exe$/.test(a.fileName) || a.fileName.includes('..') || typeof a.sha256 !== 'string' || !hex64.test(a.sha256) || !positive(a.sizeBytes)) throw new Error('UPDATE_MANIFEST_INVALID');
  return row as ReleaseManifest;
}

export function verifySignedRelease(input: unknown, trusted: { keyId: string; publicKey: string }, installed: InstalledContext): VerifiedRelease {
  const envelope = keys(input, ['manifest', 'signature']);
  const manifest = validateReleaseManifest(envelope.manifest);
  if (typeof envelope.signature !== 'string' || !base64urlSignature.test(envelope.signature)) throw new Error('UPDATE_SIGNATURE_INVALID');
  if (manifest.keyId !== trusted.keyId) throw new Error('UPDATE_SIGNER_UNKNOWN');
  const publicKey = createPublicKey(trusted.publicKey);
  if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(canonical(manifest)), publicKey, Buffer.from(envelope.signature, 'base64url'))) throw new Error('UPDATE_SIGNATURE_INVALID');
  if (installed.os !== manifest.platform.os || installed.arch !== manifest.platform.arch) throw new Error('UPDATE_PLATFORM_UNSUPPORTED');
  if (!Number.isSafeInteger(installed.schemaVersion) || installed.schemaVersion < 1 || !nonNegative(installed.freeBytes)) throw new Error('UPDATE_CONTEXT_INVALID');
  if (compareVersions(manifest.version, installed.appVersion) <= 0) throw new Error('UPDATE_DOWNGRADE_DENIED');
  const c = manifest.compatibility;
  if (compareVersions(installed.appVersion, c.minSourceVersion) < 0 || compareVersions(installed.appVersion, c.maxSourceVersion) > 0 || compareVersions(installed.agentVersion, c.minAgentVersion) < 0 || installed.schemaVersion < c.minSchema || installed.schemaVersion > c.maxSchema || c.targetSchema < installed.schemaVersion) throw new Error('UPDATE_INCOMPATIBLE');
  const expected = Array.from({ length: c.targetSchema - c.minSchema }, (_, index) => c.minSchema + index + 1);
  if (expected.length !== c.migrationVersions.length || expected.some((value, index) => c.migrationVersions[index] !== value)) throw new Error('UPDATE_MIGRATION_CHAIN_INVALID');
  if (installed.freeBytes < manifest.minFreeBytes) throw new Error('UPDATE_DISK_SPACE_INSUFFICIENT');
  const manifestSha256 = createHash('sha256').update(canonical(manifest)).digest('hex');
  const copy = structuredClone(manifest);
  Object.freeze(copy.platform);
  Object.freeze(copy.compatibility.migrationVersions);
  Object.freeze(copy.compatibility);
  Object.freeze(copy.artifact);
  Object.freeze(copy);
  return Object.freeze({ manifest: copy, manifestSha256 }) as VerifiedRelease;
}

// The caller must recheck the file immediately before any future execution.
// This check alone never authorizes an installer or proves Authenticode.
export async function verifyReleaseArtifact(release: VerifiedRelease, artifactPath: string) {
  if (!isAbsolute(artifactPath) || basename(artifactPath) !== release.manifest.artifact.fileName) throw new Error('UPDATE_ARTIFACT_PATH_INVALID');
  const handle = await open(artifactPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const [stat, pathStat] = await Promise.all([handle.stat(), lstat(artifactPath)]);
    if (!stat.isFile() || pathStat.isSymbolicLink() || pathStat.dev !== stat.dev || pathStat.ino !== stat.ino || stat.nlink !== 1 || stat.size !== release.manifest.artifact.sizeBytes) throw new Error('UPDATE_ARTIFACT_INVALID');
    const digest = createHash('sha256');
    let size = 0;
    for await (const part of handle.createReadStream({ autoClose: false })) { size += (part as Buffer).length; digest.update(part); }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || size !== release.manifest.artifact.sizeBytes || digest.digest('hex') !== release.manifest.artifact.sha256) throw new Error('UPDATE_ARTIFACT_HASH_MISMATCH');
    return { fileName: release.manifest.artifact.fileName, sizeBytes: size, sha256: release.manifest.artifact.sha256 };
  } finally { await handle.close(); }
}
