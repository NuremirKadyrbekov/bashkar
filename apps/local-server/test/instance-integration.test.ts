import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Storage } from '../src/storage';

const children: ChildProcessWithoutNullStreams[] = [];
const dirs: string[] = [];
function dir() { const d = mkdtempSync(join(tmpdir(), 'bashkar-instance-')); dirs.push(d); return d; }
function run(d: string) {
  const child = spawn(process.execPath, [resolve('apps/local-server/test/fixtures/storage-owner.cjs'), d]); children.push(child);
  const outcome = new Promise<{ ok: boolean; text: string }>((resolveResult, reject) => {
    let settled = false; let errors = '';
    const timeout = setTimeout(() => { if (!settled) { settled = true; reject(new Error('child timeout')); } }, 10000);
    child.stderr.on('data', b => { errors += b.toString(); });
    child.stdout.on('data', b => { if (!settled) { settled = true; clearTimeout(timeout); resolveResult({ ok: true, text: b.toString() }); } });
    child.on('exit', () => { if (!settled) { settled = true; clearTimeout(timeout); resolveResult({ ok: false, text: errors }); } });
    child.on('error', reject);
  });
  return { child, outcome };
}
function ended(child: ChildProcessWithoutNullStreams) { return new Promise<void>(done => { if (child.exitCode !== null || child.signalCode !== null) done(); else child.once('exit', () => done()); }); }
afterEach(async () => { for (const child of children.splice(0)) { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await ended(child); } for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

it('recovers ownership after process death without replacing the original database', async () => {
  const d = dir(); new Storage(d).initialize();
  const originalMarker = readFileSync(join(d, 'installation.json'), 'utf8');
  const owner = run(d); expect((await owner.outcome).text).toContain('NEEDS_ACTIVATION');
  const second = run(d); expect((await second.outcome).text).toContain('INSTANCE_LOCK_UNAVAILABLE');
  // Simulate the old server: its atomic create must fail while new server runs.
  expect(() => { const fd = openSync(join(d, 'server.lock'), 'wx'); closeSync(fd); }).toThrow();
  owner.child.kill('SIGKILL'); await ended(owner.child);
  expect(existsSync(join(d, 'server.lock'))).toBe(true);
  const replacement = run(d); expect((await replacement.outcome).text).toContain('NEEDS_ACTIVATION');
  expect(readFileSync(join(d, 'installation.json'), 'utf8')).toBe(originalMarker);
  replacement.child.stdin.end(); await ended(replacement.child);
  expect(existsSync(join(d, 'server.lock'))).toBe(false);
});

it('never takes over an old or incomplete lock', () => {
  const d = dir(); new Storage(d).initialize(); const lock = join(d, 'server.lock');
  for (const contents of ['', 'BASHKAR_BOOTSTRAP_LOCK_V2', 'unrecognized']) {
    writeFileSync(lock, contents); expect(() => new Storage(d).open()).toThrow('INSTANCE_LOCK_UNAVAILABLE');
    expect(readFileSync(lock, 'utf8')).toBe(contents); unlinkSync(lock);
  }
});

it('does not create a database if it goes missing following a crash', async () => {
  const d = dir(); new Storage(d).initialize(); const owner = run(d); await owner.outcome;
  owner.child.kill('SIGKILL'); await ended(owner.child); unlinkSync(join(d, 'pos.sqlite'));
  const replacement = run(d); expect((await replacement.outcome).text).toContain('INSTALLATION_OR_DATABASE_MISSING');
  expect(existsSync(join(d, 'pos.sqlite'))).toBe(false);
});
