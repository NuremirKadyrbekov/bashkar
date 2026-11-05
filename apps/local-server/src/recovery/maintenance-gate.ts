import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PosError } from '../errors';

// One gate is shared by the Desktop and Waiter HTTP listeners. The future
// Update Manager may request maintenance only through an authenticated channel.
export class MaintenanceGate {
  private state: 'ACTIVE' | 'PENDING' | 'READY' | 'QUARANTINE' = 'ACTIVE';
  private active = 0;
  private waiters: Array<() => void> = [];

  get isPending() { return this.state !== 'ACTIVE'; }
  get activeRequests() { return this.active; }

  assertWritable() {
    if (this.state !== 'ACTIVE') throw new PosError('MAINTENANCE_PENDING', 423);
  }

  enterRecoveryQuarantine() {
    if (this.state !== 'ACTIVE') throw new Error('MAINTENANCE_RESTART_REQUIRED');
    this.state = 'QUARANTINE';
  }

  begin() {
    if (this.state !== 'ACTIVE') throw new PosError('MAINTENANCE_PENDING', 423);
    this.state = 'PENDING';
    return this.waitForIdle();
  }

  ready() {
    if (this.state !== 'PENDING') throw new Error('MAINTENANCE_NOT_PENDING');
    if (this.active === 0) { this.state = 'READY'; return Promise.resolve(); }
    return new Promise<void>(resolve => this.waiters.push(() => { this.state = 'READY'; resolve(); }));
  }

  cancel() {
    if (this.state === 'READY') throw new Error('MAINTENANCE_RESTART_REQUIRED');
    this.state = 'ACTIVE';
  }

  waitForIdle(): Promise<void> {
    if (this.active === 0) return Promise.resolve();
    return new Promise(resolve => this.waiters.push(resolve));
  }

  install(app: FastifyInstance) {
    const releases = new WeakMap<FastifyRequest, () => void>();
    const release = (request: FastifyRequest) => {
      const done = releases.get(request);
      if (!done) return;
      releases.delete(request);
      done();
    };
    app.addHook('onRequest', async request => {
      if (this.state === 'QUARANTINE' && request.method === 'GET' &&
          ['/api/v1/system/health/live', '/api/v1/system/health/ready', '/api/v1/system/version'].includes(request.url)) return;
      if (this.state !== 'ACTIVE') throw new PosError('MAINTENANCE_PENDING', 423);
      this.active++;
      releases.set(request, () => {
        this.active--;
        if (this.active === 0) for (const resolve of this.waiters.splice(0)) resolve();
      });
    });
    app.addHook('onResponse', async request => release(request));
    app.addHook('onRequestAbort', async request => release(request));
  }
}
