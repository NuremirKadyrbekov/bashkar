import { lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { verifyOldBinaryInventory } from './old-binary-inventory';
import { verifyStagedPayload } from './payload-manifest';
import { inspectMigratedInstall } from './update-health';
import { UpdateJournal } from './update-journal';
import { assertWindowsServiceStopped } from './update-migration';

function regular(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_NEW_PRESTART_FILE_INVALID');
}

/** The stopped new install must match its publisher signature and the retained old install. */
export async function verifyNewInstallPrestart(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; appDir: string; operationId: string;
  releaseTrust: { publicKey: string }; assertServiceStopped?: () => void; probeMode?: boolean;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || !row.backup ||
      !(input.probeMode ? ['NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY', 'NEW_FINALIZE_INTENT', 'NEW_READY_TO_START'].includes(row.phase) :
        ['MIGRATED', 'NEW_INSTALL_PRESTART_VERIFIED'].includes(row.phase)))
    throw new Error('UPDATE_NEW_PRESTART_STATE_INVALID');
  if (basename(input.appDir) !== 'Bashkar POS' || basename(input.dataDir) !== 'data' ||
      (process.platform === 'win32' && (!process.env.ProgramW6432 || !process.env.ProgramData ||
        resolve(dirname(input.appDir)).toLowerCase() !== resolve(process.env.ProgramW6432).toLowerCase() ||
        resolve(input.dataDir).toLowerCase() !== resolve(process.env.ProgramData, 'BashkarPOS', 'data').toLowerCase())))
    throw new Error('UPDATE_NEW_PRESTART_PATH_INVALID');
  if (!input.probeMode) (input.assertServiceStopped ?? assertWindowsServiceStopped)();
  const intentPath = join(input.configDir, 'update-intent.json'), guardPath = join(input.configDir, 'update-guard.json');
  regular(intentPath); regular(guardPath);
  const intent = JSON.parse(readFileSync(intentPath, 'utf8')) as Record<string, unknown>;
  const guard = JSON.parse(readFileSync(guardPath, 'utf8')) as Record<string, unknown>;
  if (Object.keys(intent).sort().join(',') !== 'backupOperationId,format,operationId,phase' ||
      intent.format !== 1 || intent.phase !== 'GUARD_REQUESTED' || intent.operationId !== row.operationId ||
      intent.backupOperationId !== row.backup.operationId ||
      Object.keys(guard).sort().join(',') !== 'format,operationId' || guard.format !== 1 ||
      guard.operationId !== row.operationId) throw new Error('UPDATE_GUARD_MISMATCH');
  const previous = join(dirname(input.appDir), `Bashkar POS.previous.${row.operationId}`);
  const oldVersion = verifyOldBinaryInventory(input.configDir, previous, row.operationId);
  await verifyStagedPayload(input.appDir, input.releaseTrust,
    { releaseId: row.releaseId, version: row.targetVersion },
    ['BashkarPOSLocalServer.xml', 'Uninstall.exe']);
  regular(join(row.backup.path, 'manifest.json'));
  const backup = JSON.parse(readFileSync(join(row.backup.path, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  if (backup.operationId !== row.backup.operationId || backup.softwareVersion !== oldVersion ||
      backup.schemaVersion !== row.backup.schemaVersion || typeof backup.instanceId !== 'string')
    throw new Error('UPDATE_NEW_PRESTART_BACKUP_INVALID');
  const checked = inspectMigratedInstall({ journal: input.journal, configDir: input.configDir,
    dataDir: input.dataDir, appDir: input.appDir, operationId: input.operationId,
    assertServiceStopped: input.assertServiceStopped ?? assertWindowsServiceStopped,
    probeMode: input.probeMode });
  if (checked.instanceId !== backup.instanceId || checked.version !== row.targetVersion ||
      checked.schemaVersion !== row.targetSchema) throw new Error('UPDATE_NEW_PRESTART_IDENTITY_INVALID');
  if (row.phase === 'MIGRATED') input.journal.recordNewInstallPrestartVerified(row.operationId);
  return { state: 'NEW_INSTALL_PRESTART_VERIFIED' as const, operationId: row.operationId,
    version: checked.version, schemaVersion: checked.schemaVersion, instanceId: checked.instanceId,
    counts: checked.counts };
}
