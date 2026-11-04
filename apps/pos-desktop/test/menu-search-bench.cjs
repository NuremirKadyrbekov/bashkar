'use strict';
// Disposable Electron profile and Local POS Server; no restaurant data.
const {mkdtempSync,rmSync}=require('node:fs');
const assert=require('node:assert/strict');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {_electron}=require('playwright');
const {fixture,password}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
async function main(){const f=await fixture(),profile=mkdtempSync(join(tmpdir(),'bashkar-search-bench-'));let server,desktop;try{
 f.storage.close();server=await createServer(f.dir,0,true,f.trust);
 desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+profile,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port),BASHKAR_TEST_CLIENT:'1',BASHKAR_TEST_PROFILE:'menu-search-bench'}});
 const page=await desktop.firstWindow();await page.getByRole('button',{name:'Войти по логину и паролю',exact:true}).click();await page.getByLabel('Логин',{exact:true}).fill('owner');await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('#nav [data-screen="menu"]').click();await page.locator('.menu-product-list').waitFor();
 for(const count of [100,500,1000]){
  const result=await page.evaluate(count=>{
   const base={archived:false,available:true,kitchen:false,price:10000,variants:[],groups:[]};menuState={mainLanguage:'ru',languages:['ru'],categories:Array.from({length:20},(_,index)=>({id:'cat_'+index,name:'Категория '+index,archived:false})),items:Array.from({length:count},(_,index)=>({...base,id:'item_'+index,name:'Блюдо '+String(index).padStart(4,'0'),categoryId:'cat_'+index%20,translations:{ky:'Тамак '+index}}))};menuUi.published=menuState;menuUi.availability={};menuUi.query='';menuUi.category='all';menuUi.filter='active';menuUi.sort='catalog';menuDrawProducts();
   const input=menuUi.root.querySelector('.menu-filters input');input.focus();input.setSelectionRange(0,0);const durations={full:[],empty:[]};for(let index=0;index<12;index++){const full=index%2===1;menuUi.query=full?'':'zzzz';const start=performance.now();menuDrawList(true);menuUi.root.offsetHeight;durations[full?'full':'empty'].push(performance.now()-start);}const median=values=>{values.sort((a,b)=>a-b);return Number(((values[2]+values[3])/2).toFixed(2));};return {items:count,fullMs:median(durations.full),emptyMs:median(durations.empty),nodes:document.querySelectorAll('*').length,focusPreserved:document.activeElement===input};
  },count);console.log(JSON.stringify(result));
 }
 const qa=await page.evaluate(()=>{const input=menuUi.root.querySelector('.menu-filters input'),list=menuUi.root.querySelector('.menu-product-list'),before=menuUi.searchRows.get('item_999');list.scrollTop=300;const scroll=list.scrollTop;input.focus();input.value='0999';input.setSelectionRange(2,2);input.dispatchEvent(new Event('input',{bubbles:true}));const focused=document.activeElement===input&&input.selectionStart===2;const narrowed=list.querySelectorAll('.menu-product-row').length===1;input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));const reused=menuUi.searchRows.get('item_999')===before;const restored=list.scrollTop===scroll;menuState.items[999].name='Изменённое блюдо';menuState.items[999].price=12345;menuUi.availability.item_999={available:false,revision:1};menuDrawList();input.value='Изменённое';input.dispatchEvent(new Event('input',{bubbles:true}));const row=list.querySelector('.menu-product-row');return {focused,narrowed,reused,restored,updated:row?.textContent.includes('Изменённое блюдо')&&row?.textContent.includes('123,45'),unavailable:row?.querySelector('input[type="checkbox"]')?.checked===false};});
 assert.deepEqual(qa,{focused:true,narrowed:true,reused:true,restored:true,updated:true,unavailable:true});console.log('PASS search QA: reused rows, focus/caret/scroll, updated name/price/availability.');
 }finally{await desktop?.close();await server?.close();f.close();rmSync(profile,{recursive:true,force:true});}}
main().catch(error=>{console.error(error);process.exitCode=1;});
