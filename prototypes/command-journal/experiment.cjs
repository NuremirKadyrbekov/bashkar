'use strict';
// D03/D04 experiment only: never connect this to a branch database or API.
const Database = require('better-sqlite3');
const { createHash } = require('node:crypto');
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  throw new Error('UNSUPPORTED_PAYLOAD');
}
function create(dbPath) {
  const db = new Database(dbPath); db.pragma('foreign_keys = ON'); db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL'); db.pragma('busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS commands (branch TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(branch,id));');
  const increment = db.transaction((branch, id, payload, fail) => {
    if (typeof branch !== 'string' || !branch || typeof id !== 'string' || !id) throw new Error('INVALID_COMMAND');
    const fingerprint = createHash('sha256').update(canonical({ type: 'INCREMENT_TEST_ONLY', payload })).digest('hex');
    const existing = db.prepare('SELECT fingerprint,result FROM commands WHERE branch=? AND id=?').get(branch, id);
    if (existing) { if (existing.fingerprint !== fingerprint) throw new Error('COMMAND_ID_CONFLICT'); return JSON.parse(existing.result); }
    db.prepare('INSERT INTO counters VALUES(?,1) ON CONFLICT(name) DO UPDATE SET value=value+1').run(branch);
    const row = db.prepare('SELECT value FROM counters WHERE name=?').get(branch);
    if (fail) throw new Error('SIMULATED_FAILURE');
    const result = { value: row.value };
    db.prepare('INSERT INTO commands VALUES(?,?,?,?)').run(branch, id, fingerprint, JSON.stringify(result));
    return result;
  });
  return { run: (...args) => increment.immediate(...args), close: () => db.close() };
}
module.exports = { create, canonical };
