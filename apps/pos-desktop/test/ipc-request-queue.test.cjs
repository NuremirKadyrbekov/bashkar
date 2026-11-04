'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRequestQueue}=require('../ipc-request-queue.cjs');

test('independent reads overlap, but mutations wait and retain their order',async()=>{
 const enqueue=createRequestQueue(new Set(['menu','tables']),2),events=[];
 let releaseRead;
 const gate=new Promise(resolve=>{releaseRead=resolve;});
 const first=enqueue('menu',async()=>{events.push('read 1 start');await gate;events.push('read 1 end');});
 const second=enqueue('tables',async()=>{events.push('read 2 start');await gate;events.push('read 2 end');});
 const mutation=enqueue('submit',async()=>{events.push('submit');});
 const after=enqueue('menu',async()=>{events.push('read after submit');});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,['read 1 start','read 2 start']);
 releaseRead();await Promise.all([first,second,mutation,after]);
 assert.ok(events.indexOf('submit')>events.indexOf('read 1 end'));
 assert.ok(events.indexOf('submit')>events.indexOf('read 2 end'));
 assert.ok(events.indexOf('read after submit')>events.indexOf('submit'));
});

test('parallelism is bounded and a failed request does not stop later commands',async()=>{
 const enqueue=createRequestQueue(new Set(['menu']),2);
 let running=0,maximum=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 const reads=Array.from({length:5},()=>enqueue('menu',async()=>{running++;maximum=Math.max(maximum,running);await gate;running--;}));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(maximum,2);
 release();await Promise.all(reads);
 await assert.rejects(enqueue('submit',async()=>{throw Error('failed');}),/failed/);
 assert.equal(await enqueue('submit',async()=>42),42);
});
