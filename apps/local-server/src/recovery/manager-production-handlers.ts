import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { UpdateJournal } from './update-journal';
import { readUpdateJob } from './update-job';
import { readInstalledUpdateContext } from './update-manager-runtime';
import { prepareUpdateJob, verifyWindowsAuthenticode } from './update-manager';
import { requestUpdateMaintenance, windowsUpdatePipe } from './update-control';
import { reconcileMaintenanceReceipt, migrateOrRecoverBeforeIntent, type ManagerAction } from './manager-coordinator';
import { localServiceManagerHandlers } from './manager-local-service';
import { quiesceVerifiedUpdate } from './windows-service-control';
import { verifySignedRelease, verifyReleaseArtifact } from './release-verifier';
import { verifyStagedPayload } from './payload-manifest';
import { switchVerifiedBinary, restoreOldBinaryBeforeMigration } from './binary-switch';
import { assertWindowsServiceStopped } from './update-migration';
import { assertNoActiveMigrationProcess } from './migration-process';
import { verifyOldBinaryInventory } from './old-binary-inventory';
import { readInstalledSoftwareVersion } from './release-version';
import { runLocalServiceTask } from './local-service-task';
import { restoreOldBinaryAfterData } from './restore-old-binary-after-data';
import { verifyNewInstallPrestart } from './verify-new-install';
import { startGuardedNewServiceProbe } from './new-service-probe';
import { finalizeNewUpdate } from './finalize-new-update';
import { startGuardedServiceProbe } from './guarded-service-probe';
import { finalizeRestoredRecovery } from './finalize-restored-recovery';
import type { LocalServiceAction } from './local-service-task';

type Paths = { configDir: string; backupRoot: string; updatesDir: string; dataDir: string; versionPath: string };
type Trust = { agentVersion: string; releaseTrust: { keyId: string; publicKey: string };
  cloudTrust: { keyId: string; publicKey: string }; signerCertificateSha256: string };
type Boundaries = {
  readContext?: typeof readInstalledUpdateContext;
  prepare?: typeof prepareUpdateJob;
  requestMaintenance?: typeof requestUpdateMaintenance;
  localTask?: (action: LocalServiceAction, operationId: string) => void | Promise<void>;
  stopService?: (operationId: string, backupOperationId: string) => void;
  captureInventory?: (configDir: string, appDir: string, operationId: string) => string;
  stage?: (artifact: string, stage: string) => void;
  migrate?: (node: string, script: string, operationId: string) => void;
  authenticode?: typeof verifyWindowsAuthenticode;
  serviceStopped?: () => void;
  noMigrationProcess?: (appDir: string) => void;
  switchMove?: (from: string, to: string) => void;
  oldMove?: (from: string, to: string) => void;
  newProbe?: Partial<Parameters<typeof startGuardedNewServiceProbe>[0]>;
  oldProbe?: Partial<Parameters<typeof startGuardedServiceProbe>[0]>;
  newFinalizer?: Partial<Parameters<typeof finalizeNewUpdate>[0]>;
  oldFinalizer?: Partial<Parameters<typeof finalizeRestoredRecovery>[0]>;
};

/** Fixed production actions. The entry point must still enforce SYSTEM and the OS lock. */
export function productionManagerHandlers(paths: Paths, trust: Trust, journal: UpdateJournal, boundary: Boundaries = {}) {
  const appDir = dirname(dirname(paths.versionPath));
  const job = readUpdateJob(paths.configDir);
  if (!job) throw new Error('UPDATE_JOB_REQUIRED');
  const localTask = boundary.localTask ?? runLocalServiceTask;
  const local = localServiceManagerHandlers(localTask);
  const old = (operationId: string) => restoreOldBinaryBeforeMigration({ journal, configDir: paths.configDir, appDir, operationId,
    assertServiceStopped: boundary.serviceStopped, move: boundary.oldMove });
  const handlers: Partial<Record<ManagerAction, (operationId: string) => void | Promise<void>>> = {
    ...local,
    PREPARE_NEW_OPERATION: async operationId => {
      if (operationId !== job.operationId) throw new Error('UPDATE_MANAGER_JOB_JOURNAL_MISMATCH');
      const context = (boundary.readContext ?? readInstalledUpdateContext)(paths.dataDir, paths.updatesDir, paths.versionPath, trust as Parameters<typeof readInstalledUpdateContext>[3]);
      await (boundary.prepare ?? prepareUpdateJob)({ ...paths, releaseTrust: trust.releaseTrust, cloudTrust: trust.cloudTrust,
        signerCertificateSha256: trust.signerCertificateSha256, ...context });
    },
    RECONCILE_MAINTENANCE: async operationId => {
      await reconcileMaintenanceReceipt(journal, paths.configDir, operationId,
        id => (boundary.requestMaintenance ?? requestUpdateMaintenance)(paths.configDir, windowsUpdatePipe, id));
    },
    QUIESCE_SERVICE: operationId => { quiesceVerifiedUpdate({ journal, configDir: paths.configDir, operationId, appDir,
      stopService: boundary.stopService, captureInventory: boundary.captureInventory }); },
    STAGE_AND_SWITCH_BINARY: async operationId => {
      const row = journal.read();
      if (!row || row.operationId !== operationId || row.phase !== 'SERVICE_QUIESCED') throw new Error('UPDATE_OPERATION_STATE_INVALID');
      try {
        const context = (boundary.readContext ?? readInstalledUpdateContext)(paths.dataDir, paths.updatesDir, paths.versionPath, trust as Parameters<typeof readInstalledUpdateContext>[3]);
        const release = verifySignedRelease(job.signedRelease, trust.releaseTrust, context.installed);
        if (release.manifestSha256 !== row.manifestSha256 || release.manifest.releaseId !== row.releaseId ||
            release.manifest.version !== row.targetVersion || release.manifest.artifact.sha256 !== row.artifactSha256)
          throw new Error('UPDATE_MANAGER_JOB_JOURNAL_MISMATCH');
        const artifact = join(paths.updatesDir, release.manifest.artifact.fileName);
        await verifyReleaseArtifact(release, artifact);
        (boundary.authenticode ?? verifyWindowsAuthenticode)(artifact, trust.signerCertificateSha256);
        await verifyReleaseArtifact(release, artifact);
        const stage = join(dirname(appDir), `Bashkar POS.incoming.${operationId}`);
        if (boundary.stage) boundary.stage(artifact, stage);
        else execFileSync(artifact, ['/S', `/BASHKAR_STAGE=${stage}`],
          { timeout: 600000, maxBuffer: 4096, windowsHide: true });
        await verifyStagedPayload(stage, trust.releaseTrust, { releaseId: row.releaseId, version: row.targetVersion });
        await switchVerifiedBinary({ journal, configDir: paths.configDir, appDir, operationId,
          releaseTrust: trust.releaseTrust, release: { releaseId: row.releaseId, version: row.targetVersion },
          assertServiceStopped: boundary.serviceStopped, move: boundary.switchMove });
      } catch (error) {
        const current = journal.read();
        if (current?.operationId !== operationId) throw error;
        if (['SERVICE_QUIESCED', 'BINARY_SWITCH_INTENT'].includes(current.phase) ||
            (current.phase === 'RECOVERY_REQUIRED' && current.errorCode === 'UPDATE_BINARY_SWITCH_FAILED')) old(operationId);
        else throw error;
      }
    },
    RECOVER_BINARY_BEFORE_MIGRATION: operationId => { old(operationId); },
    MIGRATE_NEW_BINARY: async operationId => {
      await migrateOrRecoverBeforeIntent({ journal, operationId,
        migrate: async () => {
          const row = journal.read();
          if (!row || row.operationId !== operationId || row.phase !== 'BINARY_SWITCHED')
            throw new Error('UPDATE_MIGRATION_STATE_INVALID');
          (boundary.serviceStopped ?? assertWindowsServiceStopped)();
          (boundary.noMigrationProcess ?? assertNoActiveMigrationProcess)(appDir);
          verifyOldBinaryInventory(paths.configDir, join(dirname(appDir), `Bashkar POS.previous.${operationId}`), operationId);
          if (readInstalledSoftwareVersion(paths.versionPath) !== row.targetVersion)
            throw new Error('UPDATE_MIGRATION_TARGET_INVALID');
          await verifyStagedPayload(appDir, trust.releaseTrust, { releaseId: row.releaseId, version: row.targetVersion },
            ['BashkarPOSLocalServer.xml', 'Uninstall.exe']);
          const node = join(appDir, 'node.exe'), script = join(appDir, 'server', 'update-migrate.js');
          if (boundary.migrate) boundary.migrate(node, script, operationId);
          else execFileSync(node, [script, `--operation=${operationId}`],
            { timeout: 600000, maxBuffer: 4096, windowsHide: true });
          if (journal.read()?.phase !== 'MIGRATED') throw new Error('UPDATE_MIGRATION_RESULT_INVALID');
        },
        restoreOldBinary: () => { (boundary.noMigrationProcess ?? assertNoActiveMigrationProcess)(appDir); old(operationId); } });
    },
    RESTORE_DATA_WITH_LOCAL_SERVICE: async operationId => {
      (boundary.serviceStopped ?? assertWindowsServiceStopped)();
      (boundary.noMigrationProcess ?? assertNoActiveMigrationProcess)(appDir);
      await localTask('restore-data', operationId);
    },
    RESTORE_OLD_BINARY: operationId => { restoreOldBinaryAfterData({ journal, configDir: paths.configDir,
      dataDir: paths.dataDir, appDir, operationId, assertServiceStopped: boundary.serviceStopped }); },
    VERIFY_NEW_INSTALL_PRESTART: async operationId => {
      (boundary.noMigrationProcess ?? assertNoActiveMigrationProcess)(appDir);
      try { await verifyNewInstallPrestart({ journal, configDir: paths.configDir,
        dataDir: paths.dataDir, appDir, operationId, releaseTrust: trust.releaseTrust,
        assertServiceStopped: boundary.serviceStopped }); }
      catch (error) {
        if (journal.read()?.phase === 'MIGRATED') journal.markRecoveryRequired(operationId, 'UPDATE_HEALTH_FAILED');
        throw error;
      }
    },
    START_NEW_SERVICE_PROBE: async operationId => { await startGuardedNewServiceProbe({ journal,
      configDir: paths.configDir, dataDir: paths.dataDir, appDir, operationId, releaseTrust: trust.releaseTrust,
      ...boundary.newProbe }); },
    FINALIZE_NEW_INSTALL: async operationId => { await finalizeNewUpdate({ journal, configDir: paths.configDir,
      backupRoot: paths.backupRoot, dataDir: paths.dataDir, appDir, operationId, releaseTrust: trust.releaseTrust,
      ...boundary.newFinalizer }); },
    START_GUARDED_SERVICE_PROBE: async operationId => { await startGuardedServiceProbe({ journal,
      configDir: paths.configDir, dataDir: paths.dataDir, appDir, operationId, ...boundary.oldProbe }); },
    FINALIZE_RESTORED_INSTALL: async operationId => { await finalizeRestoredRecovery({ journal,
      configDir: paths.configDir, backupRoot: paths.backupRoot, dataDir: paths.dataDir, appDir, operationId,
      ...boundary.oldFinalizer }); }
  };
  return handlers;
}
