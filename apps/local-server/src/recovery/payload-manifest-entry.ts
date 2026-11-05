import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { signPayloadManifest, verifyStagedPayload } from './payload-manifest';

async function main() {
  const [action, stage, releaseId, targetVersion, privatePath, publicPath] = process.argv.slice(2);
  if (process.argv.length !== 8 || action !== 'sign' ||
      ![stage, privatePath, publicPath].every(path => typeof path === 'string' && isAbsolute(path)) ||
      resolve(privatePath) === resolve(stage) || resolve(publicPath) === resolve(stage))
    throw new Error('UPDATE_PAYLOAD_ARGUMENTS_INVALID');
  const signed = await signPayloadManifest(stage, releaseId, targetVersion,
    readFileSync(privatePath, 'utf8'), readFileSync(publicPath, 'utf8'));
  writeFileSync(join(stage, 'payload-manifest.signed.json'), JSON.stringify(signed),
    { flag: 'wx', mode: 0o600, flush: true });
  await verifyStagedPayload(stage, { publicKey: readFileSync(publicPath, 'utf8') },
    { releaseId, version: targetVersion });
  process.stdout.write(`SIGNED_PAYLOAD ${releaseId} ${signed.manifest.files.length}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'UPDATE_PAYLOAD_SIGNING_FAILED'}\n`);
  process.exitCode = 1;
});
