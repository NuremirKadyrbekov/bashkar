'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');

function harness(count){
 const server={orderId:'order-a',revision:count,batches:Array.from({length:count},(_,i)=>batch(i+1))},stats={calls:[],bytes:0};
 function batch(sequence){return {id:'b'+sequence,sequence,lines:[{id:'i'+sequence,currentQuantity:1,fulfillment:{revision:0}}],kitchenJobs:[{id:'j'+sequence,status:'PENDING'}]};}
 const context=vm.createContext({me:{branchId:'branch',id:'cashier'},tableQuickSession:null,cashRealtimeTicket:0,structuredClone,api:async(action,payload)=>{
  let result;if(action==='cashBatches'){
   const rows=server.batches.filter(row=>row.sequence>(payload.after??0)),limit=payload.limit??20,selected=rows.slice(0,limit);
   result={orderId:server.orderId,orderRevision:server.revision,batches:selected,next:rows.length>limit?selected.at(-1).sequence:null};
  }else if(action==='cashHistoryState'){
   result={orderId:server.orderId,orderRevision:server.revision,maxSequence:server.batches.at(-1)?.sequence??0,
    items:server.batches.flatMap(row=>row.lines.map(line=>({itemId:line.id,sequence:row.sequence,fulfillmentRevision:line.fulfillment.revision}))),
    jobs:server.batches.flatMap(row=>row.kitchenJobs.map(job=>({id:job.id,sequence:row.sequence,status:job.status,revision:1,generation:0})))};
  }else throw Error('UNEXPECTED_ACTION '+action);
  const copy=structuredClone(result);stats.calls.push(action);stats.bytes+=Buffer.byteLength(JSON.stringify(copy));return copy;
 }});
 vm.runInContext(readFileSync(join(__dirname,'../cash-workspace.js'),'utf8'),context);
 const read=()=>vm.runInContext('cashReadOrderHistory({id:"order-a",shiftId:"shift"})',context),clear=()=>vm.runInContext('cashClearHistoryCache()',context),reset=()=>{stats.calls=[];stats.bytes=0;};
 return {server,stats,read,clear,reset,batch,context};
}

for(const count of [10,50,200])test(`cash history ${count}: cache, new packages, print and fulfillment`,async()=>{
 const h=harness(count),first=await h.read();assert.equal(first.batches.length,count);assert.equal(h.stats.calls.filter(x=>x==='cashBatches').length,Math.ceil(count/20));
 h.reset();await h.read();assert.deepEqual(h.stats.calls,count<=20?['cashBatches']:['cashHistoryState']);
 h.server.batches[0].kitchenJobs[0].status='SENT';h.reset();const printed=await h.read();assert.equal(printed.batches[0].kitchenJobs[0].status,'SENT');assert.deepEqual(h.stats.calls,count<=20?['cashBatches']:['cashHistoryState']);
 h.server.batches[0].lines[0].fulfillment.revision=1;h.reset();const issued=await h.read();assert.equal(issued.batches[0].lines[0].fulfillment.revision,1);assert.equal(h.stats.calls.length,count<=20?1:2);
 h.server.batches.push(h.batch(count+1));h.server.revision++;h.reset();const added=await h.read();assert.equal(added.batches.length,count+1);assert.equal(h.stats.calls.length,count<=20?1:2);
 h.server.batches[0].lines[0].currentQuantity=0;h.server.revision++;h.reset();const corrected=await h.read();assert.equal(corrected.batches[0].lines[0].currentQuantity,0);assert.ok(h.stats.calls.includes('cashBatches'));
 h.clear();h.reset();const restored=await h.read();assert.equal(restored.batches.length,count+1);assert.ok(h.stats.calls.includes('cashBatches'));
});

test('concurrent reads share one state request and a stale response cannot replace a cleared cache',async()=>{
 const h=harness(50);await h.read();h.reset();
 await Promise.all([h.read(),h.read()]);assert.deepEqual(h.stats.calls,['cashHistoryState']);
 const original=h.context.api;let release;h.context.api=async(...args)=>{if(args[0]==='cashHistoryState')await new Promise(resolve=>{release=resolve;});return original(...args);};
 const pending=h.read();await new Promise(resolve=>setImmediate(resolve));h.clear();release();await assert.rejects(pending,/HISTORY_CHANGED/);
 h.context.api=original;h.reset();await h.read();assert.ok(h.stats.calls.includes('cashBatches'));
});

test('employee switch and permission denial invalidate cached order history',async()=>{
 const h=harness(50);await h.read();h.context.me.id='other';h.reset();await h.read();assert.ok(h.stats.calls.includes('cashBatches'));
 const original=h.context.api;h.context.api=async(action,payload)=>{if(action==='cashHistoryState')throw Error('PERMISSION_DENIED');return original(action,payload);};
 await assert.rejects(h.read(),/PERMISSION_DENIED/);assert.equal(vm.runInContext('cashHistoryCache',h.context),null);
 h.context.api=original;h.reset();await h.read();assert.ok(h.stats.calls.includes('cashBatches'));
});
