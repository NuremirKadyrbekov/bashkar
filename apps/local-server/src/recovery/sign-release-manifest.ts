import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { constants, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { canonical } from '../command-bus';
import { validateReleaseManifest, type SignedRelease } from './release-verifier';

type Draft = Record<string, unknown> & { artifact: { fileName: string } };

async function artifactDigest(path: string) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    const pathStat = lstatSync(path);
    if (!stat.isFile() || pathStat.isSymbolicLink() || stat.nlink !== 1 || stat.dev !== pathStat.dev || stat.ino !== pathStat.ino || stat.size < 1) throw new Error('UPDATE_ARTIFACT_INVALID');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { size += (chunk as Buffer).length; hash.update(chunk); }
    const after = await handle.stat();
    if (size !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('UPDATE_ARTIFACT_CHANGED');
    return { sizeBytes: size, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}

export async function signReleaseManifest(draft: unknown, artifactPath: string, privatePem: string, expectedPublicPem: string): Promise<SignedRelease> {
  if (!isAbsolute(artifactPath)) throw new Error('UPDATE_ARTIFACT_PATH_INVALID');
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('UPDATE_MANIFEST_INVALID');
  const input = draft as Draft;
  if (!input.artifact || Object.keys(input.artifact).sort().join(',') !== 'fileName' || input.artifact.fileName !== basename(artifactPath)) throw new Error('UPDATE_ARTIFACT_PATH_INVALID');
  const { sizeBytes, sha256 } = await artifactDigest(artifactPath);
  const manifest = validateReleaseManifest({ ...input, artifact: { fileName: input.artifact.fileName, sizeBytes, sha256 } });
  if (!manifest.artifact.fileName.endsWith(`-${manifest.version}.exe`) && !manifest.artifact.fileName.endsWith(`-${manifest.version}-win-x64.exe`)) throw new Error('UPDATE_ARTIFACT_VERSION_MISMATCH');
  const privateKey = createPrivateKey(privatePem), publicKey = createPublicKey(expectedPublicPem);
  if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519' || createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString() !== publicKey.export({ type: 'spki', format: 'pem' }).toString()) throw new Error('UPDATE_SIGNING_KEY_MISMATCH');
  const data = Buffer.from(canonical(manifest));
  const signature = sign(null, data, privateKey).toString('base64url');
  if (!verify(null, data, publicKey, Buffer.from(signature, 'base64url'))) throw new Error('UPDATE_SIGNATURE_INVALID');
  return { manifest, signature };
}

if (require.main === module) {
  void (async () => {
    const [draftPath, artifactPath, privatePath, publicPath, outputPath] = process.argv.slice(2);
    if (![draftPath, artifactPath, privatePath, publicPath, outputPath].every(path => typeof path === 'string' && isAbsolute(path))) throw new Error('UPDATE_SIGNING_ARGUMENTS_INVALID');
    if (resolve(privatePath) === resolve(outputPath) || resolve(privatePath) === resolve(draftPath) || resolve(privatePath) === resolve(artifactPath)) throw new Error('UPDATE_SIGNING_PATH_INVALID');
    const keyStat = lstatSync(privatePath);
    if (!keyStat.isFile() || keyStat.isSymbolicLink() || keyStat.nlink !== 1) throw new Error('UPDATE_SIGNING_KEY_UNSAFE');
    const draft = JSON.parse(readFileSync(draftPath, 'utf8')) as unknown;
    const signed = await signReleaseManifest(draft, artifactPath, readFileSync(privatePath, 'utf8'), readFileSync(publicPath, 'utf8'));
    writeFileSync(outputPath, JSON.stringify(signed) + '\n', { flag: 'wx', mode: 0o600, flush: true });
    process.stdout.write(`SIGNED_RELEASE_MANIFEST ${signed.manifest.releaseId} ${signed.manifest.artifact.sha256}\n`);
  })().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'UPDATE_SIGNING_FAILED'}\n`); process.exitCode = 1; });
}
