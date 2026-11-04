import {describe,expect,it} from 'vitest';
import {catalogSchema,validateCatalog} from '../src/modules/menu/catalog';

const catalog=()=>({mainLanguage:'ru',languages:['ru','ky'],categories:[{id:'food',name:'Еда',archived:false}],items:[{id:'soup',categoryId:'food',name:'Суп',archived:false,available:true,kitchen:true,price:10000,variants:[],groups:[],description:'Горячий суп'}]});

describe('menu description translations',()=>{
 it('keeps existing catalogs on schema 1',()=>{
  const result=validateCatalog(catalog(),1);
  expect(result.items[0].description).toBe('Горячий суп');
  expect(catalogSchema(result)).toBe(1);
 });
 it('puts multiline descriptions on schema 2',()=>{
  const input=catalog();input.items[0].description='Горячий\nсуп';
  expect(catalogSchema(validateCatalog(input))).toBe(2);
  expect(()=>validateCatalog(input,1)).toThrow('INVALID_TEXT');
 });
 it('preserves translations on schema 2 without changing menu prices',()=>{
  const input=structuredClone(catalog());
  const item=input.items[0] as typeof input.items[number]&{descriptionTranslations?:Record<string,string>};
  item.descriptionTranslations={ky:'Ысык\nшорпо'};
  const result=validateCatalog(input,2);
  expect(result.items[0].descriptionTranslations?.ky).toBe('Ысык\nшорпо');
  expect(result.items[0].price).toBe(10000);
  expect(catalogSchema(result)).toBe(2);
  expect(()=>validateCatalog(input,1)).toThrow('UNKNOWN_FIELD');
 });
 it('rejects unknown languages, blank translations and control characters',()=>{
  const input=structuredClone(catalog());
  const item=input.items[0] as typeof input.items[number]&{descriptionTranslations?:Record<string,string>};
  item.descriptionTranslations={en:'Soup'};
  expect(()=>validateCatalog(input)).toThrow('UNKNOWN_FIELD');
  item.descriptionTranslations={ky:'   '};
  expect(()=>validateCatalog(input)).toThrow('INVALID_DESCRIPTION');
  item.descriptionTranslations={ky:'Bad\u0000text'};
  expect(()=>validateCatalog(input)).toThrow('INVALID_DESCRIPTION');
 });
});
