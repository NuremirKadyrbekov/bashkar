'use strict';
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {_electron}=require('playwright');
const {fixture,password}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
async function main(){
 const f=await fixture(),profile=mkdtempSync(join(tmpdir(),'bashkar-analytics-desktop-'));
 let server,desktop;
 try{
  f.storage.close();server=await createServer(f.dir,0,true,f.trust);
  desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+profile,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port)}});
  const page=await desktop.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'Войти по логину и паролю',exact:true}).click();
  await page.getByLabel('Логин',{exact:true}).fill('owner');await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  const link=page.locator('#nav [data-screen="analyticsOverview"]');await link.waitFor();await link.click();
  await page.getByRole('heading',{name:'Обзор'}).waitFor();
  await page.getByText('Синхронизация с Cloud не настроена').waitFor();
  assert.equal(await page.locator('[data-analytics-value="orders"]').textContent(),'0');
  assert.equal(await page.locator('.analytics-plot').getByText('Нет оплат за период').count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS real Desktop → Local POS Server overview, empty state and Cloud status');
 }finally{await desktop?.close();await server?.close();f.close();rmSync(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
