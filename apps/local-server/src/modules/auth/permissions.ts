import type Database from 'better-sqlite3';
import type { Role } from './session-policy';
import { requireCondition } from '../../errors';
const printKeys=['print.queue.view','print.settings.manage','print.retry_safe','print.reprint','print.redirect','print.manual_handoff','print.resolve_no_print','print.release_late','network.waiter.manage'] as const;
const blockBKeys=['payment.refund','payment.refund.history','payment.incident.resolve','financial.case.view','financial.case.record','shift.report.history'] as const;
const financeKeys=[...blockBKeys,'order.settle.table','counter.view','counter.batch.submit','order.settle.counter','order.correct','order.cancel','counter.hide','sales.view_24h','sales.view.history','payment.incident.record'] as const;
const cashKeys=['table.move','table.responsible.change','order.custom_item.create','order.fulfillment.mark'] as const;
export const permissionKeys = [...cashKeys,...printKeys,...financeKeys,'employee.pin.issue','employee.pin.reset','employee.pin.view','employee.create','employee.edit','employee.status.manage','employee.password.reset','employee.permissions.manage','employee.archive.view','menu.edit','menu.stoplist.manage','settings.service_charge.manage','shift.open','shift.close','shift.report.view','audit.security.view','table.batch.submit','order.discount.set','table.view_status','table.view_details','table.open','table.close_empty','table.access_others','table.manage','settings.table_access_mode.manage'] as const;
export type Permission = typeof permissionKeys[number];
const tableOperational:Permission[]=['table.batch.submit','order.discount.set','table.view_status','table.view_details','table.open','table.close_empty'];
const administrative = permissionKeys.filter(p => !cashKeys.includes(p as typeof cashKeys[number])&&!printKeys.includes(p as typeof printKeys[number])&&!financeKeys.includes(p as typeof financeKeys[number])&&p!=='employee.pin.view'&&!p.startsWith('shift.')&&p!=='table.access_others');
export const defaults: Record<Role, readonly Permission[]> = {
  OWNER: [...cashKeys,'print.settings.manage','network.waiter.manage',...administrative,'table.access_others','employee.pin.view','order.settle.table','counter.view','counter.batch.submit','order.settle.counter','counter.hide','sales.view_24h','sales.view.history','payment.incident.record','payment.refund.history','payment.incident.resolve','financial.case.view','financial.case.record','shift.open','shift.close','shift.report.view','shift.report.history','order.correct','order.cancel'],
  MANAGER: [...cashKeys,...tableOperational,'table.manage','settings.table_access_mode.manage','counter.view','counter.batch.submit','order.settle.counter','order.settle.table','order.correct','order.cancel','payment.incident.record','financial.case.record'],
  CASHIER: [...cashKeys,...printKeys,'payment.refund','payment.refund.history','payment.incident.resolve','financial.case.view','financial.case.record','order.settle.table','counter.view','counter.batch.submit','order.settle.counter','counter.hide','sales.view_24h','payment.incident.record','employee.pin.issue','employee.pin.reset','employee.pin.view','employee.create','employee.edit','employee.password.reset','employee.archive.view','menu.edit','menu.stoplist.manage','table.manage','settings.table_access_mode.manage','order.correct','order.cancel','shift.open','shift.close','shift.report.view','table.access_others',...tableOperational],
  WAITER: [...tableOperational,'table.move','table.responsible.change','table.access_others','order.settle.table','order.fulfillment.mark','order.correct','order.cancel','order.custom_item.create'],
};
export function roleAllows(role: Role, permission: Permission): boolean {
  if(role==='CASHIER'&&permission==='shift.report.history')return false;
  if(cashKeys.includes(permission as typeof cashKeys[number]))return role!=='WAITER'||['order.fulfillment.mark','table.move','table.responsible.change','order.custom_item.create'].includes(permission);
  if(printKeys.includes(permission as typeof printKeys[number]))return role==='OWNER'||role==='MANAGER'||role==='CASHIER';
  if (role==='CASHIER' && blockBKeys.includes(permission as typeof blockBKeys[number]))return permission!=='shift.report.history';
  if (role === 'WAITER') return ['order.correct','order.cancel','order.settle.table','payment.incident.record'].includes(permission)||permission==='order.discount.set'||permission.startsWith('table.')&&permission!=='table.manage';
  if (permission==='employee.pin.view')return role==='OWNER'||role==='MANAGER'||role==='CASHIER';
  if (role === 'CASHIER' && financeKeys.includes(permission as typeof financeKeys[number]))return true;
  if (role === 'CASHIER') return permission.startsWith('shift.') || ['employee.pin.issue','employee.pin.reset','employee.create','employee.edit','employee.status.manage','employee.password.reset','employee.archive.view','menu.edit','menu.stoplist.manage','order.discount.set'].includes(permission)||permission.startsWith('table.')||permission==='settings.table_access_mode.manage';
  return role === 'OWNER' || role === 'MANAGER';
}
export function hasPermission(db: Database.Database, employee: { id: string; role: Role }, permission: Permission): boolean {
  if (!roleAllows(employee.role,permission)) return false;
  let roleOverride:{allowed:number}|undefined;
  try { roleOverride = db.prepare('SELECT allowed FROM role_permission_overrides WHERE branch_id=(SELECT branch_id FROM employees WHERE id=?) AND role=? AND permission=?').get(employee.id,employee.role,permission) as { allowed:number }|undefined; }
  catch(error) { if(!String(error).includes('no such table: role_permission_overrides'))throw error; } // Historical schema tests replay old transactions before migration.
  if(roleOverride) return roleOverride.allowed===1;
  const override = db.prepare('SELECT allowed FROM permission_overrides WHERE employee_id=? AND permission=?').get(employee.id,permission) as { allowed: number } | undefined;
  return override ? override.allowed === 1 : defaults[employee.role].includes(permission);
}
export function permission(value: unknown): Permission { requireCondition(permissionKeys.includes(value as Permission),'INVALID_PERMISSION'); return value as Permission; }
