import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { OperationalServices } from './api';
import { requireCondition } from './errors';
import { object } from './modules/menu/catalog';
export function registerServiceClientApi(app: FastifyInstance, services: () => OperationalServices, token: (r: FastifyRequest) => string) {
    const prints = () => { const p = services().printing; requireCondition(p, 'PRINT_UNAVAILABLE', 503); return p; };
    const network = () => { const n = services().waiterNetwork; requireCondition(n, 'WEB_UNAVAILABLE', 503); return n; };
    const id = (r: FastifyRequest) => (r.params as {
        id: string;
    }).id;
    const mutation = (r: FastifyRequest, keys: string[]) => { const { commandId, ...b } = object(r.body, ['commandId', ...keys]); requireCondition(typeof commandId === 'string', 'INVALID_COMMAND_ID'); return { commandId, b }; };
    app.get('/api/v1/printing/inventory', r => prints().inventory(token(r)));
    app.get('/api/v1/printing/devices', r => prints().devices(token(r)));
    app.post('/api/v1/printing/kitchen-preview', r => prints().kitchenPreview(token(r), r.body));
    app.post('/api/v1/printing/devices/prepare', r => prints().prepareDevice(token(r), r.body as never));
    app.post('/api/v1/printing/devices/commit', r => { const x = mutation(r, ['deviceId', 'expectedRevision', 'queueName', 'profile', 'receiptModeConfirmed', 'confirmationHash']); return prints().saveDevice(token(r), x.commandId, x.b as never); });
    app.get('/api/v1/printing/routes', r => prints().routes(token(r)));
    app.post('/api/v1/printing/routes/prepare', r => prints().prepareRoute(token(r), r.body as never));
    app.post('/api/v1/printing/routes/commit', r => { const x = mutation(r, ['role', 'expectedRevision', 'deviceId', 'backupId', 'confirmationHash']); return prints().saveRoute(token(r), x.commandId, x.b as never); });
    app.get('/api/v1/printing/queue', r => { const q = object({ ...r.query as object }, ['after', 'limit', 'state', 'role']); return prints().queue(token(r), { ...q, after: q.after === undefined ? undefined : Number(q.after), limit: q.limit === undefined ? undefined : Number(q.limit) } as never); });
    app.get('/api/v1/printing/jobs/:id/targets', r => prints().redirectTargets(token(r), id(r)));
    app.get('/api/v1/printing/jobs/:id', r => prints().details(token(r), id(r)));
    app.post('/api/v1/printing/jobs/:id/prepare', r => prints().prepareAction(token(r), id(r), r.body as never));
    app.post('/api/v1/printing/jobs/:id/commit', r => { const x = mutation(r, ['action', 'reason', 'expectedRevision', 'targetDeviceId', 'riskConfirmed', 'confirmationHash']); return prints().action(token(r), x.commandId, id(r), x.b as never); });
    app.get('/api/v1/printing/diagnostics', r => prints().diagnostics(token(r)));
    app.post('/api/v1/printing/diagnostics', r => { const x = mutation(r, ['deviceId', 'expectedDeviceRevision']); return prints().test(token(r), x.commandId, x.b as never); });
    app.post('/api/v1/printing/diagnostics/:id/resolve', r => { const x = mutation(r, ['expectedRevision', 'reason', 'riskConfirmed']); return prints().resolveDiagnostic(token(r), x.commandId, id(r), x.b as never); });
    app.get('/api/v1/waiter/network-status', r => network().status(token(r)));
    app.post('/api/v1/waiter/network/http', r => network().configureHttp(token(r), r.body as {ip:string;port:number}));
    app.post('/api/v1/waiter/network/prepare', r => network().prepare(token(r), r.body as never));
    app.post('/api/v1/waiter/network/commit', r => { const x = mutation(r, ['stagingId', 'expectedRevision', 'confirmationHash']); return network().commit(token(r), x.commandId, x.b as never); });
}
