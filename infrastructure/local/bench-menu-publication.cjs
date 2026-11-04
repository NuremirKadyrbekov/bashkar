'use strict';
// Disposable SQLite fixture only. Measures the publish command after N revisions.
const {randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {fixture,catalog}=require('../../dist/apps/local-server/test/fixtures/operations.js');

async function run(history){
 const f=await fixture();
 try{
  const document=catalog();document.items=Array.from({length:500},(_,index)=>({...document.items[0],id:'dish_'+index,name:'Блюдо '+index,variants:[],groups:[],price:10000}));
  let revision=0;
  const publish=async()=>{const saved=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:revision,catalog:document});const start=performance.now();const result=await f.menu.publish(f.token,randomUUID(),saved);const duration=performance.now()-start;revision=result.revision;return duration;};
  for(let i=0;i<history;i++)await publish();
  const plan=f.db.prepare('EXPLAIN QUERY PLAN SELECT document FROM menu_revisions WHERE branch_id=?').all(f.claims.branchId).map(row=>row.detail);
  const times=[];for(let i=0;i<3;i++)times.push(await publish());
  times.sort((a,b)=>a-b);
  return {history,items:document.items.length,publishMs:times.map(value=>Number(value.toFixed(2))),medianMs:Number(times[1].toFixed(2)),plan};
 }finally{f.close();}
}
(async()=>{for(const count of [0,10,100])console.log(JSON.stringify(await run(count)));})().catch(error=>{console.error(error);process.exitCode=1;});
