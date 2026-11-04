'use strict';
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {randomUUID}=require('node:crypto');
const {_electron}=require('playwright');
const {fixture,password,catalog}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {TableService}=require('../../../dist/apps/local-server/src/modules/tables/table-service.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');

async function main(){
 const f=await fixture(),profile=mkdtempSync(join(tmpdir(),'bashkar-catalog-reason-'));let server,desktop;
 try{
  const owner=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:owner.employee.revision,permission:'shift.open',allowed:true});
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  const menu=catalog();menu.items.push({id:'menu_disabled',categoryId:'drinks',name:'Отключено меню',archived:false,available:false,kitchen:false,price:10000,variants:[],groups:[]});
  menu.items.push({id:'stop_disabled',categoryId:'drinks',name:'Остановлено вручную',archived:false,available:true,kitchen:false,price:12000,variants:[],groups:[]});
  const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:menu});await f.menu.publish(f.token,randomUUID(),draft);
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'stop_disabled',available:false,revision:0});
  const tables=new TableService(f.db,f.bus,f.auth);await tables.setMode(f.token,randomUUID(),{mode:'STRICT',revision:0});
  const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true});await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name:'1',active:true});
  f.storage.close();server=await createServer(f.dir,0,true,f.trust);
  desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+profile,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port)}});
  const page=await desktop.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(async p=>{await window.pos.request('login',{login:'owner',password:p});localStorage.setItem('bashkar.pos.sales-view.'+(await window.pos.request('me')).value.branchId,'FAST_FIRST');},password);
  await page.reload();await page.locator('.fast-sales .fast-products').waitFor();
  const assertCards=async scope=>{for(const [name,reason] of [['Отключено меню','Недоступно в меню'],['Остановлено вручную','Это блюдо в стоп-листе']]){const card=scope.locator('.fast-product').filter({hasText:name});await card.locator('.fast-product-availability').getByText(reason,{exact:true}).waitFor();assert.equal(await card.locator('.fast-add').isDisabled(),true);assert.equal(await card.locator('.fast-product-availability').evaluate(node=>getComputedStyle(node).color),'rgb(192, 43, 61)');}};
  await assertCards(page.locator('.fast-sales'));
  await page.evaluate(()=>localStorage.setItem('bashkar.pos.sales-view.'+me.branchId,'TABLE_FIRST'));
  await page.reload();await page.getByRole('button',{name:'Касса',exact:true}).click();await page.locator('.tables-overview').waitFor();await page.locator('.table-first-card.table.free').first().click();await page.locator('.table-first-add').click();
  const dialog=page.locator('.table-first-catalog-dialog');await dialog.waitFor();await assertCards(dialog);
  assert.deepEqual(errors,[]);console.log('Catalog availability reasons passed in both cashier layouts');
 }finally{await desktop?.close();await server?.close();f.close();rmSync(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
