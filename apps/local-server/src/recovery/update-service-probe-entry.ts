import { dirname } from 'node:path';
import { assertManagerSystemIdentity, productionManagerPaths } from './update-manager-runtime';
import { startGuardedServiceProbe } from './guarded-service-probe';
import { UpdateJournal } from './update-journal';

async function main() {
  if (process.argv.length !== 3 || !/^--operation=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.argv[2]))
    throw new Error('UPDATE_SERVICE_PROBE_COMMAND_INVALID');
  assertManagerSystemIdentity();
  const paths = productionManagerPaths(), operationId = process.argv[2].slice('--operation='.length);
  const journal = new UpdateJournal(paths.configDir, paths.backupRoot);
  const result = await startGuardedServiceProbe({ journal, configDir: paths.configDir,
    dataDir: paths.dataDir, appDir: dirname(dirname(paths.versionPath)), operationId });
  process.stdout.write(JSON.stringify({ event: 'update-service-probe-healthy', operationId: result.operationId,
    version: result.version, schemaVersion: result.schemaVersion }) + '\n');
}

main().catch(error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UPDATE_SERVICE_PROBE_FAILED';
  process.stderr.write(JSON.stringify({ event: 'update-service-probe-failed', code }) + '\n');
  process.exitCode = 1;
});
