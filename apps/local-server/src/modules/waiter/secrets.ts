import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import type { PinKeys } from '../auth/pin-crypto';
import { requireCondition, PosError } from '../../errors';
export function seal(keys: Buffer, aad: string, text: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keys.subarray(0, 32), iv); cipher.setAAD(Buffer.from(aad)); return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64'); }
export function unseal(keys: Buffer, aad: string, text: string) { try {
    const raw = Buffer.from(text, 'base64'), d = createDecipheriv('aes-256-gcm', keys.subarray(0, 32), raw.subarray(0, 12));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(raw.subarray(-16));
    return Buffer.concat([d.update(raw.subarray(12, -16)), d.final()]).toString('utf8');
}
catch {
    throw new PosError('PROTECTED_WEB_KEY_INVALID', 503);
} }
export const fingerprint = (keys: Buffer) => createHash('sha256').update(keys).digest('hex');
export function protectedKeys(provider: PinKeys, expected?: string, create = false) { const keys = provider.get(create); requireCondition(keys.length === 64 && (!expected || fingerprint(keys) === expected), 'WEB_DRAFT_KEYS_UNAVAILABLE', 503); return keys; }
