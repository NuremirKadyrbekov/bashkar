import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { commonPasswords } from './common-passwords';
import { requireCondition } from '../../errors';
// Initial RFC 9106 memory-constrained profile. Target POS benchmark remains required.
const parameters = { memory:65536, passes:3, parallelism:4, tagLength:32 };
const common = new Set([...commonPasswords.map(value=>value.normalize('NFKC').toLowerCase()),'password','password1','password123','12345678','123456789','1234567890','qwerty123','qwertyuiop','qwertyui','abcdefgh','11111111','00000000','87654321','admin123','administrator','iloveyou','letmein123','пароль123','йцукен123','bashkar123']);
export function validatePassword(value: unknown): string {
  requireCondition(typeof value === 'string' && [...value].length >= 8 && Buffer.byteLength(value,'utf8') <= 1024,'PASSWORD_POLICY');
  const normalized=value.normalize('NFKC').toLowerCase();
  const withoutSuffix=normalized.replace(/[0-9!@#$%^&*._-]+$/u,'');
  requireCondition(!common.has(normalized) && !(withoutSuffix && common.has(withoutSuffix)) && !/^(.)\1+$/u.test(value),'COMMON_PASSWORD');
  return value;
}
let pending = 0;
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  requireCondition(pending < 4,'PASSWORD_WORK_LIMIT',429); pending++;
  try { return await new Promise<Buffer>((resolve,reject) => argon2('argon2id',{...parameters,message:password,nonce:salt},(error,key) => error ? reject(error) : resolve(key))); }
  finally { pending--; }
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16), key = await derive(password,salt);
  return ['argon2id-v1',salt.toString('hex'),key.toString('hex')].join('$');
}
export async function verifyPassword(password: unknown, hash: string): Promise<boolean> {
  if (typeof password !== 'string' || Buffer.byteLength(password,'utf8') > 1024) return false;
  const [format,salt,key,...extra] = hash.split('$');
  if (format !== 'argon2id-v1' || !/^[0-9a-f]{32}$/.test(salt ?? '') || !/^[0-9a-f]{64}$/.test(key ?? '') || extra.length) return false;
  return timingSafeEqual(await derive(password,Buffer.from(salt,'hex')),Buffer.from(key,'hex'));
}
// A slow salted fingerprint for client-supplied password mutations. Never use a
// fast unsalted password digest in a journal; the public command UUID is the salt.
export async function passwordFingerprint(password: string, commandId: string): Promise<string> {
  const salt = createHash('sha256').update('password-command-v1:'+commandId).digest().subarray(0,16);
  return (await derive(password,salt)).toString('hex');
}
export function temporaryPassword() { return randomBytes(18).toString('base64url'); }
