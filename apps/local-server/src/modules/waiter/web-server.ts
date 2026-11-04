import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { PosError, requireCondition } from '../../errors';
import { object } from '../menu/catalog';
import type { OperationalServices } from '../../api';
import { WaiterService } from './waiter-service';
import { FulfillmentService } from '../orders/fulfillment-service';
import type { NetworkService } from './network-service';
export const waiterCookie = '__Host-bashkar-waiter';
export const httpWaiterCookie = 'bashkar-waiter-http';
const mutating: Record<string, {
    keys: string[];
    run: (s: OperationalServices, t: string, id: string, b: any, target: string) => unknown;
}> = {
    'tables/open': { keys: ['tableId', 'responsibleWaiterId'], run: (s, t, id, b) => s.tables.open(t, id, b) },
    'tables/close-empty': { keys: ['sessionId', 'revision'], run: (s, t, id, b) => s.tables.closeEmpty(t, id, b) },
    'tables/move': { keys: ['sessionId', 'tableId', 'revision'], run: (s, t, id, b) => s.tables.move(t, id, b) },
    'tables/responsible': { keys: ['sessionId', 'responsibleWaiterId', 'revision'], run: (s, t, id, b) => s.tables.responsible(t, id, b) },
    'batch.submit': { keys: ['draftId', 'draftRevision', 'menuRevision', 'lines', 'discount', 'orderRevision', 'confirmationHash'], run: (s, t, id, b, target) => s.orders.submit(t, id, target, b) },
    'order.discount': { keys: ['expectedRevision', 'amount'], run: (s, t, id, b, target) => s.orders.discount(t, id, target, b) },
    'order.correct': { keys: ['action', 'targets', 'reason', 'comment', 'replacement', 'expectedOrderRevision', 'expectedVisitRevision', 'shiftId', 'confirmationHash'], run: (s, t, id, b, target) => s.finance.correct(t, target, b, id) },
    'order.fulfillment.mark': { keys: ['itemId', 'issuedQuantity', 'expectedRevision', 'expectedOrderRevision'], run: (s, t, id, b, target) => { requireCondition(s.finance.row(target).type === 'TABLE', 'ROLE_FORBIDDEN', 403); return new FulfillmentService(s.finance).mark(t, target, b, id); } },
    'order.settle': { keys: ['payment', 'expectedOrderRevision', 'expectedVisitRevision', 'shiftId', 'confirmationHash'], run: (s, t, id, b, target) => { requireCondition(s.finance.row(target).type === 'TABLE', 'ROLE_FORBIDDEN', 403); return s.finance.settle(t, target, b, id); } },
    'payment.incident': { keys: ['orderId', 'draftId', 'sourceCommandId', 'receipts', 'reason'], run: (s, t, id, b) => { requireCondition(b.orderId && b.draftId === null && s.finance.row(b.orderId).type === 'TABLE', 'ROLE_FORBIDDEN', 403); return s.finance.incident(t, b, id); } }
};
export async function createWaiterServer(s: OperationalServices, waiter: WaiterService, network: NetworkService, options: {
    listen?: boolean;
    assets?: string;
    printStatus?: (token: string, orderId: string) => unknown;
} = {}) {
    const http = network.http, tls = http ? undefined : network.tls(), endpoint = http ?? tls!, secure = !http, cookieName = secure ? waiterCookie : httpWaiterCookie;
    const origin = `${secure ? 'https' : 'http'}://${endpoint.ip}:${endpoint.port}`;
    const app = Fastify({ ...(tls ? { https: { key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' as const } } : {}), bodyLimit: 2 * 1024 * 1024, logger: false, trustProxy: false });
    const eventClients = new Set<{socket:Socket;cookie:string;ticket:string;branchId:string}>();
    const eventFrame = (value:string) => { const data=Buffer.from(value); const header=data.length<126?Buffer.from([0x81,data.length]):Buffer.from([0x81,126,data.length>>8,data.length&255]);return Buffer.concat([header,data]); };
    const rejectEvent = (socket:Socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    const eventUpgrade = (request:IncomingMessage,socket:Socket) => {
        const protocols=(request.headers['sec-websocket-protocol']??'').split(',').map(value=>value.trim());
        const ticket=protocols.find(value=>value.startsWith('ticket.'))?.slice(7),key=request.headers['sec-websocket-key'];
        const raw=request.headers.cookie??'', values=raw.split(';').map(value=>value.trim()).filter(value=>value.startsWith(cookieName+'='));
        if(request.url!=='/waiter/api/v1/events'||request.headers.host!==`${endpoint.ip}:${endpoint.port}`||request.headers.origin!==origin||request.headers.upgrade?.toLowerCase()!=='websocket'||request.headers['sec-websocket-version']!=='13'||!protocols.includes('bashkar.waiter.events')||!ticket||!/^[A-Za-z0-9_-]{20,256}$/.test(ticket)||typeof key!=='string'||Buffer.from(key,'base64').length!==16||values.length!==1){rejectEvent(socket);return;}
        const token=values[0].slice(cookieName.length+1);let branchId:string;
        try{branchId=waiter.authorize(token,undefined,ticket).branchId;}catch{rejectEvent(socket);return;}
        const accept=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\nSec-WebSocket-Protocol: bashkar.waiter.events\r\n\r\n');
        const client={socket,cookie:token,ticket,branchId};eventClients.add(client);socket.setTimeout(0);socket.on('close',()=>eventClients.delete(client));socket.on('error',()=>eventClients.delete(client));socket.on('data',data=>{if((data[0]&15)===8)socket.end();});
    };
    app.server.on('upgrade',eventUpgrade);
    app.server.on('bashkar:changed',((branchId:string)=>{for(const client of eventClients){if(client.branchId!==branchId)continue;try{waiter.authorize(client.cookie,undefined,client.ticket);client.socket.write(eventFrame(JSON.stringify({type:'changed'})));}catch{client.socket.destroy();eventClients.delete(client);}}}) as (...args:unknown[])=>void);
    app.addHook('onClose',async()=>{app.server.off('upgrade',eventUpgrade);for(const client of eventClients)client.socket.destroy();eventClients.clear();});
    const cookie = (r: FastifyRequest) => { const raw = r.headers.cookie ?? '', values = raw.split(';').map(s => s.trim()).filter(s => s.startsWith(cookieName + '=')); requireCondition(values.length <= 1, 'SESSION_INVALID', 401); return values[0]?.slice(cookieName.length + 1) ?? ''; };
    const cookieFlags = `${secure ? 'Secure; ' : ''}HttpOnly; SameSite=Strict; Path=/`;
    const assets = options.assets ?? resolve('apps/waiter-web');
    app.addHook('onRequest', async (r, reply) => {
        reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Content-Security-Policy', "default-src 'self';script-src 'self';style-src 'self';connect-src 'self';img-src 'self' data:;object-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'");
        requireCondition(r.headers.host === `${endpoint.ip}:${endpoint.port}`, 'WEB_HOST_DENIED', 403);
        requireCondition(!r.headers.authorization, 'CLIENT_AUDIENCE_DENIED', 403);
        if (r.headers.origin !== undefined)
            requireCondition(r.headers.origin === origin, 'WEB_ORIGIN_DENIED', 403);
        requireCondition(!r.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(String(r.headers['sec-fetch-site'])), 'WEB_ORIGIN_DENIED', 403);
        if (!['GET', 'HEAD'].includes(r.method)) {
            requireCondition(r.headers.origin === origin, 'WEB_ORIGIN_DENIED', 403);
            requireCondition(r.headers['content-type']?.split(';')[0] === 'application/json', 'JSON_REQUIRED', 415);
            requireCondition(r.headers['x-bashkar-client'] === 'waiter', 'WEB_ORIGIN_DENIED', 403);
        }
    });
    app.setErrorHandler((e, _r, reply) => { const error = e as PosError & {
        retryAfterSeconds?: number;
    }; if (error.retryAfterSeconds)
        reply.header('Retry-After', error.retryAfterSeconds); reply.code(error instanceof PosError ? error.status : 400).send({ error: { code: error instanceof PosError ? error.code : 'WEB_REQUEST_FAILED', ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) } }); });
    const base = '/waiter/api/v1', body = (r: FastifyRequest, keys: string[]) => object(r.body, keys), param = (r: FastifyRequest) => (r.params as {
        id: string;
    }).id;
    const auth = (r: FastifyRequest) => { const t = cookie(r); waiter.authorize(t, r.headers['x-csrf-token'], r.headers['x-waiter-unlock'], !['GET', 'HEAD'].includes(r.method)); return t; };
    const n = (v: unknown, fallback: number) => { if (v === undefined)
        return fallback; requireCondition(typeof v === 'string' && /^\d+$/.test(v) && Number.isSafeInteger(Number(v)), 'INVALID_QUERY'); return Number(v); };
    app.get(base + '/bootstrap', async () => waiter.bootstrap());
    for (const unlock of [false, true])
        app.post(base + '/session/' + (unlock ? 'unlock' : 'pin'), async (r, reply) => { const b = body(r, ['pin', 'deviceId']); const result = await waiter.login(b.pin, b.deviceId, r.ip, cookie(r) || undefined, unlock); reply.header('Set-Cookie', `${cookieName}=${result.cookie}; ${cookieFlags}`); return result.body; });
    app.get(base + '/session/me', async (r) => waiter.me(cookie(r), r.headers['x-csrf-token'], r.headers['x-waiter-unlock']));
    app.post(base + '/session/logout', async (r, reply) => { body(r, []); const t = auth(r), result = waiter.logout(t); reply.header('Set-Cookie', `${cookieName}=; ${cookieFlags}; Max-Age=0`); return result; });
    app.post(base + '/session/activity', async (r) => { body(r, []); s.auth.activity(auth(r)); return { active: true }; });
    app.get(base + '/menu', async (r) => { const t = auth(r); return { ...s.menu.active(t), availability: s.menu.availability() }; });
    app.get(base + '/tables', async (r) => s.tables.list(auth(r)));
    app.get(base + '/tables/waiters', async (r) => s.tables.waiters(auth(r)));
    for (const [suffix, run] of Object.entries({ details: (t: string, id: string) => s.tables.details(t, id), order: (t: string, id: string) => s.orders.get(t, id), 'draft-context': (t: string, id: string) => s.orders.context(t, id) }))
        app.get(base + '/visits/:id/' + suffix, async (r) => run(auth(r), param(r)));
    app.get(base + '/visits/:id/batches', async (r) => { const q = object({ ...r.query as object }, ['after', 'limit']); return s.orders.history(auth(r), param(r), n(q.after, 0), n(q.limit, 20)); });
    app.get(base + '/orders/:id', async (r) => { const t = auth(r), row = s.finance.row(param(r)); requireCondition(row.type === 'TABLE', 'ROLE_FORBIDDEN', 403); return s.finance.get(t, row.id); });
    app.get(base + '/orders/:id/print-status', async (r) => { const t = auth(r), row = s.finance.row(param(r)); requireCondition(row.type === 'TABLE', 'ROLE_FORBIDDEN', 403); s.finance.readAccess(t, row); return options.printStatus?.(t, row.id) ?? []; });
    app.get(base + '/orders/:id/fulfillment', async (r) => { const t = auth(r), row = s.finance.row(param(r)), q = object({ ...r.query as object }, ['after', 'limit']); requireCondition(row.type === 'TABLE', 'ROLE_FORBIDDEN', 403); return new FulfillmentService(s.finance).history(t, row.id, n(q.after, 0), n(q.limit, 100)); });
    app.post(base + '/visits/:id/batches/prepare', async (r) => s.orders.prepare(auth(r), param(r), body(r, ['draftId', 'draftRevision', 'menuRevision', 'lines', 'discount']) as never));
    app.post(base + '/orders/:id/corrections/prepare', async (r) => { const t = auth(r), b = body(r, ['action', 'targets', 'reason', 'comment', 'replacement']); requireCondition(s.finance.row(param(r)).type === 'TABLE', 'ROLE_FORBIDDEN', 403); return s.finance.prepareCorrection(t, param(r), b as never); });
    app.post(base + '/orders/:id/settlements/prepare', async (r) => { const t = auth(r); requireCondition(s.finance.row(param(r)).type === 'TABLE', 'ROLE_FORBIDDEN', 403); return s.finance.prepareSettlement(t, param(r), body(r, ['payment']) as never); });
    const execute = async (r: FastifyRequest, operation: string, target: string, envelope?: any) => { const t = auth(r), op = mutating[operation]; requireCondition(op, 'WEB_OPERATION_DENIED', 403); const b = object(envelope ?? r.body, ['commandId', ...op.keys]); const { commandId, ...payload } = b; requireCondition(typeof commandId === 'string', 'INVALID_COMMAND_ID'); return op.run(s, t, commandId, payload, target); };
    for (const [path, operation] of Object.entries({ 'tables/open': 'tables/open', 'tables/close-empty': 'tables/close-empty', 'tables/move': 'tables/move', 'tables/responsible': 'tables/responsible', 'visits/:id/batches/submit': 'batch.submit', 'orders/:id/discount': 'order.discount', 'orders/:id/corrections/commit': 'order.correct', 'orders/:id/fulfillment/mark': 'order.fulfillment.mark', 'orders/:id/settlements/commit': 'order.settle', 'payment-incidents': 'payment.incident' }))
        app.post(base + '/' + path, async (r) => { const target = param(r) ?? ''; if (target && operation !== 'batch.submit')
            requireCondition(s.finance.row(target).type === 'TABLE', 'ROLE_FORBIDDEN', 403); return execute(r, operation, target); });
    app.post(base + '/commands/receipt', async (r) => { const t = auth(r), b = body(r, ['operation', 'targetId', 'envelope']); requireCondition(typeof b.operation === 'string' && mutating[b.operation] && typeof b.targetId === 'string', 'WEB_OPERATION_DENIED', 403); const envelope = b.envelope as any; requireCondition(envelope && typeof envelope.commandId === 'string', 'INVALID_COMMAND_ID'); if (!waiter.recorded(t, envelope.commandId))
        return { state: 'NOT_RECORDED' }; return { state: 'COMMITTED', receipt: await execute(r, b.operation, b.targetId, envelope) }; });
    for (const [name, type] of Object.entries({ 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'draft-store.js': 'text/javascript; charset=utf-8', 'forge.min.js': 'text/javascript; charset=utf-8', 'style.css': 'text/css; charset=utf-8', 'sw.js': 'text/javascript; charset=utf-8', 'bg.jpeg': 'image/jpeg' }))
        app.get('/waiter/' + (name === 'index.html' ? '' : name), async (_r, reply) => { if (name === 'sw.js')
            reply.header('Service-Worker-Allowed', '/waiter/'); return reply.type(type).send(readFileSync(name === 'forge.min.js' ? require.resolve('node-forge/dist/forge.min.js') : resolve(assets, name))); });
    if (options.listen !== false)
        await app.listen({ host: endpoint.ip, port: endpoint.port });
    return app;
}
