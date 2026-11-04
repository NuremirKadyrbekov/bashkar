import { integer, requireCondition, textField } from '../../errors';
export const MAX_MONEY = 999_999_999;
export const MAX_QUANTITY = 9999;
export type Label = { name: string; translations?: Record<string, string> };
export type Category = Label & { id: string; archived: boolean };
export type Option = Label & { id: string; price: number; available: boolean };
export type Group = Label & { id: string; min: number; max: number; options: Option[] };
export type Combination = { id: string; variantId: string | null; optionIds: string[]; price: number; available: boolean; translations?: Record<string,string> };
export type SetComponent = {itemId:string;variantId:string|null;modifierIds:string[];quantity:number;combinationId?:string};
export type Item = Label & {
  kind?: 'ITEM'|'SET'; components?: SetComponent[];
  id: string; categoryId: string; archived: boolean; available: boolean; kitchen: boolean; publicVisible?: false;
  price: number | null; variants: Option[]; groups: Group[]; description?: string; descriptionTranslations?: Record<string,string>; containerId?: string | null; isPackaging?: boolean;
  pricingMode?: 'MATRIX'; combinationPrices?: Combination[];
};
export type Catalog = { mainLanguage: string; languages: string[]; categories: Category[]; items: Item[] };
export type Fee = { id: string; name: string; rate: number }; // hundredths of one percent
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_OBJECT');
  requireCondition(Object.keys(value).every(k => keys.includes(k)), 'UNKNOWN_FIELD');
  return value as Record<string, unknown>;
}
function array(value: unknown, max = 10000): unknown[] { requireCondition(Array.isArray(value) && value.length <= max, 'INVALID_ARRAY'); return value; }
function flag(value: unknown): boolean { requireCondition(typeof value === 'boolean', 'INVALID_BOOLEAN'); return value; }
export function entityId(value: unknown): string { requireCondition(typeof value === 'string' && idPattern.test(value), 'INVALID_ENTITY_ID'); return value; }
function language(value: unknown): string { requireCondition(typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value), 'INVALID_LANGUAGE'); return value; }
function label(row: Record<string, unknown>, languages: string[]): Label {
  const name = textField(row.name);
  return { name, translations: translations(row.translations,languages) };
}
function translations(value:unknown,languages:string[]):Record<string,string> {
  const translations: Record<string,string> = {};
  if (value !== undefined) {
    const input = object(value, languages);
    for (const [code, translated] of Object.entries(input)) translations[code] = textField(translated);
  }
  return translations;
}
function description(value:unknown):string {
  requireCondition(typeof value==='string' && value.trim().length>0 && value.length<=2000 && !/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(value),'INVALID_DESCRIPTION');
  return value.trim();
}
export function catalogSchema(catalog:Catalog):1|2|3 {
  if(catalog.items.some(item=>item.publicVisible===false))return 3;
  return catalog.items.some(item=>item.description?.includes('\n') || item.descriptionTranslations && Object.keys(item.descriptionTranslations).length>0)?2:1;
}
export function validateCatalog(input: unknown, schema:1|2|3=3): Catalog {
  const root = object(input, ['mainLanguage','languages','categories','items']);
  const mainLanguage = language(root.mainLanguage);
  const languages = array(root.languages, 30).map(language);
  requireCondition(languages.includes(mainLanguage) && new Set(languages).size === languages.length, 'INVALID_LANGUAGES');
  const ids = new Set<string>();
  const unique = (value: unknown) => { const id = entityId(value); requireCondition(!ids.has(id), 'DUPLICATE_ENTITY_ID'); ids.add(id); return id; };
  const categories = array(root.categories).map(value => {
    const row = object(value, ['id','name','translations','archived']);
    return { id: unique(row.id), ...label(row,languages), archived: flag(row.archived) };
  });
  const option = (value: unknown): Option => {
    const row = object(value,['id','name','translations','price','available']);
    return { id: unique(row.id), ...label(row,languages), price: integer(row.price,0,MAX_MONEY,'INVALID_PRICE'), available: flag(row.available) };
  };
  const items = array(root.items).map(value => {
    const row = object(value,['id','name','translations','categoryId','archived','available','kitchen','price','variants','groups','description',...(schema>=2?['descriptionTranslations']:[]),...(schema===3?['publicVisible']:[]),'containerId','isPackaging','pricingMode','combinationPrices','kind','components']);
    const item: Item = { id: unique(row.id), ...label(row,languages), categoryId: entityId(row.categoryId), archived: flag(row.archived), available: flag(row.available), kitchen: flag(row.kitchen),
      price: row.price === null ? null : integer(row.price,0,MAX_MONEY,'INVALID_PRICE'), variants: array(row.variants,100).map(option),
      groups: array(row.groups,100).map(value => {
        const group = object(value,['id','name','translations','min','max','options']);
        const options = array(group.options,100).map(option);
        const min = integer(group.min,0,options.length), max = integer(group.max,min,options.length);
        return { id: unique(group.id), ...label(group,languages), min, max, options };
      }) };
    if (row.pricingMode === 'MATRIX') {
      requireCondition(item.price === null && item.variants.every(v => v.price === 0) && item.groups.every(g => g.min === 1 && g.max === 1 && g.options.length > 0 && g.options.every(o => o.price === 0)), 'INVALID_MATRIX_STRUCTURE');
      let expected: {variantId:string|null;optionIds:string[]}[] = (item.variants.length ? item.variants.map(v => ({variantId:v.id,optionIds:[]})) : [{variantId:null,optionIds:[]}]);
      for (const group of item.groups) { expected = expected.flatMap(c => group.options.map(o => ({variantId:c.variantId,optionIds:[...c.optionIds,o.id]}))); requireCondition(expected.length <= 64,'TOO_MANY_COMBINATIONS'); }
      requireCondition(expected.length <= 64,'TOO_MANY_COMBINATIONS');
      const combinations = array(row.combinationPrices,64).map(value => {
        const c = object(value,['id','variantId','optionIds','price','available','translations']);
        return {id:unique(c.id),variantId:c.variantId === null ? null : entityId(c.variantId),optionIds:array(c.optionIds,100).map(entityId),price:integer(c.price,0,MAX_MONEY,'INVALID_PRICE'),available:flag(c.available),...(c.translations===undefined?{}:{translations:translations(c.translations,languages)})};
      });
      const key=(c:{variantId:string|null;optionIds:string[]})=>JSON.stringify([c.variantId,c.optionIds]);
      const wanted=new Set(expected.map(key));
      requireCondition(combinations.length === wanted.size && combinations.every(c => wanted.has(key(c))) && new Set(combinations.map(key)).size === wanted.size,'INVALID_COMBINATION_PRICES');
      item.pricingMode='MATRIX';item.combinationPrices=combinations;
    } else {
      requireCondition(row.pricingMode === undefined && row.combinationPrices === undefined,'INVALID_PRICING_MODE');
      requireCondition((item.variants.length === 0 && item.price !== null) || (item.variants.length > 0 && item.price === null), 'INVALID_PRICE_BASIS');
    }
    if(row.kind !== undefined){requireCondition(row.kind==='ITEM'||row.kind==='SET','INVALID_ITEM_KIND');item.kind=row.kind;}
    if(item.kind==='SET'){
      requireCondition(!item.pricingMode && item.price!==null && !item.variants.length && !item.groups.length && row.isPackaging!==true,'INVALID_SET');
      item.components=array(row.components,30).map(value=>{const c=object(value,['itemId','variantId','modifierIds','quantity','combinationId']);const modifierIds=array(c.modifierIds,100).map(entityId);requireCondition(new Set(modifierIds).size===modifierIds.length,'DUPLICATE_MODIFIER');return {itemId:entityId(c.itemId),variantId:c.variantId===null?null:entityId(c.variantId),modifierIds,quantity:integer(c.quantity,1,99,'INVALID_SET_QUANTITY'),...(c.combinationId===undefined?{}:{combinationId:entityId(c.combinationId)})};});
      requireCondition(item.components.length>0,'EMPTY_SET');
    }else requireCondition(row.components===undefined,'INVALID_SET');
    const category = categories.find(c => c.id === item.categoryId);
    requireCondition(category && (item.archived || !category.archived), 'INVALID_CATEGORY');
    if (row.description !== undefined) item.description = schema===1?textField(row.description,2000):description(row.description);
    if (row.descriptionTranslations !== undefined) {
      const input=object(row.descriptionTranslations,languages.filter(code=>code!==mainLanguage));
      const translated:Record<string,string>={};
      for(const [code,value] of Object.entries(input))translated[code]=description(value);
      if(Object.keys(translated).length)item.descriptionTranslations=translated;
    }
    if (row.isPackaging !== undefined) item.isPackaging = flag(row.isPackaging);
    if (row.publicVisible !== undefined){requireCondition(row.publicVisible===false,'INVALID_PUBLIC_VISIBILITY');item.publicVisible=false;}
    if (row.containerId != null) item.containerId = entityId(row.containerId);
    return item;
  });
  for(const set of items.filter(i=>i.kind==='SET')){
    const seen=new Set<string>();
    for(const component of set.components!){
      const child=items.find(i=>i.id===component.itemId);
      requireCondition(child && child.id!==set.id && child.kind!=='SET' && !child.isPackaging,'INVALID_SET_COMPONENT');
      const key=JSON.stringify([component.itemId,component.variantId,[...component.modifierIds].sort()]);requireCondition(!seen.has(key),'DUPLICATE_SET_COMPONENT');seen.add(key);
      if(set.archived)continue;
      requireCondition(!child.archived,'SET_COMPONENT_ARCHIVED');
      requireCondition(child.variants.length?child.variants.some(v=>v.id===component.variantId):component.variantId===null,'INVALID_SET_SELECTION');
      const options=child.groups.flatMap(g=>g.options).filter(o=>component.modifierIds.includes(o.id));
      requireCondition(options.length===component.modifierIds.length && child.groups.every(g=>{const n=g.options.filter(o=>component.modifierIds.includes(o.id)).length;return n>=g.min&&n<=g.max;}),'INVALID_SET_SELECTION');
      if(child.pricingMode==='MATRIX')requireCondition(child.combinationPrices!.some(c=>c.id===component.combinationId&&c.variantId===component.variantId&&c.optionIds.length===component.modifierIds.length&&c.optionIds.every(id=>component.modifierIds.includes(id))),'INVALID_SET_SELECTION');
      else requireCondition(component.combinationId===undefined,'INVALID_SET_SELECTION');
    }
    set.kitchen=set.components!.some(c=>items.find(i=>i.id===c.itemId)?.kitchen);
  }
  for (const item of items) if (item.containerId) {
    const container=items.find(i=>i.id===item.containerId);
    requireCondition(!item.isPackaging && container && container.id!==item.id, 'INVALID_CONTAINER');
    requireCondition(item.archived || container.isPackaging===true && !container.archived, 'INVALID_CONTAINER_TARGET');
  }
  return { mainLanguage, languages, categories, items };
}
export function validateFees(input: unknown): Fee[] {
  const ids = new Set<string>();
  const fees = array(input,100).map(value => { const row = object(value,['id','name','rate']); const id = entityId(row.id); requireCondition(!ids.has(id),'DUPLICATE_FEE'); ids.add(id);
    return { id, name: textField(row.name), rate: integer(row.rate,0,10000,'INVALID_RATE') }; });
  requireCondition(fees.reduce((s,f) => s+f.rate,0) <= 10000,'TOTAL_RATE_EXCEEDED');
  return fees;
}
export function displayName(label: Label, language: string): string { return label.translations?.[language] || label.name; }
