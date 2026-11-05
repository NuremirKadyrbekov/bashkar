import { expect, it } from 'vitest';
import Fastify from 'fastify';
import type Database from 'better-sqlite3';
import { CommandBus } from '../src/command-bus';
import { MaintenanceGate } from '../src/recovery/maintenance-gate';
import { createServer, type MaintenanceResult } from '../src/server';
import { fixture, password } from './fixtures/operations';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../src/storage';

const testProtector = { protect: (key: Buffer) => key.toString('base64'), unprotect: (value: string) => Buffer.from(value, 'base64') };

it('drains an accepted request, blocks new traffic on both listeners, and resumes after cancellation', async () => {
  const gate = new MaintenanceGate();
  const desktop = Fastify(), waiter = Fastify();
  gate.install(desktop);
  gate.install(waiter);
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  desktop.post('/slow', async () => { await held; return { done: true }; });
  desktop.post('/write', async () => ({ done: true }));
  waiter.post('/write', async () => ({ done: true }));
  waiter.get('/read', async () => ({ available: true }));
  try {
    const first = desktop.inject({ method: 'POST', url: '/slow' });
    for (let i = 0; gate.activeRequests === 0 && i < 100; i++) await new Promise(resolve => setImmediate(resolve));
    expect(gate.activeRequests).toBe(1);
    const drained = gate.begin();
    expect((await desktop.inject({ method: 'POST', url: '/write' })).statusCode).toBe(423);
    expect((await waiter.inject({ method: 'POST', url: '/write' })).statusCode).toBe(423);
    expect((await waiter.inject({ method: 'GET', url: '/read' })).statusCode).toBe(423);
    finish();
    expect((await first).statusCode).toBe(200);
    await drained;
    expect(gate.activeRequests).toBe(0);
    gate.cancel();
    expect((await waiter.inject({ method: 'POST', url: '/write' })).statusCode).toBe(200);
  } finally { finish(); await desktop.close(); await waiter.close(); }
});

it('rejects a new command before it enters the writer queue', async () => {
  const gate = new MaintenanceGate();
  const bus = new CommandBus({} as Database.Database, Date.now, 64, () => {}, () => gate.assertWritable());
  await gate.begin();
  await expect(bus.run({ id: 'unused', type: 'test', actor: { id: 'actor', branchId: 'branch' }, payload: {} }, () => {}, () => ({ ok: true }))).rejects.toMatchObject({ code: 'MAINTENANCE_PENDING', status: 423 });
  gate.cancel();
});

it('creates and verifies a Backup Set while the quiesced server still owns SQLite', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-maintenance-backup-'));
  const data = join(root, 'data'), backups = join(root, 'backups');
  mkdirSync(backups);
  new Storage(data).initialize();
  const gate = new MaintenanceGate();
  let prepare!: () => Promise<MaintenanceResult>;
  const app = await createServer(data, 0, false, { authority: { publicKey: '' }, device: { publicKey: () => '', assertAvailable: () => {} }, maintenanceGate: gate, maintenanceBackup: { backupRoot: backups, softwareVersion: '0.1.0', protector: testProtector }, registerMaintenanceControl: value => { prepare = value; } });
  try {
    const result = await prepare();
    expect(result.state).toBe('MAINTENANCE_READY');
    expect(result.backupCandidate.verified).toBe(true);
    expect(readdirSync(backups)).toEqual([result.backupCandidate.operationId]);
    expect((await app.inject('/api/v1/system/health/live')).statusCode).toBe(423);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { login: 'owner', password } })).statusCode).toBe(423);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});

it('cancels maintenance when a shift is open, leaving the server operational', async () => {
  const f = await fixture(), gate = new MaintenanceGate();
  await f.shifts.open(f.token, randomUUID(), 'owner', password);
  f.storage.close();
  let prepare!: () => Promise<MaintenanceResult>;
  const app = await createServer(f.dir, 0, false, { ...f.trust, maintenanceGate: gate, maintenanceBackup: { backupRoot: join(f.dir, 'backups'), softwareVersion: '0.1.0', protector: testProtector }, registerMaintenanceControl: value => { prepare = value; } });
  try {
    await expect(prepare()).rejects.toMatchObject({ code: 'MAINTENANCE_OPEN_SHIFT' });
    expect(gate.isPending).toBe(false);
    expect((await app.inject('/api/v1/system/health/live')).statusCode).toBe(200);
  } finally { await app.close(); f.close(); }
});

it('keeps maintenance closed if Backup Set creation fails after quiescing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-maintenance-failed-backup-'));
  const data = join(root, 'data');
  new Storage(data).initialize();
  const gate = new MaintenanceGate();
  let prepare!: () => Promise<MaintenanceResult>;
  const app = await createServer(data, 0, false, { authority: { publicKey: '' }, device: { publicKey: () => '', assertAvailable: () => {} }, maintenanceGate: gate, maintenanceBackup: { backupRoot: join(root, 'missing-backups'), softwareVersion: '0.1.0', protector: testProtector }, registerMaintenanceControl: value => { prepare = value; } });
  try {
    await expect(prepare()).rejects.toThrow();
    expect(gate.isPending).toBe(true);
    expect((await app.inject('/api/v1/system/health/live')).statusCode).toBe(423);
    expect(() => gate.begin()).toThrow('MAINTENANCE_PENDING');
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});

it('starts an activated restored server in recovery quarantine without accepting business traffic', async () => {
  const f = await fixture();
  f.storage.close();
  const app = await createServer(f.dir, 0, false, { ...f.trust, recoveryQuarantine: true });
  try {
    expect((await app.inject('/api/v1/system/health/ready')).statusCode).toBe(200);
    expect((await app.inject('/api/v1/system/version')).statusCode).toBe(200);
    expect((await app.inject('/api/v1/activation/status')).statusCode).toBe(423);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login',
      payload: { login: 'owner', password } })).statusCode).toBe(423);
  } finally { await app.close(); f.close(); }
});
