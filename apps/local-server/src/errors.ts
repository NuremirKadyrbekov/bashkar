export class PosError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}
export function requireCondition(value: unknown, code: string, status = 400): asserts value {
  if (!value) throw new PosError(code, status);
}
export function integer(value: unknown, min: number, max: number, code = 'INVALID_NUMBER'): number {
  requireCondition(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, code);
  return value;
}
export function textField(value: unknown, max = 200): string {
  requireCondition(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value), 'INVALID_TEXT');
  return value.trim();
}
