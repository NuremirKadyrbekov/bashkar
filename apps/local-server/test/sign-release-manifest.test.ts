import { afterEach, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signReleaseManifest } from '../src/recovery/sign-release-manifest';
import { verifyReleaseArtifact, verifySignedRelease } from '../src/recovery/release-verifier';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-release-sign-'));
  roots.push(root);
  const artifactPath = join(root, 'Bashkar-POS-Setup-0.2.0.exe');
  writeFileSync(artifactPath, 'signed installer test bytes');
  const pair = generateKeyPairSync('ed25519');
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const draft = { format: 1, releaseId: 'release_020', version: '0.2.0', gitCommit: 'a'.repeat(40), keyId: 'publisher_1', platform: { os: 'win32', arch: 'x64' }, compatibility: { minSourceVersion: '0.1.0', maxSourceVersion: '0.1.9', minAgentVersion: '0.1.0', minSchema: 26, maxSchema: 26, targetSchema: 26, migrationVersions: [] }, artifact: { fileName: 'Bashkar-POS-Setup-0.2.0.exe' }, minFreeBytes: 1000 };
  return { artifactPath, privatePem, publicPem, draft };
}

it('signs the final artifact bytes for the verifier and rejects later changes', async () => {
  const f = fixture();
  const signed = await signReleaseManifest(f.draft, f.artifactPath, f.privatePem, f.publicPem);
  const verified = verifySignedRelease(signed, { keyId: 'publisher_1', publicKey: f.publicPem }, { appVersion: '0.1.0', agentVersion: '0.1.0', schemaVersion: 26, os: 'win32', arch: 'x64', freeBytes: 1000 });
  await expect(verifyReleaseArtifact(verified, f.artifactPath)).resolves.toMatchObject({ sha256: signed.manifest.artifact.sha256 });
  const altered = readFileSync(f.artifactPath); altered[0] ^= 1; writeFileSync(f.artifactPath, altered);
  await expect(verifyReleaseArtifact(verified, f.artifactPath)).rejects.toThrow('UPDATE_ARTIFACT_HASH_MISMATCH');
});

it('rejects a different public key and a filename that disagrees with the release version', async () => {
  const f = fixture(), other = generateKeyPairSync('ed25519');
  await expect(signReleaseManifest(f.draft, f.artifactPath, f.privatePem, other.publicKey.export({ type: 'spki', format: 'pem' }).toString())).rejects.toThrow('UPDATE_SIGNING_KEY_MISMATCH');
  await expect(signReleaseManifest({ ...f.draft, version: '0.3.0' }, f.artifactPath, f.privatePem, f.publicPem)).rejects.toThrow('UPDATE_ARTIFACT_VERSION_MISMATCH');
});
