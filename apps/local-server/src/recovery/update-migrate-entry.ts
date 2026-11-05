import { assertManagerSystemIdentity, productionManagerPaths } from './update-manager-runtime';
import { runGuardedMigration } from './update-migration';
import { UpdateJournal } from './update-journal';

function main() {
  if (process.argv.length !== 3 || !/^--operation=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.argv[2])) throw new Error('UPDATE_MIGRATION_COMMAND_INVALID');
  assertManagerSystemIdentity();
  const paths = productionManagerPaths(), operationId = process.argv[2].slice('--operation='.length);
  const journal = new UpdateJournal(paths.configDir, paths.backupRoot);
  const result = runGuardedMigration({ journal, configDir: paths.configDir,
    dataDir: paths.dataDir, versionPath: paths.versionPath, operationId });
  process.stdout.write(JSON.stringify({ event: 'update-migrated', operationId: result.operationId, schemaVersion: result.targetSchema }) + '\n');
}

try { main(); }
catch (error) {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UPDATE_MIGRATION_FAILED';
  process.stderr.write(JSON.stringify({ event: 'update-migration-failed', code }) + '\n');
  process.exitCode = 1;
}
