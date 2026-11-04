/**
 * Internal policy primitives. All records and timestamps must come from trusted
 * server-side storage/clock, never from a request. This module does not perform
 * authentication, token verification, permission lookups or persist activity.
 */
export type ClientType = 'POS' | 'WAITER_WEB';
export type EmployeeStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type Role = 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER';
export type SessionRecord = Readonly<{
  branchId: string;
  employeeId: string;
  client: ClientType;
  issuedAtMs: number;
  lastActivityMs: number;
  revoked: boolean;
  credentialVersion: number;
}>;
export type EmployeeRecord = Readonly<{
  id: string;
  branchId: string;
  status: EmployeeStatus;
  role: Role;
  credentialVersion: number;
  mustChangePassword: boolean;
}>;
export type SessionDecision = { allowed: true } | { allowed: false; code: 'SESSION_INVALID' | 'SESSION_EXPIRED' | 'PASSWORD_CHANGE_REQUIRED' };
const MINUTE = 60_000;
export const ABSOLUTE_LIMIT = 12 * 60 * MINUTE;
export const IDLE_LIMIT: Record<ClientType, number> = { POS: 180 * MINUTE, WAITER_WEB: 360 * MINUTE };
const roles = new Set<Role>(['OWNER', 'MANAGER', 'CASHIER', 'WAITER']);

export function evaluateSession(session: SessionRecord, employee: EmployeeRecord, nowMs: number): SessionDecision {
  const idleLimit = IDLE_LIMIT[session.client];
  if (!Object.hasOwn(IDLE_LIMIT, session.client) || !roles.has(employee.role) ||
      typeof session.branchId !== 'string' || session.branchId.length === 0 ||
      typeof session.employeeId !== 'string' || session.employeeId.length === 0 ||
      session.branchId !== employee.branchId || session.employeeId !== employee.id ||
      session.revoked !== false || employee.status !== 'ACTIVE' ||
      employee.mustChangePassword !== false && employee.mustChangePassword !== true ||
      !Number.isSafeInteger(session.credentialVersion) || session.credentialVersion < 1 ||
      session.credentialVersion !== employee.credentialVersion ||
      !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(session.issuedAtMs) ||
      !Number.isSafeInteger(session.lastActivityMs) || session.issuedAtMs < 0 ||
      session.lastActivityMs < session.issuedAtMs || nowMs < session.lastActivityMs) {
    return { allowed: false, code: 'SESSION_INVALID' };
  }
  if (nowMs - session.issuedAtMs >= ABSOLUTE_LIMIT || nowMs - session.lastActivityMs >= idleLimit) {
    return { allowed: false, code: 'SESSION_EXPIRED' };
  }
  if (employee.mustChangePassword) return { allowed: false, code: 'PASSWORD_CHANGE_REQUIRED' };
  return { allowed: true };
}
