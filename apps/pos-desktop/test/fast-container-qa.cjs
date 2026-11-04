'use strict';
// Disposable profile and database: verifies the real desktop catalog and dialog.
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {randomUUID,randomBytes}=require('node:crypto');
const {_electron}=require('playwright');
const {fixture,password,catalog}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
async function main(){
 const f=await fixture(),userData=mkdtempSync(join(tmpdir(),'bashkar-fast-container-'));let server,desktop;
 try{
  const actor=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:actor.id,revision:f.auth.employee(actor.id).revision,permission:'shift.open',allowed:true});
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  const menu=catalog();menu.items[0].containerId='container';menu.items.push({id:'container',name:'Контейнер QA',categoryId:'drinks',archived:false,available:true,kitchen:false,isPackaging:true,price:1500,variants:[],groups:[]});
  menu.items.push({id:'tea',name:'Чай QA',categoryId:'drinks',archived:false,available:true,kitchen:true,containerId:'container',price:9000,variants:[],groups:[]});
  const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:menu});await f.menu.publish(f.token,randomUUID(),draft);
  f.storage.close();server=await createServer(f.dir,0,true,{...f.trust,pinKeys:{get:()=>randomBytes(64)}});
  desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+userData,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port),BASHKAR_TEST_CLIENT:'1',BASHKAR_TEST_PROFILE:'fast-container-qa'}});
  const page=await desktop.firstWindow();page.setDefaultTimeout(12000);
  await page.evaluate(async pass=>{await window.pos.request('login',{login:'owner',password:pass});const me=(await window.pos.request('me')).value;localStorage.setItem('bashkar.pos.sales-view.'+me.branchId,'FAST_FIRST');},password);
  await page.reload();await page.setViewportSize({width:1366,height:768});await page.locator('.fast-sales').waitFor();await page.locator('.order-first-new').click();await page.locator('.order-first-modes [data-mode=COUNTER]').click();
  await page.getByRole('button',{name:'Чай QA',exact:true}).click();const offer=page.locator('dialog[open]').filter({hasText:'Добавить контейнер'});await offer.waitFor();await page.screenshot({path:resolve('artifacts/container-offer-preview.png')});
  assert.equal(await offer.locator('textarea,input[type=number]').count(),0);assert.equal(await offer.locator('.container-offer-icon img').getAttribute('src'),'./assets/container-stack.png');assert.equal(await offer.locator('.container-offer-stepper strong').innerText(),'1');await offer.locator('.container-offer-stepper button').last().click();assert.equal(await offer.locator('.container-offer-stepper strong').innerText(),'2');assert.match(await offer.locator('.container-offer-price').innerText(),/30,00 сом/);await offer.locator('.container-offer-stepper button').first().click();
  assert.deepEqual(await page.evaluate(()=>fastState.lines.map(row=>[row.itemId,row.quantity])),[['tea',1]]);
  await offer.getByRole('button',{name:'Добавить',exact:true}).click();await offer.waitFor({state:'hidden'});
  await page.waitForFunction(()=>fastState.lines.length===2);assert.deepEqual(await page.evaluate(()=>fastState.lines.map(row=>[row.itemId,row.quantity])),[['tea',1],['container',1]]);
  await page.getByRole('button',{name:'Чай QA',exact:true}).click();const second=page.locator('dialog[open]').filter({hasText:'Добавить контейнер'});await second.waitFor();await second.getByRole('button',{name:'Отмена',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>fastState.lines.map(row=>[row.itemId,row.quantity])),[['tea',2],['container',1]]);
  await page.getByRole('button',{name:'Кофе',exact:true}).click();const choice=page.locator('.cash-choice-dialog');await choice.getByRole('radio',{name:'250 мл',exact:true}).click();await choice.locator('.cash-option-tile').filter({hasText:'Обычное'}).click();await choice.locator('.cash-choice-accept:not([disabled])').click();
  const third=page.locator('dialog[open]').filter({hasText:'Добавить контейнер'});await third.waitFor();await third.getByRole('button',{name:'Отмена',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>fastState.lines.map(row=>row.itemId)),['tea','container','coffee']);
  console.log('PASS fast counter catalog offers the configured container for simple and variant dishes; accepting adds a separate line and declining leaves the dish.');
 }finally{if(desktop)await desktop.close();if(server)await server.close();f.close();rmSync(userData,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
