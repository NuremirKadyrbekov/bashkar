'use strict';
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {_electron}=require('playwright');
const {fixture,password}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');

async function main(){
 const f=await fixture(),userData=mkdtempSync(join(tmpdir(),'bashkar-menu-recovery-'));
 let server,desktop;
 try{
  f.storage.close();server=await createServer(f.dir,0,true,f.trust);
  const port=server.server.address().port;
  desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+userData,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(port),BASHKAR_TEST_CLIENT:'1',BASHKAR_TEST_PROFILE:'menu-recovery-qa'}});
  const page=await desktop.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'Войти по логину и паролю',exact:true}).click();
  await page.getByLabel('Логин',{exact:true}).fill('owner');await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await page.locator('#nav [data-screen="menu"]').waitFor({state:'visible'});
  await server.close();server=null;
  await page.locator('#nav [data-screen="menu"]').click();
  await page.locator('.menu-workspace[data-unavailable="true"]').waitFor();
  assert.match(await page.locator('.menu-workspace').innerText(),/Связь с сервером потеряна/);
  server=await createServer(f.dir,port,true,f.trust);
  await page.locator('.menu-workspace:not([data-unavailable="true"]) .menu-toolbar').waitFor({timeout:15000});
  await page.locator('#nav [data-screen="stopList"]').click();
  await page.locator('.stop-list-screen').waitFor();
  await page.evaluate(()=>{window.__menuQaReads=0;const request=api;api=async(action,payload)=>{if(action==='menu')window.__menuQaReads++;return request(action,payload);};});
  for(let seq=1;seq<=10;seq++)await desktop.evaluate(({BrowserWindow},change)=>BrowserWindow.getAllWindows()[0].webContents.send('pos:changed',change),{type:'changed',epoch:'stop-list-qa',seq,scope:'orders'});
  await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.__menuQaReads),0);
  for(let seq=11;seq<=20;seq++)await desktop.evaluate(({BrowserWindow},change)=>BrowserWindow.getAllWindows()[0].webContents.send('pos:changed',change),{type:'changed',epoch:'stop-list-qa',seq,scope:'menu'});
  await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.__menuQaReads),1);
  assert.deepEqual(errors,[]);
  console.log('PASS menu server outage/recovery and stop-list WS: 10 order events = 0 menu requests; 10 menu events = 1 request.');
 }finally{await desktop?.close();await server?.close();f.close();rmSync(userData,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
