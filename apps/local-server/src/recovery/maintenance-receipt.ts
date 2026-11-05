import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import type { MaintenanceResult } from '../server';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const prefix = 'update-maintenance-';

function directory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077)))
    throw new Error('UPDATE_MAINTENANCE_DIRECTORY_INVALID');
}
function regular(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 4096)
    throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID');
}
function syncDirectory(path: string) {
  if (process.platform === 'win32') return; // Windows rename durability requires power-loss E2E.
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function paths(configDir: string, operationId: string) {
  if (!uuid.test(operationId)) throw new Error('UPDATE_OPERATION_ID_INVALID');
  directory(configDir);
  return { intent: join(configDir, `${prefix}${operationId}.intent.json`), receipt: join(configDir, `${prefix}${operationId}.receipt.json`) };
}
function readJson(path: string): Record<string, unknown> {
  try {
    regular(path);
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID'); }
}
function validateResult(value: unknown): MaintenanceResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID');
  const result = value as Record<string, unknown>;
  const backup = result.backupCandidate as Record<string, unknown> | undefined;
  const proof = result.restoreChecked as Record<string, unknown> | undefined;
  if (Object.keys(result).sort().join(',') !== 'backupCandidate,restoreChecked,schemaVersion,state' ||
      result.state !== 'MAINTENANCE_READY' || !Number.isSafeInteger(result.schemaVersion) || Number(result.schemaVersion) < 1 ||
      !backup || Object.keys(backup).sort().join(',') !== 'operationId,path,verified' ||
      typeof backup.operationId !== 'string' || !uuid.test(backup.operationId) ||
      typeof backup.path !== 'string' || !isAbsolute(backup.path) || basename(backup.path) !== backup.operationId || backup.verified !== true ||
      !proof || Object.keys(proof).sort().join(',') !== 'instanceId,operationId,pinCount,registrationId,schemaVersion,verified' ||
      proof.operationId !== backup.operationId || typeof proof.instanceId !== 'string' || !uuid.test(proof.instanceId) ||
      (proof.registrationId !== null && (typeof proof.registrationId !== 'string' || !uuid.test(proof.registrationId))) ||
      proof.schemaVersion !== result.schemaVersion || !Number.isSafeInteger(proof.pinCount) || Number(proof.pinCount) < 0 || proof.verified !== true)
    throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID');
  directory(backup.path);
  regular(join(backup.path, 'manifest.json'));
  return value as MaintenanceResult;
}

/** Read-only reconciliation. An intent without a complete receipt is deliberately ambiguous. */
export function readMaintenanceReceipt(configDir: string, operationId: string): MaintenanceResult | null {
  const { intent, receipt } = paths(configDir, operationId);
  if (readdirSync(configDir).some(name => name.startsWith(`${prefix}${operationId}.tmp-`)))
    throw new Error('UPDATE_MAINTENANCE_UNCERTAIN');
  let intentExists = false;
  try { lstatSync(intent); intentExists = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!intentExists) {
    try { lstatSync(receipt); throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  const marker = readJson(intent);
  if (Object.keys(marker).sort().join(',') !== 'format,operationId' || marker.format !== 1 || marker.operationId !== operationId)
    throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID');
  let receiptExists = false;
  try { lstatSync(receipt); receiptExists = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!receiptExists) throw new Error('UPDATE_MAINTENANCE_UNCERTAIN');
  const row = readJson(receipt);
  if (Object.keys(row).sort().join(',') !== 'format,operationId,result' || row.format !== 1 || row.operationId !== operationId)
    throw new Error('UPDATE_MAINTENANCE_RECEIPT_INVALID');
  return validateResult(row.result);
}

/** The intent is written before entering maintenance; a crash before receipt never retries preparation. */
export async function runDurableMaintenance(configDir: string, operationId: string,
  prepare: (operationId: string) => Promise<MaintenanceResult>,
  recheck: (operationId: string, result: MaintenanceResult) => Promise<void>) {
  const existing = readMaintenanceReceipt(configDir, operationId);
  if (existing) { await recheck(operationId, existing); return existing; }
  const { intent, receipt } = paths(configDir, operationId);
  try { writeFileSync(intent, JSON.stringify({ format: 1, operationId }), { flag: 'wx', mode: 0o600, flush: true }); }
  catch { throw new Error('UPDATE_MAINTENANCE_UNCERTAIN'); }
  syncDirectory(configDir);
  const result = validateResult(await prepare(operationId));
  const temp = join(configDir, `${prefix}${operationId}.tmp-${randomUUID()}`);
  writeFileSync(temp, JSON.stringify({ format: 1, operationId, result }), { flag: 'wx', mode: 0o600, flush: true });
  renameSync(temp, receipt);
  syncDirectory(configDir);
  return result;
}
