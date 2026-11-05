import { randomBytes } from 'node:crypto';
import { assertInstalledStableBootstrap, requestProbe, startWindowsProbeService } from './guarded-service-probe';
import { recoveryProbeProof, restoredDataDigest, verifyRecoveryProbeResponse } from './recovery-probe';
import { UpdateJournal } from './update-journal';
import { verifyNewInstallPrestart } from './verify-new-install';
import { assertLocalService } from './update-data-restore';

export async function inspectNewServiceProbe(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; appDir: string; operationId: string;
  releaseTrust: { publicKey: string }; nonce: string; key: Buffer; assertLocalService?: () => void;
}) {
  (input.assertLocalService ?? assertLocalService)();
  const checked = await verifyNewInstallPrestart({ journal: input.journal, configDir: input.configDir,
    dataDir: input.dataDir, appDir: input.appDir, operationId: input.operationId,
    releaseTrust: input.releaseTrust, probeMode: true });
  const dataDigest = restoredDataDigest(input.dataDir);
  return { state: 'RECOVERY_PROBE_HEALTHY' as const, operationId: checked.operationId,
    version: checked.version, schemaVersion: checked.schemaVersion, dataDigest,
    proof: recoveryProbeProof(input.key, input.nonce, checked.operationId,
      checked.version, checked.schemaVersion, dataDigest) };
}

/** Start the signed new-release probe only. The POS server remains guarded. */
export async function startGuardedNewServiceProbe(input: {
  journal: UpdateJournal; configDir: string; dataDir: string; appDir: string; operationId: string;
  releaseTrust: { publicKey: string }; port?: number;
  assertBootstrap?: () => void; assertServiceStopped?: () => void;
  startService?: (operationId: string, backupOperationId: string) => void;
  requestHealth?: (nonce: string, port: number) => Promise<unknown>;
}) {
  const row = input.journal.read();
  if (!row || row.operationId !== input.operationId || !row.backup ||
      !['NEW_INSTALL_PRESTART_VERIFIED', 'NEW_SERVICE_PROBE_INTENT', 'NEW_SERVICE_PROBE_HEALTHY',
        'NEW_FINALIZE_INTENT', 'NEW_READY_TO_START'].includes(row.phase))
    throw new Error('UPDATE_NEW_PROBE_STATE_INVALID');
  const port = input.port ?? 3210;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('UPDATE_NEW_PROBE_PORT_INVALID');
  (input.assertBootstrap ?? assertInstalledStableBootstrap)();
  await verifyNewInstallPrestart({ journal: input.journal, configDir: input.configDir,
    dataDir: input.dataDir, appDir: input.appDir, operationId: input.operationId,
    releaseTrust: input.releaseTrust, probeMode: row.phase !== 'NEW_INSTALL_PRESTART_VERIFIED',
    assertServiceStopped: input.assertServiceStopped });
  if (row.phase === 'NEW_INSTALL_PRESTART_VERIFIED') input.journal.recordNewServiceProbeIntent(row.operationId);
  (input.startService ?? startWindowsProbeService)(row.operationId, row.backup.operationId);
  const nonce = randomBytes(32).toString('base64url');
  let lastError: unknown;
  const deadline = Date.now() + (input.requestHealth ? 1 : 60000);
  do {
    try {
      const response = await (input.requestHealth ?? ((value, targetPort) => requestProbe(targetPort, value)))(nonce, port);
      const verified = verifyRecoveryProbeResponse(input.configDir, response, { nonce,
        operationId: row.operationId, version: row.targetVersion, schemaVersion: row.targetSchema });
      if (row.phase === 'NEW_INSTALL_PRESTART_VERIFIED' || row.phase === 'NEW_SERVICE_PROBE_INTENT')
        input.journal.recordNewServiceProbeHealthy(row.operationId);
      return { state: 'NEW_SERVICE_PROBE_HEALTHY' as const, operationId: row.operationId,
        version: row.targetVersion, schemaVersion: row.targetSchema, dataDigest: verified.dataDigest };
    } catch (error) { lastError = error; }
    if (Date.now() < deadline) await new Promise(resolveDelay => setTimeout(resolveDelay, 1000));
  } while (Date.now() < deadline);
  throw lastError instanceof Error ? lastError : new Error('UPDATE_NEW_PROBE_FAILED');
}
