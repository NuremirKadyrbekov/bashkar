'use strict';
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,rmSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {_electron}=require('playwright');
const {blankFixture}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
async function main(){
 const f=blankFixture(),userData=mkdtempSync(join(tmpdir(),'bashkar-owner-cloud-ui-'));
 const email='owner@cloud.example',password='fixture-cloud-secret',accessToken='fixture-cloud-access-token';
 let desktop,server,online=true;
 const network=async(url,init)=>{
  if(!online)throw Error('offline');
  const path=String(url);
  if(path.includes('/token?')){
   const input=JSON.parse(String(init.body));
   return input.email===email&&input.password===password?Response.json({access_token:accessToken}):Response.json({error:'invalid_grant'},{status:400});
  }
  if(path.endsWith('/user'))return Response.json({id:f.claims.ownerCloudId,email,email_confirmed_at:'2026-10-23'});
  if(path.includes('/organizations?'))return Response.json([{id:f.claims.organizationId}]);
  if(path.includes('/branches?'))return Response.json([{id:f.claims.branchId,organization_id:f.claims.organizationId}]);
  throw Error('unexpected-cloud-route');
 };
 try{
  await f.activation.activateCloudOwner(f.receipt,{email,ownerCloudId:f.claims.ownerCloudId},f.claims.nonce);
  f.storage.close();server=await createServer(f.dir,0,true,{...f.trust,cloud:{url:'https://cloud.example',publishableKey:'fixture-key'},network});
  desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+userData,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port)}});
  const page=await desktop.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('heading',{name:'Вход кассира'}).waitFor();
  await page.getByRole('button',{name:'Кабинет владельца'}).click();
  await page.getByRole('heading',{name:'Вход владельца'}).waitFor();
  await page.getByLabel('Email облачного Owner').fill(email);
  await page.getByLabel('Облачный пароль').fill(password);
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await page.getByRole('heading',{name:'Кассовая смена'}).waitFor();
  assert.match(await page.locator('#identity').textContent(),/owner@cloud\.example/);
  for(const route of ['cashRegister','sales','menu','shift','employees','roleMatrix'])assert.equal(await page.locator(`[data-screen="${route}"]`).isVisible(),true,route);
  assert.deepEqual(await page.locator('.pos-sidebar-main [data-screen]').evaluateAll(buttons=>buttons.map(button=>button.dataset.screen)),['cashRegister','sales','menu','tableConfig','shift','employees','roleMatrix']);
  assert.equal(await page.locator('#owner-nav-group').count(),0);
  const settingsGroup=page.locator('#settings-nav-group');assert.equal(await settingsGroup.isVisible(),true);assert.equal(await settingsGroup.evaluate(node=>node.open),false);
  assert.equal(await page.locator('#nav [data-screen="pins"]').count(),0);
  await page.setViewportSize({width:800,height:600});
  assert.equal(await settingsGroup.isVisible(),true);
  await page.locator('[data-screen="sales"]').click();await page.getByRole('heading',{name:'Журнал продаж'}).waitFor();
  await settingsGroup.locator('summary').click();assert.equal(await settingsGroup.getByRole('button',{name:'Основные'}).isVisible(),true);assert.equal(await settingsGroup.getByRole('button',{name:'Печать'}).isVisible(),true);
  await settingsGroup.getByRole('button',{name:'Основные'}).click();await page.getByRole('heading',{name:'Основные',exact:true}).waitFor();
  await settingsGroup.getByRole('button',{name:'Печать'}).click();await page.getByRole('heading',{name:'Печать',exact:true}).waitFor();
  await page.locator('[data-screen="waiterNetwork"]').click();await page.getByRole('heading',{name:'Настройка веб-экрана'}).waitFor();
  const state=readFileSync(join(userData,'protected-session.bin'));
  assert.equal(state.includes(Buffer.from(password)),false);
  assert.equal(state.includes(Buffer.from(accessToken)),false);
  online=false;await page.getByRole('button',{name:'Сотрудники',exact:true}).click();
  await page.getByRole('heading',{name:'Сотрудники'}).waitFor();
  const denied=await page.evaluate(()=>window.pos.request('password',{oldPassword:'x',newPassword:'some-new-password'}));
  assert.equal(denied.code,'OWNER_CLOUD_PASSWORD_ONLY');
  assert.deepEqual(errors,[]);
  console.log('PASS Desktop cloud Owner login, direct owner links and settings group at 800x600, Journal/Basic/Print/Web pages, cached reads, and fresh check for mutations. Disposable fixture only.');
 }finally{if(desktop)await desktop.close();if(server)await server.close();f.close();rmSync(userData,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
