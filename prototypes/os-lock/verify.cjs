'use strict';
// Standalone diagnostic; uses only fresh directories under the OS temporary directory.
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const testRoot = mkdtempSync(join(tmpdir(), 'bashkar-lock-test-'));
const program = join(__dirname, 'lock-prototype.cjs');
const children = [];
function launch() {
  const p = spawn(process.execPath, [program, testRoot], { stdio: 'pipe' }); children.push(p);
  const outcome = new Promise((resolve, reject) => {
    let err = ''; let complete = false;
    const timeout = setTimeout(() => { if (!complete) { complete = true; reject(new Error('child timeout')); } }, 15000);
    p.stderr.on('data', data => { err += data; });
    p.stdout.on('data', data => { if (!complete) { complete = true; clearTimeout(timeout); resolve({ p, acquired: true, output: String(data) }); } });
    p.on('exit', () => { if (!complete) { complete = true; clearTimeout(timeout); resolve({ p, acquired: false, output: err }); } });
    p.on('error', reject);
  });
  return outcome;
}
function exited(p) { return new Promise(resolve => { if (p.exitCode !== null || p.signalCode !== null) resolve(); else p.once('exit', resolve); }); }
async function main() {
  const outcomes = await Promise.all(Array.from({ length: 6 }, launch));
  const owners = outcomes.filter(x => x.acquired);
  if (owners.length !== 1 || outcomes.filter(x => !x.acquired && x.output.includes('LOCK_HELD')).length !== 5) throw new Error('RACE_FAILED');
  process.stdout.write('PASS: exactly one owner among six processes\n');
  owners[0].p.kill('SIGKILL'); await exited(owners[0].p);
  const replacement = await launch();
  if (!replacement.acquired) throw new Error('REACQUIRE_FAILED');
  process.stdout.write('PASS: lock acquired after forced owner termination\n');
  replacement.p.stdin.end(); await exited(replacement.p);
  const final = await launch();
  if (!final.acquired) throw new Error('GRACEFUL_RELEASE_FAILED');
  process.stdout.write('PASS: lock acquired after normal release\n');
  final.p.stdin.end(); await exited(final.p);
}
main().catch(error => { process.stderr.write('FAIL: ' + error.message + '\n'); process.exitCode = 1; }).finally(async () => {
  for (const child of children) { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited(child); } }
  try { rmSync(testRoot, { recursive: true, force: true }); } catch { process.stderr.write('Could not remove test directory: ' + testRoot + '\n'); process.exitCode = 1; }
});
