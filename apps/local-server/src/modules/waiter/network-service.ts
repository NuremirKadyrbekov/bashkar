import { X509Certificate, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { audit, canonical, digest, outbox } from '../../command-bus';
import { PosError, requireCondition, integer } from '../../errors';
import { object } from '../menu/catalog';
import type { AuthService } from '../auth/auth-service';
import type { PinKeys } from '../auth/pin-crypto';
import { protectedKeys, seal, unseal } from './secrets';
type NetworkRow = {
    revision: number;
    branch_id: string;
    ip: string;
    port: number;
    leaf_certificate: string;
    root_certificate: string;
    wrapped_private_key: string;
    root_fingerprint: string;
    leaf_fingerprint: string;
    valid_until: number;
};
type Stage = {
    actor: string;
    expires: number;
    ip: string;
    port: number;
    leaf: string;
    root: string;
    wrapped: string;
    rootFingerprint: string;
    leafFingerprint: string;
    validUntil: number;
    revision: number;
    hash: string;
};
export class NetworkService {
    private stages = new Map<string, Stage>();
    private keys?: Buffer;
    runtimeStatus = { listening: false, code: 'WEB_UNCONFIGURED' };
    http?: { ip: string; port: number };
    get httpConfigInvalid() { return !!this.http && !this.validHttp(this.http); }
    onChange?: () => Promise<void>;
    constructor(readonly auth: AuthService, readonly provider: PinKeys, private readonly fixtureLoopback = false, http?: { ip: string; port: number }, private readonly saveHttp?: (http: {ip:string;port:number}|null) => void) {
        this.http = http;
        if (this.httpConfigInvalid) this.runtimeStatus = { listening: false, code: 'WEB_HTTP_CONFIG_INVALID' };
    }
    private validHttp(http: {ip:string;port:number}) { return Number.isInteger(http.port) && http.port >= 1024 && http.port <= 65535 && isIP(http.ip) === 4 && (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(http.ip) || this.fixtureLoopback && http.ip === '127.0.0.1'); }
    private localIps() { return [...new Set([...Object.values(networkInterfaces()).flatMap(items => items ?? []).filter(item => item.family === 'IPv4' && !item.internal && this.validHttp({ip:item.address,port:3002})).map(item => item.address),...(this.fixtureLoopback?['127.0.0.1']:[])])]; }
    async configureHttp(token: string, input: {ip:string;port:number}) {
        this.auth.current(token, 'network.waiter.manage');
        object(input,['ip','port']);
        requireCondition(this.validHttp(input) && (this.localIps().includes(input.ip) || this.fixtureLoopback && input.ip === '127.0.0.1'), 'INVALID_LAN_IP');
        requireCondition(!!this.saveHttp, 'WEB_CONFIG_MANAGED_EXTERNALLY', 409);
        this.saveHttp(input); this.http = input;
        await this.onChange?.();
        return this.status(token);
    }
    private get db() { return this.auth.db; }
    private master(create: boolean) { return this.keys ??= protectedKeys(this.provider, undefined, create); }
    current() { return this.db.prepare('SELECT * FROM waiter_network_revisions WHERE branch_id=? ORDER BY revision DESC LIMIT 1').get(this.auth.branchId) as NetworkRow | undefined; }
    private aad(ip: string, port: number) { return canonical({ kind: 'waiter-tls', branchId: this.auth.branchId, ip, port }); }
    async status(token: string) { this.auth.current(token, 'network.waiter.manage'); const r = this.current(), http = this.http, url = this.httpConfigInvalid ? null : http ? `http://${http.ip}:${http.port}/waiter/` : r ? `https://${r.ip}:${r.port}/waiter/` : null; return { configured: !this.httpConfigInvalid && !!(http || r), mode: http || this.httpConfigInvalid ? 'HTTP_MVP' : 'HTTPS', ...this.runtimeStatus, revision: r?.revision ?? 0, ip: http?.ip ?? r?.ip ?? null, port: http?.port ?? r?.port ?? 3443, localIps:this.localIps(), url, qrDataUrl: url ? await QRCode.toDataURL(url, { width: 240, margin: 2 }) : null, rootFingerprint: http ? null : r?.root_fingerprint ?? null, leafFingerprint: http ? null : r?.leaf_fingerprint ?? null, validUntil: http ? null : r?.valid_until ?? null, daysRemaining: http ? null : r ? Math.floor((r.valid_until - this.auth.now()) / 86400000) : null, rootCertificate: http ? null : r?.root_certificate ?? null }; }
    prepare(token: string, input: {
        ip: string;
        port: number;
        leafCertificate: string;
        rootCertificate: string;
        privateKey: string;
        expectedRevision: number;
        acknowledgeOriginChange: boolean;
    }) {
        const actor = this.auth.current(token, 'network.waiter.manage');
        object(input, ['ip', 'port', 'leafCertificate', 'rootCertificate', 'privateKey', 'expectedRevision', 'acknowledgeOriginChange']);
        integer(input.port, 1024, 65535);
        integer(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER);
        requireCondition(isIP(input.ip) === 4 && (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(input.ip) || this.fixtureLoopback && input.ip === '127.0.0.1'), 'INVALID_LAN_IP');
        requireCondition(typeof input.privateKey === 'string' && input.privateKey.length < 20000 && typeof input.leafCertificate === 'string' && input.leafCertificate.length < 20000 && typeof input.rootCertificate === 'string' && input.rootCertificate.length < 20000, 'INVALID_CERTIFICATE');
        const current = this.current();
        requireCondition((current?.revision ?? 0) === input.expectedRevision, 'REVISION_CONFLICT', 409);
        if (current && (current.ip !== input.ip || current.port !== input.port))
            requireCondition(input.acknowledgeOriginChange === true, 'ORIGIN_CHANGE_REQUIRES_REVIEW', 409);
        let leaf: X509Certificate, root: X509Certificate;
        try {
            leaf = new X509Certificate(input.leafCertificate);
            root = new X509Certificate(input.rootCertificate);
            requireCondition(root.ca && root.checkIssued(root) && root.verify(root.publicKey) && leaf.checkIssued(root) && leaf.verify(root.publicKey) && leaf.checkIP(input.ip) === input.ip && !leaf.ca && leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1'), 'INVALID_CERTIFICATE');
            requireCondition(leaf.checkPrivateKey(createPrivateKey(input.privateKey)), 'CERTIFICATE_KEY_MISMATCH');
        }
        catch {
            throw new PosError('INVALID_CERTIFICATE', 400);
        }
        const now = this.auth.now(), validUntil = Date.parse(leaf.validTo);
        requireCondition(Date.parse(leaf.validFrom) <= now && validUntil > now + 86400000 && Date.parse(root.validFrom) <= now && Date.parse(root.validTo) > validUntil, 'CERTIFICATE_EXPIRED');
        const keys = this.master(!current), stagingId = randomUUID();
        for (const [key, s] of this.stages)
            if (s.expires < now)
                this.stages.delete(key);
        requireCondition(this.stages.size < 8, 'NETWORK_STAGE_LIMIT', 429);
        const publicProposal = { ip: input.ip, port: input.port, revision: input.expectedRevision, rootFingerprint: root.fingerprint256, leafFingerprint: leaf.fingerprint256, validUntil };
        const hash = digest(canonical({ actorId: actor.id, ...publicProposal }));
        this.stages.set(stagingId, { actor: actor.id, expires: now + 300000, ip: input.ip, port: input.port, leaf: input.leafCertificate, root: input.rootCertificate, wrapped: seal(keys, this.aad(input.ip, input.port), input.privateKey), rootFingerprint: root.fingerprint256, leafFingerprint: leaf.fingerprint256, validUntil, revision: input.expectedRevision, hash });
        return { ...publicProposal, stagingId, confirmationHash: hash };
    }
    async commit(token: string, commandId: string, input: {
        stagingId: string;
        expectedRevision: number;
        confirmationHash: string;
    }) { const actor = this.auth.current(token, 'network.waiter.manage'); object(input, ['stagingId', 'expectedRevision', 'confirmationHash']); const result = await this.auth.bus.run({ id: commandId, type: 'waiter.network.configure', actor, payload: input }, () => { this.auth.current(token, 'network.waiter.manage'); }, () => { const s = this.stages.get(input.stagingId); requireCondition(s && s.actor === actor.id && s.expires >= this.auth.now(), 'NETWORK_STAGE_EXPIRED', 409); requireCondition(s.hash === input.confirmationHash && s.revision === input.expectedRevision && (this.current()?.revision ?? 0) === s.revision, 'CONFIRMATION_STALE', 409); this.db.prepare('INSERT INTO waiter_network_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(s.revision + 1, actor.branchId, s.ip, s.port, s.leaf, s.root, s.wrapped, s.rootFingerprint, s.leafFingerprint, s.validUntil, actor.id, this.auth.now(), commandId); const receipt = { revision: s.revision + 1, url: `https://${s.ip}:${s.port}/waiter/` }; audit(this.db, actor, 'waiter.network.configured', null, commandId, this.auth.now(), receipt); outbox(this.db, actor.branchId, 'waiter.network.configured', receipt, this.auth.now()); return receipt; }); await this.onChange?.(); return result; }
    tls() { const r = this.current(); requireCondition(r, 'WEB_UNCONFIGURED', 503); requireCondition(r.valid_until > this.auth.now(), 'CERTIFICATE_EXPIRED', 503); return { ip: r.ip, port: r.port, cert: r.leaf_certificate, key: unseal(this.master(false), this.aad(r.ip, r.port), r.wrapped_private_key) }; }
}
