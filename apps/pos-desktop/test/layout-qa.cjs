'use strict';
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,mkdirSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {randomUUID}=require('node:crypto');
const {_electron}=require('playwright');
const {fixture,password}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {TableService}=require('../../../dist/apps/local-server/src/modules/tables/table-service.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');

async function main(){
 const f=await fixture(),userData=mkdtempSync(join(tmpdir(),'bashkar-layout-qa-')),output=resolve('artifacts/layout-qa');
 mkdirSync(output,{recursive:true});let server,desktop;
 try{
  const owner=f.auth.current(f.token),employee=f.auth.employee(owner.id);
  await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:employee.revision,permission:'shift.open',allowed:true});
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  const tables=new TableService(f.db,f.bus,f.auth);
  const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Основной зал',active:true});
  await tables.setMode(f.token,randomUUID(),{revision:0,mode:'STRICT'});
  for(let i=1;i<=12;i++)await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name:'Стол '+i,active:true});
  const cashier=await f.auth.createEmployee(f.token,randomUUID(),{login:'cashier-layout',name:'Алина',role:'CASHIER'});
  const first=await f.auth.login('cashier-layout',cashier.temporaryPassword,'POS');
  await f.auth.changePassword(first.token,randomUUID(),cashier.temporaryPassword,password);
  f.storage.close();server=await createServer(f.dir,0,true,f.trust);
  desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+userData,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port),BASHKAR_TEST_CLIENT:'1',BASHKAR_TEST_PROFILE:'layout-qa'}});
  const page=await desktop.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('heading',{name:'Вход кассира'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Локальный Owner / Manager'}).count(),0);
  await page.getByRole('button',{name:'Кабинет владельца'}).click();
  await page.getByRole('heading',{name:'Вход владельца'}).waitFor();
  assert.equal(await page.getByLabel('Email облачного Owner').count(),1);
  await page.getByRole('button',{name:'Войти по PIN'}).click();
  for(const size of [{width:1366,height:768},{width:800,height:600}]){
   await page.setViewportSize(size);
   const bounds=await page.evaluate(()=>{const root=document.querySelector('#screen'),card=document.querySelector('.auth-screen'),actions=card.querySelector('.auth-actions');return {cardHeight:card.clientHeight,cardContentHeight:card.scrollHeight,documentScroll:document.documentElement.scrollHeight>innerHeight,cardScroll:card.scrollHeight>card.clientHeight+1,actionsVisible:actions.getBoundingClientRect().bottom<=root.getBoundingClientRect().bottom+1};});
   await page.screenshot({path:join(output,`login-${size.width}x${size.height}.png`)});
   assert.equal(bounds.documentScroll,false,JSON.stringify({size,bounds}));
   assert.equal(bounds.cardScroll,false,JSON.stringify({size,bounds}));
   assert.equal(bounds.actionsVisible,true,JSON.stringify({size,bounds}));
  }
  await page.setViewportSize({width:1366,height:768});
  await page.getByRole('button',{name:'Войти по логину и паролю',exact:true}).click();
  await page.getByLabel('Логин',{exact:true}).fill('cashier-layout');
  await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await page.getByRole('heading',{name:'Столы',exact:true}).waitFor();
  assert.equal(await page.locator('.table-card').count(),12);
  const header=page.locator('#pos-header'),handle=page.locator('#header-toggle');
  const waitHeader=async open=>{await page.waitForFunction(open=>{const header=document.getElementById('pos-header');return header.inert!==open&&(open?Math.abs(header.getBoundingClientRect().top)<.5:getComputedStyle(header).visibility==='hidden');},open);};
  const geometry=()=>page.locator('#workspace').evaluate(node=>{const rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};});
  for(const size of [{width:1366,height:768},{width:1920,height:1080}]){
   await page.setViewportSize(size);await waitHeader(false);const before=await geometry();assert.equal(before.y,28);
   await handle.hover();await handle.focus();await page.waitForTimeout(350);assert.equal(await header.evaluate(node=>node.inert),true);
   await page.screenshot({path:join(output,`header-hidden-${size.width}.png`)});
   const opened=Date.now();await page.keyboard.press('Enter');await waitHeader(true);await page.keyboard.press('Tab');assert.equal(await page.locator('#header-back').evaluate(node=>node===document.activeElement),true);
   await page.locator('#header-back').hover();assert.deepEqual(await geometry(),before);await page.screenshot({path:join(output,`header-open-${size.width}.png`)});
   await page.waitForTimeout(3000);assert.equal(await header.evaluate(node=>node.inert),false);await waitHeader(false);assert.ok(Date.now()-opened>=3950);assert.deepEqual(await geometry(),before);assert.equal(await handle.evaluate(node=>node===document.activeElement),true);
  }
  await handle.click();await waitHeader(true);await page.keyboard.press('Escape');await waitHeader(false);
  // Switching to a normal route cancels the sales timer and restores a persistent header.
  await handle.click();await page.locator('#header-settings').click();await page.getByRole('heading',{name:'Как вам удобнее продавать?'}).waitFor();assert.equal(await handle.isVisible(),false);assert.equal((await geometry()).y,76);await page.waitForTimeout(4250);assert.equal(await header.isVisible(),true);assert.equal(await header.evaluate(node=>node.inert),false);
  await page.screenshot({path:join(output,'header-fixed-settings.png')});
  await page.locator('[data-view=FAST_FIRST]').click();await page.getByRole('button',{name:'Сохранить вид экрана'}).click();await page.locator('#nav [data-screen=cashRegister]').click();await page.locator('.fast-sales').waitFor();await waitHeader(false);
  const fastBefore=await geometry();assert.equal(fastBefore.y,28);await handle.click();await waitHeader(true);await page.locator('#language').focus();await waitHeader(false);assert.deepEqual(await geometry(),fastBefore);
  // A second click extends the display period; pointer/focus cannot keep it open indefinitely.
  await handle.click();await waitHeader(true);await page.waitForTimeout(1000);await handle.click();await page.waitForTimeout(3200);assert.equal(await header.evaluate(node=>node.inert),false);await waitHeader(false);
  await handle.click();await page.locator('#header-settings').click();await page.getByRole('heading',{name:'Как вам удобнее продавать?'}).waitFor();await page.locator('[data-view=TABLE_FIRST]').click();await page.getByRole('button',{name:'Сохранить вид экрана'}).click();
  await page.locator('#nav [data-screen=shift]').click();await page.getByRole('heading',{name:'Кассовая смена',exact:true}).waitFor();assert.equal(await handle.isVisible(),false);assert.equal(await header.isVisible(),true);assert.equal((await geometry()).y,76);
  await page.locator('#nav [data-screen=cashRegister]').click();await page.getByRole('heading',{name:'Столы',exact:true}).waitFor();await waitHeader(false);
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await header.evaluate(node=>getComputedStyle(node).transitionDuration),'0s');await page.emulateMedia({reducedMotion:'no-preference'});
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const tap=async(x,y)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
  const target=await handle.boundingBox();assert.ok(target.width>=148&&target.height>=44);await tap(target.x+target.width/2,target.y+target.height/2);await waitHeader(true);await tap(1900,1060);await page.waitForTimeout(400);assert.equal(await header.evaluate(node=>node.inert),false);await waitHeader(false);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});await cdp.detach();await page.setViewportSize({width:1366,height:768});
  const metrics=await page.evaluate(()=>{
   const content=document.querySelector('.tables-content'),sidebar=document.querySelector('#nav');
   const rect=content.getBoundingClientRect();
   return {viewport:[innerWidth,innerHeight],documentScroll:document.documentElement.scrollHeight>innerHeight,contentScroll:content.scrollHeight>content.clientHeight+1,sidebarVisible:getComputedStyle(sidebar).display!=='none',lastCardBottom:content.querySelector('.table-card:last-child').getBoundingClientRect().bottom,contentBottom:rect.bottom,identity:document.querySelector('#identity').textContent};
  });
  await page.screenshot({path:join(output,'cashier-1366x768.png')});
  assert.equal(metrics.documentScroll,false,JSON.stringify(metrics));
  assert.equal(metrics.contentScroll,false,JSON.stringify(metrics));
  assert.equal(metrics.sidebarVisible,false,JSON.stringify(metrics));
  assert.equal(metrics.identity.includes('Алина'),true,JSON.stringify(metrics));
  assert.equal(metrics.identity.includes(cashier.id),false,JSON.stringify(metrics));
  assert.deepEqual(errors,[]);
  console.log('PASS sales-only header: click/Enter, no hover/focus opening, 4s auto close and extension, fixed header in settings/shift, both cashier modes, no layout shift, touch, Escape/inert, reduced motion, 1366/1920 and 12 real tables.');
 }finally{if(desktop)await desktop.close();if(server)await server.close();f.close();rmSync(userData,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
