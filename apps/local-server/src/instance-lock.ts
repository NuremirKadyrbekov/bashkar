import Database from 'better-sqlite3';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// This marker is distinct from the empty lock created by the original server.
// The data directory must be protected against untrusted writes/deletion.
const SENTINEL = 'BASHKAR_BOOTSTRAP_LOCK_V2\n';
export const LOCK_DATABASE = 'instance-lock.sqlite';
export const LEGACY_LOCK = 'server.lock';

function fileKind(path: string): 'missing' | 'file' | 'other' {
  try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 ? 'file' : 'other'; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw error; }
}

export class InstanceLock {
  private database?: Database.Database;
  private ownsSentinel = false;
  private identities?: { lock: string; sentinel: string; directory: string };
  private identity(path: string) { const stat=lstatSync(path); return `${stat.dev}:${stat.ino}`; }
  assertOwned() {
    if(!this.database || !this.identities || fileKind(join(this.dir,LOCK_DATABASE))!=='file' || fileKind(join(this.dir,LEGACY_LOCK))!=='file' || this.identity(join(this.dir,LOCK_DATABASE))!==this.identities.lock || this.identity(join(this.dir,LEGACY_LOCK))!==this.identities.sentinel || this.identity(this.dir)!==this.identities.directory || readFileSync(join(this.dir,LEGACY_LOCK),'utf8')!==SENTINEL) throw new Error('INSTANCE_LOCK_IDENTITY_CHANGED');
  }
  private readonly dir: string;
  constructor(dir: string) { this.dir = realpathSync(dir); }
  acquire() {
    const lockDatabase = join(this.dir, LOCK_DATABASE);
    const sentinel = join(this.dir, LEGACY_LOCK);
    if (fileKind(lockDatabase) === 'other') throw new Error('INSTANCE_LOCK_INVALID');
    try {
      const before = fileKind(lockDatabase)==='file' ? this.identity(lockDatabase) : undefined;
      this.database = new Database(lockDatabase, { timeout: 0 });
      this.database.pragma('busy_timeout = 0');
      if (this.database.pragma('journal_mode', { simple: true }) !== 'delete') throw new Error('INSTANCE_LOCK_INVALID');
      this.database.exec('BEGIN EXCLUSIVE');
      if (fileKind(lockDatabase)!=='file' || before && this.identity(lockDatabase)!==before) throw new Error('INSTANCE_LOCK_IDENTITY_CHANGED');
      const kind = fileKind(sentinel);
      if (kind === 'other') throw new Error('INSTANCE_LOCK_UNAVAILABLE');
      if (kind === 'file') {
        // A legacy or incomplete lock may belong to an older live process.
        if (readFileSync(sentinel, 'utf8') !== SENTINEL) throw new Error('INSTANCE_LOCK_UNAVAILABLE');
        this.ownsSentinel = true;
      } else {
        let fd: number;
        try { fd = openSync(sentinel, 'wx', 0o600); }
        catch { throw new Error('INSTANCE_LOCK_UNAVAILABLE'); }
        try { writeFileSync(fd, SENTINEL); fsyncSync(fd); this.ownsSentinel = true; }
        finally { closeSync(fd); }
      }
      this.identities={lock:this.identity(lockDatabase),sentinel:this.identity(sentinel),directory:this.identity(this.dir)};
      this.assertOwned();
    } catch (error) {
      this.database?.close(); this.database = undefined;
      if ((error as { code?: string }).code === 'SQLITE_BUSY' || (error as { code?: string }).code === 'SQLITE_LOCKED') throw new Error('INSTANCE_LOCK_UNAVAILABLE');
      throw error;
    }
  }
  release() {
    try {
      if (this.ownsSentinel) {
        // Never delete a replacement owned by somebody else. On uncertainty
        // preserve all files and release only our SQLite connection.
        try { this.assertOwned(); unlinkSync(join(this.dir, LEGACY_LOCK)); } catch { /* Preserve for diagnosis. */ }
        this.ownsSentinel = false; this.identities=undefined;
      }
    } finally {
      this.database?.close(); this.database = undefined;
    }
  }
}
