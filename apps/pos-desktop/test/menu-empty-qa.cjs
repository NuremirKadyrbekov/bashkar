'use strict';
// One-time signed authority fixture. The test never touches a production profile.
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {_electron}=require('playwright');
const {fixture,password}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
async function main(){
 const f=await fixture(),userData=mkdtempSync(join(tmpdir(),'bashkar-empty-menu-'));let server,desktop;
 try{
  f.storage.close();server=await createServer(f.dir,0,true,f.trust);
  desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+userData,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port)}});
  const page=await desktop.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'Войти по логину и паролю',exact:true}).click();await page.getByLabel('Логин',{exact:true}).fill('owner');await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Меню',exact:true}).click();
  await page.locator('.menu-workspace').waitFor();await page.getByText('Пока нет товаров.',{exact:false}).waitFor();const before=await page.evaluate(()=>window.pos.request('menu'));assert.equal(before.value.revision,0);assert.equal(before.value.catalog,null);
  // The photo control stays visible during creation and explains its publication prerequisite.
  await page.locator('.menu-categories').getByRole('button',{name:'Добавить категорию',exact:true}).click();await page.locator('.menu-dialog').getByLabel('Название',{exact:true}).fill('Напитки');await page.locator('.menu-dialog').getByRole('button',{name:'Сохранить категорию',exact:true}).click();await page.locator('.menu-products').getByRole('button',{name:/Добавить товар/}).click();await page.locator('.menu-editor').getByRole('button',{name:'Удалить из черновика',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Подтвердить',exact:true}).click();await page.locator('.menu-products').getByRole('button',{name:/Добавить товар/}).click();assert.match(await page.locator('.menu-photo-controls').innerText(),/Фото блюда.*Сначала опубликуйте товар в меню/s);assert.equal(await page.locator('.menu-photo-controls').getByRole('button',{name:'Загрузить фото'}).isDisabled(),true);await page.locator('.menu-editor').getByLabel('Название',{exact:true}).fill('Вода');await page.locator('.menu-editor-tabs').getByRole('button',{name:'Варианты и размеры',exact:true}).click();await page.locator('.menu-matrix-row').getByLabel('Конечная цена, сом',{exact:true}).fill('35');await page.locator('.menu-editor').getByRole('button',{name:'Сохранить изменения',exact:true}).click();await page.locator('.menu-toolbar').getByRole('button',{name:'Сохранить черновик',exact:true}).click();await page.getByRole('status').filter({hasText:'Черновик сохранён'}).waitFor();
  const unpublished=await page.evaluate(()=>window.pos.request('menu'));assert.equal(unpublished.value.revision,0);assert.equal(unpublished.value.catalog,null);await page.locator('.menu-toolbar-tabs').getByRole('tab',{name:/Черновики/}).click();await page.locator('.menu-products').getByRole('button',{name:'Открыть черновик',exact:true}).click();await page.getByRole('button',{name:'Вода',exact:true}).waitFor();
  const port=server.server.address().port;await server.close();server=null;await page.locator('.menu-toolbar').getByRole('button',{name:'Опубликовать целиком',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Подтвердить',exact:true}).click();await page.waitForFunction(()=>!!document.querySelector('#status')?.textContent?.trim());const outageStatus=await page.locator('#status').textContent();assert.match(outageStatus,/Связь|результат|сервер|SERVER|RESULT/i);server=await createServer(f.dir,port,true,f.trust);const recovered=await page.evaluate(()=>window.pos.request('menu'));assert.equal(recovered.value.revision,0);assert.equal(recovered.value.catalog,null);assert.deepEqual(errors,[]);console.log('PASS empty activated menu: guided category/item creation, draft persisted and reopened, published revision remains 0 after local server outage.');
 }finally{if(desktop)await desktop.close();if(server)await server.close();f.close();rmSync(userData,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
