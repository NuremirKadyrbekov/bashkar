import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '../../command-bus';
import {validateCatalog} from './catalog';
export type SyncVersion={branch_id:string;local_revision:number;version_id:string;parent_id:string|null;content_hash:string;origin:'LOCAL_POS'|'CLOUD_OWNER'|'CLOUD_RESTORE';author:string;published_at:number;cloud_state:'PENDING'|'ACCEPTED'|'CONFLICT'|'INBOUND';operation_id:string};
export function ensureMenuMetadata(db:Database.Database,branchId:string){
 const rows=db.prepare('SELECT r.*,e.name author_name FROM menu_revisions r LEFT JOIN employees e ON e.id=r.created_by AND e.branch_id=r.branch_id WHERE r.branch_id=? ORDER BY r.revision').all(branchId) as {revision:number;document:string;created_by:string|null;author_name:string|null;created_at:number}[];
 let parent:string|null=null;
 for(const row of rows){let meta=db.prepare('SELECT version_id FROM menu_sync_versions WHERE branch_id=? AND local_revision=?').get(branchId,row.revision) as {version_id:string}|undefined;
  if(!meta){const id=randomUUID(),document=validateCatalog(JSON.parse(row.document));db.prepare('INSERT INTO menu_sync_versions(branch_id,local_revision,version_id,parent_id,content_hash,origin,author,published_at,operation_id) VALUES(?,?,?,?,?,\'LOCAL_POS\',?,?,?)').run(branchId,row.revision,id,parent,digest(canonical(document)),canonical({type:'LOCAL_EMPLOYEE',id:row.created_by,name:row.author_name??'Local employee'}),row.created_at,randomUUID());meta={version_id:id};}parent=meta.version_id;
 }
 db.prepare('INSERT OR IGNORE INTO menu_sync_state(branch_id) VALUES(?)').run(branchId);
}
