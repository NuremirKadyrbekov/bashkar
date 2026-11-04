import { randomUUID } from 'node:crypto';
import { audit, canonical, digest, outbox, uuidPattern } from '../../command-bus';
import { integer, requireCondition } from '../../errors';
import { object } from '../menu/catalog';
import { hasPermission, type Permission } from '../auth/permissions';
import type { FinanceService } from '../orders/finance-service';
import { defaultPrintProfile, renderInWorker, type PrintProfile } from './render';
import { type PrintAdapter, type PrintDevice, WindowsPrintAdapter } from './windows-adapter';
type Row = Record<string, any>;
type ActionInput = {
    action: string;
    reason: string;
    expectedRevision: number;
    targetDeviceId: string | null;
    riskConfirmed: boolean;
    confirmationHash?: string;
};
const permissions: Record<string, Permission> = { RETRY_SAFE: 'print.retry_safe', REPRINT: 'print.reprint', REDIRECT: 'print.redirect', MANUAL_HANDOFF: 'print.manual_handoff', RESOLVE_NO_PRINT: 'print.resolve_no_print', RELEASE_LATE: 'print.release_late', ASSIGN_ROUTE: 'print.settings.manage' };
const reasonText = (s: unknown) => { requireCondition(typeof s === 'string', 'INVALID_REASON'); const v = s.trim().normalize('NFC'); requireCondition(v && [...v].length <= 300 && !/[\u0000-\u001f\u007f-\u009f]/u.test(v), 'INVALID_REASON'); return v; };
export class PrintService {
    onStatusChanged?:()=>void;
    readonly db;
    readonly auth;
    readonly bus;
    readonly now;
    readonly epoch = randomUUID();
    private stopping = false;
    private running = new Set<Promise<void>>();
    private timer?: ReturnType<typeof setTimeout>;
    private statusTimer?: ReturnType<typeof setTimeout>;
    private ticking = false;
    private scanAfter = 0;
    constructor(readonly finance: FinanceService, readonly adapter: PrintAdapter = new WindowsPrintAdapter(), readonly renderer = renderInWorker) { this.db = finance.db; this.auth = finance.auth; this.bus = finance.bus; this.now = finance.now; }
    private row(sql: string, ...args: unknown[]) { return this.db.prepare(sql).get(...args) as Row | undefined; }
    private rows(sql: string, ...args: unknown[]) { return this.db.prepare(sql).all(...args) as Row[]; }
    private branch() { return this.auth.branchId; }
    private notifyStatusChanged(){if(!this.onStatusChanged||this.stopping||this.statusTimer)return;this.statusTimer=setTimeout(()=>{this.statusTimer=undefined;try{this.onStatusChanged?.();}catch{/* committed status stands */}},100);this.statusTimer.unref();}
    private hash(token: string, kind: string, value: unknown) { return digest(canonical({ actorId: this.auth.current(token).id, branchId: this.branch(), kind, value })); }
    devices(token: string) { this.auth.current(token, 'print.settings.manage'); return this.rows('SELECT p.* FROM print_device_revisions p WHERE p.branch_id=? AND p.revision=(SELECT MAX(x.revision) FROM print_device_revisions x WHERE x.branch_id=p.branch_id AND x.id=p.id) ORDER BY p.queue_name', this.branch()).map(p => ({ id: p.id, revision: p.revision, queueName: p.queue_name, driverName: p.driver_name, portName: p.port_name, physicalId: p.physical_id, profile: JSON.parse(p.profile) })); }
    async inventory(token: string) { this.auth.current(token, 'print.settings.manage'); return this.adapter.inventory(); }
    private device(id: string, revision?: number): PrintDevice { const row = this.row('SELECT * FROM print_device_revisions WHERE branch_id=? AND id=? ' + (revision ? 'AND revision=?' : 'ORDER BY revision DESC LIMIT 1'), ...([this.branch(), id, ...(revision ? [revision] : [])])); requireCondition(row, 'PRINT_DEVICE_NOT_FOUND', 404); return { id: row.id, revision: row.revision, queueName: row.queue_name, driverName: row.driver_name, portName: row.port_name, physicalId: row.physical_id, profile: JSON.parse(row.profile) }; }
    private profile(input: unknown) { const p = object(input, ['model', 'mode', 'dpi', 'width', 'feed', 'cutter', 'kitchenTextSize']); requireCondition(p.model === 'XP-365B' && p.mode === 'ESC_POS_RECEIPT' && p.dpi === 203 && p.cutter === false && (p.kitchenTextSize === undefined || typeof p.kitchenTextSize === 'string' && ['NORMAL', 'LARGE'].includes(p.kitchenTextSize)), 'INVALID_PRINT_PROFILE'); integer(p.width, 384, 608); integer(p.feed, 0, 96); requireCondition((p.width as number) % 8 === 0, 'INVALID_PRINT_PROFILE'); return p as PrintProfile; }
    async kitchenPreview(token:string,input:unknown){this.auth.current(token,'print.settings.manage');const profile=this.profile(input);const sample={type:'TABLE',tableName:'7',zoneName:'Основной зал',orderNumber:12,submittedAt:this.now(),sender:{id:'preview-sender',name:'Айдана'},responsibleWaiter:{id:'preview-waiter',name:'Бекзат'},lines:[{quantity:2,name:'Плов с говядиной Ө Ү Ң',variant:{name:'Большая порция'},modifiers:[{name:'Без лука'}],comment:'Сначала приготовить без острого соуса'}]};const rendered=await this.renderer('KITCHEN','NEW_BATCH',sample,profile,false,this.now());return {image:'data:image/png;base64,'+rendered.preview.toString('base64'),lineCount:rendered.lineCount};}
    async prepareDevice(token: string, input: {
        deviceId: string | null;
        expectedRevision: number;
        queueName: string;
        profile: unknown;
        receiptModeConfirmed: boolean;
    }) { this.auth.current(token, 'print.settings.manage'); object(input, ['deviceId', 'expectedRevision', 'queueName', 'profile', 'receiptModeConfirmed']); integer(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER); requireCondition(input.receiptModeConfirmed === true, 'PRINT_MODE_CONFIRMATION_REQUIRED'); const devices = await this.adapter.inventory(), device = devices.find(p => p.queueName === input.queueName); requireCondition(device, 'PRINT_DEVICE_NOT_FOUND', 404); const id = input.deviceId ?? randomUUID(); requireCondition(uuidPattern.test(id), 'INVALID_ID'); const current = this.row('SELECT MAX(revision) revision FROM print_device_revisions WHERE branch_id=? AND id=?', this.branch(), id); requireCondition((current?.revision ?? 0) === input.expectedRevision, 'REVISION_CONFLICT', 409); const proposal = { deviceId: id, expectedRevision: input.expectedRevision, ...device, profile: this.profile(input.profile), receiptModeConfirmed: true }; return { ...proposal, confirmationHash: this.hash(token, 'print.device', proposal) }; }
    async saveDevice(token: string, commandId: string, input: {
        deviceId: string;
        expectedRevision: number;
        queueName: string;
        profile: unknown;
        receiptModeConfirmed: boolean;
        confirmationHash: string;
    }) { const actor = this.auth.current(token, 'print.settings.manage'), { confirmationHash, ...base } = input, proposal = this.row('SELECT id FROM commands WHERE id=?', commandId) ? null : await this.prepareDevice(token, base); return this.bus.run({ id: commandId, type: 'print.device.configure', actor, payload: input }, () => { this.auth.current(token, 'print.settings.manage'); }, () => { requireCondition(proposal && proposal.confirmationHash === confirmationHash, 'CONFIRMATION_STALE', 409); const revision = (this.row('SELECT MAX(revision) revision FROM print_device_revisions WHERE branch_id=? AND id=?', actor.branchId, input.deviceId)?.revision ?? 0); requireCondition(revision === input.expectedRevision, 'REVISION_CONFLICT', 409); this.db.prepare('INSERT INTO print_device_revisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.deviceId, actor.branchId, revision + 1, proposal.physicalId, proposal.queueName, proposal.driverName, proposal.portName, canonical(proposal.profile), actor.id, this.now()); const priorDevice=revision?this.device(input.deviceId,revision):null;const updatedRoles:string[]=[];if(priorDevice?.physicalId===proposal.physicalId){for(const route of this.rows('SELECT r.* FROM print_role_routes r WHERE r.branch_id=? AND r.revision=(SELECT max(x.revision) FROM print_role_routes x WHERE x.branch_id=r.branch_id AND x.role=r.role) AND (r.device_id=? OR r.backup_id=?)',actor.branchId,input.deviceId,input.deviceId)){this.db.prepare('INSERT INTO print_role_routes VALUES(?,?,?,?,?,?,?,?,?)').run(actor.branchId,route.role,route.revision+1,route.device_id,route.device_id===input.deviceId?revision+1:route.device_revision,route.backup_id,route.backup_id===input.deviceId?revision+1:route.backup_revision,actor.id,this.now());updatedRoles.push(route.role);}}const result = { deviceId: input.deviceId, revision: revision + 1, updatedRoles }; audit(this.db, actor, 'print.device.configured', input.deviceId, commandId, this.now(), result); return result; }); }
    routes(token: string) { this.auth.current(token, 'print.settings.manage'); return this.rows('SELECT r.* FROM print_role_routes r WHERE r.branch_id=? AND r.revision=(SELECT MAX(x.revision) FROM print_role_routes x WHERE x.branch_id=r.branch_id AND x.role=r.role)', this.branch()).map(r => ({ role: r.role, revision: r.revision, deviceId: r.device_id, deviceRevision: r.device_revision, backupId: r.backup_id, backupRevision: r.backup_revision })); }
    prepareRoute(token: string, input: {
        role: string;
        expectedRevision: number;
        deviceId: string;
        backupId: string | null;
    }) { this.auth.current(token, 'print.settings.manage'); object(input, ['role', 'expectedRevision', 'deviceId', 'backupId']); requireCondition(['KITCHEN', 'CUSTOMER'].includes(input.role), 'INVALID_PRINT_ROLE'); integer(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER); const device = this.device(input.deviceId), backup = input.backupId ? this.device(input.backupId) : null, revision = this.row('SELECT MAX(revision) revision FROM print_role_routes WHERE branch_id=? AND role=?', this.branch(), input.role)?.revision ?? 0; requireCondition(revision === input.expectedRevision, 'REVISION_CONFLICT', 409); const other = this.row('SELECT d.physical_id FROM print_role_routes r JOIN print_device_revisions d ON d.branch_id=r.branch_id AND d.id=r.device_id AND d.revision=r.device_revision WHERE r.branch_id=? AND r.role<>? ORDER BY r.revision DESC LIMIT 1', this.branch(), input.role); requireCondition(!other || other.physical_id !== device.physicalId, 'PRINT_DISTINCT_DEVICES_REQUIRED'); requireCondition(!backup || backup.physicalId !== device.physicalId, 'INVALID_BACKUP_DEVICE'); const q = { ...input, deviceRevision: device.revision, backupRevision: backup?.revision ?? null }; return { ...q, confirmationHash: this.hash(token, 'print.route', q) }; }
    async saveRoute(token: string, commandId: string, input: {
        role: string;
        expectedRevision: number;
        deviceId: string;
        backupId: string | null;
        confirmationHash: string;
    }) { const actor = this.auth.current(token, 'print.settings.manage'); const { confirmationHash, ...base } = input; return this.bus.run({ id: commandId, type: 'print.route.configure', actor, payload: input }, () => { this.auth.current(token, 'print.settings.manage'); }, () => { const q = this.prepareRoute(token, base); requireCondition(q.confirmationHash === confirmationHash, 'CONFIRMATION_STALE', 409); this.db.prepare('INSERT INTO print_role_routes VALUES(?,?,?,?,?,?,?,?,?)').run(actor.branchId, q.role, q.expectedRevision + 1, q.deviceId, q.deviceRevision, q.backupId, q.backupRevision, actor.id, this.now()); const result = { role: q.role, revision: q.expectedRevision + 1 }; audit(this.db, actor, 'print.route.configured', null, commandId, this.now(), result); return result; }); }
    private source(dispatchId: string): Row { const d = this.row('SELECT d.*,j.type,j.purpose,j.payload,j.order_id,o.shift_id,s.status shift_status FROM print_dispatches d JOIN print_jobs j ON j.id=d.job_id AND j.branch_id=d.branch_id JOIN orders o ON o.id=j.order_id AND o.branch_id=j.branch_id JOIN shifts s ON s.id=o.shift_id AND s.branch_id=o.branch_id WHERE d.branch_id=? AND d.id=?', this.branch(), dispatchId); requireCondition(d, 'PRINT_JOB_NOT_FOUND', 404); return { ...d, kind: 'JOB' }; }
    private isLate(d: Row) { return d.kind === 'JOB' && d.role === 'KITCHEN' && d.shift_status === 'CLOSED' && !d.late_approved; }
    private payloadAccess(token: string, d: Row) { const p = this.auth.current(token); if (['OWNER', 'MANAGER'].includes(p.role) && hasPermission(this.db, p.employee, 'payment.refund.history'))
        return; this.finance.readAccess(token, this.finance.row(d.order_id)); }
    private dependencyState(d: Row) { if (d.kind !== 'JOB')
        return { blocked: false, manual: false }; const predecessors = this.rows('SELECT p.predecessor_id FROM print_job_dependencies p WHERE p.branch_id=? AND p.successor_id=?', this.branch(), d.job_id); let manual = false; for (const p of predecessors) {
        const latest = this.row('SELECT state FROM print_dispatches WHERE branch_id=? AND job_id=? ORDER BY generation DESC LIMIT 1', this.branch(), p.predecessor_id);
        if (!latest || !['SENT', 'MANUAL_HANDOFF', 'RESOLVED_NO_PRINT'].includes(latest.state))
            return { blocked: true, manual };
        if (latest.state === 'MANUAL_HANDOFF' || latest.state === 'RESOLVED_NO_PRINT')
            manual = true;
    } return { blocked: manual && !d.late_approved, manual }; }
    statusForOrder(token: string, orderId: string) { this.finance.readAccess(token, this.finance.row(orderId)); return this.rows('SELECT d.id,d.job_id jobId,d.state,d.role,d.revision FROM print_dispatches d JOIN print_jobs j ON j.id=d.job_id AND j.branch_id=d.branch_id WHERE d.branch_id=? AND j.order_id=? AND d.generation=(SELECT MAX(x.generation) FROM print_dispatches x WHERE x.branch_id=d.branch_id AND x.job_id=d.job_id) ORDER BY d.rowid', this.branch(), orderId); }
    queue(token: string, input: {
        after?: number;
        limit?: number;
        state?: string;
        role?: string;
    } = {}) { this.auth.current(token, 'print.queue.view'); const after = input.after ?? 0, limit = input.limit ?? 20; integer(after, 0, Number.MAX_SAFE_INTEGER); integer(limit, 1, 100); requireCondition(!input.role || ['KITCHEN', 'CUSTOMER'].includes(input.role), 'INVALID_QUERY'); requireCondition(!input.state || /^[A-Z_]{1,30}$/.test(input.state), 'INVALID_QUERY'); const rows = this.rows('SELECT rowid cursor,* FROM print_dispatches d WHERE branch_id=? AND rowid>? AND generation=(SELECT MAX(x.generation) FROM print_dispatches x WHERE x.branch_id=d.branch_id AND x.job_id=d.job_id) AND (?=\'\' OR state=?) AND (?=\'\' OR role=?) ORDER BY rowid LIMIT ?', this.branch(), after, input.state ?? '', input.state ?? '', input.role ?? '', input.role ?? '', limit); return { jobs: rows.map(d => { const source = this.source(d.id); let header: unknown = null; try {
            this.payloadAccess(token, source);
            const p = JSON.parse(source.payload);
            header = { orderNumber: p.orderNumber ?? p.counterNumber ?? null, tableName: p.tableName ?? null, counterNumber: p.counterNumber ?? null, type: p.type };
        }
        catch { } return { id: d.id, jobId: d.job_id, role: d.role, state: d.state, revision: d.revision, createdAt: d.created_at, header, ...this.dependencyState(source), late: this.isLate(source) }; }), next: rows.length === limit ? rows[rows.length - 1].cursor : null }; }
    details(token: string, dispatchId: string) { this.auth.current(token, 'print.queue.view'); const d = this.source(dispatchId); this.payloadAccess(token, d); return { id: d.id, jobId: d.job_id, role: d.role, state: d.state, revision: d.revision, attemptCount: d.attempt_count, createdAt: d.created_at, payload: JSON.parse(d.payload), deviceId: d.device_id, deviceRevision: d.device_revision, repeat: !!d.is_repeat, late: this.isLate(d), ...this.dependencyState(d), events: this.rows('SELECT revision,state,details,actor_id actorId,created_at createdAt FROM print_delivery_events WHERE branch_id=? AND dispatch_id=? ORDER BY revision', this.branch(), d.id).map(e => ({ ...e, details: JSON.parse(e.details) })) }; }
    private transition(d: Row, state: string, details: unknown = {}, actorId: string | null = null, commandId: string | null = null, patch: Row = {}): Row { const table = d.kind === 'TEST' ? 'print_diagnostics' : 'print_dispatches', allowed = ['active_attempt', 'attempt_count', 'next_attempt_at', 'late_approved']; requireCondition(Object.keys(patch).every(k => allowed.includes(k)), 'INVALID_PRINT_PATCH', 500); const fields = Object.keys(patch); const changed = this.db.prepare(`UPDATE ${table} SET state=?,revision=revision+1${fields.map(k => ',' + k + '=?').join('')} WHERE branch_id=? AND id=? AND revision=?`).run(state, ...fields.map(k => patch[k]), this.branch(), d.id, d.revision); requireCondition(changed.changes === 1, 'PRINT_ACTION_CONFLICT', 409); this.db.prepare('INSERT INTO print_delivery_events(id,branch_id,dispatch_id,diagnostic_id,revision,attempt_id,state,details,actor_id,created_at,command_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), this.branch(), d.kind === 'TEST' ? null : d.id, d.kind === 'TEST' ? d.id : null, d.revision + 1, patch.active_attempt ?? d.active_attempt ?? null, state, canonical(details), actorId, this.now(), commandId); outbox(this.db, this.branch(), 'print.delivery.changed', { dispatchId: d.id, state, revision: d.revision + 1 }, this.now()); return { ...d, ...patch, state, revision: d.revision + 1 }; }
    prepareAction(token: string, dispatchId: string, input: ActionInput) {
        const permission = permissions[input.action];
        requireCondition(permission, 'PRINT_ACTION_DENIED', 403);
        this.auth.current(token, permission);
        object(input, ['action', 'reason', 'expectedRevision', 'targetDeviceId', 'riskConfirmed', 'confirmationHash']);
        const d = this.source(dispatchId);
        this.payloadAccess(token, d);
        integer(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER);
        requireCondition(d.revision === input.expectedRevision && !d.active_attempt, 'PRINT_ACTION_CONFLICT', 409);
        const latest = this.row('SELECT id FROM print_dispatches WHERE branch_id=? AND job_id=? ORDER BY generation DESC LIMIT 1', this.branch(), d.job_id);
        requireCondition(latest?.id === d.id, 'PRINT_ACTION_CONFLICT', 409);
        const reason = reasonText(input.reason), risky = ['REPRINT', 'REDIRECT', 'MANUAL_HANDOFF', 'RESOLVE_NO_PRINT', 'RELEASE_LATE'].includes(input.action);
        if (risky)
            requireCondition(input.riskConfirmed === true, 'PRINT_RISK_CONFIRMATION_REQUIRED');
        requireCondition(!['CLAIMED', 'IN_PROGRESS'].includes(d.state), 'PRINT_ACTION_CONFLICT', 409);
        if (input.action === 'RETRY_SAFE')
            requireCondition(d.state === 'FAILED_SAFE' && d.attempt_count >= 5, 'PRINT_ACTION_CONFLICT', 409);
        if (input.action === 'REPRINT')
            requireCondition(['SENT', 'UNKNOWN', 'MANUAL_HANDOFF', 'RESOLVED_NO_PRINT'].includes(d.state), 'PRINT_ACTION_CONFLICT', 409);
        if (input.action === 'MANUAL_HANDOFF')
            requireCondition(d.role === 'KITCHEN' && !['SENT', 'RESOLVED_NO_PRINT', 'MANUAL_HANDOFF'].includes(d.state), 'PRINT_ACTION_CONFLICT', 409);
        if (input.action === 'RESOLVE_NO_PRINT')
            requireCondition(!['SENT', 'RESOLVED_NO_PRINT', 'MANUAL_HANDOFF'].includes(d.state), 'PRINT_ACTION_CONFLICT', 409);
        if (input.action === 'ASSIGN_ROUTE')
            requireCondition(d.state === 'UNCONFIGURED', 'PRINT_ACTION_CONFLICT', 409);
        if (input.action === 'RELEASE_LATE')
            requireCondition(['LEGACY_REVIEW', 'LATE_REVIEW', 'UNCONFIGURED', 'PENDING'].includes(d.state), 'PRINT_ACTION_CONFLICT', 409);
        let target: Row | null = null;
        if (!['MANUAL_HANDOFF', 'RESOLVE_NO_PRINT'].includes(input.action)) {
            const route = this.row('SELECT * FROM print_role_routes WHERE branch_id=? AND role=? ORDER BY revision DESC LIMIT 1', this.branch(), d.role);
            requireCondition(route, 'PRINT_UNCONFIGURED', 409);
            if (input.action === 'REDIRECT') {
                requireCondition(input.targetDeviceId && route.backup_id === input.targetDeviceId, 'PRINT_BACKUP_NOT_CONFIGURED', 409);
                target = { deviceId: route.backup_id, deviceRevision: route.backup_revision, routeRevision: route.revision };
            }
            else {
                requireCondition(input.targetDeviceId === null, 'INVALID_TARGET_DEVICE');
                target = { deviceId: d.device_id ?? route.device_id, deviceRevision: d.device_revision ?? route.device_revision, routeRevision: d.route_revision ?? route.revision };
            }
            this.device(target.deviceId, target.deviceRevision);
        }
        const q = { dispatchId, action: input.action, expectedRevision: input.expectedRevision, reason, targetDeviceId: input.targetDeviceId, riskConfirmed: input.riskConfirmed, target, late: this.isLate(d), dependency: this.dependencyState(d) };
        return { ...q, confirmationHash: this.hash(token, 'print.action', q) };
    }
    async action(token: string, commandId: string, dispatchId: string, input: ActionInput) {
        const permission = permissions[input.action];
        requireCondition(permission, 'PRINT_ACTION_DENIED', 403);
        const actor = this.auth.current(token, permission);
        return this.bus.run({ id: commandId, type: 'print.operator.action', actor, payload: { dispatchId, ...input } }, () => { this.auth.current(token, permission); this.payloadAccess(token, this.source(dispatchId)); }, () => {
            const q = this.prepareAction(token, dispatchId, input);
            requireCondition(q.confirmationHash === input.confirmationHash, 'CONFIRMATION_STALE', 409);
            let d = this.source(dispatchId), successorId: string | null = null;
            const lease = this.row('SELECT physical_id FROM print_device_leases WHERE branch_id=? AND attempt_id IN (SELECT id FROM print_attempts WHERE branch_id=? AND dispatch_id=?)', this.branch(), this.branch(), d.id);
            if (lease) {
                requireCondition(input.riskConfirmed === true, 'PRINT_UNKNOWN_REQUIRES_REVIEW', 409);
                this.db.prepare('DELETE FROM print_device_leases WHERE branch_id=? AND physical_id=?').run(this.branch(), lease.physical_id);
            }
            const previousState = d.state;
            const manual = ['MANUAL_HANDOFF', 'RESOLVE_NO_PRINT'].includes(input.action);
            d = this.transition(d, input.action === 'MANUAL_HANDOFF' ? 'MANUAL_HANDOFF' : 'RESOLVED_NO_PRINT', { action: input.action, reason: q.reason }, actor.id, commandId);
            if (!manual) {
                successorId = randomUUID();
                const repeat = ['SENT', 'UNKNOWN', 'MANUAL_HANDOFF', 'RESOLVED_NO_PRINT'].includes(previousState) || input.action === 'REPRINT' || d.is_repeat === 1;
                const approved = input.action === 'RELEASE_LATE';
                const state = q.late && !approved ? 'LATE_REVIEW' : 'PENDING';
                this.db.prepare('INSERT INTO print_dispatches(id,branch_id,job_id,generation,parent_id,role,route_revision,device_id,device_revision,state,revision,late_approved,is_repeat,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?)').run(successorId, actor.branchId, d.job_id, d.generation + 1, d.id, d.role, q.target!.routeRevision, q.target!.deviceId, q.target!.deviceRevision, state, approved ? 1 : d.late_approved, repeat ? 1 : 0, this.now());
                this.db.prepare('INSERT INTO print_delivery_events(id,branch_id,dispatch_id,revision,state,details,actor_id,created_at,command_id) VALUES(?,?,?,1,?,?,?,?,?)').run(randomUUID(), actor.branchId, successorId, state, canonical({ action: input.action, parentId: d.id, reason: q.reason }), actor.id, this.now(), commandId);
            }
            this.db.prepare('INSERT INTO print_operator_actions VALUES(?,?,?,?,?,?,?,?)').run(commandId, actor.branchId, d.id, input.action, q.reason, actor.id, this.now(), successorId);
            const result = { dispatchId: d.id, successorId, action: input.action };
            audit(this.db, actor, 'print.operator.action', d.job_id, commandId, this.now(), result);
            return result;
        });
    }
    async test(token: string, commandId: string, input: {
        deviceId: string;
        expectedDeviceRevision: number;
    }) { const actor = this.auth.current(token, 'print.settings.manage'); object(input, ['deviceId', 'expectedDeviceRevision']); return this.bus.run({ id: commandId, type: 'print.diagnostic', actor, payload: input }, () => { this.auth.current(token, 'print.settings.manage'); }, () => { const device = this.device(input.deviceId); requireCondition(device.revision === input.expectedDeviceRevision, 'REVISION_CONFLICT', 409); const id = randomUUID(); this.db.prepare("INSERT INTO print_diagnostics(id,branch_id,device_id,device_revision,state,revision,payload,actor_id,created_at) VALUES(?,?,?,?,'PENDING',1,'{}',?,?)").run(id, actor.branchId, device.id, device.revision, actor.id, this.now()); this.db.prepare("INSERT INTO print_delivery_events(id,branch_id,diagnostic_id,revision,state,details,actor_id,created_at,command_id) VALUES(?,?,?,1,'PENDING','{}',?,?,?)").run(randomUUID(), actor.branchId, id, actor.id, this.now(), commandId); audit(this.db, actor, 'print.test.requested', device.id, commandId, this.now(), { diagnosticId: id }); return { diagnosticId: id }; }); }
    redirectTargets(token: string, id: string) { this.auth.current(token, 'print.redirect'); const d = this.source(id); this.payloadAccess(token, d); const route = this.row('SELECT * FROM print_role_routes WHERE branch_id=? AND role=? ORDER BY revision DESC LIMIT 1', this.branch(), d.role); if (!route?.backup_id)
        return []; const device = this.device(route.backup_id, route.backup_revision); return [{ id: device.id, name: device.queueName }]; }
    diagnostics(token: string) { this.auth.current(token, 'print.settings.manage'); return this.rows('SELECT id,device_id deviceId,state,revision,created_at createdAt FROM print_diagnostics WHERE branch_id=? ORDER BY rowid DESC LIMIT 20', this.branch()); }
    async resolveDiagnostic(token: string, commandId: string, id: string, input: {
        expectedRevision: number;
        reason: string;
        riskConfirmed: boolean;
    }) { const actor = this.auth.current(token, 'print.settings.manage'); object(input, ['expectedRevision', 'reason', 'riskConfirmed']); return this.bus.run({ id: commandId, type: 'print.diagnostic.resolve', actor, payload: { id, ...input } }, () => { this.auth.current(token, 'print.settings.manage'); }, () => { const d = this.row('SELECT * FROM print_diagnostics WHERE branch_id=? AND id=?', actor.branchId, id); requireCondition(d && d.revision === input.expectedRevision && !d.active_attempt && ['UNKNOWN', 'FAILED_SAFE', 'PENDING'].includes(d.state), 'PRINT_ACTION_CONFLICT', 409); requireCondition(input.riskConfirmed === true, 'PRINT_RISK_CONFIRMATION_REQUIRED'); const reason = reasonText(input.reason); this.transition({ ...d, kind: 'TEST' }, 'RESOLVED_NO_PRINT', { reason, riskConfirmed: true }, actor.id, commandId); this.db.prepare('DELETE FROM print_device_leases WHERE branch_id=? AND attempt_id IN (SELECT id FROM print_attempts WHERE branch_id=? AND diagnostic_id=?)').run(actor.branchId, actor.branchId, id); audit(this.db, actor, 'print.diagnostic.resolved', id, commandId, this.now(), { reason }); return { id, state: 'RESOLVED_NO_PRINT' }; }); }
    async recover() { await this.bus.system(() => { for (const d of this.rows("SELECT * FROM print_dispatches WHERE branch_id=? AND state IN ('CLAIMED','IN_PROGRESS')", this.branch()).map(r => this.source(r.id))) {
        this.transition(d, d.state === 'CLAIMED' ? 'FAILED_SAFE' : 'UNKNOWN', { code: 'WORKER_RESTART', previousEpoch: true }, null, null, { active_attempt: null, next_attempt_at: this.now() + 1000 });
        if (d.state === 'CLAIMED')
            this.db.prepare('DELETE FROM print_device_leases WHERE branch_id=? AND attempt_id=?').run(this.branch(), d.active_attempt);
    } for (const d of this.rows("SELECT * FROM print_diagnostics WHERE branch_id=? AND state IN ('CLAIMED','IN_PROGRESS')", this.branch())) {
        this.transition({ ...d, kind: 'TEST' }, d.state === 'CLAIMED' ? 'FAILED_SAFE' : 'UNKNOWN', { code: 'WORKER_RESTART' }, null, null, { active_attempt: null, next_attempt_at: this.now() + 1000 });
        if (d.state === 'CLAIMED')
            this.db.prepare('DELETE FROM print_device_leases WHERE branch_id=? AND attempt_id=?').run(this.branch(), d.active_attempt);
    } }); }
    private async claim() { return this.bus.system(() => { const rows: Row[] = [...this.rows("SELECT rowid cursor,id FROM print_dispatches WHERE branch_id=? AND rowid>? AND (state='PENDING' OR state='FAILED_SAFE' AND attempt_count<5) AND next_attempt_at<=? ORDER BY rowid LIMIT 40", this.branch(), this.scanAfter, this.now()).map(r => ({ ...this.source(r.id), cursor: r.cursor })), ...this.rows("SELECT * FROM print_diagnostics WHERE branch_id=? AND (state='PENDING' OR state='FAILED_SAFE' AND attempt_count<5) AND next_attempt_at<=? ORDER BY rowid LIMIT 10", this.branch(), this.now()).map(d => ({ ...d, kind: 'TEST' }))]; if (!rows.some(d => d.kind === 'JOB'))
        this.scanAfter = 0; for (const d of rows) {
        if (d.kind === 'JOB')
            this.scanAfter = d.cursor;
        if (this.isLate(d)) {
            this.transition(d, 'LATE_REVIEW', { code: 'SHIFT_CLOSED' });
            continue;
        }
        if (this.dependencyState(d).blocked)
            continue;
        const device = this.device(d.device_id, d.device_revision);
        if (this.row('SELECT 1 FROM print_device_leases WHERE branch_id=? AND physical_id=?', this.branch(), device.physicalId))
            continue;
        const attemptId = randomUUID(), hash = digest(canonical({ payload: JSON.parse(d.payload), device, repeat: !!d.is_repeat }));
        this.db.prepare('INSERT INTO print_attempts VALUES(?,?,?,?,?,?,?,1)').run(attemptId, this.branch(), d.kind === 'TEST' ? null : d.id, d.kind === 'TEST' ? d.id : null, this.epoch, this.now(), hash);
        this.db.prepare('INSERT INTO print_device_leases VALUES(?,?,?,?)').run(this.branch(), device.physicalId, attemptId, this.epoch);
        const claimed = this.transition(d, 'CLAIMED', {}, null, null, { active_attempt: attemptId, attempt_count: d.attempt_count + 1 });
        return { work: claimed, device, attemptId };
    } return null; }); }
    private async run(claim: NonNullable<Awaited<ReturnType<PrintService['claim']>>>) {
        const { work, device, attemptId } = claim;
        let result: {
            state: string;
            evidence: unknown;
        } = { state: 'FAILED_SAFE', evidence: { stage: 'RENDER' } };
        try {
            const rendered = await this.renderer(work.kind === 'TEST' ? 'DIAGNOSTIC' : work.role, work.purpose ?? 'TEST', JSON.parse(work.payload), device.profile, !!work.is_repeat, this.now());
            const allowed = await this.bus.system(() => { const fresh: Row = work.kind === 'TEST' ? { ...this.row('SELECT * FROM print_diagnostics WHERE branch_id=? AND id=?', this.branch(), work.id), kind: 'TEST' } : this.source(work.id); requireCondition(fresh.active_attempt === attemptId && fresh.state === 'CLAIMED', 'PRINT_ACTION_CONFLICT', 409); if (this.isLate(fresh)) {
                this.transition(fresh, 'LATE_REVIEW', { code: 'SHIFT_CLOSED' }, null, null, { active_attempt: null });
                this.db.prepare('DELETE FROM print_device_leases WHERE branch_id=? AND attempt_id=?').run(this.branch(), attemptId);
                return false;
            } this.transition(fresh, 'IN_PROGRESS', { stage: 'SEND_STARTED', rasterHash: rendered.hash, lineCount: rendered.lineCount }); return true; });
            this.notifyStatusChanged();
            if (!allowed)
                return;
            result = await this.adapter.send(device, rendered.raw, 'BASHKAR-' + attemptId);
        }
        catch (error) {
            const fresh: Row | undefined = work.kind === 'TEST' ? this.row('SELECT state FROM print_diagnostics WHERE branch_id=? AND id=?', this.branch(), work.id) : this.source(work.id);
            result = { state: fresh?.state === 'IN_PROGRESS' ? 'UNKNOWN' : 'FAILED_SAFE', evidence: { stage: fresh?.state === 'IN_PROGRESS' ? 'AFTER_SEND_MARKER' : 'BEFORE_SEND_MARKER', code: 'PRINT_ATTEMPT_FAILED' } };
        }
        await this.bus.system(() => { const fresh: Row = work.kind === 'TEST' ? { ...this.row('SELECT * FROM print_diagnostics WHERE branch_id=? AND id=?', this.branch(), work.id), kind: 'TEST' } : this.source(work.id); requireCondition(fresh.active_attempt === attemptId, 'PRINT_ACTION_CONFLICT', 409); this.transition(fresh, result.state, result.evidence, null, null, { active_attempt: null, next_attempt_at: this.now() + [1000, 3000, 10000, 30000, 60000][Math.min(fresh.attempt_count - 1, 4)] }); if (result.state !== 'UNKNOWN')
            this.db.prepare('DELETE FROM print_device_leases WHERE branch_id=? AND attempt_id=?').run(this.branch(), attemptId); });
        this.notifyStatusChanged();
    }
    async tick() { if (this.stopping || this.ticking)
        return; this.ticking = true; try {
        while (this.running.size < 2) {
            const claim = await this.claim();
            if (!claim)
                break;
            this.notifyStatusChanged();
            const task = this.run(claim).catch(() => { });
            this.running.add(task);
            void task.finally(() => this.running.delete(task));
        }
    }
    finally {
        this.ticking = false;
    } }
    async start() { await this.recover(); this.timer = setInterval(() => { void this.tick().catch(() => { }); }, 500); this.timer.unref(); }
    async stop() { this.stopping = true; if (this.timer)
        clearInterval(this.timer); if(this.statusTimer)clearTimeout(this.statusTimer); await Promise.all([...this.running]); }
    async idle() { await this.tick(); await Promise.all([...this.running]); }
}
