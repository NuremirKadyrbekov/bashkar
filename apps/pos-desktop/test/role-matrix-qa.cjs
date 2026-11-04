'use strict';
// Visual contract on a disposable in-page transport. Server enforcement has its own test.
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
   const me={id:'owner',name:'Owner',role:'OWNER',branchId:'branch',branchName:'QA',permissions:['employee.permissions.manage','employee.edit']};
   const keys=['table.open','table.view_status','table.batch.submit','order.correct','employee.create'];
   const rows=['OWNER','MANAGER','CASHIER','WAITER'].map(role=>({role,revision:1,permissions:keys.map(key=>({key,allowed:role!=='WAITER'||!key.startsWith('employee.'),enabled:key==='table.open',custom:false}))}));
   window.pos={onChanged:()=>()=>{},request:async(action,payload={})=>{
    if(action==='health')return {ok:true,value:{ready:false,state:'NEEDS_ACTIVATION'}};
    if(action==='activationStatus')return {ok:true,value:{configured:false}};
    if(action==='me')return {ok:true,value:me};
    if(action==='shift')return {ok:true,value:null};
    if(action==='pending')return {ok:true,value:[]};
    if(action==='activity')return {ok:true,value:{active:true}};
    if(action==='roleMatrix')return {ok:true,value:rows};
    if(action==='rolePermission'){const row=rows.find(item=>item.role===payload.role);if(row.revision!==payload.revision)return {ok:false,code:'REVISION_CONFLICT'};row.revision++;const permission=row.permissions.find(item=>item.key===payload.permission);permission.enabled=payload.allowed;permission.custom=true;return {ok:true,value:{role:row.role,revision:row.revision,enabled:payload.allowed}};}
    return {ok:false,code:'MOCK_UNSUPPORTED'};
   }};
  });
  await page.goto(pathToFileURL(resolve('apps/pos-desktop/index.html')).href);
  await page.getByRole('heading',{name:'Активация филиала'}).waitFor();
  await page.evaluate(async()=>{me=await api('me');screen='roleMatrix';serverSchema=19;await RoleMatrix.show();});
  assert.equal(await page.locator('#nav [data-screen=roleMatrix]').isDisabled(),true);
  assert.equal(await page.locator('.role-matrix-table tbody tr').count(),4);
  const waiterOpen=()=>page.locator('.role-matrix-table tbody tr').last().locator('button.role-matrix-cell').first();
  assert.equal(await waiterOpen().count(),1);
  const output=resolve('artifacts/role-matrix-qa');mkdirSync(output,{recursive:true});
  for(const [width,height] of [[1366,768],[1920,1080]]){await page.setViewportSize({width,height});await page.screenshot({path:resolve(output,`roles-${width}.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await waiterOpen().click();
  await page.getByRole('dialog').getByText('Изменение коснётся всех сотрудников этой роли в текущем филиале.').waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Отключить',exact:true}).click();
  await page.locator('.pos-toast.success').getByText('Права роли сохранены').waitFor();
  assert.match(await waiterOpen().getAttribute('class'),/custom/);
  await page.evaluate(async()=>{screen='roleMatrix';await render();});
  assert.equal(await page.locator('.role-matrix-screen').count(),0);
  assert.equal(await page.locator('#nav [data-screen=roleMatrix]').isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS role matrix UI: 4 role rows, confirmation, server save, 1366/1920 layout');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
