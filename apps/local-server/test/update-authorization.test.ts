import { expect, it } from 'vitest';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { canonical } from '../src/command-bus';
import { verifySignedRelease, type ReleaseManifest } from '../src/recovery/release-verifier';
import { authorizeOwnerInstallAttempt, requestAuthorizedOwnerInstall, requestAuthorizedOwnerInstallPackage, verifyUpdateInstallGrant, type InstallGrantClaims } from '../src/recovery/update-authorization';
import type { AuthService } from '../src/modules/auth/auth-service';
import type { CloudOwnerAuth } from '../src/modules/auth/cloud-owner-auth';
import type { SigningDeviceIdentity } from '../src/modules/activation/platform-device';

function fixture() {
  const publisher = generateKeyPairSync('ed25519'), cloud = generateKeyPairSync('ed25519');
  const manifest: ReleaseManifest = { format: 1, releaseId: 'rel_020', version: '0.2.0', gitCommit: 'a'.repeat(40), keyId: 'publisher_1', platform: { os: 'win32', arch: 'x64' }, compatibility: { minSourceVersion: '0.1.0', maxSourceVersion: '0.1.0', minAgentVersion: '0.1.0', minSchema: 26, maxSchema: 26, targetSchema: 26, migrationVersions: [] }, artifact: { fileName: 'Bashkar-POS-Setup-0.2.0.exe', sizeBytes: 1, sha256: 'b'.repeat(64) }, minFreeBytes: 0 };
  const release = verifySignedRelease({ manifest, signature: sign(null, Buffer.from(canonical(manifest)), publisher.privateKey).toString('base64url') }, { keyId: manifest.keyId, publicKey: publisher.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, { appVersion: '0.1.0', agentVersion: '0.1.0', schemaVersion: 26, os: 'win32', arch: 'x64', freeBytes: 1 });
  const identity = { branchId: randomUUID(), instanceId: randomUUID(), registrationId: randomUUID() };
  const actor = { id: randomUUID(), branchId: identity.branchId, role: 'OWNER', audience: 'LOCAL_ADMIN', method: 'CLOUD_OWNER' };
  const operationId = randomUUID(), now = 1_800_000_000_000;
  const claims: InstallGrantClaims = { format: 1, action: 'INSTALL', keyId: 'update_cloud_1', operationId, ...identity, actorId: actor.id, releaseId: manifest.releaseId, manifestSha256: release.manifestSha256, artifactSha256: manifest.artifact.sha256, issuedAt: now, expiresAt: now + 60_000, nonce: randomUUID(), requiresClosedShift: true, requiresBackup: true };
  const trusted = { keyId: claims.keyId, publicKey: cloud.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  const signed = (value: InstallGrantClaims = claims) => ({ claims: value, signature: sign(null, Buffer.from(canonical(value)), cloud.privateKey).toString('base64url') });
  return { release, identity, actor, operationId, now, claims, trusted, signed };
}

it('accepts a fresh Cloud grant for one owner, installation, operation and signed release', () => {
  const f = fixture();
  expect(verifyUpdateInstallGrant(f.signed(), f.trusted, f.identity, f.actor, f.release, f.operationId, f.now)).toMatchObject({ operationId: f.operationId, actorId: f.actor.id, expiresAt: f.claims.expiresAt });
});

it('rejects changed grants, another operation or installation, and an expired grant', () => {
  const f = fixture();
  expect(() => verifyUpdateInstallGrant({ ...f.signed(), claims: { ...f.claims, artifactSha256: '0'.repeat(64) } }, f.trusted, f.identity, f.actor, f.release, f.operationId, f.now)).toThrow('UPDATE_AUTHORIZATION_SIGNATURE_INVALID');
  expect(() => verifyUpdateInstallGrant(f.signed(), f.trusted, f.identity, f.actor, f.release, randomUUID(), f.now)).toThrow('UPDATE_AUTHORIZATION_SCOPE_MISMATCH');
  expect(() => verifyUpdateInstallGrant(f.signed(), f.trusted, { ...f.identity, instanceId: randomUUID() }, f.actor, f.release, f.operationId, f.now)).toThrow('UPDATE_AUTHORIZATION_SCOPE_MISMATCH');
  expect(() => verifyUpdateInstallGrant(f.signed(), f.trusted, f.identity, { ...f.actor, id: randomUUID() }, f.release, f.operationId, f.now)).toThrow('UPDATE_AUTHORIZATION_SCOPE_MISMATCH');
  expect(() => verifyUpdateInstallGrant(f.signed({ ...f.claims, manifestSha256: '0'.repeat(64) }), f.trusted, f.identity, f.actor, f.release, f.operationId, f.now)).toThrow('UPDATE_AUTHORIZATION_SCOPE_MISMATCH');
  expect(() => verifyUpdateInstallGrant(f.signed(), f.trusted, f.identity, f.actor, f.release, f.operationId, f.claims.expiresAt)).toThrow('UPDATE_AUTHORIZATION_EXPIRED');
});

it('requires a Cloud Owner session and mandatory local safety conditions', () => {
  const f = fixture();
  expect(() => verifyUpdateInstallGrant(f.signed(), f.trusted, f.identity, { ...f.actor, role: 'WAITER' }, f.release, f.operationId, f.now)).toThrow('UPDATE_ACTOR_DENIED');
  expect(() => verifyUpdateInstallGrant(f.signed(), f.trusted, f.identity, { ...f.actor, method: 'PIN' }, f.release, f.operationId, f.now)).toThrow('UPDATE_ACTOR_DENIED');
  expect(() => verifyUpdateInstallGrant(f.signed({ ...f.claims, requiresBackup: false as true }), f.trusted, f.identity, f.actor, f.release, f.operationId, f.now)).toThrow('UPDATE_AUTHORIZATION_INVALID');
});

it('checks Cloud Owner freshly and rechecks the local session after the network call', async () => {
  const f = fixture(), sessionId = randomUUID(), calls: string[] = [];
  let active = true;
  const auth = { current: () => { calls.push('local'); if (!active) throw new Error('SESSION_INVALID'); return { ...f.actor, sessionId }; } } as unknown as AuthService;
  const cloudOwner = { verifySession: async (id: string, fresh: boolean) => { expect(id).toBe(sessionId); expect(fresh).toBe(true); calls.push('cloud'); } } as unknown as CloudOwnerAuth;
  await expect(authorizeOwnerInstallAttempt({ auth, cloudOwner, token: 'test', grant: f.signed(), trusted: f.trusted, identity: f.identity, release: f.release, operationId: f.operationId, now: () => f.now })).resolves.toMatchObject({ actorId: f.actor.id });
  expect(calls).toEqual(['local', 'cloud', 'local']);
  calls.length = 0;
  const revokingCloud = { verifySession: async () => { active = false; } } as unknown as CloudOwnerAuth;
  await expect(authorizeOwnerInstallAttempt({ auth, cloudOwner: revokingCloud, token: 'test', grant: f.signed(), trusted: f.trusted, identity: f.identity, release: f.release, operationId: f.operationId, now: () => f.now })).rejects.toThrow('SESSION_INVALID');
});

it('requests a new Cloud grant with the current Owner and rejects a revoked local session', async () => {
  const f = fixture(), sessionId = randomUUID(), calls: string[] = [];
  let active = true;
  const auth = { current: () => { calls.push('local'); if (!active) throw Error('SESSION_INVALID'); return { ...f.actor, sessionId }; } } as unknown as AuthService;
  const cloudOwner = { requestUpdateGrant: async (id: string, _device: unknown, _identity: unknown, actorId: string, _release: unknown, operationId: string) => { calls.push('cloud'); expect(id).toBe(sessionId); expect(actorId).toBe(f.actor.id); expect(operationId).toBe(f.operationId); return f.signed(); } } as unknown as CloudOwnerAuth;
  const device = {} as SigningDeviceIdentity;
  await expect(requestAuthorizedOwnerInstall({ auth, cloudOwner, device, token: 'test', trusted: f.trusted, identity: f.identity, release: f.release, operationId: f.operationId, now: () => f.now })).resolves.toMatchObject({ operationId: f.operationId });
  expect(calls).toEqual(['local', 'cloud', 'local']);
  const packet=await requestAuthorizedOwnerInstallPackage({ auth, cloudOwner, device, token: 'test', trusted: f.trusted, identity: f.identity, release: f.release, operationId: f.operationId, now: () => f.now });
  expect(packet.authorization.operationId).toBe(f.operationId);
  expect(packet.signedGrant).toEqual(f.signed());
  const revokingCloud = { requestUpdateGrant: async () => { active = false; return f.signed(); } } as unknown as CloudOwnerAuth;
  await expect(requestAuthorizedOwnerInstall({ auth, cloudOwner: revokingCloud, device, token: 'test', trusted: f.trusted, identity: f.identity, release: f.release, operationId: f.operationId, now: () => f.now })).rejects.toThrow('SESSION_INVALID');
});
