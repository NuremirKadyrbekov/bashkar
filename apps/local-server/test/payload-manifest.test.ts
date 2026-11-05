import { afterEach, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signPayloadManifest, verifyStagedPayload } from '../src/recovery/payload-manifest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const stage = mkdtempSync(join(tmpdir(), 'bashkar-payload-'));
  roots.push(stage);
  mkdirSync(join(stage, 'server'));
  writeFileSync(join(stage, 'node.exe'), 'node-binary');
  writeFileSync(join(stage, 'server', 'main.js'), 'new-server');
  const key = generateKeyPairSync('ed25519');
  const publicKey = key.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKey = key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return { stage, publicKey, privateKey };
}

it('checks every extracted file against a signed release-bound inventory', async () => {
  const f = fixture(), release = { releaseId: 'release_030', version: '0.3.0' };
  const signed = await signPayloadManifest(f.stage, release.releaseId, release.version, f.privateKey, f.publicKey);
  writeFileSync(join(f.stage, 'payload-manifest.signed.json'), JSON.stringify(signed));
  expect((await verifyStagedPayload(f.stage, { publicKey: f.publicKey }, release)).files).toHaveLength(2);
  await expect(verifyStagedPayload(f.stage, { publicKey: f.publicKey }, { ...release, version: '0.3.1' })).rejects.toThrow('UPDATE_PAYLOAD_RELEASE_MISMATCH');
  writeFileSync(join(f.stage, 'server', 'main.js'), 'tampered');
  await expect(verifyStagedPayload(f.stage, { publicKey: f.publicKey }, release)).rejects.toThrow('UPDATE_PAYLOAD_CONTENT_MISMATCH');
});

it('rejects added or linked files in the extracted directory', async () => {
  const f = fixture(), release = { releaseId: 'release_030', version: '0.3.0' };
  const signed = await signPayloadManifest(f.stage, release.releaseId, release.version, f.privateKey, f.publicKey);
  writeFileSync(join(f.stage, 'payload-manifest.signed.json'), JSON.stringify(signed));
  writeFileSync(join(f.stage, 'extra.txt'), 'extra');
  await expect(verifyStagedPayload(f.stage, { publicKey: f.publicKey }, release)).rejects.toThrow('UPDATE_PAYLOAD_CONTENT_MISMATCH');
  rmSync(join(f.stage, 'extra.txt'));
  symlinkSync(join(f.stage, 'node.exe'), join(f.stage, 'linked.exe'));
  await expect(verifyStagedPayload(f.stage, { publicKey: f.publicKey }, release)).rejects.toThrow('UPDATE_PAYLOAD_FILE_INVALID');
});
