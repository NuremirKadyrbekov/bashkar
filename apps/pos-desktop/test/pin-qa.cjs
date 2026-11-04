'use strict';
// Only disposable fixture data and exact Keychain account created by this run.
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,mkdirSync,rmSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {_electron}=require('playwright');
const {fixture,password,catalog}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {PinService}=require('../../../dist/apps/local-server/src/modules/auth/pin-service.js');
const {PlatformPinKeys}=require('../../../dist/apps/local-server/src/modules/auth/pin-crypto.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
async function main(){
 const f=await fixture(),userData=mkdtempSync(join(tmpdir(),'bashkar-pin-desktop-')),output=resolve('artifacts/pin-qa');mkdirSync(output,{recursive:true});let desktop,server,createdKey=false;const errors=[];
 const account=createHash('sha256').update(resolve(f.dir)).digest('hex');
 try{
 const pins=new PinService(f.auth,new PlatformPinKeys(f.dir));
 const people={};for(const [login,role]of [['cash-one','CASHIER'],['cash-two','CASHIER'],['waiter-one','WAITER']]){
 const e=await f.auth.createEmployee(f.token,randomUUID(),{login,name:login,role});people[login]=e;
 if(role==='CASHIER'){const temp=await f.auth.login(login,e.temporaryPassword,'POS');await f.auth.changePassword(temp.token,randomUUID(),e.temporaryPassword,password);}
 const issued=await pins.assign(f.token,randomUUID(),{employeeId:e.id,revision:f.auth.employee(e.id).revision},false);createdKey=true;e.pin=issued.temporaryPin;
 }
 const noPin=await f.auth.createEmployee(f.token,randomUUID(),{login:'no-pin',name:'no-pin',role:'WAITER'});
 const d=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});await f.menu.publish(f.token,randomUUID(),d);
 f.storage.close();server=await createServer(f.dir,0,true,f.trust);const port=server.server.address().port;
 async function launch(){desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+userData,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(port)}});const page=await desktop.firstWindow();page.on('pageerror',e=>errors.push(e.message));return page;}
 let page=await launch();await page.getByRole('heading',{name:'Вход кассира',exact:true}).waitFor();assert.equal(await page.getByLabel('Логин',{exact:true}).count(),0);await page.screenshot({path:join(output,'cashier-login.png'),fullPage:true});
 async function reveal(){if(await page.locator('#app-shell.has-auto-header:not(.is-header-open)').count())await page.locator('#header-toggle').click();}
 async function exit(){await reveal();await page.getByRole('button',{name:'Выйти',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Выйти',exact:true}).click();}
 await page.getByLabel('PIN',{exact:true}).fill(people['waiter-one'].pin);await page.waitForFunction(()=>document.querySelector('.pin-input')?.value==='');assert.equal(await page.getByRole('heading',{name:'Вход кассира',exact:true}).count(),1);
 await page.getByLabel('PIN',{exact:true}).fill(people['cash-one'].pin);await page.getByRole('heading',{name:'Столы',exact:true}).waitFor();assert.match(await page.locator('#identity').textContent(),/cash-one.*Кассир/);assert.equal(await page.getByRole('button',{name:'Сотрудники',exact:true}).count(),0);
 await page.locator('#header-toggle').click();await page.getByRole('button',{name:'Назад',exact:true}).click();await page.getByRole('button',{name:'Меню',exact:true}).click();await page.locator('.menu-workspace').waitFor();
 const forbidden=await page.evaluate(employeeId=>window.pos.request('pinReveal',{employeeId}),people['cash-two'].id);assert.equal(forbidden.code,'PIN_VIEW_DENIED');
 assert.equal(await page.locator('#nav [data-screen="pins"]').count(),0);
 assert.equal(await page.evaluate(pin=>JSON.stringify({...localStorage}).includes(pin),people['waiter-one'].pin),false);
 await exit();await page.getByRole('heading',{name:'Вход кассира',exact:true}).waitFor();
 await page.getByRole('button',{name:'Войти по логину и паролю',exact:true}).click();await page.getByLabel('Логин',{exact:true}).fill('cash-one');await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('heading',{name:'Столы',exact:true}).waitFor();
 await desktop.close();desktop=undefined;await server.close();server=await createServer(f.dir,port,true,f.trust);page=await launch();await page.locator('#identity').filter({hasText:'cash-one'}).waitFor();
 await reveal();await page.getByRole('button',{name:'Смена не открыта',exact:false}).click();await page.getByRole('dialog').getByLabel('PIN',{exact:true}).fill(people['cash-one'].pin);await page.getByRole('dialog').getByRole('button',{name:'Открыть смену',exact:true}).click();await page.locator('#shift-indicator.is-open').waitFor();
 await exit();await page.getByLabel('PIN',{exact:true}).fill(people['cash-one'].pin);await page.getByRole('heading',{name:'Столы',exact:true}).waitFor();
 await reveal();await page.getByLabel('Язык интерфейса').selectOption('ky');await page.getByRole('heading',{name:'Столдор',exact:true}).waitFor();await page.screenshot({path:join(output,'cashier-ky.png'),fullPage:true});
 await reveal();await page.getByLabel('Язык интерфейса').selectOption('ru');await exit();await page.getByRole('button',{name:'Войти по логину и паролю',exact:true}).click();await page.getByLabel('Логин',{exact:true}).fill('owner');await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('heading',{name:'Кассовая смена',exact:true}).waitFor();
 await page.getByRole('button',{name:'Сотрудники',exact:true}).click();await page.locator('.staff-row').filter({hasText:'no-pin'}).waitFor();assert.equal(await page.locator('.staff-screen').getByText('PIN',{exact:true}).count(),0);
 const issuedByOwner=await page.evaluate(employeeId=>window.pos.request('pinIssue',{employeeId,revision:1}),noPin.id);assert.equal(issuedByOwner.ok,true);assert.ok(/^\d{4}$/.test(issuedByOwner.value.temporaryPin));
 const currentCash=await page.evaluate(()=>window.pos.request('employees'));const cashTwo=currentCash.value.find(row=>row.login==='cash-two');const resetByOwner=await page.evaluate(row=>window.pos.request('pinReset',{employeeId:row.id,revision:row.revision}),cashTwo);assert.equal(resetByOwner.ok,true);const replacement=resetByOwner.value.temporaryPin;assert.ok(replacement!==people['cash-two'].pin,'reset must replace credential');await exit();
 await page.getByLabel('PIN',{exact:true}).fill(replacement);await page.getByRole('heading',{name:'Столы',exact:true}).waitFor();
 const state=readFileSync(join(userData,'protected-session.bin'));for(const e of Object.values(people))assert.equal(state.includes(Buffer.from(e.pin)),false);
 assert.deepEqual(errors,[]);console.log('PASS PIN Electron/macOS: actual Keychain issue/reload, cashier PIN/password, waiter rejection, direct-ID scope, dedicated PIN page removed, confirmed exit, offline local restart, PIN-confirmed shift, owner API issue/reset and RU/KY. Disposable fixture only; no Windows/cloud/Waiter transport claim.');
 }catch(error){if(desktop){const page=await desktop.firstWindow();await page.locator('code.secret,input[type=password]').evaluateAll(nodes=>nodes.forEach(n=>{if(n.tagName==='INPUT')n.value='';else n.textContent='[hidden]';}));await page.screenshot({path:join(output,'failure.png'),fullPage:true});console.error('PIN QA status:',await page.locator('#status').textContent());}throw error;}
 finally{if(desktop)await desktop.close();if(server)await server.close();if(createdKey&&process.platform==='darwin')execFileSync('/usr/bin/security',['delete-generic-password','-a',account,'-s','kg.bashkar.local-server.pin'],{stdio:'pipe'});f.close();rmSync(userData,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
