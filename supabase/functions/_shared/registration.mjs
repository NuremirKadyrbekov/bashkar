// Portable WebCrypto code, used by Deno and by Node contract tests.
const encoder = new TextEncoder();
export class RegistrationError extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  throw new RegistrationError('INVALID_REGISTRATION');
}
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
function pemBytes(pem, type) {
  if (typeof pem !== 'string' || pem.length > 2000 || !pem.startsWith(`-----BEGIN ${type}-----\n`) || !pem.endsWith(`\n-----END ${type}-----\n`))
    throw new RegistrationError('INVALID_DEVICE_KEY');
  return decode(pem.slice(`-----BEGIN ${type}-----\n`.length, -`\n-----END ${type}-----\n`.length).replaceAll('\n', ''));
}
export async function validateRegistration(input) {
  const fields = ['version','registrationId','branchId','instanceId','devicePublicKey','nonce','deviceSignature'];
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).length !== fields.length || fields.some(k => !(k in input)))
    throw new RegistrationError('INVALID_REGISTRATION');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (input.version !== 1 || !['registrationId','branchId','instanceId'].every(k => typeof input[k] === 'string' && uuid.test(input[k])) ||
      typeof input.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.nonce) ||
      typeof input.deviceSignature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(input.deviceSignature))
    throw new RegistrationError('INVALID_REGISTRATION');
  let key;
  try { key = await crypto.subtle.importKey('spki', pemBytes(input.devicePublicKey, 'PUBLIC KEY'), {name:'Ed25519'}, false, ['verify']); }
  catch { throw new RegistrationError('INVALID_DEVICE_KEY'); }
  const devicePublicKeyHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input.devicePublicKey))), b => b.toString(16).padStart(2, '0')).join('');
  const proof = {version:1,registrationId:input.registrationId,branchId:input.branchId,instanceId:input.instanceId,devicePublicKeyHash,nonce:input.nonce};
  if (!await crypto.subtle.verify('Ed25519', key, decode(input.deviceSignature), encoder.encode(canonical(proof))))
    throw new RegistrationError('DEVICE_PROOF_INVALID', 403);
  return proof;
}
export async function loadAuthority(privatePem) {
  try { return await crypto.subtle.importKey('pkcs8', pemBytes(privatePem, 'PRIVATE KEY'), 'Ed25519', false, ['sign']); }
  catch { throw new RegistrationError('ACTIVATION_AUTHORITY_UNAVAILABLE', 503); }
}
export async function signRegistration(claims, key) {
  return {claims,signature:b64url(await crypto.subtle.sign('Ed25519',key,encoder.encode(canonical(claims))))};
}
