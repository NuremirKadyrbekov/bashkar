'use strict';
const ExcelJS=require('exceljs');
const JSZip=require('jszip');
const {readFile,writeFile}=require('node:fs/promises');
const {stat}=require('node:fs/promises');
const {randomUUID}=require('node:crypto');

const HEADERS=['Код категории','Категория RU','Категория KY','Категория EN','Код товара','Товар RU','Товар KY','Товар EN','Вариант RU','Вариант KY','Вариант EN','Цена, сом','Описание RU','Описание KY','Описание EN','Доступен','На кухню'];
const TEMPLATE_EXAMPLES=[
 ['hot','Горячие блюда','Ысык тамактар','Hot dishes','plov','Плов','Аш','Pilaf','','','','360','С говядиной','Уй эти менен','With beef','Да','Да'],
 ['pizza','Пицца','Пицца','Pizza','pepperoni','Пепперони','Пепперони','Pepperoni','25 см','25 см','25 cm',490,'Томатный соус, сыр, пепперони','','','Да','Да'],
 ['pizza','Пицца','Пицца','Pizza','pepperoni','Пепперони','Пепперони','Pepperoni','35 см','35 см','35 cm',690,'Томатный соус, сыр, пепперони','','','Да','Да'],
 ['drinks','Напитки','Суусундуктар','Drinks','lemonade','Лимонад','','','','','',150.5,'Домашний лимонад','','','Да','Нет'],
 ['salads','Салаты','','','seasonal_salad','Сезонный салат','','','','','',280,'Временно нет в продаже','','','Нет','Да']
];
const MAX_FILE=5*1024*1024,MAX_ROWS=1000;
const CODE=/^[a-z0-9][a-z0-9_-]{0,59}$/;
const columns=['categoryCode','categoryRu','categoryKy','categoryEn','itemCode','itemRu','itemKy','itemEn','variantRu','variantKy','variantEn','price','descriptionRu','descriptionKy','descriptionEn','available','kitchen'];
function zipBudget(buffer){
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||end+22>buffer.length)throw Error('MENU_IMPORT_INVALID_FILE');
 const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),offset=buffer.readUInt32LE(end+16);
 if(!count||count>200||offset+size>buffer.length)throw Error('MENU_IMPORT_INVALID_FILE');
 let pos=offset,total=0;
 for(let n=0;n<count;n++){
  if(pos+46>buffer.length||buffer.readUInt32LE(pos)!==0x02014b50)throw Error('MENU_IMPORT_INVALID_FILE');
  const flags=buffer.readUInt16LE(pos+8),method=buffer.readUInt16LE(pos+10),unpacked=buffer.readUInt32LE(pos+24),nameLength=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32);
  if(flags&1||![0,8].includes(method)||unpacked===0xffffffff||pos+46+nameLength+extra+comment>buffer.length)throw Error('MENU_IMPORT_INVALID_FILE');
  const name=buffer.subarray(pos+46,pos+46+nameLength).toString('utf8').toLowerCase();
  if(name.includes('..')||name.startsWith('/')||name.includes('externallinks/')||name.includes('vbaproject')||name.endsWith('.bin'))throw Error('MENU_IMPORT_INVALID_FILE');
  total+=unpacked;if(total>25*1024*1024)throw Error('MENU_IMPORT_TOO_LARGE');
  pos+=46+nameLength+extra+comment;
 }
 if(pos!==offset+size)throw Error('MENU_IMPORT_INVALID_FILE');
}
function cellText(cell){
 const value=cell.value;
 if(value===null||value===undefined)return '';
 if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return String(value).trim();
 throw Error('MENU_IMPORT_UNSUPPORTED_CELL');
}
async function normalizePrefixedWorkbook(buffer){
 const zip=await JSZip.loadAsync(buffer,{checkCRC32:true});
 const workbookXml=zip.file('xl/workbook.xml');
 if(!workbookXml)return null;
 const source=await workbookXml.async('string');
 if(!/<x:workbook\b/.test(source)||!source.includes('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'))return null;
 for(const name of Object.keys(zip.files).filter(name=>name.startsWith('xl/')&&name.endsWith('.xml'))){
  const xml=await zip.file(name).async('string');
  zip.file(name,xml.replace(/xmlns:x=/g,'xmlns=').replace(/<(\/?)x:/g,'<$1'));
 }
 return zip.generateAsync({type:'nodebuffer'});
}
async function readWorkbook(path){
 const info=await stat(path);if(info.size<1||info.size>MAX_FILE)throw Error('MENU_IMPORT_TOO_LARGE');
 const buffer=await readFile(path);zipBudget(buffer);
 let workbook=new ExcelJS.Workbook();
 try{await workbook.xlsx.load(buffer);}
 catch{
  try{const normalized=await normalizePrefixedWorkbook(buffer);if(!normalized)throw Error('MENU_IMPORT_INVALID_FILE');workbook=new ExcelJS.Workbook();await workbook.xlsx.load(normalized);}
  catch{throw Error('MENU_IMPORT_INVALID_FILE');}
 }
 if(workbook.worksheets.length!==1||workbook.worksheets[0].name!=='Меню')throw Error('MENU_IMPORT_INVALID_SHEET');
 const sheet=workbook.worksheets[0];
 if(sheet.rowCount>MAX_ROWS+1)throw Error('MENU_IMPORT_TOO_MANY_ROWS');
 for(let i=0;i<HEADERS.length;i++)if(cellText(sheet.getRow(1).getCell(i+1))!==HEADERS[i])throw Error('MENU_IMPORT_INVALID_HEADERS');
 const rows=[],issues=[];
 for(let number=2;number<=sheet.rowCount;number++){
  const row=sheet.getRow(number),values={},all=[];
  for(let i=1;i<=Math.max(HEADERS.length,row.cellCount);i++){
   try{const value=cellText(row.getCell(i));all.push(value);if(i<=HEADERS.length)values[columns[i-1]]=value;else if(value)issues.push({row:number,message:'Лишний столбец'});}
   catch{issues.push({row:number,message:'Формула или неподдерживаемый тип ячейки'});}
  }
  if(all.some(Boolean))rows.push({number,...values});
 }
 if(!rows.length)issues.push({row:0,message:'В файле нет строк меню'});
 return {rows,issues:issues.slice(0,100),rowCount:rows.length};
}
async function writeTemplate(path){
 const workbook=new ExcelJS.Workbook();workbook.creator='Bashkar POS';
 const sheet=workbook.addWorksheet('Меню',{views:[{state:'frozen',ySplit:1}]});
 sheet.addRow(HEADERS);
 for(const example of TEMPLATE_EXAMPLES)sheet.addRow(example);
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF143D36'}};
 sheet.getRow(1).height=30;sheet.autoFilter={from:'A1',to:'Q1'};
 for(let i=1;i<=HEADERS.length;i++)sheet.getColumn(i).width=[20,24,24,20,18,24,24,20,20,20,20,16,38,38,38,14,14][i-1];
 sheet.getColumn(12).numFmt='0.00';
 await writeFile(path,await workbook.xlsx.writeBuffer());
}
function priceCents(value){
 if(!/^(?:0|[1-9]\d{0,6})(?:[.,]\d{1,2})?$/.test(value))return null;
 const [whole,part='']=value.replace(',','.').split('.');const n=Number(whole)*100+Number(part.padEnd(2,'0'));return n<=999999999?n:null;
}
function flag(value,defaultValue){
 if(!value)return defaultValue;
 if(['да','ооба','yes','true','1'].includes(value.toLowerCase()))return true;
 if(['нет','жок','no','false','0'].includes(value.toLowerCase()))return false;
 return null;
}
const norm=s=>s.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g,' ');
function planImport(rows,catalog,initialIssues=[]){
 const issues=[...initialIssues],categories=new Map(),items=new Map(),next=structuredClone(catalog);
 const add=(row,message)=>{if(issues.length<100)issues.push({row,message});};
 const language=catalog.mainLanguage,langs=new Set(catalog.languages);
 const usedIds=new Set([...next.categories.map(c=>c.id),...next.items.flatMap(i=>[i.id,...i.variants.map(v=>v.id),...i.groups.flatMap(g=>[g.id,...g.options.map(o=>o.id)]),...(i.combinationPrices??[]).map(c=>c.id)])]);
 const label=(row,stem,number)=>{
  const value=row[stem+language[0].toUpperCase()+language.slice(1)]||'';
  if(!value)add(number,`Укажите ${stem==='item'?'товар':'категорию'} на основном языке ${language.toUpperCase()}`);
  const translations={};for(const code of ['ru','ky','en'])if(code!==language&&row[stem+code[0].toUpperCase()+code.slice(1)]){if(!langs.has(code))add(number,`Язык ${code.toUpperCase()} не включён в меню`);else translations[code]=row[stem+code[0].toUpperCase()+code.slice(1)];}
  return {name:value,translations};
 };
 for(const row of rows){
  const n=row.number,categoryCode=row.categoryCode,itemCode=row.itemCode;
  if(!CODE.test(categoryCode))add(n,'Некорректный код категории: латиница, цифры, _ или -');
  if(!CODE.test(itemCode))add(n,'Некорректный код товара: латиница, цифры, _ или -');
  if(!row.categoryRu)add(n,'Укажите название категории RU');
  if(!row.itemRu)add(n,'Укажите название товара RU');
  const cents=priceCents(row.price);if(cents===null)add(n,'Цена должна быть в сомах, от 0 до 9999999,99');
  const available=flag(row.available,true),kitchen=flag(row.kitchen,true);
  if(available===null)add(n,'Доступен: укажите Да или Нет');if(kitchen===null)add(n,'На кухню: укажите Да или Нет');
  const cat=label(row,'category',n),item=label(row,'item',n);
  for(const code of ['ru','ky','en'])if(row['description'+code[0].toUpperCase()+code.slice(1)]?.length>2000)add(n,'Описание длиннее 2000 символов');
  for(const key of ['categoryRu','categoryKy','categoryEn','itemRu','itemKy','itemEn','variantRu','variantKy','variantEn'])if(row[key]?.length>200)add(n,'Название длиннее 200 символов');
  if(!categories.has(categoryCode))categories.set(categoryCode,{...cat,code:categoryCode,row:n});
  else if(JSON.stringify({name:categories.get(categoryCode).name,translations:categories.get(categoryCode).translations})!==JSON.stringify(cat))add(n,'Данные категории с этим кодом различаются');
  const record={row:n,categoryCode,item,variant:{ru:row.variantRu,ky:row.variantKy,en:row.variantEn},price:cents,available,kitchen,description:{ru:row.descriptionRu,ky:row.descriptionKy,en:row.descriptionEn}};
  if(!items.has(itemCode))items.set(itemCode,[record]);
  else items.get(itemCode).push(record);
 }
 const mapped=new Map(),newCategories=[];
 for(const [code,category] of categories){
  const matches=next.categories.filter(c=>!c.archived&&norm(c.name)===norm(category.name));
  const byId=next.categories.find(c=>c.id==='xlc_'+code);
  if(matches.length>1||byId&&norm(byId.name)!==norm(category.name))add(category.row,'Категория неоднозначна или код уже занят');
  else if(byId?.archived)add(category.row,'Категория с этим кодом архивирована');
  else if(matches.length===1)mapped.set(code,matches[0].id);
  else {const created={id:'xlc_'+code,name:category.name,translations:category.translations,archived:false};if(usedIds.has(created.id))add(category.row,'Код категории занят другим объектом');usedIds.add(created.id);next.categories.push(created);newCategories.push(created);mapped.set(code,created.id);}
 }
 const newItems=[],newVariants=[];
 for(const [code,group] of items){
  const first=group[0],id='xli_'+code,categoryId=mapped.get(first.categoryCode);
  if(usedIds.has(id))add(first.row,'Код товара занят другим объектом');usedIds.add(id);
  if(next.items.some(i=>i.id===id||i.categoryId===categoryId&&norm(i.name)===norm(first.item.name)))add(first.row,'Товар с этим кодом или названием уже существует');
  if(group.some(r=>r.categoryCode!==first.categoryCode||JSON.stringify(r.item)!==JSON.stringify(first.item)||JSON.stringify(r.description)!==JSON.stringify(first.description)||r.available!==first.available||r.kitchen!==first.kitchen))add(first.row,'Строки товара содержат разные названия, описания или настройки');
  const hasVariants=group.some(r=>r.variant.ru||r.variant.ky||r.variant.en);
  if(hasVariants&&group.some(r=>!r.variant[language]))add(first.row,'Укажите название каждого варианта на основном языке');
  if(!hasVariants&&group.length>1)add(first.row,'Товар без вариантов должен занимать одну строку');
  const names=new Set();const variants=[],prices=[];
  for(const record of group){
   const variantName=record.variant[language]||'',key=norm(variantName);
   if(hasVariants){if(names.has(key))add(record.row,'Повторяется название варианта');names.add(key);}
   const variantId=hasVariants?randomUUID():null;
   if(hasVariants){const translations={};for(const code of ['ru','ky','en'])if(code!==language&&record.variant[code]){if(!langs.has(code))add(record.row,`Язык ${code.toUpperCase()} не включён в меню`);else translations[code]=record.variant[code];}variants.push({id:variantId,name:variantName,translations,price:0,available:true});newVariants.push(variantName);}
   prices.push({id:randomUUID(),variantId,optionIds:[],price:record.price??0,available:true});
  }
  const description=first.description[language]||'',descriptionTranslations={};for(const code of ['ru','ky','en'])if(code!==language&&first.description[code]){if(!langs.has(code))add(first.row,`Язык ${code.toUpperCase()} не включён в меню`);else descriptionTranslations[code]=first.description[code];}
  const created={id,name:first.item.name,translations:first.item.translations,categoryId,archived:false,available:first.available??true,kitchen:first.kitchen??true,price:null,variants,groups:[],pricingMode:'MATRIX',combinationPrices:prices,...(description?{description}:{}),...(Object.keys(descriptionTranslations).length?{descriptionTranslations}:{})};
  next.items.push(created);newItems.push(created);
 }
 if(next.categories.length>10000||next.items.length>10000)add(0,'Превышен лимит каталога');
 return {catalog:next,issues,summary:{categories:newCategories.length,items:newItems.length,variants:newVariants.length,rows:rows.length},sample:newItems.slice(0,12).map(i=>({category:next.categories.find(c=>c.id===i.categoryId)?.name||'',name:i.name,price:i.combinationPrices[0]?.price??0}))};
}
module.exports={HEADERS,TEMPLATE_EXAMPLES,MAX_FILE,MAX_ROWS,readWorkbook,writeTemplate,planImport,priceCents};
