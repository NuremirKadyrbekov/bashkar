import { evaluateSession, type EmployeeRecord, type SessionRecord } from './session-policy';

/** Internal semantic names, not final API permission keys (D15). */
export type RestrictedAction =
  | 'COUNTER_CREATE' | 'COUNTER_SETTLE' | 'ORDER_CANCEL_FULL'
  | 'REFUND' | 'SHIFT_OPEN' | 'SHIFT_CLOSE'
  | 'EMPLOYEE_MANAGE' | 'MENU_EDIT' | 'SETTINGS_MANAGE';
const waiterForbidden = new Set<RestrictedAction>(['COUNTER_CREATE', 'COUNTER_SETTLE', 'ORDER_CANCEL_FULL', 'REFUND', 'SHIFT_OPEN', 'SHIFT_CLOSE', 'EMPLOYEE_MANAGE', 'MENU_EDIT', 'SETTINGS_MANAGE']);
const cashierForbidden = new Set<RestrictedAction>(['EMPLOYEE_MANAGE', 'MENU_EDIT', 'SETTINGS_MANAGE']);
const actions = new Set<RestrictedAction>([...waiterForbidden]);

/**
 * Inputs are trusted server-side, current snapshots, not request fields. The
 * caller must verify the session token, fetch current grants and object scope,
 * and perform all relevant domain preconditions inside the command transaction.
 * This helper alone is never sufficient to authorize an endpoint.
 */
export function evaluateRestrictedAction(input: Readonly<{
  session: SessionRecord; employee: EmployeeRecord; nowMs: number;
  action: RestrictedAction; currentGrant: boolean; objectScopeAllowed: boolean; domainConditionsMet: boolean;
}>): boolean {
  if (!evaluateSession(input.session, input.employee, input.nowMs).allowed || !actions.has(input.action)) return false;
  if (input.employee.role === 'WAITER' && waiterForbidden.has(input.action)) return false;
  if (input.employee.role === 'CASHIER' && cashierForbidden.has(input.action)) return false;
  return input.currentGrant === true && input.objectScopeAllowed === true && input.domainConditionsMet === true;
}
