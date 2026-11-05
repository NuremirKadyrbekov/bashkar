import { createServer, type Server } from 'node:net';
import { chmodSync, lstatSync, unlinkSync } from 'node:fs';

export const windowsManagerLockPipe = String.raw`\\.\pipe\BashkarPOSUpdateManagerExecution`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The listening OS handle is the lock; no stale lock file is trusted after a crash. */
export async function withManagerExecutionLock<T>(operationId: string, run: () => Promise<T>,
  pipePath = windowsManagerLockPipe): Promise<T> {
  if (!uuid.test(operationId)) throw new Error('UPDATE_OPERATION_ID_INVALID');
  if (process.platform === 'win32' && pipePath !== windowsManagerLockPipe)
    throw new Error('UPDATE_MANAGER_LOCK_PATH_INVALID');
  const server: Server = createServer(socket => {
    socket.end(JSON.stringify({ operationId }) + '\n');
  });
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(pipePath, () => { server.off('error', reject); resolveListen(); });
    });
  } catch (error) {
    server.close();
    if (['EADDRINUSE', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw new Error('UPDATE_MANAGER_BUSY');
    throw error;
  }
  try {
    if (process.platform !== 'win32') chmodSync(pipePath, 0o600);
    return await run();
  } finally {
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    if (process.platform !== 'win32') {
      try {
        const stat = lstatSync(pipePath);
        if (!stat.isSocket()) throw new Error('UPDATE_MANAGER_LOCK_INVALID');
        unlinkSync(pipePath);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
}
