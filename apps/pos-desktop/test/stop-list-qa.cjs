'use strict';
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,rmSync,mkdirSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {randomUUID}=require('node:crypto');
const {_electron}=require('playwright');
const {fixture,password,catalog}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');

async function main(){
 const f=await fixture(),profile=mkdtempSync(join(tmpdir(),'bashkar-stop-list-'));
 let server,desktop;
 try{
  const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});
  await f.menu.publish(f.token,randomUUID(),draft);
  f.storage.close();server=await createServer(f.dir,0,true,f.trust);
  desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+profile,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port)}});
  const page=await desktop.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'Войти по логину и паролю',exact:true}).click();
  await page.getByLabel('Логин',{exact:true}).fill('owner');await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();
  await page.getByRole('button',{name:'Стоп-лист',exact:true}).click();
  await page.getByRole('heading',{name:'Стоп-лист',exact:true}).waitFor();
  const coffee=page.locator('.stop-list-item').filter({hasText:'Кофе'});
  await coffee.getByRole('button',{name:'Показать варианты'}).click();
  const small=coffee.locator('.stop-list-variant').filter({hasText:'250 мл'});
  await small.getByRole('button',{name:'Стоп',exact:true}).click();
  await page.waitForFunction(async()=>{const r=await window.pos.request('menu');return r.value?.availability?.small?.available===false;});
  await coffee.locator('.stop-list-item-top').getByRole('button',{name:'Стоп',exact:true}).click();
  await page.waitForFunction(async()=>{const r=await window.pos.request('menu');return r.value?.availability?.coffee?.available===false;});
  await coffee.locator('.stop-list-item-top').getByRole('button',{name:'Вернуть',exact:true}).click();
  await page.waitForFunction(async()=>{const r=await window.pos.request('menu');return r.value?.availability?.coffee?.available===true;});
  assert.match(await small.textContent(),/В стопе/);
  await page.getByRole('button',{name:/Остановить все/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Подтвердить',exact:true}).click();
  await page.waitForFunction(async()=>{const r=await window.pos.request('menu');return r.value?.availability?.coffee?.available===false;});
  await page.getByRole('button',{name:/Вернуть все/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Подтвердить',exact:true}).click();
  await page.waitForFunction(async()=>{const r=await window.pos.request('menu');return r.value?.availability?.coffee?.available===true;});
  assert.match(await small.textContent(),/В стопе/);
  const output=resolve('artifacts/desktop-qa');mkdirSync(output,{recursive:true});
  await page.screenshot({path:join(output,'stop-list.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await desktop.close();desktop=null;await server.close();server=null;
  server=await createServer(f.dir,0,true,f.trust);
  const persisted=await server.inject({method:'GET',url:'/api/v1/menu',headers:{authorization:'Bearer '+f.token}});
  assert.equal(persisted.statusCode,200);assert.equal(persisted.json().availability.small.available,false);
  console.log('Stop-list desktop QA passed');
 }finally{await desktop?.close();await server?.close();f.close();rmSync(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
