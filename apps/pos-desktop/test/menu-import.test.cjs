'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm,readFile,writeFile}=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const ExcelJS=require('exceljs');
const JSZip=require('jszip');
const {HEADERS,TEMPLATE_EXAMPLES,readWorkbook,writeTemplate,planImport}=require('../menu-import-file.cjs');
const empty=()=>({mainLanguage:'ru',languages:['ru','ky','en'],categories:[],items:[]});
const samples=[
 ['hot','Горячие блюда','Ысык тамактар','Hot dishes','plov','Плов','Аш','Pilaf','','','','360','С говядиной','','','Да','Да'],
 ['drinks','Напитки','Суусундуктар','Drinks','tea','Чай','Чай','Tea','Маленький','Кичине','Small','100','Чёрный чай','','','Да','Нет'],
 ['drinks','Напитки','Суусундуктар','Drinks','tea','Чай','Чай','Tea','Большой','Чоң','Large','160','Чёрный чай','','','Да','Нет']
];

test('template parses and plans local categories, simple dishes and priced variants without publishing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bashkar-import-')),path=join(dir,'menu.xlsx');
 try{
  await writeTemplate(path);
  const example=await readWorkbook(path);assert.equal(example.rows.length,TEMPLATE_EXAMPLES.length);
  const examplePlan=planImport(example.rows,empty(),example.issues);
  assert.deepEqual(examplePlan.issues,[]);
  assert.deepEqual(examplePlan.summary,{categories:4,items:4,variants:2,rows:5});
  assert.equal(examplePlan.catalog.items.find(i=>i.name==='Лимонад').kitchen,false);
  assert.equal(examplePlan.catalog.items.find(i=>i.name==='Лимонад').combinationPrices[0].price,15050);
  assert.equal(examplePlan.catalog.items.find(i=>i.name==='Сезонный салат').available,false);
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Меню');sheet.addRow(HEADERS);
  for(const row of samples)sheet.addRow(row);await workbook.xlsx.writeFile(path);
  const parsed=await readWorkbook(path);
  assert.equal(parsed.issues.length,0);
  assert.equal(parsed.rows.length,3);
  const planned=planImport(parsed.rows,empty(),parsed.issues);
  assert.deepEqual(planned.issues,[]);
  assert.deepEqual(planned.summary,{categories:2,items:2,variants:2,rows:3});
  assert.equal(planned.catalog.items[0].combinationPrices[0].price,36000);
  assert.deepEqual(planned.catalog.items[1].combinationPrices.map(c=>c.price),[10000,16000]);
  assert.equal(planned.catalog.items[1].variants.length,2);
  assert.equal(planned.catalog.categories[0].translations.ky,'Ысык тамактар');
  const repeated=planImport(parsed.rows,planned.catalog,[]);
  assert.ok(repeated.issues.some(i=>i.message.includes('уже существует')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('invalid rows, formulas and inconsistent variants block the complete import',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bashkar-import-bad-')),path=join(dir,'bad.xlsx');
 try{
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Меню');
  sheet.addRow(HEADERS);sheet.addRow(['hot','Горячие блюда','','','dish','Блюдо','','','','','','12,50','','','','Да','Нет']);
  sheet.addRow(['hot','Горячие блюда','','','dish','Другое название','','','Большой','','','12.30','','','','Да','Нет']);
  sheet.getRow(2).getCell(13).value={formula:'1+1',result:2};
  await workbook.xlsx.writeFile(path);
  const parsed=await readWorkbook(path),planned=planImport(parsed.rows,empty(),parsed.issues);
  assert.ok(planned.issues.some(i=>i.message.includes('Формула')));
  assert.ok(planned.issues.some(i=>i.message.includes('разные названия')));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('imports a valid workbook with prefixed SpreadsheetML tags',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bashkar-import-prefixed-')),path=join(dir,'menu.xlsx');
 try{
  await writeTemplate(path);
  const zip=await JSZip.loadAsync(await readFile(path));
  for(const name of Object.keys(zip.files).filter(name=>/^xl\/(?:workbook|styles|sharedStrings|worksheets\/sheet1)\.xml$/.test(name))){
   const xml=await zip.file(name).async('string');
   zip.file(name,xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"','xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"').replace(/<(\/?)([A-Za-z][\w-]*)(?=[\s/>])/g,'<$1x:$2'));
  }
  await writeFile(path,await zip.generateAsync({type:'nodebuffer'}));
  const parsed=await readWorkbook(path);
  assert.equal(parsed.rows.length,TEMPLATE_EXAMPLES.length);
  assert.deepEqual(planImport(parsed.rows,empty(),parsed.issues).issues,[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
