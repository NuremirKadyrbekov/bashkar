import { lstatSync, readFileSync } from 'node:fs';

export function readInstalledSoftwareVersion(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 256) throw new Error('UPDATE_VERSION_FILE_INVALID');
  const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'format,version' || value.format !== 1 || typeof value.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version)) throw new Error('UPDATE_VERSION_FILE_INVALID');
  return value.version;
}
