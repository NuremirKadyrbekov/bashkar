'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const {mkdirSync}=require('node:fs');
async function main(){
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1536,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   const me={id:'owner',name:'Владелец',role:'OWNER',branchId:'branch',branchName:'Ресторан «Центр»',permissions:['shift.report.view','sales.view_24h']};
   window.pos={onChanged:()=>()=>{},request:async(action,payload={})=>{
    if(action==='health')return {ok:true,value:{ready:false,state:'NEEDS_ACTIVATION'}};
    if(action==='activationStatus')return {ok:true,value:{configured:false}};
    if(action==='me')return {ok:true,value:me};
    if(action==='shift')return {ok:true,value:null};
    if(action==='pending')return {ok:true,value:[]};
    if(action==='activity')return {ok:true,value:{active:true}};
    if(action==='analyticsOverview'){
     const one=payload.from===payload.to,points=Array.from({length:one?24:7},(_,index)=>({period:one?payload.from+'T'+String(index).padStart(2,'0'):new Date(Date.parse(payload.from+'T00:00:00Z')+index*86400000).toISOString().slice(0,10),amount:String(index*100000)}));
     return {ok:true,value:{range:{granularity:one?'hour':'day'},generatedAt:Date.now(),grossPaymentsAmount:'6000000',refundsAmount:'200000',netReceiptsAmount:'5800000',paidOrdersCount:40,averageCheckAmount:'150000',discountsAmount:'350000',cancelledOrdersCount:2,dynamics:points,paymentMethods:{CASH:'2500000',CARD_MANUAL:'2000000',QR_TRANSFER_MANUAL:'1500000'},serviceTypes:{TABLE:{amount:'3400000',paidOrdersCount:24},COUNTER:{amount:'2600000',paidOrdersCount:16}},cloudSync:{enabled:true,lastSuccessAt:Date.now()-60000,lastError:null,pendingFacts:0}}};
    }
    return {ok:false,code:'MOCK_UNSUPPORTED'};
   }};
  });
  await page.goto(pathToFileURL(resolve('apps/pos-desktop/index.html')).href);
  await page.getByRole('heading',{name:'Активация филиала'}).waitFor();
  await page.evaluate(async()=>{me=await api('me');screen='analyticsOverview';serverSchema=24;await analyticsOverviewView();});
  await page.getByText('Cloud актуален',{exact:false}).waitFor();
  assert.equal(await page.locator('[data-analytics-value="net"]').textContent(),'58 000 сом');
  assert.equal(await page.locator('.analytics-plot svg').count(),1);
  const output=resolve('artifacts/desktop-qa');mkdirSync(output,{recursive:true});
  await page.screenshot({path:resolve(output,'analytics-overview-1536.png'),fullPage:true});
  await page.getByRole('button',{name:'7 дней'}).click();
  await page.getByText('Сумма оплат по дням').waitFor();
  await page.setViewportSize({width:820,height:950});
  await page.screenshot({path:resolve(output,'analytics-overview-820.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('PASS owner desktop analytics layout, local metrics, Cloud freshness and period switching');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
