'use strict';
const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {mkdtempSync,rmSync,existsSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const net=require('node:net');
async function main(){
 const entry=resolve(process.argv[2]||'artifacts/runtime-smoke.cjs'),dir=mkdtempSync(join(tmpdir(),'bashkar-bundle-'));
 let child;
 try{
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const env={...process.env,BASHKAR_DATA_DIR:dir,BASHKAR_PORT:String(port)};
  const initialized=spawnSync(process.execPath,[entry,'init-db'],{env,encoding:'utf8'});assert.equal(initialized.status,0,initialized.stderr);
  child=spawn(process.execPath,[entry],{env,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
  const deadline=Date.now()+5000;let live;
  while(Date.now()<deadline){try{live=await fetch('http://127.0.0.1:'+port+'/api/v1/system/health/live');if(live.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,40));}
  assert.ok(live?.ok,logs);
  const ready=await fetch('http://127.0.0.1:'+port+'/api/v1/system/health/ready');assert.equal(ready.status,503);assert.equal((await ready.json()).state,'NEEDS_ACTIVATION');
  const version=await(await fetch('http://127.0.0.1:'+port+'/api/v1/system/version')).json();assert.equal(version.schema,Number(process.argv[3]??6));
  const duplicate=spawnSync(process.execPath,[entry],{env,encoding:'utf8'});assert.notEqual(duplicate.status,0);assert.ok(duplicate.stderr.includes('INSTANCE_LOCK_UNAVAILABLE'));
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
  if(process.platform!=='win32')assert.equal(existsSync(join(dir,'server.lock')),false);
  console.log('PASS bundled server: explicit init, schema '+version.schema+', live/activation required, second-process refusal, shutdown on '+process.platform);
 }finally{if(child&&child.exitCode===null)child.kill();rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
