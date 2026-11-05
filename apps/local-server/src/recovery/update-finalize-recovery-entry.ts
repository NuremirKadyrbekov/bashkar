import { dirname } from 'node:path';
import { finalizeRestoredRecovery } from './finalize-restored-recovery';
import { assertManagerSystemIdentity, productionManagerPaths } from './update-manager-runtime';
import { UpdateJournal } from './update-journal';

async function main() {
  if (process.argv.length !== 3 || !/^--operation=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.argv[2]))
    throw new Error('UPDATE_FINALIZE_COMMAND_INVALID');
  assertManagerSystemIdentity();
  const paths = productionManagerPaths(), operationId = process.argv[2].slice('--operation='.length);
  const result = await finalizeRestoredRecovery({ journal: new UpdateJournal(paths.configDir, paths.backupRoot),
    configDir: paths.configDir, backupRoot: paths.backupRoot, dataDir: paths.dataDir,
    appDir: dirname(dirname(paths.versionPath)), operationId });
  process.stdout.write(JSON.stringify({ event: 'update-recovery-completed', operationId: result.operationId }) + '\n');
}

main().catch(error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UPDATE_FINALIZE_FAILED';
  process.stderr.write(JSON.stringify({ event: 'update-finalize-failed', code }) + '\n');
  process.exitCode = 1;
});
