import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InstanceLock, LOCK_DATABASE, LEGACY_LOCK } from './instance-lock';

export type State = 'NEEDS_ACTIVATION' | 'BLOCKED' | 'READ_ONLY';
import { migrations, validateMigrations, applyPending, latestSchema, validatePhysicalSchema } from './migrations';

export class Storage {
  private db?: Database.Database;
  private instanceLock?: InstanceLock;
  private identities?: {marker:string;database:string};
  private identity(path:string) { const stat=lstatSync(path); if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1) throw new Error('STORAGE_FILE_INVALID'); return `${stat.dev}:${stat.ino}`; }
  assertIdentity() {
    this.instanceLock?.assertOwned();
    if(!this.identities || this.identity(this.marker)!==this.identities.marker || this.identity(this.database)!==this.identities.database) throw new Error('STORAGE_IDENTITY_CHANGED');
  }
  private readonly marker: string;
  private readonly database: string;
  constructor(private readonly dir: string) {
    this.marker = join(dir, 'installation.json'); this.database = join(dir, 'pos.sqlite');
  }
  private acquire() {
    const lock = new InstanceLock(this.dir);
    lock.acquire();
    this.instanceLock = lock;
  }
  initialize() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.acquire();
    try {
      if (readdirSync(this.dir).some(name => name !== LEGACY_LOCK && name !== LOCK_DATABASE && name !== `${LOCK_DATABASE}-journal`)) throw new Error('INITIALIZATION_DIRECTORY_NOT_EMPTY');
      const id = randomUUID();
      const markerFd = openSync(this.marker, 'wx', 0o600);
      try { writeFileSync(markerFd, JSON.stringify({ format: 1, id })); fsyncSync(markerFd); } finally { closeSync(markerFd); }
      closeSync(openSync(this.database, 'wx', 0o600));
      this.db = new Database(this.database, { fileMustExist: true });
      this.configure();
      this.db.transaction(() => {
        this.db!.exec(migrations[0].sql);
        this.db!.prepare('INSERT INTO bootstrap_instance VALUES (?, ?)').run(id, 'UNACTIVATED');
        this.db!.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(1, migrations[0].checksum);
      })();
      applyPending(this.db);
    } finally { this.close(); }
  }
  open(): { state: State; reason: string; schemaVersion: number | null } {
    if (!existsSync(this.dir)) return { state: 'BLOCKED', reason: 'INSTALLATION_NOT_INITIALIZED', schemaVersion: null };
    this.acquire();
    if (!existsSync(this.marker) || !existsSync(this.database)) return { state: 'BLOCKED', reason: 'INSTALLATION_OR_DATABASE_MISSING', schemaVersion: null };
    try {
      const marker: unknown = JSON.parse(readFileSync(this.marker, 'utf8'));
      if (!marker || typeof marker !== 'object' || !('id' in marker) || !('format' in marker) || marker.format !== 1 || typeof marker.id !== 'string') throw new Error('INVALID_MARKER');
      for (const path of [this.marker, this.database]) { const st = lstatSync(path); if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw new Error('STORAGE_FILE_INVALID'); }
      this.db = new Database(this.database, { fileMustExist: true });
      this.configure();
      if (this.db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('INTEGRITY_CHECK_FAILED');
      this.identities={marker:this.identity(this.marker),database:this.identity(this.database)};
      const version = validateMigrations(this.db);
      validatePhysicalSchema(this.db,version);
      if ((this.db.pragma('foreign_key_check') as unknown[]).length !== 0) throw new Error('FOREIGN_KEY_CHECK_FAILED');
      const instances = this.db.prepare('SELECT id, activation_state FROM bootstrap_instance').all() as { id: string; activation_state: string }[];
      if (instances.length !== 1 || instances[0].id !== marker.id || instances[0].activation_state !== 'UNACTIVATED') throw new Error('INSTANCE_MISMATCH');
      // Confirm that SQLite can acquire and durably commit a write transaction, without business data.
      this.db.transaction(() => { if(version===latestSchema && this.db!.prepare('UPDATE storage_probe SET value=? WHERE singleton=1').run(randomUUID()).changes!==1) throw new Error('WRITE_PROBE_MISSING'); })();
      if (version < latestSchema) return { state: 'BLOCKED', reason: 'SCHEMA_UPGRADE_REQUIRED', schemaVersion: version };
      // Activation is still unavailable in the shipped runtime until D10 cloud
      // registration and protected Windows credentials are commissioned.
      return { state: 'NEEDS_ACTIVATION', reason: 'ACTIVATION_REQUIRED', schemaVersion: version };
    } catch (error) {
      this.db?.close(); this.db = undefined;
      const e=error as {code?:string;message?:string};
      const reason=e.code && /^SQLITE_(CORRUPT|NOTADB)/.test(e.code)?'DATABASE_CORRUPT':e.message && /^[A-Z_]+$/.test(e.message)?e.message:'STORAGE_VALIDATION_FAILED';
      return { state: 'BLOCKED', reason, schemaVersion: null };
    }
  }
  connection(): Database.Database { if (!this.db) throw new Error('STORAGE_NOT_OPEN'); return this.db; }
  migrate() {
    try {
      const status = this.open();
      if (status.reason !== 'SCHEMA_UPGRADE_REQUIRED' && status.state !== 'NEEDS_ACTIVATION') throw new Error(status.reason);
      applyPending(this.connection());
    } finally { this.close(); }
  }
  private configure() {
    const db = this.db!;
    db.pragma('busy_timeout = 5000');
    if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') throw new Error('WAL_UNAVAILABLE');
    db.pragma('synchronous = FULL'); db.pragma('foreign_keys = ON');
    if (db.pragma('synchronous', { simple: true }) !== 2 || db.pragma('foreign_keys', { simple: true }) !== 1 || db.pragma('busy_timeout', { simple: true }) !== 5000) throw new Error('SQLITE_CONFIGURATION_FAILED');
  }
  close() {
    try { this.db?.close(); } finally {
      this.db = undefined; this.identities=undefined;
      this.instanceLock?.release(); this.instanceLock = undefined;
    }
  }
}
