'use strict';
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {_electron}=require('playwright');
const {fixture,password}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
async function main(){const f=await fixture(),profile=mkdtempSync(join(tmpdir(),'bashkar-media-qa-'));let server,desktop;try{
 f.storage.close();server=await createServer(f.dir,0,true,f.trust);
 desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+profile,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port),BASHKAR_TEST_CLIENT:'1',BASHKAR_TEST_PROFILE:'media-async-qa'}});
 const page=await desktop.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'Войти по логину и паролю',exact:true}).click();await page.getByLabel('Логин',{exact:true}).fill('owner');await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('#nav [data-screen="menu"]').click();await page.locator('.menu-workspace').waitFor();
 const product=await page.evaluate(async()=>{
  const items=['a','b'].map(id=>({id,categoryId:'food',name:'Блюдо '+id,archived:false,available:true,kitchen:false,price:10000,variants:[],groups:[]}));menuState={mainLanguage:'ru',languages:['ru'],categories:[{id:'food',name:'Еда',archived:false}],items};menuUi.published=menuState;menuUi.revision=7;menuUi.item='a';menuUi.form=null;menuDraw();
  const original=api,originalConfirm=confirmAction,pending=[];confirmAction=async()=>true;let calls=0,instant=false,fail=false;
  api=async(action,payload)=>{if(action==='menuPhotoStatus'){calls++;if(!instant)return new Promise((resolve,reject)=>pending.push({id:payload.itemId,resolve,reject}));if(fail)throw Error('PHOTO_CLOUD_UNAVAILABLE');return {url:'https://qa.invalid/'+payload.itemId,itemRevision:2};}if(action==='menuPhotoUpload')return {url:'https://qa.invalid/uploaded',itemRevision:3};if(action==='menuPhotoRemove')return {url:null,itemRevision:4};return original(action,payload);};
  const first=menuLoadPhoto('a');menuUi.item='b';menuUi.form=null;menuDrawEditor();const second=menuLoadPhoto('b');pending.find(row=>row.id==='a').resolve({url:'https://qa.invalid/a',itemRevision:1});await first;const oldIgnored=menuUi.photos.a?.url!== 'https://qa.invalid/a'&&menuUi.photos.b?.loading===true;pending.find(row=>row.id==='b').resolve({url:'https://qa.invalid/b',itemRevision:1});await second;
  for(let i=0;i<5;i++)await menuLoadPhoto('b');const cachedCalls=calls;await menuPhotoChange(items[1],menuUi.photos.b,false);instant=true;await menuLoadPhoto('b');const uploadInvalidated=calls===cachedCalls+1;await menuPhotoChange(items[1],menuUi.photos.b,true);await menuLoadPhoto('b');const removeInvalidated=calls===cachedCalls+2;
  fail=true;await menuLoadPhoto('b',true);const errorVisible=menuUi.photos.b?.error==='PHOTO_CLOUD_UNAVAILABLE';fail=false;await menuLoadPhoto('b',true);const recovered=menuUi.photos.b?.url==='https://qa.invalid/b';
  const beforeBranch=calls;const previousBranch=me.branchId;me.branchId='other-branch';await menuLoadPhoto('b');const branchScoped=calls===beforeBranch+1;me.branchId=previousBranch;
  api=original;confirmAction=originalConfirm;return {oldIgnored,cachedCalls,uploadInvalidated,removeInvalidated,errorVisible,recovered,branchScoped,selectedUrl:menuUi.photos.b?.url};
 });assert.deepEqual(product,{oldIgnored:true,cachedCalls:2,uploadInvalidated:true,removeInvalidated:true,errorVisible:true,recovered:true,branchScoped:true,selectedUrl:'https://qa.invalid/b'});assert.deepEqual(errors,[]);console.log('PASS menu photo async: 5 repeated selections use 1 status, stale response ignored, upload/remove invalidation, offline recovery and branch scope.');
 }finally{await desktop?.close();await server?.close();f.close();rmSync(profile,{recursive:true,force:true});}}
main().catch(error=>{console.error(error);process.exitCode=1;});
