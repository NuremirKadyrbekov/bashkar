'use strict';
// Visual interaction check with a disposable in-page transport. Server behavior
// is verified separately by the local-server tests; no working profile is used.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const {mkdirSync}=require('node:fs');
async function main(){
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   const rows=[
    {id:'11111111-1111-4111-8111-111111111111',name:'Алиев Искандер',login:'iskander',phone:'+996 555 123 456',role:'MANAGER',status:'ACTIVE',revision:1,lastActivity:Date.now(),permissions:['employee.create','employee.edit'],delegations:[]},
    {id:'22222222-2222-4222-8222-222222222222',name:'Бекова Айдана',login:'aidana',phone:null,role:'CASHIER',status:'SUSPENDED',revision:1,lastActivity:Date.now()-86400000,permissions:[],delegations:[]}
   ];
   const me={id:'00000000-0000-4000-8000-000000000000',name:'Владелец',role:'OWNER',branchId:'branch',branchName:'Тестовый филиал',permissions:['employee.create','employee.edit','employee.archive.view','employee.password.reset','employee.status.manage','employee.permissions.manage','employee.pin.view','sales.view_24h']};
   window.pos={onChanged:()=>()=>{},request:async(action,payload={})=>{
    if(action==='health')return {ok:true,value:{ready:false,state:'NEEDS_ACTIVATION'}};
    if(action==='activationStatus')return {ok:true,value:{configured:false}};
    if(action==='me')return {ok:true,value:me};
    if(action==='shift')return {ok:true,value:null};
    if(action==='activity')return {ok:true,value:{active:true}};
    if(action==='pending')return {ok:true,value:[]};
    if(action==='employees'||action==='employeesArchive')return {ok:true,value:rows};
    if(action==='employeeStatistics')return {ok:true,value:{openedTables:12,submittedBatches:8,registeredPayments:15,corrections:2,revenueTodayCents:2456000}};
    if(action==='employeeCreate'){const row={id:'33333333-3333-4333-8333-333333333333',name:payload.name,login:payload.login,phone:payload.phone,role:payload.role,status:'ACTIVE',revision:1,lastActivity:null,pinIssued:payload.role!=='MANAGER',permissions:[],delegations:[]};rows.push(row);return {ok:true,value:{...row,temporaryPassword:'TEST-ONE-TIME-SECRET',temporaryPin:payload.role==='MANAGER'?undefined:'0123'}};}
    if(action==='pinReveal')return {ok:true,value:{pin:'0123',employeeId:payload.employeeId}};
    return {ok:false,code:'MOCK_UNSUPPORTED'};
   }};
  });
  await page.goto(pathToFileURL(resolve('apps/pos-desktop/index.html')).href);
  await page.getByRole('heading',{name:'Активация филиала'}).waitFor();
  await page.evaluate(async()=>{me=await api('me');screen='employees';await StaffScreen.show();});
  await page.getByRole('button',{name:/Алиев Искандер/}).click();
  await page.locator('.staff-stat-grid').waitFor({timeout:3000});
  assert.match(await page.locator('.staff-revenue').innerText(),/24\s?560/);
  const output=resolve('artifacts/staff-screen-qa');mkdirSync(output,{recursive:true});
  for(const [width,height] of [[1366,768],[1920,1080]]){await page.setViewportSize({width,height});await page.screenshot({path:resolve(output,`staff-${width}.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.getByRole('combobox',{name:'Роль',exact:true}).selectOption('CASHIER');
  assert.equal(await page.locator('.staff-row').count(),1);
  await page.getByRole('searchbox',{name:'Поиск сотрудников'}).fill('несуществующий');
  await page.getByText('Ничего не найдено.',{exact:false}).waitFor();
  await page.getByRole('searchbox',{name:'Поиск сотрудников'}).fill('');
  await page.getByRole('combobox',{name:'Роль',exact:true}).selectOption('ALL');
  await page.getByRole('combobox',{name:'Статус',exact:true}).selectOption('SUSPENDED');assert.equal(await page.locator('.staff-row').count(),1);
  await page.getByRole('combobox',{name:'Статус',exact:true}).selectOption('ALL');
  await page.getByRole('combobox',{name:'Сортировка',exact:true}).selectOption('oldest');assert.match(await page.locator('.staff-row').first().innerText(),/Бекова Айдана/);
  await page.getByRole('button',{name:/Добавить сотрудника/}).click();
  const form=page.locator('.staff-dialog');
  await form.getByLabel('Имя').fill('Тимур');
  await form.getByLabel('Фамилия').fill('Сариев');
  await form.getByLabel('Логин').fill('timur');
  await form.getByRole('combobox',{name:'Роль',exact:true}).selectOption('WAITER');
  await form.getByRole('button',{name:'Создать сотрудника'}).click();
  await page.getByRole('dialog').getByText('TEST-ONE-TIME-SECRET').waitFor();
  await page.getByRole('dialog').getByText('0123').waitFor();
  assert.equal(await page.locator('#status').innerText(),'');
  await page.locator('.pos-toast.success').getByText('Сотрудник создан').waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.locator('.staff-secret-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('.staff-row.selected').count(),1);
  const pinRow=page.locator('.staff-pin-row');assert.match(await pinRow.innerText(),/••••/);
  const reveal=pinRow.getByRole('button',{name:'Показать PIN-код сотрудника'});await reveal.click();
  await pinRow.getByText('0123').waitFor();await pinRow.getByText('••••').waitFor({timeout:4500});
  await reveal.click();await pinRow.getByText('0123').waitFor();
  await page.getByRole('button',{name:/Алиев Искандер/}).click();
  assert.match(await page.locator('.staff-pin-row').innerText(),/Не предусмотрен/);
  assert.deepEqual(errors,[]);
  console.log('staff mock UI passed: filters, revenue, one-time PIN, masked 3-second reveal, selection, create, 1366×768, 1920×1080');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
