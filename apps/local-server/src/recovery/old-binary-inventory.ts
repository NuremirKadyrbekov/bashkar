import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readInstalledSoftwareVersion } from './release-version';

const name = 'update-old-binary-inventory.json';
type Entry = { path: string; size: number; sha256: string };
type Inventory = { format: 1; operationId: string; version: string; files: Entry[] };

function regular(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UPDATE_OLD_INVENTORY_FILE_INVALID');
  return stat;
}
function directory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UPDATE_OLD_INVENTORY_DIRECTORY_INVALID');
}
function digest(path: string) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd), named = regular(path);
    if (before.ino !== named.ino || before.dev !== named.dev) throw new Error('UPDATE_OLD_INVENTORY_FILE_INVALID');
    const hash = createHash('sha256'); let size = 0;
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      size += count; hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(fd);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw new Error('UPDATE_OLD_INVENTORY_CHANGED');
    return { size, sha256: hash.digest('hex') };
  } finally { closeSync(fd); }
}
function inventory(appDir: string) {
  directory(appDir);
  const root = realpathSync(appDir), paths: string[] = [];
  function walk(dir: string) {
    directory(dir);
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), stat = lstatSync(path);
      if (stat.isDirectory()) { walk(path); continue; }
      regular(path);
      paths.push(relative(root, path).split(sep).join('/'));
      if (paths.length > 20000) throw new Error('UPDATE_OLD_INVENTORY_TOO_LARGE');
    }
  }
  walk(root); paths.sort();
  const files: Entry[] = []; let total = 0;
  for (const path of paths) {
    const result = digest(join(root, ...path.split('/')));
    total += result.size;
    if (total > 4 * 1024 * 1024 * 1024) throw new Error('UPDATE_OLD_INVENTORY_TOO_LARGE');
    files.push({ path, ...result });
  }
  if (!files.length) throw new Error('UPDATE_OLD_INVENTORY_EMPTY');
  return files;
}
function validate(value: unknown, operationId: string): Inventory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('UPDATE_OLD_INVENTORY_INVALID');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'files,format,operationId,version' || row.format !== 1 ||
      row.operationId !== operationId || typeof row.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(row.version) ||
      !Array.isArray(row.files) || !row.files.length || row.files.length > 20000) throw new Error('UPDATE_OLD_INVENTORY_INVALID');
  let previous = '';
  for (const raw of row.files) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('UPDATE_OLD_INVENTORY_INVALID');
    const file = raw as Record<string, unknown>;
    if (Object.keys(file).sort().join(',') !== 'path,sha256,size' || typeof file.path !== 'string' ||
        !/^[A-Za-z0-9@._+() -]+(?:\/[A-Za-z0-9@._+() -]+)*$/.test(file.path) || file.path <= previous ||
        !Number.isSafeInteger(file.size) || Number(file.size) < 0 || typeof file.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error('UPDATE_OLD_INVENTORY_INVALID');
    previous = file.path;
  }
  return row as Inventory;
}
function read(configDir: string, operationId: string) {
  const path = join(configDir, name), stat = regular(path);
  if (stat.size < 1 || stat.size > 3_000_000) throw new Error('UPDATE_OLD_INVENTORY_INVALID');
  return validate(JSON.parse(readFileSync(path, 'utf8')), operationId);
}

/** Capture the existing program before any directory rename. A present record is immutable. */
export function captureOldBinaryInventory(configDir: string, appDir: string, operationId: string) {
  directory(configDir);
  const value: Inventory = { format: 1, operationId,
    version: readInstalledSoftwareVersion(join(appDir, 'server', 'version.json')), files: inventory(appDir) };
  const path = join(configDir, name);
  if (Buffer.byteLength(JSON.stringify(value)) > 3_000_000) throw new Error('UPDATE_OLD_INVENTORY_TOO_LARGE');
  try { writeFileSync(path, JSON.stringify(value), { flag: 'wx', mode: 0o600, flush: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const recorded = read(configDir, operationId);
    if (JSON.stringify(recorded) !== JSON.stringify(value)) throw new Error('UPDATE_OLD_INVENTORY_MISMATCH');
  }
  return value.version;
}

export function verifyOldBinaryInventory(configDir: string, appDir: string, operationId: string) {
  const recorded = read(configDir, operationId);
  if (readInstalledSoftwareVersion(join(appDir, 'server', 'version.json')) !== recorded.version ||
      JSON.stringify(inventory(appDir)) !== JSON.stringify(recorded.files)) throw new Error('UPDATE_OLD_INVENTORY_MISMATCH');
  return recorded.version;
}
