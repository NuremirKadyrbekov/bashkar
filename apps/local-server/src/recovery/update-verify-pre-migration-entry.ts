import { dirname } from 'node:path';
import { windowsBackupProtector } from './backup-set';
import { productionManagerPaths } from './update-manager-runtime';
import { UpdateJournal } from './update-journal';
import { verifyPreMigrationData } from './verify-pre-migration-data';
import { assertLocalService } from './update-data-restore';

async function main() {
  if (process.argv.length !== 3 || !/^--operation=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.argv[2]))
    throw new Error('UPDATE_PRE_MIGRATION_COMMAND_INVALID');
  assertLocalService();
  const paths = productionManagerPaths(), operationId = process.argv[2].slice('--operation='.length);
  const result = await verifyPreMigrationData({ journal: new UpdateJournal(paths.configDir, paths.backupRoot),
    configDir: paths.configDir, dataDir: paths.dataDir, appDir: dirname(dirname(paths.versionPath)),
    operationId, protector: windowsBackupProtector() });
  process.stdout.write(JSON.stringify({ event: 'update-pre-migration-data-verified', ...result }) + '\n');
}
main().catch(error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UPDATE_PRE_MIGRATION_FAILED';
  process.stderr.write(JSON.stringify({ event: 'update-pre-migration-failed', code }) + '\n');
  process.exitCode = 1;
});
