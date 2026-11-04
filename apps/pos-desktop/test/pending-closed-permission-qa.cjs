'use strict';
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {_electron}=require('playwright');
const {randomUUID}=require('node:crypto');
const {fixture,password}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
async function main(){const f=await fixture(),profile=mkdtempSync(join(tmpdir(),'bashkar-pending-rights-'));let server,desktop;try{
 f.storage.close();server=await createServer(f.dir,0,true,f.trust);
 desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+profile,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port)}});
 const page=await desktop.firstWindow();await page.getByRole('button',{name:'Войти по логину и паролю'}).click();await page.getByLabel('Логин',{exact:true}).fill('owner');await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();
 await desktop.evaluate(()=>{const original=globalThis.fetch;let lost=false;globalThis.fetch=async(...args)=>{const result=await original(...args);if(!lost&&String(args[0]).endsWith('/employees/permission')){lost=true;throw Error('TEST_LOST_RESPONSE');}return result;};});
 const attempted=await page.evaluate(async id=>{try{await api('employeePermission',{employeeId:id,revision:1,permission:'menu.edit',allowed:true});return 'APPLIED';}catch(error){await pendingPanel();return error.message;}},randomUUID());
 assert.equal(attempted,'RESULT_UNKNOWN_RETRY_SAME_ACTION');const panel=page.locator('#pending-commands');await panel.waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await panel.getByRole('button',{name:'Повторить исходное действие'}).click();await panel.waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>api('pending')),[]);assert.equal(await page.locator('#status').textContent(),'Изменение прав сотрудников временно закрыто.');
 await page.locator('#nav [data-screen=employees]').click();await page.getByRole('heading',{name:'Сотрудники'}).waitFor();assert.equal(await page.locator('#pending-commands').count(),0);
 console.log('PASS lost permission response resolves on explicit 423; pending banner disappears across navigation');
 }finally{await desktop?.close();await server?.close();f.close();rmSync(profile,{recursive:true,force:true});}}
main().catch(error=>{console.error(error);process.exitCode=1;});
