'use strict';
const assert=require('node:assert/strict');
const {resolve,join}=require('node:path');
const {mkdtempSync,mkdirSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {_electron}=require('playwright');
const {fixture,password}=require('../../../dist/apps/local-server/test/fixtures/operations.js');
const {createServer}=require('../../../dist/apps/local-server/src/server.js');
async function main(){
 const f=await fixture(),userData=mkdtempSync(join(tmpdir(),'bashkar-public-editor-')),output=resolve('artifacts/public-menu-editor-qa');mkdirSync(output,{recursive:true});let server,desktop;
 try{
  f.storage.close();server=await createServer(f.dir,0,true,f.trust);
  desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+userData,resolve('apps/pos-desktop/main.cjs')],env:{...process.env,BASHKAR_DESKTOP_PORT:String(server.server.address().port),BASHKAR_TEST_CLIENT:'1',BASHKAR_TEST_PROFILE:'public-editor-qa'}});
  const page=await desktop.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Войти по логину и паролю',exact:true}).click();await page.getByLabel('Логин',{exact:true}).fill('owner');await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Меню',exact:true}).click();
  await page.evaluate(()=>{menuState={mainLanguage:'ru',languages:['ru','ky','en'],categories:[{id:'breakfast',name:'Завтраки',translations:{},archived:false}],items:[{id:'omelet',categoryId:'breakfast',name:'Омлет',translations:{},archived:false,isPackaging:false,available:true,kitchen:true,price:24000,variants:[],groups:[]}]};menuDraw();});
  const product=page.locator('.menu-product-row');await product.getByRole('checkbox',{name:'Показывать в публичном меню'}).uncheck();assert.equal(await page.evaluate(()=>menuState.items[0].publicVisible),false);assert.equal(await product.getByRole('checkbox',{name:'Доступен'}).isChecked(),true);
  await page.getByRole('tab',{name:'Публичное меню',exact:true}).click();
  await page.evaluate(async()=>{
   const original=api;window.restorePublicEditorApi=()=>{api=original;};window.savedDesigns=[];
   api=async(action,payload)=>{
    if(action==='publicMenuDesignStatus')return window.conflictLatest??{revision:1,theme:'emerald',defaultLanguage:'ru',languages:['ru','ky','en'],copy:{ru:{eyebrow:'Москва',title:'Супер суп',description:'Семейный ресторан',foot:'с 1996 года',menuTitle:'Наше меню',menuDescription:''}},updatedAt:'2026-11-02T04:49:36Z'};
    if(action==='publicMenuStatus')return {enabled:true,versionId:'qa'};
    if(action==='menuSyncStatus'||action==='tableCloudSyncStatus')return {state:'SYNCED'};
    if(action==='tablePublicLinksRefresh')return [{publicUrl:'https://bashkarmenu-beta.vercel.app/b/00000000-0000-4000-8000-000000000001/t/ABCDEFGHIJKLMNOPQRSTUV'}];
    if(action==='menuPhotoStatus')return {url:null,itemRevision:0};
    if(action==='publicMenuDesignSet'){if(window.failNextDesign){const code=window.failNextDesign;window.failNextDesign=null;throw Error(code);}if(window.conflictNext){window.conflictNext=false;throw Error('PUBLIC_MENU_DESIGN_CONFLICT');}window.savedDesigns.push(structuredClone(payload));return {...payload,revision:2,updatedAt:'2026-11-02T05:00:00Z'};}
    if(action==='publicMenuSet')return {enabled:payload.enabled,versionId:'qa'};
    return original(action,payload);
   };await publicMenuLoad();
  });
  await page.getByRole('heading',{name:'Редактирование публичного меню'}).waitFor();
  await page.screenshot({path:join(output,'initial-1440.png'),fullPage:true});
  assert.equal(await page.locator('.public-editor-workspace').count(),1);
  assert.equal(await page.locator('.public-preview-hero h2').innerText(),'Супер суп');
  await page.getByLabel('Заголовок баннера · RU').fill('Новый заголовок');assert.equal(await page.locator('.public-preview-hero h2').innerText(),'Новый заголовок');
  await page.getByRole('button',{name:'Тёплая'}).click();assert.equal(await page.locator('#public-menu-preview').getAttribute('data-theme'),'warm');
  await page.getByRole('button',{name:'▯  Mobile'}).click();assert.equal(await page.locator('#public-menu-preview').evaluate(node=>node.classList.contains('is-mobile')),true);
  await page.screenshot({path:join(output,'desktop.png'),fullPage:true});
  await page.getByRole('button',{name:/^KY 0\/6$/}).click();await page.getByLabel('Заголовок баннера · KY').fill('Жаңы аталыш');assert.equal(await page.locator('.public-preview-hero h2').innerText(),'Жаңы аталыш');
  await page.locator('.public-editor-text-tabs').getByRole('button',{name:/^RU/}).click();assert.equal(await page.getByLabel('Заголовок баннера · RU').inputValue(),'Новый заголовок');
  await page.locator('.public-editor-text-tabs').getByRole('button',{name:/^EN/}).click();await page.getByLabel('Заголовок баннера · EN').fill('English draft');await page.locator('.public-editor-language-toggles').getByRole('checkbox',{name:'EN'}).uncheck();assert.equal(await page.evaluate(()=>publicMenuState.edit.copy.en.title),'English draft');
  await page.getByRole('button',{name:/Сохранить и опубликовать оформление/}).click();await page.waitForFunction(()=>!publicMenuState.saving&&publicMenuState.settings?.revision===2);assert.equal(await page.evaluate(()=>window.savedDesigns.length),1);assert.equal(await page.evaluate(()=>window.savedDesigns[0].copy.ky.title),'Жаңы аталыш');assert.equal(await page.evaluate(()=>window.savedDesigns[0].copy.en),undefined);
  await page.getByLabel('Заголовок баннера · RU').fill('Временная правка');await page.getByRole('button',{name:/Отменить правки/}).click();await page.getByRole('dialog').getByRole('button',{name:'Подтвердить'}).click();await page.waitForFunction(()=>!publicMenuState.dirty);assert.equal(await page.getByLabel('Заголовок баннера · RU').inputValue(),'Новый заголовок');
  await page.getByLabel('Название сети (SSID)').fill('Bashkar Guest');await page.getByLabel('Пароль Wi-Fi').fill('welcome123');assert.equal(await page.locator('.public-preview-wifi').innerText().then(value=>value.includes('welcome123')),true);
  await page.evaluate(()=>{menuUi.published={languages:['ru','ky','en'],categories:[{id:'breakfast',name:'Завтраки',translations:{ky:'Эртең мененки'},archived:false}],items:[{id:'omelet',categoryId:'breakfast',name:'Омлет',translations:{},description:'С сыром',descriptionTranslations:{},archived:false,isPackaging:false,available:true,price:24000,variants:[],groups:[]}]};menuDrawProducts();});
  const categoryCard=page.locator('.public-editor-category-card');assert.equal(await categoryCard.getByLabel('Заголовок категории · RU').count(),1);assert.equal(await categoryCard.getByRole('button',{name:/Загрузить изображение/}).count(),0);
  await categoryCard.getByLabel('Заголовок категории · RU').fill('Завтраки весь день');assert.equal(await page.locator('.public-preview-categories').innerText(),'Завтраки весь день');
  await categoryCard.getByRole('checkbox',{name:/Завтраки · Показывать в публичном меню/}).uncheck();assert.equal(await page.locator('.public-preview-categories span').count(),0);assert.equal(await page.locator('.public-preview-item').count(),0);
  await categoryCard.getByRole('checkbox',{name:/Завтраки · Показывать в публичном меню/}).check();
  await page.locator('.public-editor-template-options').getByRole('button',{name:/Категории/}).click();assert.equal(await page.locator('#public-menu-preview').evaluate(node=>node.classList.contains('is-categories')),true);await page.getByLabel('Заголовок категории · RU').fill('Завтраки весь день');assert.equal(await page.locator('.public-preview-category-tile').innerText(),'ЗАВТРАКИ ВЕСЬ ДЕНЬ');await page.locator('.public-preview-category-tile').click();assert.equal(await page.locator('.public-preview-horizontal-item').count(),1);assert.equal(await page.locator('.public-preview-category-banner').count(),0);assert.equal(await page.locator('.public-preview-category-search').isVisible(),true);assert.equal(await page.locator('.public-preview-category-switch summary').count(),1);
  await categoryCard.getByRole('checkbox',{name:/Завтраки · Показывать в публичном меню/}).uncheck();assert.equal(await page.locator('.public-preview-horizontal-item').count(),0);
  await page.getByRole('button',{name:/Сохранить и опубликовать оформление/}).click();await page.waitForFunction(()=>window.savedDesigns.length===2);assert.equal(await page.evaluate(()=>window.savedDesigns[1].template),'categories');assert.equal(await page.evaluate(()=>window.savedDesigns[1].wifi.password),'welcome123');assert.equal(await page.evaluate(()=>window.savedDesigns[1].categoryTitles.breakfast.ru),'Завтраки весь день');assert.deepEqual(await page.evaluate(()=>window.savedDesigns[1].hiddenCategoryIds),['breakfast']);
  await page.getByLabel('Заголовок баннера · RU').fill('Моя правка при конфликте');await page.evaluate(()=>{window.conflictLatest={...structuredClone(publicMenuState.settings),revision:3,theme:'light'};window.conflictNext=true;});await page.getByRole('button',{name:/Сохранить и опубликовать оформление/}).click();await page.getByRole('alert').getByText('Оформление изменилось в Cloud').waitFor();assert.equal(await page.getByLabel('Заголовок баннера · RU').inputValue(),'Моя правка при конфликте');assert.equal(await page.evaluate(()=>publicMenuState.settings.revision),3);assert.equal(await page.evaluate(()=>publicMenuState.edit.theme),'light');await page.getByRole('button',{name:/Сохранить и опубликовать оформление/}).click();await page.waitForFunction(()=>window.savedDesigns.length===3);assert.equal(await page.evaluate(()=>window.savedDesigns[2].expectedRevision),3);assert.equal(await page.evaluate(()=>window.savedDesigns[2].copy.ru.title),'Моя правка при конфликте');
  await page.getByLabel('Заголовок баннера · RU').fill('Несохранённая правка');await page.evaluate(()=>{window.failNextDesign='INVALID_MENU_PAYLOAD';});await page.getByRole('button',{name:/Сохранить и опубликовать оформление/}).click();await page.waitForFunction(()=>!publicMenuState.saving);assert.match(await page.locator('#status').innerText(),/Cloud Functions устарели/);assert.equal(await page.evaluate(()=>publicMenuState.dirty),true);assert.equal(await page.evaluate(()=>window.savedDesigns.length),3);
  for(const width of [1024,768,390]){await page.setViewportSize({width,height:844});await page.screenshot({path:join(output,`width-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`horizontal overflow at ${width}px`);}
  assert.deepEqual(errors,[]);console.log('PASS public menu editor: preview, theme, languages, mobile, save, discard, narrow layout.');
 }finally{if(desktop)await desktop.close();if(server)await server.close();f.close();rmSync(userData,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
