import { windowsBackupProtector } from './backup-set';
import { acceptBackupCandidate } from './backup-acceptance';
import { assertLocalService } from './update-data-restore';
import { productionManagerPaths, readInstalledUpdateContext, readProductionManagerTrust } from './update-manager-runtime';
import { UpdateJournal } from './update-journal';

async function main() {
  if (process.argv.length !== 3 || !/^--operation=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.argv[2]))
    throw new Error('UPDATE_BACKUP_COMMAND_INVALID');
  assertLocalService();
  const paths = productionManagerPaths(), operationId = process.argv[2].slice('--operation='.length);
  const trust = readProductionManagerTrust(paths.trustPath);
  const context = readInstalledUpdateContext(paths.dataDir, paths.updatesDir, paths.versionPath, trust);
  const result = await acceptBackupCandidate({ journal: new UpdateJournal(paths.configDir, paths.backupRoot),
    operationId, expectedIdentity: { instanceId: context.identity.instanceId,
      registrationId: context.identity.registrationId }, protector: windowsBackupProtector() });
  process.stdout.write(JSON.stringify({ event: 'update-backup-verified', operationId: result.operationId }) + '\n');
}
main().catch(error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UPDATE_BACKUP_FAILED';
  process.stderr.write(JSON.stringify({ event: 'update-backup-verify-failed', code }) + '\n');
  process.exitCode = 1;
});
