import { afterEach, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical } from '../src/command-bus';
import { verifyReleaseArtifact, verifySignedRelease, type ReleaseManifest } from '../src/recovery/release-verifier';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const pair = generateKeyPairSync('ed25519');
  const root = mkdtempSync(join(tmpdir(), 'bashkar-release-'));
  dirs.push(root);
  const fileName = 'BashkarPOS-Setup-0.2.0-win-x64.exe', artifactPath = join(root, fileName), content = Buffer.from('isolated test installer bytes');
  writeFileSync(artifactPath, content);
  const manifest: ReleaseManifest = {
    format: 1, releaseId: 'release_020', version: '0.2.0', gitCommit: 'a'.repeat(40), keyId: 'publisher_1',
    platform: { os: 'win32', arch: 'x64' },
    compatibility: { minSourceVersion: '0.1.0', maxSourceVersion: '0.1.9', minAgentVersion: '0.1.0', minSchema: 26, maxSchema: 26, targetSchema: 28, migrationVersions: [27, 28] },
    artifact: { fileName, sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }, minFreeBytes: 1000
  };
  const trusted = { keyId: 'publisher_1', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  const installed = { appVersion: '0.1.0', agentVersion: '0.1.0', schemaVersion: 26, os: 'win32', arch: 'x64', freeBytes: 2000 };
  const signed = (value = manifest) => ({ manifest: value, signature: sign(null, Buffer.from(canonical(value)), pair.privateKey).toString('base64url') });
  return { manifest, trusted, installed, artifactPath, signed };
}

it('accepts only a signed compatible release and hashes its exact installer bytes', async () => {
  const f = fixture(), release = verifySignedRelease(f.signed(), f.trusted, f.installed);
  expect(release.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
  f.manifest.artifact.sha256 = '0'.repeat(64);
  expect(release.manifest.artifact.sha256).not.toBe(f.manifest.artifact.sha256);
  expect(await verifyReleaseArtifact(release, f.artifactPath)).toMatchObject({ sizeBytes: f.manifest.artifact.sizeBytes, sha256: release.manifest.artifact.sha256 });
  writeFileSync(f.artifactPath, Buffer.alloc(f.manifest.artifact.sizeBytes, 7));
  await expect(verifyReleaseArtifact(release, f.artifactPath)).rejects.toThrow('UPDATE_ARTIFACT_HASH_MISMATCH');
});

it('rejects altered metadata, an unknown signing key, and extra unsigned fields', () => {
  const f = fixture(), envelope = f.signed();
  expect(() => verifySignedRelease({ ...envelope, manifest: { ...f.manifest, minFreeBytes: 0 } }, f.trusted, f.installed)).toThrow('UPDATE_SIGNATURE_INVALID');
  expect(() => verifySignedRelease(envelope, { ...f.trusted, keyId: 'other' }, f.installed)).toThrow('UPDATE_SIGNER_UNKNOWN');
  expect(() => verifySignedRelease({ ...envelope, downloadUrl: 'https://example.invalid' }, f.trusted, f.installed)).toThrow('UPDATE_MANIFEST_INVALID');
});

it('denies downgrade, missing migration, unsupported platform and insufficient disk space', () => {
  const f = fixture();
  expect(() => verifySignedRelease(f.signed(), f.trusted, { ...f.installed, appVersion: '0.2.0' })).toThrow('UPDATE_DOWNGRADE_DENIED');
  expect(() => verifySignedRelease(f.signed({ ...f.manifest, compatibility: { ...f.manifest.compatibility, migrationVersions: [28] } }), f.trusted, f.installed)).toThrow('UPDATE_MIGRATION_CHAIN_INVALID');
  expect(() => verifySignedRelease(f.signed(), f.trusted, { ...f.installed, os: 'darwin' })).toThrow('UPDATE_PLATFORM_UNSUPPORTED');
  expect(() => verifySignedRelease(f.signed(), f.trusted, { ...f.installed, freeBytes: 999 })).toThrow('UPDATE_DISK_SPACE_INSUFFICIENT');
  expect(() => verifySignedRelease(f.signed({ ...f.manifest, compatibility: { ...f.manifest.compatibility, targetSchema: 1000000 } }), f.trusted, f.installed)).toThrow('UPDATE_MANIFEST_INVALID');
});

it('accepts every supported source schema only when the full signed migration chain is present', () => {
  const f = fixture();
  const manifest = { ...f.manifest, compatibility: { ...f.manifest.compatibility, minSchema: 24, maxSchema: 26, migrationVersions: [25, 26, 27, 28] } };
  expect(() => verifySignedRelease(f.signed(manifest), f.trusted, { ...f.installed, schemaVersion: 24 })).not.toThrow();
  expect(() => verifySignedRelease(f.signed(manifest), f.trusted, { ...f.installed, schemaVersion: 26 })).not.toThrow();
  expect(() => verifySignedRelease(f.signed({ ...manifest, compatibility: { ...manifest.compatibility, migrationVersions: [27, 28] } }), f.trusted, f.installed)).toThrow('UPDATE_MIGRATION_CHAIN_INVALID');
});

it('rejects a symlink even when it points to the exact signed bytes', async () => {
  const f = fixture();
  const link = join(f.artifactPath, '..', f.manifest.artifact.fileName);
  const real = join(f.artifactPath, '..', 'real-installer.exe');
  const content = Buffer.from('isolated test installer bytes');
  rmSync(link); writeFileSync(real, content); symlinkSync(real, link);
  await expect(verifyReleaseArtifact(verifySignedRelease(f.signed(), f.trusted, f.installed), link)).rejects.toThrow();
});
