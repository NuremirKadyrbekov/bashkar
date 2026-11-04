import { expect, it } from 'vitest';
import { evaluateRestrictedAction, type RestrictedAction } from '../src/modules/auth/authorization-policy';
import type { EmployeeRecord, SessionRecord } from '../src/modules/auth/session-policy';
const session: SessionRecord = { branchId: 'b', employeeId: 'u', client: 'POS', issuedAtMs: 100, lastActivityMs: 100, revoked: false, credentialVersion: 1 };
const employee: EmployeeRecord = { id: 'u', branchId: 'b', status: 'ACTIVE', role: 'CASHIER', credentialVersion: 1, mustChangePassword: false };
const base = { session, employee, nowMs: 101, action: 'COUNTER_CREATE' as const, currentGrant: true, objectScopeAllowed: true, domainConditionsMet: true };

it('requires every server-side condition and rejects an unknown action', () => {
  expect(evaluateRestrictedAction(base)).toBe(true);
  expect(evaluateRestrictedAction({ ...base, currentGrant: false })).toBe(false);
  expect(evaluateRestrictedAction({ ...base, objectScopeAllowed: false })).toBe(false);
  expect(evaluateRestrictedAction({ ...base, domainConditionsMet: false })).toBe(false);
  expect(evaluateRestrictedAction({ ...base, action: 'UNKNOWN' as RestrictedAction })).toBe(false);
  expect(evaluateRestrictedAction({ ...base, session: { ...session, revoked: true } })).toBe(false);
});
it('never extends the role ceiling through an individual grant', () => {
  for (const action of ['COUNTER_CREATE', 'COUNTER_SETTLE', 'ORDER_CANCEL_FULL', 'REFUND', 'SHIFT_OPEN', 'SHIFT_CLOSE', 'EMPLOYEE_MANAGE', 'MENU_EDIT', 'SETTINGS_MANAGE'] as const) {
    expect(evaluateRestrictedAction({ ...base, employee: { ...employee, role: 'WAITER' }, action })).toBe(false);
  }
  for (const action of ['EMPLOYEE_MANAGE', 'MENU_EDIT', 'SETTINGS_MANAGE'] as const) expect(evaluateRestrictedAction({ ...base, action })).toBe(false);
  expect(evaluateRestrictedAction({ ...base, employee: { ...employee, role: 'OWNER' }, currentGrant: false, action: 'ORDER_CANCEL_FULL' })).toBe(false);
});
