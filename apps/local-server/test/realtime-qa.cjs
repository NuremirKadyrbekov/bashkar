'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
(async()=>{const f=await fixture();let app,socket;try{
 f.storage.close();app=await createServer(f.dir,0,true,f.trust);const port=app.server.address().port;
 socket=new WebSocket(`ws://127.0.0.1:${port}/api/v1/events`,['bashkar.events','token.'+f.token]);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',event=>reject(event.error??event),{once:true});});
 const events=[];socket.addEventListener('message',event=>events.push(JSON.parse(event.data)));
 const commandId=randomUUID(),request={commandId,zoneId:null,revision:0,name:'Realtime QA',active:true};
 const send=()=>fetch(`http://127.0.0.1:${port}/api/v1/tables/zones/save`,{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:JSON.stringify(request)});
 const response=await send();assert.equal(response.status,200);await new Promise((resolve,reject)=>{const until=Date.now()+3000;const wait=()=>events.some(event=>event.type==='changed')?resolve():Date.now()>until?reject(Error('NO_REALTIME_EVENT')):setTimeout(wait,10);wait();});
 const changed=events.find(event=>event.type==='changed');assert.equal(changed.scope,'tables');assert.equal(changed.seq,1);assert.equal(typeof changed.epoch,'string');
 assert.equal((await send()).status,200);await new Promise(resolve=>setTimeout(resolve,100));assert.equal(events.filter(event=>event.type==='changed').length,1);
 const denied=new WebSocket(`ws://127.0.0.1:${port}/api/v1/events`,['bashkar.events','token.'+'A'.repeat(43)]);
 await new Promise((resolve,reject)=>{denied.addEventListener('error',resolve,{once:true});denied.addEventListener('open',()=>reject(Error('UNAUTHORIZED_WEBSOCKET_OPEN')),{once:true});});
 console.log('PASS local WebSocket: authenticated Desktop session received post-commit invalidation.');
}finally{socket?.close();if(app)await app.close();f.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
