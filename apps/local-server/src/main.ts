import { isAbsolute } from 'node:path';
import { Storage } from './storage';
import { createServer } from './server';
import { cloudConfig } from './modules/activation/cloud-config';
import { PlatformDeviceIdentity } from './modules/activation/platform-device';

async function main() {
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major!==24 || minor<7)throw new Error('RUNTIME_UNSUPPORTED');
  const dir = process.env.BASHKAR_DATA_DIR;
  if (!dir || !isAbsolute(dir)) throw new Error('DATA_DIR_REQUIRED');
  if (process.argv.length > 3 || (process.argv[2] && !['init-db', 'migrate-db'].includes(process.argv[2]))) throw new Error('INVALID_COMMAND');
  if (process.argv[2] === 'init-db') { new Storage(dir).initialize(); process.stdout.write('{"event":"initialized"}\n'); return; }
  if (process.argv[2] === 'migrate-db') { new Storage(dir).migrate(); process.stdout.write('{"event":"migrated"}\n'); return; }
  const port = Number(process.env.BASHKAR_PORT ?? '3210');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  const waiterHttp = process.env.BASHKAR_WAITER_HTTP_IP ? { ip: process.env.BASHKAR_WAITER_HTTP_IP, port: Number(process.env.BASHKAR_WAITER_HTTP_PORT ?? '3002') } : undefined;
  const app = await createServer(dir, port,true,{authority:{publicKey:cloudConfig.authorityPublicKey},device:new PlatformDeviceIdentity(dir),cloud:cloudConfig,waiterHttp});
  let stopping = false;
  const stop = () => { if (!stopping) { stopping = true; void app.close().catch(() => { process.exitCode = 1; }); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch((error: unknown) => { const code = (error as {code?:string})?.code==='EADDRINUSE'?'PORT_IN_USE':error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'STARTUP_FAILED'; process.stderr.write(JSON.stringify({ level: 'error', component: 'local-server', code }) + '\n'); process.exitCode = 1; });
