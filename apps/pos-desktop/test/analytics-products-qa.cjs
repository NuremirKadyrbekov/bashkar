'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const {mkdirSync}=require('node:fs');
async function main(){
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:1536,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{const me={id:'owner',name:'Владелец',role:'OWNER',branchId:'branch',branchName:'Ресторан «Центр»',permissions:[]};window.pos={onChanged:()=>()=>{},request:async(action,payload={})=>{
   if(action==='health')return {ok:true,value:{ready:false,state:'NEEDS_ACTIVATION'}};
   if(action==='activationStatus')return {ok:true,value:{configured:false}};
   if(action==='me')return {ok:true,value:me};
   if(action==='shift')return {ok:true,value:null};
   if(action==='pending')return {ok:true,value:[]};
   if(action==='activity')return {ok:true,value:{active:true}};
   if(action==='analyticsProducts')return {ok:true,value:{generatedAt:Date.now(),totalUnits:payload.from===payload.to?3:0,topProducts:payload.from===payload.to?[{productId:'plov',name:'Плов',categoryId:'hot',category:'Горячие блюда',quantity:3}]:[],cloudSync:{enabled:true,lastSuccessAt:null,lastError:'OFFLINE',pendingFacts:1}}};
   return {ok:false,code:'MOCK_UNSUPPORTED'};}};});
  await page.goto(pathToFileURL(resolve('apps/pos-desktop/index.html')).href);await page.getByRole('heading',{name:'Активация филиала'}).waitFor();
  await page.evaluate(async()=>{me=await api('me');serverSchema=25;screen='analyticsProducts';await render();});
  await page.getByRole('heading',{name:'Продажи блюд'}).waitFor();assert.equal(await page.locator('[data-product-units]').textContent(),'3');await page.getByText('Плов').waitFor();await page.getByText('Cloud отстаёт',{exact:false}).waitFor();
  const output=resolve('artifacts/desktop-qa');mkdirSync(output,{recursive:true});await page.screenshot({path:resolve(output,'analytics-products-1536.png'),fullPage:true});
  await page.getByRole('button',{name:'7 дней'}).click();await page.getByText('Нет продаж блюд за выбранный период').waitFor();assert.equal(await page.locator('[data-product-units]').textContent(),'0');
  await page.setViewportSize({width:820,height:950});await page.screenshot({path:resolve(output,'analytics-products-820.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{POSLayout.show({id:'cashier',name:'Кассир',role:'CASHIER',branchId:'branch',permissions:[]},'shift',25,x=>x,x=>x);});assert.equal(await page.locator('#nav [data-screen="analyticsProducts"]').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('PASS offline owner product page, empty state, Cloud delay and cashier visibility');
 }finally{await browser.close();}}
main().catch(error=>{console.error(error);process.exitCode=1;});
