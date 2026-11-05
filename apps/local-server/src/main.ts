import { isAbsolute, join, resolve } from 'node:path';
import { Storage } from './storage';
import { createServer } from './server';
import { cloudConfig } from './modules/activation/cloud-config';
import { PlatformDeviceIdentity } from './modules/activation/platform-device';
import { assertStartupAllowed } from './recovery/startup-guard';
import { windowsUpdatePipe } from './recovery/update-control';
import { readInstalledSoftwareVersion } from './recovery/release-version';
import { UpdateJournal } from './recovery/update-journal';

async function main() {
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major!==24 || minor<7)throw new Error('RUNTIME_UNSUPPORTED');
  const dir = process.env.BASHKAR_DATA_DIR;
  if (!dir || !isAbsolute(dir)) throw new Error('DATA_DIR_REQUIRED');
  let recoveryQuarantine = false;
  if (process.platform === 'win32') {
    if (!process.env.ProgramData) throw new Error('UPDATE_GUARD_UNAVAILABLE');
    const productionRoot = join(process.env.ProgramData, 'BashkarPOS');
    if (resolve(dir).toLowerCase() === resolve(productionRoot, 'data').toLowerCase()) {
      const configDir = join(productionRoot, 'config');
      assertStartupAllowed(configDir, join(productionRoot, 'backups'));
      recoveryQuarantine = ['RECOVERY_READY_TO_START', 'RECOVERY_QUARANTINE_HEALTHY',
        'NEW_READY_TO_START', 'NEW_QUARANTINE_HEALTHY'].includes(
        new UpdateJournal(configDir, join(productionRoot, 'backups')).read()?.phase ?? '');
    }
  }
  if (process.argv.length > 3 || (process.argv[2] && !['init-db', 'migrate-db'].includes(process.argv[2]))) throw new Error('INVALID_COMMAND');
  if (process.argv[2] === 'init-db') { new Storage(dir).initialize(); process.stdout.write('{"event":"initialized"}\n'); return; }
  if (process.argv[2] === 'migrate-db') { new Storage(dir).migrate(); process.stdout.write('{"event":"migrated"}\n'); return; }
  const port = Number(process.env.BASHKAR_PORT ?? '3210');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  const waiterHttp = process.env.BASHKAR_WAITER_HTTP_IP ? { ip: process.env.BASHKAR_WAITER_HTTP_IP, port: Number(process.env.BASHKAR_WAITER_HTTP_PORT ?? '3002') } : undefined;
  const softwareVersion = process.platform === 'win32' && resolve(dir).toLowerCase() === resolve(process.env.ProgramData!, 'BashkarPOS', 'data').toLowerCase()
    ? readInstalledSoftwareVersion(join(__dirname, 'version.json')) : '0.1.0';
  const maintenanceBackup = process.platform === 'win32' && resolve(dir).toLowerCase() === resolve(process.env.ProgramData!, 'BashkarPOS', 'data').toLowerCase()
    ? { backupRoot: join(process.env.ProgramData!, 'BashkarPOS', 'backups'), softwareVersion } : undefined;
  const updateControl = maintenanceBackup ? { configDir: join(process.env.ProgramData!, 'BashkarPOS', 'config'), socketPath: windowsUpdatePipe } : undefined;
  const app = await createServer(dir, port,true,{authority:{publicKey:cloudConfig.authorityPublicKey},device:new PlatformDeviceIdentity(dir),cloud:cloudConfig,waiterHttp,maintenanceBackup,updateControl: recoveryQuarantine ? undefined : updateControl,recoveryQuarantine});
  let stopping = false;
  const stop = () => { if (!stopping) { stopping = true; void app.close().catch(() => { process.exitCode = 1; }); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch((error: unknown) => { const code = (error as {code?:string})?.code==='EADDRINUSE'?'PORT_IN_USE':error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'STARTUP_FAILED'; process.stderr.write(JSON.stringify({ level: 'error', component: 'local-server', code }) + '\n'); process.exitCode = 1; });
