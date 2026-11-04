'use strict';
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const ExcelJS=require('exceljs');
const {_electron}=require('playwright');
const {fixture,password}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
const {HEADERS,readWorkbook}=require('../menu-import-file.cjs');

async function main(){
 const f=await fixture(),userData=mkdtempSync(join(tmpdir(),'bashkar-import-ui-')),file=join(userData,'menu.xlsx');
 let server,desktop;
 try{
  f.storage.close();server=await createServer(f.dir,0,true,f.trust);
  desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+userData,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port)}});
  const page=await desktop.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'Войти по логину и паролю',exact:true}).click();
  await page.getByLabel('Логин',{exact:true}).fill('owner');await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Меню',exact:true}).click();
  await page.locator('.menu-toolbar-tabs').getByRole('tab',{name:'Импорт',exact:true}).click();
  await page.getByText('Образец файла',{exact:true}).waitFor();
  await desktop.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},file);
  await page.getByRole('button',{name:'Скачать шаблон Excel',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Шаблон сохранён'}).waitFor();
  assert.equal((await readWorkbook(file)).rows.length,5);
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Меню');sheet.addRow(HEADERS);
  for(const row of [
   ['hot','Горячие блюда','Ысык тамактар','Hot dishes','plov','Плов','Аш','Pilaf','','','','360','С говядиной','','','Да','Да'],
   ['drinks','Напитки','Суусундуктар','Drinks','tea','Чай','Чай','Tea','Маленький','Кичине','Small','100','Чёрный чай','','','Да','Нет'],
   ['drinks','Напитки','Суусундуктар','Drinks','tea','Чай','Чай','Tea','Большой','Чоң','Large','160','Чёрный чай','','','Да','Нет']
  ])sheet.addRow(row);
  await workbook.xlsx.writeFile(file);
  await desktop.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},file);
  await page.getByRole('button',{name:'Импортировать Excel',exact:true}).click();
  await page.getByText('3 строк · 2 категорий · 2 товаров · 2 вариантов',{exact:true}).waitFor();
  if(process.env.BASHKAR_MENU_IMPORT_SCREENSHOT){await page.locator('.menu-products').evaluate(el=>{el.scrollTop=el.scrollHeight;});await page.screenshot({path:process.env.BASHKAR_MENU_IMPORT_SCREENSHOT,fullPage:true});}
  await page.getByRole('button',{name:'Сохранить импорт в черновик',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Подтвердить',exact:true}).click();
  await page.locator('.menu-toolbar-tabs').getByRole('tab',{name:'Каталог',exact:true}).waitFor();
  await page.getByRole('button',{name:'Плов',exact:true}).waitFor();
  const published=await page.evaluate(()=>window.pos.request('menu'));
  assert.equal(published.value.revision,0);assert.equal(published.value.catalog,null);
  const drafts=await page.evaluate(()=>window.pos.request('drafts'));assert.equal(drafts.value.length,1);
  const draft=await page.evaluate(id=>window.pos.request('draftGet',{id}),drafts.value[0].id);
  assert.equal(draft.value.catalog.categories.length,2);assert.equal(draft.value.catalog.items.length,2);
  assert.deepEqual(draft.value.catalog.items.find(i=>i.name==='Чай').combinationPrices.map(c=>c.price),[10000,16000]);
  assert.deepEqual(errors,[]);
  assert.equal((await readWorkbook(file)).rows.length,3);
  console.log('PASS Excel preview and confirmed local draft save; published menu unchanged.');
 }finally{if(desktop)await desktop.close();if(server)await server.close();f.close();rmSync(userData,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
