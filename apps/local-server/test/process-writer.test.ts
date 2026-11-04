import { expect,it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture,password } from './fixtures/operations';
it('serializes real independent SQLite writers: one shift for distinct IDs, one result for an identical ID',async()=>{
 const f=await fixture();try{
  const owner=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:owner.employee.revision,permission:'shift.open',allowed:true});
  const run=(commandId:string)=>new Promise<{ok:boolean;id?:string;code?:string}>((resolveResult,reject)=>{
   const processChild=spawn(process.execPath,[resolve('dist/apps/local-server/test/fixtures/shift-contender.js')],{stdio:['pipe','pipe','pipe']});let output='';let errors='';
   processChild.stdout.on('data',chunk=>{output+=chunk;});processChild.stderr.on('data',chunk=>{errors+=chunk;});processChild.on('error',reject);
   processChild.on('close',code=>{if(code!==0)reject(new Error(errors));else try{resolveResult(JSON.parse(output));}catch(error){reject(error);}});
   processChild.stdin.end(JSON.stringify({path:join(f.dir,'pos.sqlite'),branchId:f.claims.branchId,token:f.token,commandId,password}));
  });
  const ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];const results=await Promise.all(ids.map(run));
  const success=results.filter(r=>r.ok);expect(new Set(success.map(r=>r.id)).size).toBe(1);expect(success).toHaveLength(1);
  const winner=results.findIndex(r=>r.ok);const repeated=await Promise.all([run(ids[winner]),run(ids[winner])]);expect(repeated.every(r=>r.ok && r.id===success[0].id)).toBe(true);
  expect(f.db.prepare("SELECT count(*) AS n FROM shifts WHERE status='OPEN'").get()).toEqual({n:1});
 }finally{f.close();}
});
