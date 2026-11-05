import { dirname } from 'node:path';
import { assertManagerSystemIdentity, productionManagerPaths, readProductionManagerTrust } from './update-manager-runtime';
import { UpdateJournal } from './update-journal';
import { verifyNewInstallPrestart } from './verify-new-install';

async function main() {
  if (process.argv.length !== 3 || !/^--operation=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.argv[2]))
    throw new Error('UPDATE_NEW_PRESTART_COMMAND_INVALID');
  assertManagerSystemIdentity();
  const paths = productionManagerPaths(), operationId = process.argv[2].slice('--operation='.length);
  const trust = readProductionManagerTrust(paths.trustPath);
  const result = await verifyNewInstallPrestart({ journal: new UpdateJournal(paths.configDir, paths.backupRoot),
    configDir: paths.configDir, dataDir: paths.dataDir, appDir: dirname(dirname(paths.versionPath)),
    operationId, releaseTrust: trust.releaseTrust });
  process.stdout.write(JSON.stringify({ event: 'update-new-prestart-verified', operationId: result.operationId,
    version: result.version, schemaVersion: result.schemaVersion, counts: result.counts }) + '\n');
}

main().catch(error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UPDATE_NEW_PRESTART_FAILED';
  process.stderr.write(JSON.stringify({ event: 'update-new-prestart-failed', code }) + '\n');
  process.exitCode = 1;
});
