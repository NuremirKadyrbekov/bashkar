import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
const load = createRequire(__filename);
const experiment = load(resolve('prototypes/command-journal/experiment.cjs')) as { create: (path: string) => { run: (branch: string, id: string, payload: unknown, fail?: boolean) => { value: number }; close: () => void } };

it('replays committed results across restart and rejects conflicting content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bashkar-commands-')); const path = join(dir, 'test.sqlite');
  try {
    const first = experiment.create(path); expect(first.run('branch', 'one', { a: 1, b: 2 }).value).toBe(1); first.close();
    const second = experiment.create(path);
    expect(second.run('branch', 'one', { b: 2, a: 1 }).value).toBe(1);
    expect(() => second.run('branch', 'one', { a: 2 })).toThrow('COMMAND_ID_CONFLICT');
    expect(second.run('branch', 'two', {}).value).toBe(2);
    expect(second.run('other-branch', 'one', { a: 2 }).value).toBe(1);
    second.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('rolls back both change and result when the transaction fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bashkar-commands-')); const path = join(dir, 'test.sqlite');
  try {
    const x = experiment.create(path);
    expect(() => x.run('branch', 'one', {}, true)).toThrow('SIMULATED_FAILURE');
    expect(x.run('branch', 'one', {}).value).toBe(1);
    expect(() => x.run('branch', 'two', { value: 1.5 })).toThrow('UNSUPPORTED_PAYLOAD');
    expect(x.run('branch', 'three', {}).value).toBe(2);
    x.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
