import {latestSchema} from '../src/migrations';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Storage } from '../src/storage';
import { createServer } from '../src/server';

const dirs: string[] = [];
function temp() { const dir = mkdtempSync(join(tmpdir(), 'bashkar-test-')); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('bootstrap storage', () => {
  it('requires explicit initialization and persists identity and migrations after restart', () => {
    const dir = temp(); const initial = new Storage(dir);
    expect(initial.open().state).toBe('BLOCKED'); initial.close();
    new Storage(dir).initialize(); const marker = readFileSync(join(dir, 'installation.json'), 'utf8');
    for (let i = 0; i < 2; i++) { const s = new Storage(dir); expect(s.open()).toEqual({ state: 'NEEDS_ACTIVATION', reason: 'ACTIVATION_REQUIRED', schemaVersion: latestSchema }); s.close(); }
    expect(readFileSync(join(dir, 'installation.json'), 'utf8')).toBe(marker);
    expect(() => new Storage(dir).initialize()).toThrow('INITIALIZATION_DIRECTORY_NOT_EMPTY');
  });
  it('never replaces a missing database or accepts a missing marker', () => {
    const dir = temp(); new Storage(dir).initialize(); unlinkSync(join(dir, 'pos.sqlite'));
    const s = new Storage(dir); expect(s.open().reason).toBe('INSTALLATION_OR_DATABASE_MISSING'); s.close();
    expect(() => new Storage(dir).initialize()).toThrow();
    expect(() => readFileSync(join(dir, 'pos.sqlite'))).toThrow();
  });
  it('rejects an incompatible migration', () => {
    const dir = temp(); new Storage(dir).initialize();
    const db = new Database(join(dir, 'pos.sqlite')); db.prepare('UPDATE schema_migrations SET checksum = ?').run('changed'); db.close();
    const s = new Storage(dir); expect(s.open().state).toBe('BLOCKED'); s.close();
  });
  it('rejects a second process lock and preserves an abandoned lock', () => {
    const dir = temp(); new Storage(dir).initialize(); const first = new Storage(dir); first.open();
    expect(() => new Storage(dir).open()).toThrow('INSTANCE_LOCK_UNAVAILABLE'); first.close();
    writeFileSync(join(dir, 'server.lock'), 'stale');
    expect(() => new Storage(dir).open()).toThrow('INSTANCE_LOCK_UNAVAILABLE');
  });
  it('blocks an altered marker and a missing marker without replacing the database', () => {
    const dir = temp(); new Storage(dir).initialize(); const marker = join(dir, 'installation.json');
    writeFileSync(marker, JSON.stringify({ format: 1, id: 'different' }));
    const mismatch = new Storage(dir); expect(mismatch.open().state).toBe('BLOCKED'); mismatch.close();
    unlinkSync(marker); const missing = new Storage(dir); expect(missing.open().reason).toBe('INSTALLATION_OR_DATABASE_MISSING'); missing.close();
    expect(() => new Storage(dir).initialize()).toThrow();
  });
  it('blocks a corrupted file without replacing it', () => {
    const dir = temp(); new Storage(dir).initialize(); const path = join(dir, 'pos.sqlite'); writeFileSync(path, 'damaged');
    const s = new Storage(dir); expect(s.open().state).toBe('BLOCKED'); s.close(); expect(readFileSync(path, 'utf8')).toBe('damaged');
  });
});

describe('diagnostics', () => {
  it('distinguishes liveness from operational readiness and hides request data', async () => {
    const dir = temp(); new Storage(dir).initialize(); const app = await createServer(dir, 0, false);
    try {
      expect((await app.inject({ method: 'GET', url: '/api/v1/system/health/live' })).statusCode).toBe(200);
      const ready = await app.inject({ method: 'GET', url: '/api/v1/system/health/ready?token=secret', headers: { authorization: 'Bearer secret' } });
      expect(ready.statusCode).toBe(503); expect(ready.body).not.toContain('secret'); expect(ready.json().state).toBe('NEEDS_ACTIVATION');
      expect((await app.inject({ method: 'POST', url: '/api/v1/system/health/live', headers: {'content-type':'application/json'}, payload:{} })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
