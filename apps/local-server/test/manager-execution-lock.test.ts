import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withManagerExecutionLock } from '../src/recovery/manager-execution-lock';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it.skipIf(process.platform === 'win32')('serializes two Manager operations and releases the OS handle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-manager-lock-')); roots.push(root);
  const pipe = join(root, 'manager.sock');
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const first = withManagerExecutionLock(randomUUID(), async () => { entered(); await held; return 'done'; }, pipe);
  await started;
  await expect(withManagerExecutionLock(randomUUID(), async () => 'unsafe', pipe)).rejects.toThrow('UPDATE_MANAGER_BUSY');
  release();
  expect(await first).toBe('done');
  expect(await withManagerExecutionLock(randomUUID(), async () => 'resumed', pipe)).toBe('resumed');
});
