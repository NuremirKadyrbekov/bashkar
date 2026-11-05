import { createHash, createPublicKey, verify } from 'node:crypto';
import { canonical } from '../command-bus';
import type { AuthService } from '../modules/auth/auth-service';
import type { CloudOwnerAuth } from '../modules/auth/cloud-owner-auth';
import type { SigningDeviceIdentity } from '../modules/activation/platform-device';
import type { VerifiedRelease } from './release-verifier';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const signaturePattern = /^[A-Za-z0-9_-]{86}$/;
const maxLifetimeMs = 5 * 60 * 1000;
type Identity = { branchId: string; instanceId: string; registrationId: string };
export type UpdateActor = { id: string; branchId: string; role: string; audience: string; method: string };
export type InstallGrantClaims = {
  format: 1;
  action: 'INSTALL';
  keyId: string;
  operationId: string;
  branchId: string;
  instanceId: string;
  registrationId: string;
  actorId: string;
  releaseId: string;
  manifestSha256: string;
  artifactSha256: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  requiresClosedShift: true;
  requiresBackup: true;
};
export type SignedInstallGrant = { claims: InstallGrantClaims; signature: string };
declare const authorizedUpdateBrand: unique symbol;
export type AuthorizedUpdate = { readonly operationId: string; readonly release: VerifiedRelease; readonly actorId: string; readonly expiresAt: number; readonly grantSha256: string; readonly [authorizedUpdateBrand]: true };

function exact(value: unknown, names: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(',') !== [...names].sort().join(',')) throw new Error('UPDATE_AUTHORIZATION_INVALID');
  return value as Record<string, unknown>;
}

export function verifyUpdateInstallGrant(input: unknown, trusted: { keyId: string; publicKey: string }, identity: Identity, actor: UpdateActor, release: VerifiedRelease, operationId: string, now = Date.now()): AuthorizedUpdate {
  const envelope = exact(input, ['claims', 'signature']);
  const claims = exact(envelope.claims, ['format', 'action', 'keyId', 'operationId', 'branchId', 'instanceId', 'registrationId', 'actorId', 'releaseId', 'manifestSha256', 'artifactSha256', 'issuedAt', 'expiresAt', 'nonce', 'requiresClosedShift', 'requiresBackup']);
  if (claims.format !== 1 || claims.action !== 'INSTALL' || claims.requiresClosedShift !== true || claims.requiresBackup !== true || typeof claims.keyId !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(claims.keyId) || typeof claims.operationId !== 'string' || !uuid.test(claims.operationId) || typeof claims.nonce !== 'string' || !uuid.test(claims.nonce) || typeof claims.manifestSha256 !== 'string' || !hash.test(claims.manifestSha256) || typeof claims.artifactSha256 !== 'string' || !hash.test(claims.artifactSha256) || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt) || !Number.isSafeInteger(now)) throw new Error('UPDATE_AUTHORIZATION_INVALID');
  for (const name of ['branchId', 'instanceId', 'registrationId', 'actorId', 'releaseId'] as const) if (typeof claims[name] !== 'string' || claims[name].length < 1 || claims[name].length > 128) throw new Error('UPDATE_AUTHORIZATION_INVALID');
  if (actor.role !== 'OWNER' || actor.audience !== 'LOCAL_ADMIN' || actor.method !== 'CLOUD_OWNER' || actor.branchId !== identity.branchId) throw new Error('UPDATE_ACTOR_DENIED');
  if (claims.keyId !== trusted.keyId) throw new Error('UPDATE_AUTHORIZATION_SIGNER_UNKNOWN');
  if (typeof envelope.signature !== 'string' || !signaturePattern.test(envelope.signature)) throw new Error('UPDATE_AUTHORIZATION_SIGNATURE_INVALID');
  const publicKey = createPublicKey(trusted.publicKey);
  if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(canonical(claims)), publicKey, Buffer.from(envelope.signature, 'base64url'))) throw new Error('UPDATE_AUTHORIZATION_SIGNATURE_INVALID');
  if (claims.operationId !== operationId || claims.branchId !== identity.branchId || claims.instanceId !== identity.instanceId || claims.registrationId !== identity.registrationId || claims.actorId !== actor.id || claims.releaseId !== release.manifest.releaseId || claims.manifestSha256 !== release.manifestSha256 || claims.artifactSha256 !== release.manifest.artifact.sha256) throw new Error('UPDATE_AUTHORIZATION_SCOPE_MISMATCH');
  if (Number(claims.issuedAt) > now + 30_000 || Number(claims.issuedAt) < now - maxLifetimeMs || Number(claims.expiresAt) <= now || Number(claims.expiresAt) - Number(claims.issuedAt) > maxLifetimeMs || Number(claims.expiresAt) <= Number(claims.issuedAt)) throw new Error('UPDATE_AUTHORIZATION_EXPIRED');
  return Object.freeze({ operationId, release, actorId: actor.id, expiresAt: claims.expiresAt, grantSha256: createHash('sha256').update(canonical(envelope)).digest('hex') }) as AuthorizedUpdate;
}

// The caller must obtain a new signed grant from Cloud for this attempt.
// This function never enters maintenance or starts an installer.
export async function authorizeOwnerInstallAttempt(input: { auth: AuthService; cloudOwner: CloudOwnerAuth; token: string; grant: unknown; trusted: { keyId: string; publicKey: string }; identity: Identity; release: VerifiedRelease; operationId: string; now?: () => number }): Promise<AuthorizedUpdate> {
  const before = input.auth.current(input.token);
  if (before.role !== 'OWNER' || before.method !== 'CLOUD_OWNER' || before.audience !== 'LOCAL_ADMIN') throw new Error('UPDATE_ACTOR_DENIED');
  await input.cloudOwner.verifySession(before.sessionId, true);
  const after = input.auth.current(input.token);
  if (after.sessionId !== before.sessionId || after.id !== before.id) throw new Error('UPDATE_ACTOR_DENIED');
  return verifyUpdateInstallGrant(input.grant, input.trusted, input.identity, after, input.release, input.operationId, (input.now ?? Date.now)());
}

type OwnerInstallRequest = { auth: AuthService; cloudOwner: CloudOwnerAuth; device: SigningDeviceIdentity; token: string; trusted: { keyId: string; publicKey: string }; identity: Identity; release: VerifiedRelease; operationId: string; now?: () => number };
export async function requestAuthorizedOwnerInstallPackage(input: OwnerInstallRequest): Promise<{ authorization: AuthorizedUpdate; signedGrant: SignedInstallGrant }> {
  const before = input.auth.current(input.token);
  if (before.role !== 'OWNER' || before.method !== 'CLOUD_OWNER' || before.audience !== 'LOCAL_ADMIN' || before.branchId !== input.identity.branchId) throw new Error('UPDATE_ACTOR_DENIED');
  const grant = await input.cloudOwner.requestUpdateGrant(before.sessionId, input.device, input.identity, before.id, input.release, input.operationId);
  const after = input.auth.current(input.token);
  if (after.sessionId !== before.sessionId || after.id !== before.id) throw new Error('UPDATE_ACTOR_DENIED');
  const authorization = verifyUpdateInstallGrant(grant, input.trusted, input.identity, after, input.release, input.operationId, (input.now ?? Date.now)());
  return { authorization, signedGrant: grant as SignedInstallGrant };
}
export async function requestAuthorizedOwnerInstall(input: OwnerInstallRequest): Promise<AuthorizedUpdate> {
  return (await requestAuthorizedOwnerInstallPackage(input)).authorization;
}
