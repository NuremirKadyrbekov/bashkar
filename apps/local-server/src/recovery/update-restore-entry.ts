import { windowsBackupProtector } from './backup-set';
import { assertLocalService, restoreGuardedData } from './update-data-restore';
import { productionManagerPaths } from './update-manager-runtime';
import { UpdateJournal } from './update-journal';

async function main() {
  if (process.argv.length !== 3 || !/^--operation=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.argv[2]))
    throw new Error('UPDATE_RESTORE_COMMAND_INVALID');
  assertLocalService();
  const paths = productionManagerPaths(), operationId = process.argv[2].slice('--operation='.length);
  const journal = new UpdateJournal(paths.configDir, paths.backupRoot);
  const result = await restoreGuardedData({ journal, configDir: paths.configDir, dataDir: paths.dataDir,
    operationId, protector: windowsBackupProtector() });
  process.stdout.write(JSON.stringify({ event: 'update-data-restored-guarded', operationId: result.operationId,
    schemaVersion: result.schemaVersion }) + '\n');
}

main().catch(error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UPDATE_RESTORE_FAILED';
  process.stderr.write(JSON.stringify({ event: 'update-data-restore-failed', code }) + '\n');
  process.exitCode = 1;
});
