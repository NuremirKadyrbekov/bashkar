import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { join, resolve } from 'node:path';
import type { MaintenanceResult } from '../server';
import { runDurableMaintenance } from './maintenance-receipt';
import { assertLocalService } from './update-data-restore';

export const windowsUpdatePipe = String.raw`\\.\pipe\BashkarPOSUpdateControl`;
const keyName = 'update-control.key';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noncePattern = /^[A-Za-z0-9_-]{43}$/;

function keyFile(configDir: string) {
  const stat = lstatSync(configDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UPDATE_CONTROL_DIRECTORY_INVALID');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('UPDATE_CONTROL_DIRECTORY_UNSAFE');
  const path = join(configDir, keyName);
  return path;
}

function readKey(configDir: string) {
  const path = keyFile(configDir), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new Error('UPDATE_CONTROL_KEY_UNSAFE');
  const raw = readFileSync(path, 'utf8');
  if (!noncePattern.test(raw)) throw new Error('UPDATE_CONTROL_KEY_INVALID');
  const key = Buffer.from(raw, 'base64url');
  if (key.length !== 32) throw new Error('UPDATE_CONTROL_KEY_INVALID');
  return key;
}

function ensureKey(configDir: string) {
  const path = keyFile(configDir);
  try { writeFileSync(path, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600, flush: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return readKey(configDir);
}

function mac(key: Buffer, ...parts: string[]) {
  return createHmac('sha256', key).update(JSON.stringify(['bashkar-update-control-v1', ...parts])).digest('base64url');
}
function equalProof(expected: string, actual: unknown) {
  if (typeof actual !== 'string' || !noncePattern.test(actual)) return false;
  const a = Buffer.from(expected, 'base64url'), b = Buffer.from(actual, 'base64url');
  return a.length === b.length && timingSafeEqual(a, b);
}
function code(error: unknown) {
  const value = error instanceof Error ? error.message : '';
  return /^[A-Z_]+$/.test(value) ? value : 'UPDATE_CONTROL_FAILED';
}

type Frame = Record<string, unknown>;
function wire(socket: Socket, onFrame: (frame: Frame) => void, onError: (error: Error) => void) {
  let input = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    input += chunk;
    if (Buffer.byteLength(input, 'utf8') > 4096) { onError(new Error('UPDATE_CONTROL_FRAME_TOO_LARGE')); return; }
    const end = input.indexOf('\n');
    if (end === -1) return;
    const line = input.slice(0, end);
    input = input.slice(end + 1);
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('UPDATE_CONTROL_FRAME_INVALID');
      onFrame(parsed as Frame);
    } catch { onError(new Error('UPDATE_CONTROL_FRAME_INVALID')); }
    if (input.length) onError(new Error('UPDATE_CONTROL_FRAME_INVALID'));
  });
}
function send(socket: Socket, value: Frame) { socket.write(JSON.stringify(value) + '\n'); }

export async function startUpdateControl(configDir: string, socketPath: string,
  prepare: (operationId: string) => Promise<MaintenanceResult>, recheck: (operationId: string, result: MaintenanceResult) => Promise<void>) {
  if (process.platform === 'win32') assertLocalService();
  if (process.platform === 'win32' && (socketPath !== windowsUpdatePipe || !process.env.ProgramData || resolve(configDir).toLowerCase() !== resolve(process.env.ProgramData, 'BashkarPOS', 'config').toLowerCase())) throw new Error('UPDATE_CONTROL_PATH_INVALID');
  const key = ensureKey(configDir);
  const sockets = new Set<Socket>();
  const tasks = new Set<Promise<void>>();
  const server: Server = createServer(socket => {
    if (sockets.size >= 4) { socket.destroy(); return; }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(10000, () => socket.destroy());
    const clientNonce = { value: '' }, serverNonce = randomBytes(32).toString('base64url');
    let phase: 'HELLO' | 'PREPARE' | 'BUSY' = 'HELLO';
    const deny = () => { send(socket, { v: 1, kind: 'error', code: 'UPDATE_CONTROL_DENIED' }); socket.end(); };
    wire(socket, frame => {
      if (phase === 'HELLO') {
        if (frame.v !== 1 || frame.kind !== 'hello' || typeof frame.nonce !== 'string' || !noncePattern.test(frame.nonce)) { deny(); return; }
        clientNonce.value = frame.nonce;
        phase = 'PREPARE';
        send(socket, { v: 1, kind: 'challenge', nonce: serverNonce, proof: mac(key, 'server', clientNonce.value, serverNonce) });
        return;
      }
      if (phase !== 'PREPARE' || frame.v !== 1 || frame.kind !== 'prepare' || typeof frame.operationId !== 'string' || !uuid.test(frame.operationId) || !equalProof(mac(key, 'client', clientNonce.value, serverNonce, frame.operationId), frame.proof)) { deny(); return; }
      phase = 'BUSY';
      socket.setTimeout(0);
      const operationId = frame.operationId;
      const task = runDurableMaintenance(configDir, operationId, prepare, recheck).then(result => { if (!socket.destroyed) { send(socket, { v: 1, kind: 'result', operationId, result }); socket.end(); } }, error => { if (!socket.destroyed) { send(socket, { v: 1, kind: 'error', code: code(error) }); socket.end(); } });
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
    }, deny);
  });
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => { server.off('error', reject); resolveListen(); });
    });
    if (process.platform !== 'win32') chmodSync(socketPath, 0o600);
  } catch (error) { key.fill(0); server.close(); throw error; }
  return { close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    await Promise.all([...tasks]);
    key.fill(0);
    if (process.platform !== 'win32') { try { unlinkSync(socketPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  } };
}

export async function requestUpdateMaintenance(configDir: string, socketPath: string, operationId: string = randomUUID()) {
  if (!uuid.test(operationId)) throw new Error('UPDATE_OPERATION_ID_INVALID');
  const key = readKey(configDir), clientNonce = randomBytes(32).toString('base64url');
  const socket = createConnection(socketPath);
  try {
    return await new Promise<MaintenanceResult>((resolveResult, reject) => {
      let phase: 'CHALLENGE' | 'RESULT' = 'CHALLENGE', serverNonce = '';
      const fail = (error: Error) => { socket.destroy(); reject(error); };
      socket.setTimeout(300000, () => fail(new Error('UPDATE_CONTROL_TIMEOUT')));
      socket.once('error', fail);
      socket.once('close', () => fail(new Error('UPDATE_CONTROL_CLOSED')));
      wire(socket, frame => {
        if (phase === 'CHALLENGE') {
          if (frame.v !== 1 || frame.kind !== 'challenge' || typeof frame.nonce !== 'string' || !noncePattern.test(frame.nonce) || !equalProof(mac(key, 'server', clientNonce, frame.nonce), frame.proof)) { fail(new Error('UPDATE_CONTROL_SERVER_UNTRUSTED')); return; }
          serverNonce = frame.nonce; phase = 'RESULT';
          send(socket, { v: 1, kind: 'prepare', operationId, proof: mac(key, 'client', clientNonce, serverNonce, operationId) });
          return;
        }
        if (frame.v !== 1) { fail(new Error('UPDATE_CONTROL_FRAME_INVALID')); return; }
        if (frame.kind === 'error' && typeof frame.code === 'string' && /^[A-Z_]+$/.test(frame.code)) { fail(new Error(frame.code)); return; }
        const result = frame.result as Frame | undefined, backup = result?.backupCandidate as Frame | undefined;
        if (frame.kind !== 'result' || frame.operationId !== operationId || !result || result.state !== 'MAINTENANCE_READY' || !backup || typeof backup.operationId !== 'string' || !uuid.test(backup.operationId) || typeof backup.path !== 'string' || !backup.path || backup.verified !== true) { fail(new Error('UPDATE_CONTROL_RESULT_INVALID')); return; }
        resolveResult(frame.result as MaintenanceResult); socket.end();
      }, fail);
      socket.once('connect', () => send(socket, { v: 1, kind: 'hello', nonce: clientNonce }));
    });
  } finally { key.fill(0); socket.destroy(); }
}
