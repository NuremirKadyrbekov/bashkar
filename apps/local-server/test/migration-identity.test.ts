import { expect,it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync,writeFileSync,readFileSync,rmSync,renameSync,linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Storage } from '../src/storage';
import { migrations,applyPending,validatePhysicalSchema } from '../src/migrations';
for(const base of [3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19])for(const open of [false,true])it(`upgrades authentic schema ${base} only explicitly and preserves it when OPEN=${open}`,()=>{
 const dir=mkdtempSync(join(tmpdir(),'bashkar-v3-')),id=randomUUID(),branch=randomUUID(),employee=randomUUID();
 try{
  writeFileSync(join(dir,'installation.json'),JSON.stringify({format:1,id}));const db=new Database(join(dir,'pos.sqlite'));db.pragma('foreign_keys=ON');
  for(const m of migrations.slice(0,base)){db.exec(m.sql);db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(m.version,m.checksum);}
  db.prepare('INSERT INTO bootstrap_instance VALUES(?,?)').run(id,'UNACTIVATED');
  if(open){db.prepare('INSERT INTO activation VALUES(1,?,?,?,?,?,?,?)').run(id,branch,randomUUID(),randomUUID(),randomUUID(),'{}',Date.now());db.prepare("INSERT INTO employees(id,branch_id,login,name,role,status,password_hash,must_change,created_at) VALUES(?,?,'owner','Fixture','OWNER','ACTIVE','not-a-runtime-credential',0,?)").run(employee,branch,Date.now());db.prepare("INSERT INTO shifts(id,branch_id,status,opened_by,opened_at) VALUES(?,?,'OPEN',?,?)").run(randomUUID(),branch,employee,Date.now());}
  db.close();const storage=new Storage(dir);expect(storage.open().reason).toBe('SCHEMA_UPGRADE_REQUIRED');storage.close();
  if(open)expect(()=>storage.migrate()).toThrow('MIGRATION_OPEN_SHIFT');else storage.migrate();
  const read=new Database(join(dir,'pos.sqlite'),{readonly:true});try{
   expect(read.prepare('SELECT count(*) n FROM schema_migrations').get()).toEqual({n:open?base:migrations.length});expect(read.prepare('SELECT id FROM bootstrap_instance').get()).toEqual({id});
   const checks=read.prepare(`SELECT checksum FROM schema_migrations WHERE version<=${base} ORDER BY version`).all() as {checksum:string}[];expect(checks.map(r=>r.checksum)).toEqual(migrations.slice(0,base).map(m=>m.checksum));
   if(open)expect(read.prepare("SELECT count(*) n FROM shifts WHERE status='OPEN'").get()).toEqual({n:1});
  }finally{read.close();storage.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('backfills stable draft creation times from authentic v16 without changing draft payloads or revisions',()=>{
 const db=new Database(':memory:');try{
  db.pragma('foreign_keys=ON');for(const migration of migrations.slice(0,16)){db.exec(migration.sql);db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(migration.version,migration.checksum);}
  const instance=randomUUID(),branch=randomUUID(),actor=randomUUID(),shift=randomUUID(),draft=randomUUID(),command=randomUUID(),payload='{"lines":[],"id":"legacy"}';
  db.prepare('INSERT INTO bootstrap_instance VALUES(?,?)').run(instance,'UNACTIVATED');db.prepare('INSERT INTO activation VALUES(1,?,?,?,?,?,?,?)').run(instance,branch,randomUUID(),randomUUID(),randomUUID(),'{}',1);
  db.prepare("INSERT INTO employees(id,branch_id,login,name,role,status,password_hash,must_change,created_at) VALUES(?,?,'owner','Historical','OWNER','ACTIVE','historical-hash',0,1)").run(actor,branch);
  db.prepare("INSERT INTO shifts(id,branch_id,status,opened_by,opened_at) VALUES(?,?,'CLOSED',?,1)").run(shift,branch,actor);
  db.prepare('INSERT INTO cash_drafts VALUES(?,?,?,?,?,?,?,?,?,?)').run(draft,branch,actor,shift,1,7,payload,1234,command,'hash');
  const before=db.prepare('SELECT * FROM cash_drafts').get();applyPending(db);const {created_at,...retained}=db.prepare('SELECT * FROM cash_drafts').get() as Record<string,unknown>;
  expect(created_at).toBe(1234);expect(retained).toEqual(before);expect(()=>db.prepare('UPDATE cash_drafts SET created_at=9999').run()).toThrow('IMMUTABLE_DRAFT_CREATION');validatePhysicalSchema(db,migrations.length);expect(db.pragma('foreign_key_check')).toEqual([]);
 }finally{db.close();}
});
it('rebuilds schema 6 historical graph with FK ON and preserves all snapshots, results and immutable guards',()=>{
 const db=new Database(':memory:');try{db.pragma('foreign_keys=ON');for(const m of migrations.slice(0,6)){db.exec(m.sql);db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(m.version,m.checksum);}
 const instance=randomUUID(),branch=randomUUID(),actor=randomUUID(),shift=randomUUID(),zone=randomUUID(),table=randomUUID(),visit=randomUUID(),order=randomUUID(),batch=randomUUID(),item=randomUUID(),command=randomUUID(),job=randomUUID();
 db.prepare('INSERT INTO bootstrap_instance VALUES(?,?)').run(instance,'UNACTIVATED');db.prepare('INSERT INTO activation VALUES(1,?,?,?,?,?,?,?)').run(instance,branch,randomUUID(),randomUUID(),randomUUID(),'{}',1);
 db.prepare("INSERT INTO employees(id,branch_id,login,name,role,status,password_hash,must_change,created_at) VALUES(?,?,'owner','Historical','OWNER','ACTIVE','historical-hash',0,1)").run(actor,branch);
 // Synthetic CLOSED period supplies historical rows without bypassing the OPEN
 // migration guard in any real installation; no shift-close code is exercised.
 db.prepare("INSERT INTO shifts(id,branch_id,status,opened_by,opened_at) VALUES(?,?,'CLOSED',?,1)").run(shift,branch,actor);db.prepare("INSERT INTO dining_zones VALUES(?,?,'Зал','зал',1,1)").run(zone,branch);db.prepare("INSERT INTO dining_tables VALUES(?,?,?,'7','7',1,1)").run(table,branch,zone);
 db.prepare("INSERT INTO table_sessions(id,branch_id,table_id,shift_id,opened_by,table_name,zone_name,opened_by_name,opened_at,status,has_accepted_batch) VALUES(?,?,?,?,?,'7','Зал','Historical',1,'OPEN',1)").run(visit,branch,table,shift,actor);
 const fees='{"revision":3,"fees":[]}',snapshot='{"name":"Плов","unitPrice":30000,"quantity":2,"total":60000,"comment":"Без лука","kitchen":true}',payload='{"tableName":"7","lines":[]}';
 db.prepare("INSERT INTO orders VALUES(?,?,?,?,'TABLE','OPEN',1,0,60000,60000,?,1)").run(order,branch,shift,visit,fees);db.prepare('INSERT INTO order_batches VALUES(?,?,?,1,?,?,1,?,?,1,1,60000)').run(batch,branch,order,command,randomUUID(),actor,'Historical');db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?,2,60000,1)').run(item,branch,batch,randomUUID(),snapshot);db.prepare("INSERT INTO print_jobs VALUES(?,?,?,?,'KITCHEN','NEW_BATCH',1,'PENDING',?,1)").run(job,branch,order,batch,payload);db.prepare('INSERT INTO commands VALUES(?,?,?,?,?,1)').run(branch,command,actor,'fingerprint',JSON.stringify({orderId:order,batchId:batch}));
 const before=new Map(['table_sessions','order_batches','order_items','print_jobs','commands'].map(name=>[name,db.prepare('SELECT * FROM '+name).all()]));
 applyPending(db);validatePhysicalSchema(db,migrations.length);for(const name of ['table_sessions','order_batches','order_items','commands'])expect(db.prepare('SELECT * FROM '+name).all()).toEqual(before.get(name));expect(db.prepare('SELECT id,payload,status FROM print_jobs').get()).toEqual({id:job,payload,status:'PENDING'});expect(db.prepare('SELECT id,fees_snapshot FROM orders').get()).toEqual({id:order,fees_snapshot:fees});expect(db.prepare('SELECT item_id,quantity,comment FROM order_item_portions').get()).toEqual({item_id:item,quantity:2,comment:'Без лука'});expect(db.pragma('foreign_key_check')).toEqual([]);expect(()=>db.prepare('UPDATE order_items SET quantity=1').run()).toThrow('IMMUTABLE_ACCEPTED_FACT');expect(()=>db.prepare("UPDATE print_jobs SET payload='{}'").run()).toThrow('IMMUTABLE_ACCEPTED_FACT');
 }finally{db.close();}
});
it('upgrades an existing v1 database only explicitly, preserving instance identity, and rejects future schema/changed checksums',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bashkar-migration-'));try {
  const id=randomUUID();writeFileSync(join(dir,'installation.json'),JSON.stringify({format:1,id}));
  const db=new Database(join(dir,'pos.sqlite'));db.exec(migrations[0].sql);db.prepare('INSERT INTO bootstrap_instance VALUES(?,?)').run(id,'UNACTIVATED');db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(1,migrations[0].checksum);db.close();
  const s=new Storage(dir);expect(s.open().reason).toBe('SCHEMA_UPGRADE_REQUIRED');s.close();s.migrate();
  expect(s.open().schemaVersion).toBe(migrations.length);expect(s.connection().prepare('SELECT id FROM bootstrap_instance').get()).toEqual({id});s.close();
  const future=new Database(join(dir,'pos.sqlite'));future.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(migrations.length+1,'future');future.close();expect(s.open().state).toBe('BLOCKED');s.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('refuses a pending migration during an OPEN shift',()=>{
 const db=new Database(':memory:');try{
  db.exec(migrations[0].sql);db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(1,migrations[0].checksum);db.exec("CREATE TABLE shifts(status TEXT NOT NULL);INSERT INTO shifts VALUES('OPEN')");
  expect(()=>applyPending(db)).toThrow('MIGRATION_OPEN_SHIFT');expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({n:1});
 }finally{db.close();}
});
it('detects replaced lock/sentinel files, preserves the replacement on release, and refuses hard-linked storage aliases',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bashkar-identity-'));try {
  const s=new Storage(dir);s.initialize();s.open();
  renameSync(join(dir,'server.lock'),join(dir,'old-sentinel'));writeFileSync(join(dir,'server.lock'),'replacement');
  expect(()=>s.assertIdentity()).toThrow('INSTANCE_LOCK_IDENTITY_CHANGED');s.close();expect(readFileSync(join(dir,'server.lock'),'utf8')).toBe('replacement');
  rmSync(join(dir,'server.lock'));rmSync(join(dir,'old-sentinel'));
  linkSync(join(dir,'pos.sqlite'),join(dir,'db-alias'));expect(s.open().state).toBe('BLOCKED');s.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('rejects a dropped uniqueness index even if the journal checksum is untouched, and requires a real write-probe row',()=>{
 for(const sql of ['DROP INDEX one_open_shift','DELETE FROM storage_probe']) {
  const dir=mkdtempSync(join(tmpdir(),'bashkar-schema-'));
  try{const s=new Storage(dir);s.initialize();const db=new Database(join(dir,'pos.sqlite'));db.exec(sql);db.close();expect(s.open().reason).toBe(sql.startsWith('DROP')?'SCHEMA_STRUCTURE_MISMATCH':'WRITE_PROBE_MISSING');s.close();}finally{rmSync(dir,{recursive:true,force:true});}
 }
});
it('migrates real schema 5 employees/audit/sessions without changing actor IDs or issuing a default PIN',()=>{
 const db=new Database(':memory:');try{
 for(const m of migrations.slice(0,5)){db.exec(m.sql);db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(m.version,m.checksum);}
 const instance=randomUUID(),branch=randomUUID(),actor=randomUUID(),session=randomUUID(),event=randomUUID();
 db.prepare('INSERT INTO bootstrap_instance VALUES(?,?)').run(instance,'UNACTIVATED');db.prepare('INSERT INTO activation VALUES(1,?,?,?,?,?,?,?)').run(instance,branch,randomUUID(),randomUUID(),randomUUID(),'{}',Date.now());
 db.prepare("INSERT INTO employees(id,branch_id,login,name,role,status,password_hash,must_change,created_at) VALUES(?,?,'owner','Historical Owner','OWNER','ACTIVE','historical-hash',0,?)").run(actor,branch,Date.now());
 db.prepare("INSERT INTO auth_sessions VALUES(?,?,?,'POS',?,?,1,0)").run(session,actor,'historical-session-hash',Date.now(),Date.now());
 db.prepare("INSERT INTO audit_events VALUES(?,?,?,'historical.action',?,'SUCCESS',NULL,?,'{}')").run(event,branch,actor,actor,Date.now());
 applyPending(db);expect(db.prepare('SELECT id,password_hash FROM employees').all()).toEqual([{id:actor,password_hash:'historical-hash'}]);expect(db.prepare('SELECT actor_id FROM audit_events WHERE id=?').get(event)).toEqual({actor_id:actor});expect(db.prepare('SELECT revoked,audience FROM auth_sessions WHERE id=?').get(session)).toEqual({revoked:1,audience:'LEGACY_POS'});expect(db.prepare('SELECT count(*) n FROM employee_pins').get()).toEqual({n:0});expect(db.prepare('SELECT count(*) n FROM pin_key_binding').get()).toEqual({n:0});
 }finally{db.close();}
});
