'use strict';
const fs = require('node:fs');
const path = require('node:path');
const out = process.argv[2];
if (!out || !path.isAbsolute(out)) throw Error('Absolute output directory required');
const sqliteSource = path.dirname(require.resolve('better-sqlite3/package.json'));
const resvgSource = path.dirname(require.resolve('@resvg/resvg-js/package.json'));
for (const name of ['better-sqlite3', 'bindings', 'file-uri-to-path', '@resvg/resvg-js']) {
  const lookup = name === 'bindings' || name === 'file-uri-to-path' ? { paths: [sqliteSource] } : { paths: [process.cwd()] };
  const source = path.dirname(require.resolve(name + '/package.json', lookup));
  const target = path.join(out, 'node_modules', ...name.split('/'));
  fs.cpSync(source, target, { recursive: true, filter: file => !path.relative(source, file).split(path.sep).includes('node_modules') });
}
const native = require.resolve('@resvg/resvg-js-win32-x64-msvc', { paths: [resvgSource] });
fs.copyFileSync(native, path.join(out, 'node_modules', '@resvg', 'resvg-js', 'resvgjs.win32-x64-msvc.node'));
const sqlite = path.join(out, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (!fs.existsSync(sqlite)) throw Error('Windows better-sqlite3 binary missing');
for (const file of [sqlite, native]) if (fs.readFileSync(file).subarray(0, 2).toString() !== 'MZ') throw Error('Expected Windows x64 native binary: ' + file);
