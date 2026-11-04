'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const {mkdirSync}=require('node:fs');
async function main(){const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{const me={id:'owner',name:'Владелец',role:'OWNER',branchId:'branch',branchName:'Ресторан',permissions:['employee.edit','employee.permissions.manage']};window.__records=[{key:'pending-1',id:'11111111-1111-4111-8111-111111111111',action:'employeePermission',payload:{name:'А'.repeat(180),permission:'employee.create',allowed:true}}];window.pos={onChanged:()=>()=>{},request:async(action)=>{
  if(action==='health')return {ok:true,value:{ready:false,state:'NEEDS_ACTIVATION'}};
  if(action==='activationStatus')return {ok:true,value:{configured:false}};
  if(action==='me')return {ok:true,value:me};
  if(action==='shift')return {ok:true,value:null};
  if(action==='pending')return {ok:true,value:window.__records};
  if(action==='retryPending'){window.__records=[];return {ok:true,value:{}};}
  if(action==='activity')return {ok:true,value:{active:true}};
  if(action==='analyticsProducts')return {ok:true,value:{generatedAt:Date.now(),totalUnits:0,topProducts:[],cloudSync:{enabled:false,lastSuccessAt:null,lastError:null,pendingFacts:0}}};
  return {ok:false,code:'MOCK_UNSUPPORTED'};
 }};});
 await page.goto(pathToFileURL(resolve('apps/pos-desktop/index.html')).href);await page.getByRole('heading',{name:'Активация филиала'}).waitFor();
 await page.evaluate(async()=>{me=await api('me');serverSchema=25;screen='analyticsProducts';await render();});
 const panel=page.locator('#pending-commands');await panel.waitFor();
 for(const [width,height] of [[390,844],[820,950],[1536,1000]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow at '+width);const bounds=await panel.boundingBox();assert.ok(bounds.width<=width&&bounds.height<=300,'pending panel exceeds viewport at '+width);}
 const output=resolve('artifacts/desktop-qa');mkdirSync(output,{recursive:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(output,'pending-layout-390.png'),fullPage:true});
 await panel.locator('summary').click();assert.equal(await panel.locator('details').evaluate(node=>node.open),false);
 await page.evaluate(async()=>{screen='cashRegister';shell('Касса');await pendingPanel();message('X'.repeat(500));toast('error','Y'.repeat(500));});
 assert.equal(await page.locator('#pending-commands details').evaluate(node=>node.open),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#pending-commands summary').click();await page.getByRole('button',{name:'Повторить исходное действие'}).click();await panel.waitFor({state:'detached'});assert.deepEqual(errors,[]);
 console.log('PASS pending recovery layout 390/820/1536, collapse, long text and resolved retry');
 }finally{await browser.close();}}
main().catch(error=>{console.error(error);process.exitCode=1;});
