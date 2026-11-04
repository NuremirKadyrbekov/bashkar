import { describe, expect, it } from 'vitest';
import { evaluateSession, type EmployeeRecord, type SessionRecord } from '../src/modules/auth/session-policy';
const minute = 60_000;
const issued = 1_000_000;
const session: SessionRecord = { branchId: 'branch', employeeId: 'employee', client: 'POS', issuedAtMs: issued, lastActivityMs: issued, revoked: false, credentialVersion: 1 };
const employee: EmployeeRecord = { id: 'employee', branchId: 'branch', status: 'ACTIVE', role: 'CASHIER', credentialVersion: 1, mustChangePassword: false };

describe('session checks on server records', () => {
  it('uses the specified idle limits and denies exactly at the boundary', () => {
    expect(evaluateSession(session, employee, issued + 180 * minute - 1).allowed).toBe(true);
    expect(evaluateSession(session, employee, issued + 180 * minute)).toEqual({ allowed: false, code: 'SESSION_EXPIRED' });
    const waiter = { ...session, client: 'WAITER_WEB' as const };
    expect(evaluateSession(waiter, employee, issued + 180 * minute).allowed).toBe(true);
    expect(evaluateSession(waiter, employee, issued + 360 * minute - 1).allowed).toBe(true);
    expect(evaluateSession(waiter, employee, issued + 360 * minute)).toEqual({ allowed: false, code: 'SESSION_EXPIRED' });
  });
  it('enforces the absolute twelve-hour limit even after activity', () => {
    const recent = { ...session, lastActivityMs: issued + 12 * 60 * minute - 1 };
    expect(evaluateSession(recent, employee, issued + 12 * 60 * minute - 1).allowed).toBe(true);
    expect(evaluateSession(recent, employee, issued + 12 * 60 * minute)).toEqual({ allowed: false, code: 'SESSION_EXPIRED' });
  });
  it('denies revoked sessions, changed credentials, inactive users and branch mismatches', () => {
    const invalids: [SessionRecord, EmployeeRecord][] = [
      [{ ...session, revoked: true }, employee], [session, { ...employee, status: 'SUSPENDED' }],
      [session, { ...employee, status: 'DEACTIVATED' }], [session, { ...employee, credentialVersion: 2 }],
      [session, { ...employee, branchId: 'other' }], [session, { ...employee, id: 'other' }],
    ];
    for (const [s, e] of invalids) expect(evaluateSession(s, e, issued)).toEqual({ allowed: false, code: 'SESSION_INVALID' });
  });
  it('does not grant a regular session before required password change', () => {
    expect(evaluateSession(session, { ...employee, mustChangePassword: true }, issued)).toEqual({ allowed: false, code: 'PASSWORD_CHANGE_REQUIRED' });
  });
  it('fails closed for invalid clocks and unrecognized clients', () => {
    expect(evaluateSession(session, employee, issued - 1).allowed).toBe(false);
    expect(evaluateSession({ ...session, lastActivityMs: issued - 1 }, employee, issued).allowed).toBe(false);
    expect(evaluateSession({ ...session, client: 'BAD' as SessionRecord['client'] }, employee, issued).allowed).toBe(false);
    expect(evaluateSession(session, employee, NaN).allowed).toBe(false);
  });
});
