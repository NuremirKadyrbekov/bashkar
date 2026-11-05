import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { constants, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { canonical } from '../command-bus';

const manifestName = 'payload-manifest.signed.json';
const id = /^[a-z0-9_-]{1,80}$/;
const version = /^\d+\.\d+\.\d+$/;
const sha = /^[0-9a-f]{64}$/;
const comparePath = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
type Entry = { path: string; sizeBytes: number; sha256: string };
export type PayloadManifest = { format: 1; releaseId: string; version: string; files: Entry[] };
export type SignedPayloadManifest = { manifest: PayloadManifest; signature: string };

function directory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UPDATE_PAYLOAD_DIRECTORY_INVALID');
}
function validateManifest(value: unknown): PayloadManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('UPDATE_PAYLOAD_MANIFEST_INVALID');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'files,format,releaseId,version' || row.format !== 1 || typeof row.releaseId !== 'string' || !id.test(row.releaseId) || typeof row.version !== 'string' || !version.test(row.version) || !Array.isArray(row.files) || row.files.length < 1 || row.files.length > 20000) throw new Error('UPDATE_PAYLOAD_MANIFEST_INVALID');
  const seen = new Set<string>();
  for (const entry of row.files as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('UPDATE_PAYLOAD_MANIFEST_INVALID');
    const file = entry as Record<string, unknown>;
    if (Object.keys(file).sort().join(',') !== 'path,sha256,sizeBytes' || typeof file.path !== 'string' || !/^[A-Za-z0-9@._+() -]+(?:\/[A-Za-z0-9@._+() -]+)*$/.test(file.path) || file.path.split('/').some(part => part === '.' || part === '..') || file.path === manifestName || typeof file.sha256 !== 'string' || !sha.test(file.sha256) || !Number.isSafeInteger(file.sizeBytes) || Number(file.sizeBytes) < 0 || seen.has(file.path.toLowerCase())) throw new Error('UPDATE_PAYLOAD_MANIFEST_INVALID');
    seen.add(file.path.toLowerCase());
  }
  const files = row.files as Entry[];
  if (files.some((file, index) => index > 0 && comparePath(files[index - 1].path, file.path) >= 0)) throw new Error('UPDATE_PAYLOAD_MANIFEST_INVALID');
  return row as PayloadManifest;
}

async function digest(path: string) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat(), named = lstatSync(path);
    if (!before.isFile() || named.isSymbolicLink() || before.nlink !== 1 || before.ino !== named.ino || before.dev !== named.dev) throw new Error('UPDATE_PAYLOAD_FILE_INVALID');
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { size += (chunk as Buffer).length; hash.update(chunk); }
    const after = await handle.stat();
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error('UPDATE_PAYLOAD_CHANGED');
    return { sizeBytes: size, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}

async function inventory(stageDir: string) {
  if (!isAbsolute(stageDir)) throw new Error('UPDATE_PAYLOAD_DIRECTORY_INVALID');
  directory(stageDir);
  const root = realpathSync(stageDir), names: string[] = [];
  function walk(dir: string) {
    directory(dir);
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('UPDATE_PAYLOAD_FILE_INVALID');
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('UPDATE_PAYLOAD_FILE_INVALID');
      const rel = relative(root, path).split(sep).join('/');
      if (rel !== manifestName) names.push(rel);
      if (names.length > 20000) throw new Error('UPDATE_PAYLOAD_TOO_LARGE');
    }
  }
  walk(root);
  names.sort(comparePath);
  const files: Entry[] = [];
  let total = 0;
  for (const name of names) {
    const item = await digest(join(root, ...name.split('/')));
    total += item.sizeBytes;
    if (total > 4 * 1024 * 1024 * 1024) throw new Error('UPDATE_PAYLOAD_TOO_LARGE');
    files.push({ path: name, ...item });
  }
  return files;
}

export async function signPayloadManifest(stageDir: string, releaseId: string, targetVersion: string, privatePem: string, publicPem: string): Promise<SignedPayloadManifest> {
  if (lstatSync(stageDir).isSymbolicLink()) throw new Error('UPDATE_PAYLOAD_DIRECTORY_INVALID');
  const manifest = validateManifest({ format: 1, releaseId, version: targetVersion, files: await inventory(stageDir) });
  const privateKey = createPrivateKey(privatePem), publicKey = createPublicKey(publicPem);
  if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519' || createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString() !== publicKey.export({ type: 'spki', format: 'pem' }).toString()) throw new Error('UPDATE_SIGNING_KEY_MISMATCH');
  return { manifest, signature: sign(null, Buffer.from(canonical(manifest)), privateKey).toString('base64url') };
}

export async function verifyStagedPayload(stageDir: string, trusted: { publicKey: string }, release: { releaseId: string; version: string }, allowedCopiedFiles: readonly string[] = []) {
  directory(stageDir);
  const path = join(stageDir, manifestName), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 3_000_000) throw new Error('UPDATE_PAYLOAD_MANIFEST_INVALID');
  const envelope = JSON.parse(readFileSync(path, 'utf8')) as SignedPayloadManifest;
  if (!envelope || Object.keys(envelope).sort().join(',') !== 'manifest,signature' || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) throw new Error('UPDATE_PAYLOAD_SIGNATURE_INVALID');
  const manifest = validateManifest(envelope.manifest);
  if (manifest.releaseId !== release.releaseId || manifest.version !== release.version) throw new Error('UPDATE_PAYLOAD_RELEASE_MISMATCH');
  const key = createPublicKey(trusted.publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(canonical(manifest)), key, Buffer.from(envelope.signature, 'base64url'))) throw new Error('UPDATE_PAYLOAD_SIGNATURE_INVALID');
  const actual = await inventory(stageDir);
  if (allowedCopiedFiles.some(name => manifest.files.some(file => file.path === name))) throw new Error('UPDATE_PAYLOAD_CONTENT_MISMATCH');
  if (canonical(actual.filter(file => !allowedCopiedFiles.includes(file.path))) !== canonical(manifest.files)) throw new Error('UPDATE_PAYLOAD_CONTENT_MISMATCH');
  return manifest;
}
