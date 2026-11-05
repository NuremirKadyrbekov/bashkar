import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMaintenanceReceipt, runDurableMaintenance } from '../src/recovery/maintenance-receipt';
import type { MaintenanceResult } from '../src/server';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-maintenance-receipt-'));
  roots.push(root);
  const config = join(root, 'config'), backupId = randomUUID(), backup = join(root, backupId), operationId = randomUUID();
  mkdirSync(config, { mode: 0o700 }); mkdirSync(backup, { mode: 0o700 });
  writeFileSync(join(backup, 'manifest.json'), '{}');
  const result: MaintenanceResult = { state: 'MAINTENANCE_READY', schemaVersion: 26,
    backupCandidate: { operationId: backupId, path: backup, verified: true },
    restoreChecked: { operationId: backupId, instanceId: randomUUID(), registrationId: null,
      schemaVersion: 26, pinCount: 0, verified: true } };
  return { config, operationId, result };
}

it('persists a receipt before replying and rechecks it without preparing twice', async () => {
  const f = fixture(); let prepared = 0, checked = 0;
  const prepare = async () => { prepared++; return f.result; };
  const recheck = async (operationId: string, value: MaintenanceResult) => { checked++; expect(operationId).toBe(f.operationId); expect(value).toEqual(f.result); };
  expect(await runDurableMaintenance(f.config, f.operationId, prepare, recheck)).toEqual(f.result);
  expect(readMaintenanceReceipt(f.config, f.operationId)).toEqual(f.result);
  expect(await runDurableMaintenance(f.config, f.operationId, prepare, recheck)).toEqual(f.result);
  expect(prepared).toBe(1);
  expect(checked).toBe(1);
});

it('treats a crash after intent and a concurrent request as uncertain', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const first = runDurableMaintenance(f.config, f.operationId, async () => { entered(); await held; return f.result; }, async () => {});
  await started;
  await expect(runDurableMaintenance(f.config, f.operationId, async () => { throw new Error('DUPLICATE'); }, async () => {}))
    .rejects.toThrow('UPDATE_MAINTENANCE_UNCERTAIN');
  release(); await first;
  const g = fixture();
  await expect(runDurableMaintenance(g.config, g.operationId, async () => { throw new Error('CRASH'); }, async () => {})).rejects.toThrow('CRASH');
  await expect(runDurableMaintenance(g.config, g.operationId, async () => g.result, async () => {})).rejects.toThrow('UPDATE_MAINTENANCE_UNCERTAIN');
});

it('rejects a foreign or damaged receipt and never reruns preparation', async () => {
  const f = fixture();
  await runDurableMaintenance(f.config, f.operationId, async () => f.result, async () => {});
  const path = join(f.config, `update-maintenance-${f.operationId}.receipt.json`);
  const row = JSON.parse(readFileSync(path, 'utf8'));
  row.operationId = randomUUID();
  writeFileSync(path, JSON.stringify(row));
  await expect(runDurableMaintenance(f.config, f.operationId, async () => { throw new Error('DUPLICATE'); }, async () => {}))
    .rejects.toThrow('UPDATE_MAINTENANCE_RECEIPT_INVALID');
});
