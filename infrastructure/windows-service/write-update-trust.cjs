const { createPublicKey, createHash, X509Certificate } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');

const [releasePath, releaseKeyId, cloudPath, cloudKeyId, certificatePath, output] = process.argv.slice(2);
if (process.argv.length !== 8 || !/^[a-z0-9_-]{1,80}$/.test(releaseKeyId) || !/^[a-z0-9_-]{1,80}$/.test(cloudKeyId)) throw new Error('UPDATE_TRUST_INPUT_INVALID');
function publicKey(path) {
  const pem = readFileSync(path, 'utf8');
  if (createPublicKey(pem).asymmetricKeyType !== 'ed25519') throw new Error('UPDATE_TRUST_KEY_INVALID');
  return pem;
}
const certificate = readFileSync(certificatePath);
if (!certificate.length) throw new Error('UPDATE_TRUST_CERTIFICATE_INVALID');
new X509Certificate(certificate);
const trust = {
  format: 2, agentVersion: '0.1.0',
  releaseTrust: { keyId: releaseKeyId, publicKey: publicKey(releasePath) },
  cloudTrust: { keyId: cloudKeyId, publicKey: publicKey(cloudPath) },
  signerCertificateSha256: createHash('sha256').update(certificate).digest('hex')
};
if (trust.releaseTrust.publicKey === trust.cloudTrust.publicKey) throw new Error('UPDATE_TRUST_KEYS_MUST_DIFFER');
writeFileSync(output, JSON.stringify(trust), { flag: 'wx', mode: 0o600 });
