import Database from 'better-sqlite3';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { migration as bootstrap } from './001-bootstrap';
import { migration as operations } from './002-operations';
import { migration as activationPending } from './003-activation-pending';
import { migration as tables } from './004-tables';
import { migration as orders } from './005-orders-batches';
import { migration as pin } from './006-pin';
import { migration as finance } from './007-finance';
import { migration as shiftFinance } from './008-shift-finance';
import { migration as waiter } from './009-waiter-web';
import { migration as printing } from './010-print-dispatch';
import { migration as ownerCloud } from './011-owner-cloud';
import { migration as analyticsSync } from './024-analytics-sync';
import { migration as analyticsProducts } from './025-analytics-products';
import { migration as shiftCloudDelivery } from './026-shift-cloud-delivery';
import { migration as menuSync } from './012-menu-sync';
import { migration as orderNumbers } from './013-order-numbers';
import { migration as cashService } from './014-cash-service';
import { migration as assignments } from './015-visit-assignments';
import { migration as cashDrafts } from './016-cash-drafts';
import { migration as cashDraftCreated } from './017-cash-draft-created';
import { migration as employeePhone } from './018-employee-phone';
import { migration as rolePermissions } from './019-role-permissions';
import { migration as floorPlan } from './020-floor-plan';
import { migration as tablePublicLinks } from './021-table-public-links';
import { migration as tableCloudSync } from './022-table-cloud-sync';
import { migration as salesCatalogPins } from './023-sales-catalog-pins';
import { requireCondition } from '../errors';
export const migrations = [bootstrap, operations, activationPending, tables, orders, pin, finance, shiftFinance, waiter, printing, ownerCloud, menuSync, orderNumbers, cashService, assignments, cashDrafts,cashDraftCreated,employeePhone,rolePermissions,floorPlan,tablePublicLinks,tableCloudSync,salesCatalogPins,analyticsSync,analyticsProducts,shiftCloudDelivery].map((sql, i) => ({ version: i + 1, sql, checksum: createHash('sha256').update(sql).digest('hex') }));
export const latestSchema = migrations.length;
export function ensureTablePublicLink(db:Database.Database,branchId:string,tableId:string,now=Date.now()){
  const existing=db.prepare('SELECT code FROM dining_table_public_links WHERE branch_id=? AND table_id=?').get(branchId,tableId) as {code:string}|undefined;
  if(existing)return existing.code;
  for(let attempt=0;attempt<8;attempt++){
    const code=randomBytes(16).toString('base64url');
    if(db.prepare('SELECT 1 FROM dining_table_public_links WHERE branch_id=? AND code=?').get(branchId,code))continue;
    db.prepare('INSERT INTO dining_table_public_links(branch_id,table_id,code,created_at) VALUES(?,?,?,?)').run(branchId,tableId,code,now);
    return code;
  }
  throw new Error('TABLE_PUBLIC_CODE_COLLISION');
}
export function validateMigrations(db: Database.Database): number {
  const rows = db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all() as { version: number; checksum: string }[];
  requireCondition(rows.length > 0 && rows.length <= latestSchema, 'SCHEMA_INCOMPATIBLE');
  for (let i = 0; i < rows.length; i++) requireCondition(rows[i].version === i + 1 && rows[i].checksum === migrations[i].checksum, 'SCHEMA_INCOMPATIBLE');
  return rows.length;
}
export function applyPending(db: Database.Database) {
  db.transaction(() => {
    const version = validateMigrations(db);
    const hasShifts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shifts'").get();
    if (hasShifts && version < latestSchema) requireCondition(!db.prepare("SELECT 1 FROM shifts WHERE status='OPEN' LIMIT 1").get(), 'MIGRATION_OPEN_SHIFT');
    for (const migration of migrations.slice(version)) {
      db.exec(migration.sql);
      if(migration.version===21){
        const tables=db.prepare('SELECT branch_id, id FROM dining_tables ORDER BY branch_id,id').all() as {branch_id:string;id:string}[];
        for(const table of tables)ensureTablePublicLink(db,table.branch_id,table.id);
      }
      if(migration.version===22){
        const activation=db.prepare('SELECT branch_id FROM activation WHERE singleton=1').get() as {branch_id:string}|undefined;
        if(activation)db.prepare('INSERT INTO table_cloud_sync_state(branch_id,command_id) VALUES(?,?)').run(activation.branch_id,randomUUID());
      }
      db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(migration.version, migration.checksum);
    }
    requireCondition((db.pragma('foreign_key_check') as unknown[]).length === 0, 'FOREIGN_KEY_CHECK_FAILED');
  }).immediate();
}

export function validatePhysicalSchema(db: Database.Database, version: number) {
  const reference = new Database(':memory:');
  try {
    for(const migration of migrations.slice(0,version))reference.exec(migration.sql);
    const sql="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
    requireCondition(JSON.stringify(db.prepare(sql).all())===JSON.stringify(reference.prepare(sql).all()),'SCHEMA_STRUCTURE_MISMATCH');
  } finally {reference.close();}
}
