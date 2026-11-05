import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { PosError, requireCondition } from './errors';

export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  throw new PosError('INVALID_PAYLOAD', 400);
}
export function assertPublicDto(value: unknown): void {
  if(Array.isArray(value)){value.forEach(assertPublicDto);return;}
  if(value && typeof value==='object')for(const [key,item] of Object.entries(value)) {
    requireCondition(!['password','oldPassword','newPassword','temporaryPassword','password_hash','passwordHash','secret_hash','token','secret','privateKey','pin','temporaryPin','pin_hash','lookup','ciphertext','pinKeys'].includes(key),'SECRET_IN_PERSISTED_DTO',500);
    assertPublicDto(item);
  }
}
export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Actor = { id: string; branchId: string };
// One instance belongs to one operational connection. Callbacks are synchronous:
// no network, hashing, printing or promises inside a SQLite transaction.
export class CommandBus {
  onCommit?: (branchId:string,type:string)=>void;
  private queued = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly db: Database.Database, private readonly now = Date.now, private readonly limit = 64, private readonly assertStorage = () => {}, private readonly assertNewCommand = () => {}) {}
  run<T>(input: { id: string; type: string; payload: unknown; actor: Actor }, authorize: () => void, apply: () => T): Promise<T> {
    try { this.assertNewCommand(); } catch (error) { return Promise.reject(error); }
    if (this.queued >= this.limit) return Promise.reject(new PosError('WRITE_QUEUE_FULL', 503));
    this.queued++;
    let applied=false;
    const job = this.tail.then(() => this.db.transaction(() => {
      return this.runInTransaction(input,authorize,apply,()=>{applied=true;});
    }).immediate());
    this.tail = job.catch(() => undefined);
    return job.then(result=>{if(applied)try{this.onCommit?.(input.actor.branchId,input.type);}catch{/* realtime never changes a committed result */}return result;}).finally(() => { this.queued--; });
  }
  // Atomic child commands use the current writer transaction and receive normal
  // receipts. No child can commit independently of its parent.
  runInTransaction<T>(input: {id:string;type:string;payload:unknown;actor:Actor},authorize:()=>void,apply:()=>T,onApplied?:()=>void):T {
    requireCondition(this.db.inTransaction,'TRANSACTION_REQUIRED',500);
    this.assertStorage();
    authorize(); // Recheck current access even on replay, inside the writer.
    requireCondition(uuidPattern.test(input.id), 'INVALID_COMMAND_ID');
    const fingerprint = digest(canonical({ api: 1, type: input.type, actorId: input.actor.id, payload: input.payload }));
    const existing = this.db.prepare('SELECT actor_id,fingerprint,result FROM commands WHERE branch_id=? AND id=?').get(input.actor.branchId, input.id) as { actor_id: string; fingerprint: string; result: string } | undefined;
    if (existing) {
      requireCondition(existing.actor_id === input.actor.id && existing.fingerprint === fingerprint, 'COMMAND_ID_CONFLICT', 409);
      return JSON.parse(existing.result) as T;
    }
    const result = apply();
    requireCondition(!(result instanceof Promise), 'ASYNC_TRANSACTION_FORBIDDEN', 500);
    this.assertStorage();
    assertPublicDto(result);
    const serialized = canonical(result); // Explicit DTOs only: never credential/token responses.
    this.db.prepare('INSERT INTO commands VALUES(?,?,?,?,?,?)').run(input.actor.branchId, input.id, input.actor.id, fingerprint, serialized, this.now());
    onApplied?.();
    return JSON.parse(serialized) as T;
  }
  // Background jobs share the exact bounded writer queue but have no fictitious
  // employee identity or financial command receipt. Domain events supply dedup.
  system<T>(apply:()=>T):Promise<T>{
    if(this.queued>=this.limit)return Promise.reject(new PosError('WRITE_QUEUE_FULL',503));
    this.queued++;
    const job=this.tail.then(()=>this.db.transaction(()=>{this.assertStorage();const result=apply();requireCondition(!(result instanceof Promise),'ASYNC_TRANSACTION_FORBIDDEN',500);this.assertStorage();return result;}).immediate());
    this.tail=job.catch(()=>undefined);return job.finally(()=>{this.queued--;});
  }
  async drain() { await this.tail; }
}
export function audit(db: Database.Database, actor: Actor | {id:null;branchId:string} | null, action: string, targetId: string | null, commandId: string | null, now: number, details: unknown = {}, result = 'SUCCESS') {
  assertPublicDto(details);
  db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), actor?.branchId ?? null, actor?.id ?? null, action, targetId, result, commandId, now, canonical(details));
}
export function outbox(db: Database.Database, branchId: string, type: string, payload: unknown, now: number) {
  assertPublicDto(payload);
  db.prepare('INSERT INTO outbox VALUES(?,?,?,?,?,NULL)').run(randomUUID(), branchId, type, canonical(payload), now);
}
