import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertStartupAllowed, beginGuardedOperation } from '../src/recovery/startup-guard';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('blocks startup whenever a persistent update marker exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-guard-test-'));
  dirs.push(root);
  const config = join(root, 'config');
  mkdirSync(config);
  expect(() => assertStartupAllowed(config)).not.toThrow();
  writeFileSync(join(config, 'update-guard.json'), 'incomplete');
  expect(() => assertStartupAllowed(config)).toThrow('UPDATE_GUARD_ACTIVE');
});

it('fails closed when the configuration directory is unavailable', () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-guard-test-'));
  dirs.push(root);
  expect(() => assertStartupAllowed(join(root, 'missing'))).toThrow('UPDATE_GUARD_UNAVAILABLE');
});

it('blocks startup if power failed after recording intent but before creating the guard', () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-guard-test-'));
  dirs.push(root);
  const config = join(root, 'config');
  mkdirSync(config);
  writeFileSync(join(config, 'update-intent.json'), '{');
  expect(() => assertStartupAllowed(config)).toThrow('UPDATE_GUARD_ACTIVE');
});

it('persists the operation and backup identity before guarded installation', () => {
  const root = mkdtempSync(join(tmpdir(), 'bashkar-guard-test-'));
  dirs.push(root);
  const config = join(root, 'config');
  mkdirSync(config);
  const operationId = randomUUID(), backupOperationId = randomUUID();
  beginGuardedOperation(config, operationId, backupOperationId);
  expect(JSON.parse(readFileSync(join(config, 'update-intent.json'), 'utf8'))).toMatchObject({ operationId, backupOperationId, phase: 'GUARD_REQUESTED' });
  expect(JSON.parse(readFileSync(join(config, 'update-guard.json'), 'utf8'))).toMatchObject({ operationId });
  expect(() => assertStartupAllowed(config)).toThrow('UPDATE_GUARD_ACTIVE');
  expect(() => beginGuardedOperation(config, randomUUID(), backupOperationId)).toThrow('UPDATE_GUARD_ACTIVE');
});
