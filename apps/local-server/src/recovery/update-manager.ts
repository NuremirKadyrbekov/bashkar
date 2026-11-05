import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { join, resolve } from 'node:path';
import type { MaintenanceResult } from '../server';
import { verifyReleaseArtifact, verifySignedRelease, type InstalledContext } from './release-verifier';
import { verifyUpdateInstallGrant, type AuthorizedUpdate, type UpdateActor } from './update-authorization';
import { UpdateJournal } from './update-journal';
import { readUpdateJob } from './update-job';
import { requestUpdateMaintenance, windowsUpdatePipe } from './update-control';
import { readMaintenanceReceipt } from './maintenance-receipt';

const sha256 = /^[0-9a-f]{64}$/;

/** Windows validates the PE signature and trust chain; the signer certificate is pinned by SHA-256. */
export function verifyWindowsAuthenticode(artifactPath: string, signerCertificateSha256: string) {
  if (process.platform !== 'win32') throw new Error('UPDATE_WINDOWS_REQUIRED');
  if (!isAbsolute(artifactPath) || !sha256.test(signerCertificateSha256)) throw new Error('UPDATE_AUTHENTICODE_CONFIGURATION_INVALID');
  const script = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $signature = Get-AuthenticodeSignature -LiteralPath $inputData.path
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate) { throw 'INVALID_SIGNATURE' }
  $cert = $signature.SignerCertificate
  $digest = [Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData)
  $actual = [BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant()
  if ($actual -cne $inputData.signerCertificateSha256) { throw 'SIGNER_MISMATCH' }
  [Console]::Out.Write('AUTHENTICODE_OK')
} catch { [Console]::Error.Write('AUTHENTICODE_INVALID'); exit 9 }
`;
  try {
    const output = execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { input: JSON.stringify({ path: artifactPath, signerCertificateSha256 }), encoding: 'utf8', timeout: 30000, maxBuffer: 1024, windowsHide: true });
    if (output !== 'AUTHENTICODE_OK') throw new Error('UPDATE_AUTHENTICODE_INVALID');
  } catch { throw new Error('UPDATE_AUTHENTICODE_INVALID'); }
}

type PreparationInput = {
  authorization: AuthorizedUpdate;
  expectedIdentity?: { instanceId: string; registrationId: string };
  artifactPath: string;
  journal: UpdateJournal;
  signerCertificateSha256: string;
  verifyAuthenticode?: (artifactPath: string, signerCertificateSha256: string) => void | Promise<void>;
  requestMaintenance: (operationId: string) => Promise<MaintenanceResult>;
  configDir?: string;
  now?: () => number;
};

/** Preparation verifies the server's restored backup result but never stops a service or starts an installer. */
export async function prepareAuthorizedUpdate(input: PreparationInput) {
  const { authorization, artifactPath, journal } = input;
  const now = input.now ?? Date.now;
  if (!sha256.test(input.signerCertificateSha256)) throw new Error('UPDATE_AUTHENTICODE_CONFIGURATION_INVALID');
  if (now() >= authorization.expiresAt) throw new Error('UPDATE_AUTHORIZATION_EXPIRED');
  await verifyReleaseArtifact(authorization.release, artifactPath);
  await (input.verifyAuthenticode ?? verifyWindowsAuthenticode)(artifactPath, input.signerCertificateSha256);
  // PowerShell and the first hash read are separate operations. Reopen and
  // hash again before creating durable intent; a changed EXE cannot advance.
  await verifyReleaseArtifact(authorization.release, artifactPath);
  if (now() >= authorization.expiresAt) throw new Error('UPDATE_AUTHORIZATION_EXPIRED');
  journal.start(authorization, now());
  try {
    const result = await input.requestMaintenance(authorization.operationId);
    const candidate = journal.recordCandidate(authorization.operationId, result);
    if (!input.expectedIdentity) return candidate;
    const restored = result.restoreChecked;
    if (!restored || restored.verified !== true || restored.operationId !== candidate.backup?.operationId ||
        restored.instanceId !== input.expectedIdentity.instanceId || restored.registrationId !== input.expectedIdentity.registrationId ||
        restored.schemaVersion !== candidate.backup.schemaVersion || !Number.isSafeInteger(restored.pinCount) || restored.pinCount < 0) throw new Error('UPDATE_RESTORE_PROOF_INVALID');
    return journal.recordBackupVerified(authorization.operationId, restored.operationId, restored.schemaVersion);
  } catch (error) {
    // Once the IPC starts, a lost response could mean the server already
    // entered maintenance. A complete receipt is reconciled only by a new
    // authenticated LocalService request, never by SYSTEM's file read alone.
    if (input.configDir) {
      let receipt = false;
      try { receipt = !!readMaintenanceReceipt(input.configDir, authorization.operationId); }
      catch { /* An incomplete or invalid receipt stays manual. */ }
      if (receipt) throw error;
    }
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UPDATE_PREPARATION_UNCERTAIN';
    try { journal.markRecoveryRequired(authorization.operationId, code); }
    catch { /* Preserve the original failure and any incomplete journal marker. */ }
    throw error;
  }
}

/** Re-verify both signed envelopes at the manager boundary before any intent. */
export async function prepareSignedUpdate(input: Omit<PreparationInput, 'authorization' | 'verifyAuthenticode'> & {
  signedRelease: unknown;
  signedGrant: unknown;
  releaseTrust: { keyId: string; publicKey: string };
  cloudTrust: { keyId: string; publicKey: string };
  installed: InstalledContext;
  identity: { branchId: string; instanceId: string; registrationId: string };
  actor: UpdateActor;
  operationId: string;
  separateBackupVerification?: boolean;
}) {
  const release = verifySignedRelease(input.signedRelease, input.releaseTrust, input.installed);
  const authorization = verifyUpdateInstallGrant(input.signedGrant, input.cloudTrust, input.identity, input.actor, release, input.operationId, (input.now ?? Date.now)());
  if (process.platform !== 'win32' || process.arch !== 'x64' || input.installed.os !== process.platform || input.installed.arch !== process.arch) throw new Error('UPDATE_PLATFORM_UNSUPPORTED');
  return prepareAuthorizedUpdate({ authorization, artifactPath: input.artifactPath, journal: input.journal,
    configDir: input.configDir,
    expectedIdentity: input.separateBackupVerification ? undefined :
      { instanceId: input.identity.instanceId, registrationId: input.identity.registrationId },
    signerCertificateSha256: input.signerCertificateSha256, requestMaintenance: input.requestMaintenance, now: input.now });
}

/** The future independent agent reads only a restricted, signed one-shot job. */
export async function prepareUpdateJob(input: {
  configDir: string;
  backupRoot: string;
  updatesDir: string;
  releaseTrust: { keyId: string; publicKey: string };
  cloudTrust: { keyId: string; publicKey: string };
  signerCertificateSha256: string;
  installed: InstalledContext;
  identity: { branchId: string; instanceId: string; registrationId: string };
}) {
  if (process.platform !== 'win32' || !process.env.ProgramData) throw new Error('UPDATE_WINDOWS_REQUIRED');
  const expected = resolve(process.env.ProgramData, 'BashkarPOS', 'updates');
  const stat = lstatSync(input.updatesDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(input.updatesDir).toLowerCase() !== expected.toLowerCase()) throw new Error('UPDATE_DOWNLOAD_DIRECTORY_INVALID');
  const job = readUpdateJob(input.configDir);
  if (!job) throw new Error('UPDATE_JOB_REQUIRED');
  const actor: UpdateActor = { id: job.actorId, branchId: input.identity.branchId, role: 'OWNER', audience: 'LOCAL_ADMIN', method: 'CLOUD_OWNER' };
  return prepareSignedUpdate({ signedRelease: job.signedRelease, signedGrant: job.signedGrant,
    releaseTrust: input.releaseTrust, cloudTrust: input.cloudTrust,
    installed: input.installed, identity: input.identity, actor, operationId: job.operationId,
    separateBackupVerification: true,
    artifactPath: join(expected, job.signedRelease.manifest.artifact.fileName),
    journal: new UpdateJournal(input.configDir, input.backupRoot),
    configDir: input.configDir,
    signerCertificateSha256: input.signerCertificateSha256,
    requestMaintenance: operationId => requestUpdateMaintenance(input.configDir, windowsUpdatePipe, operationId) });
}
