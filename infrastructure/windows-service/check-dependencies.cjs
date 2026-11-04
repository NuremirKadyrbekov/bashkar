'use strict';
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { dirname, join } = require('node:path');

assert.equal(process.platform, 'win32', 'Windows runtime required');
assert.equal(process.arch, 'x64', 'Windows x64 runtime required');
assert.equal(process.versions.node, '24.18.0', 'Pinned build Node.js required');

const electronPackage = require.resolve('electron/package.json');
assert.equal(require(electronPackage).version, '45.0.0', 'Unexpected Electron version');
assert.ok(existsSync(join(dirname(electronPackage), 'dist', 'electron.exe')), 'Electron install script did not install electron.exe');

const Database = require('better-sqlite3');
const db = new Database(':memory:');
try { assert.equal(db.prepare('SELECT 1 AS value').get().value, 1); }
finally { db.close(); }

assert.equal(typeof require('@resvg/resvg-js').Resvg, 'function', 'Windows resvg native module unavailable');
const resvgPackage = dirname(require.resolve('@resvg/resvg-js/package.json'));
assert.ok(require.resolve('@resvg/resvg-js-win32-x64-msvc', { paths: [resvgPackage] }), 'Windows resvg binary unavailable');
console.log('PASS Windows x64 dependencies: Electron executable, Node ABI SQLite, resvg');
