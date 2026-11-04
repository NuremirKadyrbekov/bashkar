import { randomBytes } from 'node:crypto';
import { audit, digest, uuidPattern } from '../../command-bus';
import { requireCondition } from '../../errors';
import type { OperationalServices } from '../../api';
import { permissionKeys, hasPermission } from '../auth/permissions';
import type { PinKeys } from '../auth/pin-crypto';
import { protectedKeys, seal, unseal, fingerprint } from './secrets';
type Security = {
    session_id: string;
    branch_id: string;
    employee_id: string;
    device_id: string;
    csrf_hash: string;
    unlock_hash: string;
    credential_version: number;
};
export class WaiterService {
    private keys?: Buffer;
    constructor(readonly services: OperationalServices, readonly provider: PinKeys) { }
    private get auth() { return this.services.auth; }
    private get db() { return this.auth.db; }
    bootstrap() { const instance = this.db.prepare('SELECT id FROM bootstrap_instance').get() as {
        id: string;
    }; return { instanceId: instance.id, branchId: this.auth.branchId, version: '0.9.0-service-clients', draftSchema: 1 }; }
    private master() { const bound = this.db.prepare('SELECT fingerprint FROM web_key_binding WHERE singleton=1').get() as {
        fingerprint: string;
    } | undefined; if (!this.keys)
        this.keys = protectedKeys(this.provider, bound?.fingerprint, !bound); requireCondition(!bound || bound.fingerprint === fingerprint(this.keys), 'WEB_DRAFT_KEYS_UNAVAILABLE', 503); return this.keys; }
    private draftKey(employeeId: string, deviceId: string) {
        const keys = this.master(), scope = JSON.stringify(['waiter-draft', this.bootstrap().instanceId, this.auth.branchId, employeeId, deviceId, 1]), prior = this.db.prepare('SELECT wrapped_key FROM web_draft_key_contexts WHERE branch_id=? AND employee_id=? AND device_id=?').get(this.auth.branchId, employeeId, deviceId) as {
            wrapped_key: string;
        } | undefined;
        if (prior)
            return unseal(keys, scope, prior.wrapped_key);
        const value = randomBytes(32).toString('base64');
        this.db.transaction(() => { this.db.prepare('INSERT OR IGNORE INTO web_key_binding VALUES(1,?)').run(fingerprint(keys)); this.db.prepare('INSERT OR IGNORE INTO web_draft_key_contexts VALUES(?,?,?,1,?,?)').run(this.auth.branchId, employeeId, deviceId, seal(keys, scope, value), this.auth.now()); }).immediate();
        const saved = this.db.prepare('SELECT wrapped_key FROM web_draft_key_contexts WHERE branch_id=? AND employee_id=? AND device_id=?').get(this.auth.branchId, employeeId, deviceId) as {
            wrapped_key: string;
        };
        return unseal(keys, scope, saved.wrapped_key);
    }
    async login(pin: unknown, deviceId: unknown, source: string, previous?: string, unlock = false) {
        requireCondition(typeof deviceId === 'string' && uuidPattern.test(deviceId), 'INVALID_DEVICE_ID');
        requireCondition(this.services.pins, 'PIN_UNAVAILABLE', 503);
        const old = unlock ? this.auth.current(previous!) : undefined;
        if (unlock) {
            requireCondition(old?.audience === 'WAITER_WEB', 'CLIENT_AUDIENCE_DENIED', 403);
            const security = this.db.prepare('SELECT device_id FROM waiter_session_security WHERE session_id=?').get(old.sessionId) as {
                device_id: string;
            } | undefined;
            requireCondition(security?.device_id === deviceId, 'WEB_UNLOCK_REQUIRED', 401);
        }
        const opened = await this.services.pins.login(pin, source, 'WAITER_WEB');
        try {
            const actor = this.auth.current(opened.token);
            requireCondition(actor.audience === 'WAITER_WEB' && actor.role === 'WAITER', 'CLIENT_AUDIENCE_DENIED', 403);
            requireCondition(!old || old.id === actor.id, 'ACTOR_CHANGED', 409);
            const draftKey = this.draftKey(actor.id, deviceId), csrf = randomBytes(32).toString('base64url'), unlockTicket = randomBytes(32).toString('base64url');
            this.db.transaction(() => { if (previous)
                try {
                    this.auth.logout(previous);
                }
                catch { } this.db.prepare('INSERT INTO waiter_session_security VALUES(?,?,?,?,?,?,?,?)').run(actor.sessionId, actor.branchId, actor.id, deviceId, digest(csrf), digest(unlockTicket), actor.employee.credential_version, this.auth.now()); }).immediate();
            return { cookie: opened.token, body: { ...this.bootstrap(), employeeId: actor.id, name: actor.employee.name, permissions: permissionKeys.filter(p => hasPermission(this.db, actor.employee, p)), csrf, unlockTicket, draftKey, deviceId, keyVersion: 1 } };
        }
        catch (error) {
            this.auth.logout(opened.token);
            throw error;
        }
    }
    authorize(cookie: unknown, csrf?: unknown, unlockTicket?: unknown, unsafe = false) { requireCondition(typeof cookie === 'string', 'SESSION_INVALID', 401); const actor = this.auth.current(cookie); requireCondition(actor.role === 'WAITER' && actor.audience === 'WAITER_WEB', 'CLIENT_AUDIENCE_DENIED', 403); const s = this.db.prepare('SELECT * FROM waiter_session_security WHERE session_id=?').get(actor.sessionId) as Security | undefined; requireCondition(s && s.branch_id === actor.branchId && s.employee_id === actor.id && s.credential_version === actor.employee.credential_version, 'SESSION_INVALID', 401); requireCondition(typeof unlockTicket === 'string' && digest(unlockTicket) === s.unlock_hash, 'WEB_UNLOCK_REQUIRED', 401); if (unsafe)
        requireCondition(typeof csrf === 'string' && digest(csrf) === s.csrf_hash, 'CSRF_INVALID', 403); return actor; }
    me(cookie: string, csrf: unknown, ticket: unknown) { const actor = this.authorize(cookie, csrf, ticket); return { ...this.bootstrap(), id: actor.id, name: actor.employee.name, permissions: permissionKeys.filter(p => hasPermission(this.db, actor.employee, p)), deviceId: (this.db.prepare('SELECT device_id FROM waiter_session_security WHERE session_id=?').get(actor.sessionId) as Security).device_id }; }
    logout(cookie: string) { const actor = this.auth.current(cookie); this.db.transaction(() => { this.db.prepare('DELETE FROM waiter_session_security WHERE session_id=?').run(actor.sessionId); this.auth.logout(cookie); }).immediate(); return { loggedOut: true }; }
    // Never returns arbitrary journal records. The original operation is replayed by
    // its normal handler only after actor/fingerprint and current authorization.
    recorded(cookie: string, commandId: string) { const actor = this.auth.current(cookie); requireCondition(uuidPattern.test(commandId), 'INVALID_COMMAND_ID'); const r = this.db.prepare('SELECT actor_id FROM commands WHERE branch_id=? AND id=?').get(actor.branchId, commandId) as {
        actor_id: string;
    } | undefined; requireCondition(!r || r.actor_id === actor.id, 'COMMAND_ID_CONFLICT', 409); return !!r; }
}
