'use strict';
// Isolated experiment only: never use the branch data directory.
const Database = require('better-sqlite3');
const { lstatSync, realpathSync, existsSync } = require('node:fs');
const { join, isAbsolute } = require('node:path');

function acquire(directory) {
  if (!isAbsolute(directory) || !existsSync(directory) || !lstatSync(directory).isDirectory()) throw new Error('INVALID_TEST_DIRECTORY');
  const path = join(realpathSync(directory), 'prototype-lock.sqlite');
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('INVALID_LOCK_FILE');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let db;
  try {
    db = new Database(path, { timeout: 0 });
    db.pragma('busy_timeout = 0');
    if (db.pragma('journal_mode', { simple: true }) !== 'delete') throw new Error('INVALID_JOURNAL_MODE');
    db.exec('BEGIN EXCLUSIVE');
    return () => { if (db) { try { db.exec('ROLLBACK'); } finally { db.close(); db = undefined; } } };
  } catch (error) {
    if (db) db.close();
    if (error && (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED')) throw new Error('LOCK_HELD');
    throw error;
  }
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('INVALID_ARGUMENTS');
    const release = acquire(process.argv[2]);
    process.stdout.write('{"status":"acquired"}\n');
    const stop = () => { release(); process.exit(0); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    process.stdin.resume();
    process.stdin.on('end', stop);
  } catch (error) {
    const code = error && typeof error.message === 'string' && /^[A-Z_]+$/.test(error.message) ? error.message : 'LOCK_ERROR';
    process.stderr.write(JSON.stringify({ code }) + '\n'); process.exitCode = 1;
  }
}
module.exports = { acquire };
