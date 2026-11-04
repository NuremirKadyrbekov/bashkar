'use strict';
// Disposable SQLite benchmark for the table-list batch count. Never opens a POS profile.
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');
const Database=require('better-sqlite3');

const historicalOrders=10000,batchesPerOrder=10,maxOpen=50,iterations=30;
const oldSql=`SELECT v.*,o.total current_total,COALESCE(b.batch_count,0) batch_count
 FROM table_sessions v LEFT JOIN orders o ON o.branch_id=v.branch_id AND o.table_session_id=v.id
 LEFT JOIN (SELECT branch_id,order_id,COUNT(*) batch_count FROM order_batches WHERE branch_id=? GROUP BY branch_id,order_id) b ON b.branch_id=o.branch_id AND b.order_id=o.id
 WHERE v.branch_id=? AND v.status='OPEN'`;
const newSql=`SELECT v.*,o.total current_total,
 COALESCE((SELECT COUNT(*) FROM order_batches b WHERE b.branch_id=v.branch_id AND b.order_id=o.id),0) batch_count
 FROM table_sessions v LEFT JOIN orders o ON o.branch_id=v.branch_id AND o.table_session_id=v.id
 WHERE v.branch_id=? AND v.status='OPEN'`;
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
const dir=mkdtempSync(join(tmpdir(),'bashkar-table-batches-')),dbPath=join(dir,'bench.sqlite');
const scanStats=sql=>{const result=spawnSync('sqlite3',['-cmd','.scanstats on',dbPath,sql.replaceAll('?',"'b'")],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr||'SQLITE_SCANSTATS_FAILED');return result.stdout.slice(result.stdout.indexOf('QUERY PLAN')).trim();};
let db;
try{
 db=new Database(dbPath);
 db.exec(`CREATE TABLE table_sessions(id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,table_id TEXT,status TEXT NOT NULL,opened_at INTEGER);
  CREATE UNIQUE INDEX one_active_visit_per_table ON table_sessions(branch_id,table_id) WHERE status='OPEN';
  CREATE TABLE orders(id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,table_session_id TEXT NOT NULL,total INTEGER NOT NULL);
  CREATE UNIQUE INDEX orders_visit ON orders(branch_id,table_session_id);
  CREATE TABLE order_batches(id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,order_id TEXT NOT NULL,sequence INTEGER NOT NULL);
  CREATE INDEX order_batches_history ON order_batches(branch_id,order_id,sequence);`);
 const visit=db.prepare('INSERT INTO table_sessions VALUES(?,?,?,?,0)'),order=db.prepare('INSERT INTO orders VALUES(?,?,?,?)'),batch=db.prepare('INSERT INTO order_batches VALUES(?,?,?,?)');
 db.transaction(()=>{for(let i=0;i<historicalOrders+maxOpen;i++){
  const id=`o${i}`,visitId=`v${i}`;visit.run(visitId,'b',`t${i}`,'CLOSED');order.run(id,'b',visitId,i);
  for(let sequence=1;sequence<=batchesPerOrder;sequence++)batch.run(`${id}-${sequence}`,'b',id,sequence);
 }})();
 db.exec('ANALYZE');
 const before=db.prepare(oldSql),after=db.prepare(newSql),update=db.prepare('UPDATE table_sessions SET status=? WHERE id=?');
 const measure=(statement,params)=>{for(let i=0;i<3;i++)statement.all(...params);const times=[];for(let i=0;i<iterations;i++){const start=process.hrtime.bigint();statement.all(...params);times.push(Number(process.hrtime.bigint()-start)/1e6);}return {medianMs:median(times),minMs:Math.min(...times),maxMs:Math.max(...times)};};
 const results=[];
 for(const open of [0,10,50]){
  db.transaction(()=>{for(let i=0;i<maxOpen;i++)update.run(i<open?'OPEN':'CLOSED',`v${historicalOrders+i}`);})();
  const oldRows=before.all('b','b'),newRows=after.all('b');assert.deepEqual(newRows,oldRows);
  assert.equal(newRows.length,open);assert.ok(newRows.every(row=>row.batch_count===batchesPerOrder));
  results.push({open,old:measure(before,['b','b']),new:measure(after,['b']),
   oldBatchIndexEntries:open?(historicalOrders+maxOpen)*batchesPerOrder:0,
   newBatchIndexEntries:open*batchesPerOrder,
   oldScanStats:scanStats(oldSql),newScanStats:scanStats(newSql),
   oldPlan:db.prepare('EXPLAIN QUERY PLAN '+oldSql).all('b','b').map(row=>row.detail),
   newPlan:db.prepare('EXPLAIN QUERY PLAN '+newSql).all('b').map(row=>row.detail)});
 }
 console.log(JSON.stringify({historicalOrders,historicalBatches:historicalOrders*batchesPerOrder,totalBatches:(historicalOrders+maxOpen)*batchesPerOrder,iterations,results},null,2));
}finally{db?.close();rmSync(dir,{recursive:true,force:true});}
