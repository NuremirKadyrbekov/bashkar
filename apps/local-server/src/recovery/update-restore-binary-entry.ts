import { dirname } from 'node:path';
import { assertManagerSystemIdentity, productionManagerPaths } from './update-manager-runtime';
import { restoreOldBinaryAfterData } from './restore-old-binary-after-data';
import { UpdateJournal } from './update-journal';

function main() {
  if (process.argv.length !== 3 || !/^--operation=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.argv[2]))
    throw new Error('UPDATE_BINARY_RESTORE_COMMAND_INVALID');
  assertManagerSystemIdentity();
  const paths = productionManagerPaths(), operationId = process.argv[2].slice('--operation='.length);
  const journal = new UpdateJournal(paths.configDir, paths.backupRoot);
  const result = restoreOldBinaryAfterData({ journal, configDir: paths.configDir, dataDir: paths.dataDir,
    appDir: dirname(dirname(paths.versionPath)), operationId });
  process.stdout.write(JSON.stringify({ event: 'update-old-binary-restored-guarded', operationId: result.operationId }) + '\n');
}

try { main(); }
catch (error) {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UPDATE_BINARY_RESTORE_FAILED';
  process.stderr.write(JSON.stringify({ event: 'update-old-binary-restore-failed', code }) + '\n');
  process.exitCode = 1;
}
