import { dirname, join, resolve } from 'node:path';
import { guardedStartupMode } from './startup-guard';
import { productionManagerPaths, readProductionManagerTrust } from './update-manager-runtime';
import { startRecoveryProbe } from './recovery-probe';
import { UpdateJournal } from './update-journal';
import { inspectNewServiceProbe } from './new-service-probe';

async function main() {
  if (process.platform !== 'win32' || process.argv.length !== 2) throw new Error('UPDATE_BOOTSTRAP_COMMAND_INVALID');
  const paths = productionManagerPaths();
  if (!process.env.BASHKAR_DATA_DIR || resolve(process.env.BASHKAR_DATA_DIR).toLowerCase() !== resolve(paths.dataDir).toLowerCase())
    throw new Error('UPDATE_BOOTSTRAP_DATA_INVALID');
  const mode = guardedStartupMode(paths.configDir, paths.backupRoot);
  const appDir = dirname(dirname(paths.versionPath));
  if (mode.kind === 'NORMAL') {
    // Resolve the installed application only after the stable guard check.
    require(join(appDir, 'server', 'main.js'));
    return;
  }
  const port = Number(process.env.BASHKAR_PORT ?? '3210');
  const journal = new UpdateJournal(paths.configDir, paths.backupRoot);
  const releaseTrust = mode.kind === 'NEW_PROBE' ? readProductionManagerTrust(paths.trustPath).releaseTrust : undefined;
  const probe = await startRecoveryProbe({ journal, configDir: paths.configDir, dataDir: paths.dataDir,
    appDir, operationId: mode.operationId, port,
    inspect: releaseTrust ? (nonce, key) => inspectNewServiceProbe({ journal, configDir: paths.configDir,
      dataDir: paths.dataDir, appDir, operationId: mode.operationId, releaseTrust, nonce, key }) : undefined });
  const stop = () => { void probe.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

main().catch(error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UPDATE_BOOTSTRAP_FAILED';
  process.stderr.write(JSON.stringify({ event: 'service-bootstrap-failed', code }) + '\n');
  process.exitCode = 1;
});
