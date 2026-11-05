import { join } from 'node:path';
import { readUpdateJob } from './update-job';
import { verifySignedRelease, verifyReleaseArtifact } from './release-verifier';
import { verifyUpdateInstallGrant } from './update-authorization';
import { verifyWindowsAuthenticode } from './update-manager';
import { assertManagerSystemIdentity, productionManagerPaths, readInstalledUpdateContext, readProductionManagerTrust } from './update-manager-runtime';
import { UpdateJournal } from './update-journal';
import { planManagerResume } from './manager-coordinator';
import { runManagerOperation } from './manager-runner';
import { productionManagerHandlers } from './manager-production-handlers';

async function main() {
  if (process.argv.length !== 3 || !['--preflight', '--resume-status', '--run'].includes(process.argv[2])) throw new Error('UPDATE_MANAGER_COMMAND_INVALID');
  assertManagerSystemIdentity();
  const paths = productionManagerPaths();
  if (process.argv[2] === '--run') {
    const journal = new UpdateJournal(paths.configDir, paths.backupRoot);
    const job = readUpdateJob(paths.configDir);
    if (!job) {
      if (journal.read()) throw new Error('UPDATE_JOB_REQUIRED');
      process.stdout.write(JSON.stringify({ event: 'update-manager-idle' }) + '\n');
      return;
    }
    const trust = readProductionManagerTrust(paths.trustPath);
    const result = await runManagerOperation({ journal, configDir: paths.configDir, job,
      handlers: productionManagerHandlers(paths, trust, journal) });
    process.stdout.write(JSON.stringify({ event: 'update-manager-completed', ...result }) + '\n');
    return;
  }
  if (process.argv[2] === '--resume-status') {
    const next = planManagerResume({ journal: new UpdateJournal(paths.configDir, paths.backupRoot),
      configDir: paths.configDir, job: readUpdateJob(paths.configDir) });
    process.stdout.write(JSON.stringify({ event: 'update-resume-status', ...next }) + '\n');
    return;
  }
  const trust = readProductionManagerTrust(paths.trustPath);
  const context = readInstalledUpdateContext(paths.dataDir, paths.updatesDir, paths.versionPath, trust);
  const job = readUpdateJob(paths.configDir);
  if (!job) throw new Error('UPDATE_JOB_REQUIRED');
  const release = verifySignedRelease(job.signedRelease, trust.releaseTrust, context.installed);
  verifyUpdateInstallGrant(job.signedGrant, trust.cloudTrust, context.identity,
    { id: job.actorId, branchId: context.identity.branchId, role: 'OWNER', audience: 'LOCAL_ADMIN', method: 'CLOUD_OWNER' }, release, job.operationId);
  const artifact = join(paths.updatesDir, release.manifest.artifact.fileName);
  await verifyReleaseArtifact(release, artifact);
  verifyWindowsAuthenticode(artifact, trust.signerCertificateSha256);
  await verifyReleaseArtifact(release, artifact);
  process.stdout.write(JSON.stringify({ event: 'update-preflight-ok', operationId: job.operationId, releaseId: release.manifest.releaseId }) + '\n');
}

main().catch(error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UPDATE_MANAGER_FAILED';
  process.stderr.write(JSON.stringify({ event: 'update-manager-failed', code }) + '\n');
  process.exitCode = 1;
});
