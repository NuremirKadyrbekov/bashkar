import { expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { validateManagerTrust } from '../src/recovery/update-manager-runtime';

it('accepts only separate Ed25519 publisher and Cloud grant trust anchors', () => {
  const publisher = generateKeyPairSync('ed25519'), cloud = generateKeyPairSync('ed25519');
  const pem = (pair: typeof publisher) => pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const trust = { format: 2, agentVersion: '0.1.0',
    releaseTrust: { keyId: 'release_1', publicKey: pem(publisher) }, cloudTrust: { keyId: 'grant_1', publicKey: pem(cloud) }, signerCertificateSha256: 'a'.repeat(64) };
  expect(validateManagerTrust(trust)).toEqual(trust);
  expect(() => validateManagerTrust({ ...trust, signerCertificateSha256: '' })).toThrow('UPDATE_TRUST_INVALID');
  expect(() => validateManagerTrust({ ...trust, cloudTrust: { ...trust.cloudTrust, publicKey: 'invalid' } })).toThrow('UPDATE_TRUST_INVALID');
  expect(() => validateManagerTrust({ ...trust, cloudTrust: { ...trust.cloudTrust, publicKey: trust.releaseTrust.publicKey } })).toThrow('UPDATE_TRUST_INVALID');
  expect(() => validateManagerTrust({ ...trust, privateKey: 'secret' })).toThrow('UPDATE_TRUST_INVALID');
});
