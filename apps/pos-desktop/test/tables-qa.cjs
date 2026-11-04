'use strict';
// Disposable activation fixture only; never imported by production entrypoints.
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,mkdirSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {randomUUID}=require('node:crypto');
const {_electron}=require('playwright');
const {fixture,password,catalog}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {TableService}=require('../../../dist/apps/local-server/src/modules/tables/table-service.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
async function main(){
 const f=await fixture(),userData=mkdtempSync(join(tmpdir(),'bashkar-tables-qa-')),output=resolve('artifacts/tables-qa');mkdirSync(output,{recursive:true});let server,desktop;const errors=[];
 try{
  const owner=f.auth.current(f.token),employee=f.auth.employee(owner.id);await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:employee.revision,permission:'shift.open',allowed:true});
  const tables=new TableService(f.db,f.bus,f.auth,f.now);await tables.setMode(f.token,randomUUID(),{mode:'STRICT',revision:0});
  const menuDraft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});await f.menu.publish(f.token,randomUUID(),menuDraft);
  const main=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Основной зал',active:true});for(let n=1;n<=12;n++)await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:main.id,revision:0,name:String(n),active:true});
  for(const [name,number] of [['VIP','V1'],['Терраса','T1']]){const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name,active:true});await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name:number,active:true});}
  const cashier=await f.auth.createEmployee(f.token,randomUUID(),{login:'cashier',name:'Кассир',role:'CASHIER'}),first=await f.auth.login('cashier',cashier.temporaryPassword,'POS');await f.auth.changePassword(first.token,randomUUID(),cashier.temporaryPassword,password);
  f.storage.close();server=await createServer(f.dir,0,true,f.trust);const port=server.server.address().port;
  desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+userData,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(port),BASHKAR_TEST_CLIENT:'1',BASHKAR_TEST_PROFILE:'tables-qa'}});
  const page=await desktop.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.locator('#test-client').waitFor({state:'attached'});
  async function login(user){const result=await page.evaluate(({user,password})=>window.pos.request('login',{login:user,password}),{user,password});assert.equal(result.ok,true,result.code);await page.reload();await page.locator('#app-shell.is-authenticated').waitFor();}
  await login('owner');await page.getByRole('button',{name:'Смена не открыта',exact:false}).click();let shiftDialog=page.getByRole('dialog');await shiftDialog.getByLabel('Логин',{exact:true}).fill('owner');await shiftDialog.getByLabel('Пароль',{exact:true}).fill(password);await shiftDialog.getByRole('button',{name:'Открыть смену',exact:true}).click();await page.getByRole('button',{name:'Смена открыта',exact:false}).waitFor();await page.locator('#nav [data-screen=cashRegister]').click();await page.getByRole('heading',{name:'Столы',exact:true}).waitFor();
  assert.equal(await page.locator('#header-route').count(),0);assert.equal(await page.locator('#test-client').isVisible(),false);assert.equal(await page.locator('.recent-sales').count(),1);assert.equal(await page.locator('.table-first-card.table').count(),14);assert.equal(await page.locator('.table-zone-tabs,.table-filters,.table-panel-tabs').count(),0);await page.getByText('Последние продажи',{exact:true}).waitFor();assert.equal(await page.getByText('Доступ к столам',{exact:true}).count(),0);
  await page.setViewportSize({width:1366,height:768});assert.equal(await page.locator('.table-first-group').filter({has:page.getByRole('heading',{name:'VIP',exact:true})}).locator('.table-first-card').evaluate(n=>{const width=n.getBoundingClientRect().width;return width>140&&width<=170;}),true);
  for(const [width,height] of [[1366,768],[1920,1080]]){await page.setViewportSize({width,height});await page.screenshot({path:join(output,`tables-cashier-${width}x${height}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.getByRole('button',{name:'Столы и зоны',exact:true}).click();await page.getByRole('heading',{name:'Столы и зоны',exact:true}).waitFor();assert.equal(await page.locator('.table-config-zone').count(),3);await page.locator('.table-config-zone-pick').filter({hasText:'Основной зал'}).click();await page.locator('.table-config-card').nth(11).waitFor();assert.equal(await page.locator('.table-config-card').count(),12);assert.equal(await page.getByRole('button',{name:'SVG карта'}).isEnabled(),true);await page.setViewportSize({width:1366,height:768});await page.screenshot({path:join(output,'table-config-1366.png'),fullPage:true});
  const qrUrl='https://menu.example.test/b/branch/t/table',qrDataUrl=await require('qrcode').toDataURL(qrUrl);
  await page.evaluate(async({qrUrl,qrDataUrl})=>{
   const realApi=api,first=(await realApi('tables')).tables.find(row=>row.name==='1');
   window.restoreTableConfigApi=()=>{api=realApi;};
   api=async(action,payload)=>{
    if(action==='tablePublicLinks')return [{tableId:first.id,publicUrl:qrUrl,publicLinkStatus:'READY'}];
    if(action==='tablePublicQrBatch')return payload.tableIds.map(tableId=>({tableId,publicUrl:qrUrl,qrDataUrl}));
    if(action==='tablePublicQr')return {tableId:first.id,publicUrl:qrUrl,qrDataUrl};
    return realApi(action,payload);
   };
   await tableConfigView(false);
  },{qrUrl,qrDataUrl});
  const qrCard=page.locator('.table-config-card').filter({hasText:'1'}).first();
  await qrCard.locator('.table-config-card-qr img').waitFor();
  assert.equal(await qrCard.locator('.table-config-download').getAttribute('download'),'QR_Основной-зал_1.png');
  assert.equal(await page.locator('.table-config-card-qr img').count(),1);
  await page.screenshot({path:join(output,'table-config-qr-1366.png'),fullPage:true});
  await qrCard.getByRole('button',{name:'Изменить стол 1'}).click();
  await page.getByRole('dialog').getByRole('link',{name:'Скачать QR'}).waitFor();
  assert.equal(await page.getByRole('dialog').getByRole('link',{name:'Скачать QR'}).getAttribute('download'),'QR_Основной-зал_1.png');
  await page.getByRole('dialog').getByRole('button',{name:'Отмена'}).click();
  await page.evaluate(async()=>{window.restoreTableConfigApi();await tableConfigView(false);});
  await page.getByRole('button',{name:'SVG карта'}).click();await page.getByRole('button',{name:'Разместить зону · Основной зал'}).click();await page.getByRole('button',{name:'Разместить стол · 1',exact:true}).click();const marker=page.locator('svg .table-map-table'),box=await marker.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+12,{steps:5});await page.mouse.up();for(let number=2;number<=12;number++)await page.getByRole('button',{name:'Разместить стол · '+number,exact:true}).click();await page.getByRole('button',{name:'Форма стола: Круглый'}).click();await page.getByRole('button',{name:'Разместить зону · VIP'}).click();await page.getByRole('button',{name:'Разместить стол · V1'}).click();await page.getByRole('button',{name:'Разместить зону · Терраса'}).click();await page.getByRole('button',{name:'Разместить стол · T1'}).click();await page.getByRole('button',{name:'Сохранить карту'}).click();const savedPlan=await page.evaluate(async()=>window.pos.request('floorPlan'));assert.equal(savedPlan.ok,true);assert.equal(savedPlan.value.revision,1);assert.notEqual(savedPlan.value.plan.tables[0].y,195);await page.getByRole('button',{name:'Предпросмотр в зале'}).click();await page.locator('svg .table-map-table[role=button]').first().waitFor();await page.screenshot({path:join(output,'table-map-1366.png'),fullPage:true});await page.setViewportSize({width:1920,height:1080});await page.screenshot({path:join(output,'table-map-1920.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('svg .table-map-table[role=button]').first().click();await page.locator('.table-first-card.table.selected').waitFor();await page.getByRole('button',{name:'Столы и зоны',exact:true}).click();await page.getByRole('button',{name:'Карточки'}).click();
  await page.getByRole('button',{name:'+ Добавить стол'}).click();assert.equal(await page.getByRole('dialog').getByLabel('Стол № / название').inputValue(),'13');await page.getByRole('dialog').getByRole('button',{name:'Сохранить стол'}).click();await page.locator('.table-config-card').filter({hasText:'13'}).waitFor();
  await page.getByRole('button',{name:'+ Добавить стол'}).click();assert.equal(await page.getByRole('dialog').getByLabel('Стол № / название').inputValue(),'14');await page.getByRole('dialog').getByRole('button',{name:'Отмена'}).click();
  await page.getByRole('button',{name:'+ Добавить зону'}).click();await page.getByRole('dialog').getByLabel('Название зоны').fill('Летний зал');await page.getByRole('dialog').getByRole('button',{name:'Сохранить зону'}).click();await page.locator('.table-config-zone-pick').filter({hasText:'Летний зал'}).click();await page.getByRole('button',{name:'+ Добавить стол'}).click();assert.equal(await page.getByRole('dialog').getByLabel('Стол № / название').inputValue(),'14');await page.getByRole('dialog').getByLabel('Стол № / название').fill('L1');await page.getByRole('dialog').getByRole('button',{name:'Сохранить стол'}).click();await page.locator('.table-config-card').filter({hasText:'L1'}).waitFor();assert.equal(await page.locator('.table-config-card').count(),1);
  await page.getByRole('button',{name:'Изменить стол L1'}).click();await page.getByRole('dialog').getByRole('button',{name:'Убрать из работы'}).click();await page.getByRole('dialog').last().getByRole('button',{name:'Подтвердить'}).click();await page.locator('.table-config-card').filter({hasText:'L1'}).waitFor({state:'detached'});await page.getByRole('button',{name:'Показать неактивные'}).click();await page.locator('.table-config-card').filter({hasText:'L1'}).waitFor();
  await page.getByLabel('Язык интерфейса').selectOption('ky');await page.getByRole('heading',{name:'Столдор жана зоналар',exact:true}).waitFor();await page.evaluate(async()=>{screen='posSettings';await render();});assert.equal(await page.locator('.fast-settings>details,.pos-access-mode').count(),0);
  await page.evaluate(async()=>{await window.pos.request('logout');me=null;login();});await login('cashier');await page.getByRole('button',{name:'Столдор жана зоналар',exact:true}).click();await page.getByRole('heading',{name:'Столдор жана зоналар',exact:true}).waitFor();assert.equal(await page.locator('.table-config-zone-pick').filter({hasText:'Летний зал'}).count(),1);
  assert.deepEqual(errors,[]);console.log('PASS Tables Electron/macOS: cards and SVG plan, drag/save/click to cash, zone/table create and deactivate, Owner/Cashier, RU/KY, 1366x768 and 1920x1080; disposable fixture only.');
 }finally{if(desktop)await desktop.close();if(server)await server.close();f.close();rmSync(userData,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
