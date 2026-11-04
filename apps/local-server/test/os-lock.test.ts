import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const program = resolve('prototypes/os-lock/lock-prototype.cjs');
const dirs: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];
function temporary() { const path = mkdtempSync(join(tmpdir(), 'bashkar-lock-')); dirs.push(path); return path; }
function run(path: string) {
  const child = spawn(process.execPath, [program, path], { stdio: 'pipe' }); children.push(child); return child;
}
function result(child: ChildProcessWithoutNullStreams) {
  return new Promise<{ status: 'acquired' | 'exited'; message: string }>((done, reject) => {
    let settled = false; let errorText = '';
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('child timeout')); } }, 10000);
    child.stderr.on('data', (data: Buffer) => { errorText += data.toString(); });
    child.stdout.on('data', (data: Buffer) => { if (!settled) { settled = true; clearTimeout(timer); done({ status: 'acquired', message: data.toString() }); } });
    child.once('exit', () => { if (!settled) { settled = true; clearTimeout(timer); done({ status: 'exited', message: errorText }); } });
    child.once('error', reject);
  });
}
function exit(child: ChildProcessWithoutNullStreams) { return new Promise<void>(done => { if (child.exitCode !== null || child.signalCode !== null) done(); else child.once('exit', () => done()); }); }
afterEach(async () => { for (const child of children.splice(0)) { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exit(child); } for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('isolated OS lock experiment', () => {
  it('excludes another process and releases the lock when the owner is killed', async () => {
    const dir = temporary(); const owner = run(dir); expect((await result(owner)).status).toBe('acquired');
    const competitor = run(dir); const failure = await result(competitor); expect(failure.status).toBe('exited'); expect(failure.message).toContain('LOCK_HELD');
    owner.kill('SIGKILL'); await exit(owner);
    const replacement = run(dir); expect((await result(replacement)).status).toBe('acquired');
    replacement.stdin.end(); await exit(replacement);
    expect((await result(run(dir))).status).toBe('acquired');
  });
  it('allows exactly one winner among concurrent processes', async () => {
    const dir = temporary(); const outcomes = await Promise.all(Array.from({ length: 6 }, () => result(run(dir))));
    expect(outcomes.filter(x => x.status === 'acquired')).toHaveLength(1);
    expect(outcomes.filter(x => x.status === 'exited' && x.message.includes('LOCK_HELD'))).toHaveLength(5);
  });
  it('refuses a missing directory and a symlink lock file', async () => {
    const dir = temporary(); expect((await result(run(join(dir, 'missing')))).message).toContain('INVALID_TEST_DIRECTORY');
    if (process.platform !== 'win32') { symlinkSync(join(dir, 'target'), join(dir, 'prototype-lock.sqlite')); expect((await result(run(dir))).status).toBe('exited'); }
  });
});
