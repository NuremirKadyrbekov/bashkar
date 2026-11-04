import { integer, requireCondition } from '../../errors';
import { type Catalog, type Fee, MAX_MONEY, MAX_QUANTITY, object, entityId, validateFees } from './catalog';
export type Selection = { itemId: string; variantId: string | null; modifierIds: string[]; quantity: number; comment?: string; kind?: 'CUSTOM_AMOUNT'; unitPrice?: number };
export function selection(input: unknown): Selection {
  if(input&&typeof input==='object'&&(input as {kind?:unknown}).kind==='CUSTOM_AMOUNT'){
    const r=object(input,['kind','unitPrice','quantity','itemId','variantId','modifierIds','comment']);
    requireCondition((r.itemId===undefined||r.itemId==='CUSTOM_AMOUNT')&&(r.variantId===undefined||r.variantId===null)&&(r.modifierIds===undefined||Array.isArray(r.modifierIds)&&r.modifierIds.length===0)&&(r.comment===undefined||r.comment===''),'INVALID_CUSTOM_ITEM');
    return {kind:'CUSTOM_AMOUNT',unitPrice:integer(r.unitPrice,1,MAX_MONEY,'INVALID_CUSTOM_AMOUNT'),itemId:'CUSTOM_AMOUNT',variantId:null,modifierIds:[],quantity:integer(r.quantity,1,MAX_QUANTITY,'INVALID_QUANTITY'),comment:''};
  }
  const row = object(input,['itemId' ,'variantId','modifierIds','quantity','comment']);
  requireCondition(Array.isArray(row.modifierIds) && row.modifierIds.length <= 10000,'INVALID_MODIFIERS');
  const modifierIds = row.modifierIds.map(entityId);
  requireCondition(new Set(modifierIds).size === modifierIds.length,'DUPLICATE_MODIFIER');
  requireCondition(row.comment === undefined || typeof row.comment === 'string','INVALID_COMMENT');
  const comment = typeof row.comment === 'string' ? row.comment.replace(/\r\n/g,'\n').normalize('NFC') : undefined;
  requireCondition(comment === undefined || [...comment].length <= 300 && !/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(comment),'INVALID_COMMENT');
  return { itemId: entityId(row.itemId), variantId: row.variantId === null ? null : entityId(row.variantId), modifierIds, quantity: integer(row.quantity,1,MAX_QUANTITY,'INVALID_QUANTITY'), ...(row.comment !== undefined ? { comment: comment! } : {}) };
}
function money(value: bigint): number { requireCondition(value >= 0n && value <= BigInt(MAX_MONEY),'MONEY_LIMIT_EXCEEDED'); return Number(value); }
// DTO is suitable for persisting at future order acceptance. A quote itself is
// neither an accepted order nor a settlement, and creates no financial record.
function ordinaryPriceLine(catalog: Catalog, revision: number, raw: unknown, availability: Record<string,boolean> = {}) {
  const line = selection(raw), item = catalog.items.find(i => i.id === line.itemId);
  requireCondition(item && !item.archived && (availability[item.id] ?? item.available),'ITEM_UNAVAILABLE',409);
  const variant = item.variants.find(v => v.id === line.variantId);
  requireCondition(item.variants.length ? variant : line.variantId === null,'INVALID_VARIANT');
  if(variant)requireCondition(availability[variant.id] ?? variant.available,'VARIANT_UNAVAILABLE',409);
  const modifiers = item.groups.flatMap(g => g.options).filter(o => line.modifierIds.includes(o.id));
  requireCondition(modifiers.length === line.modifierIds.length,'INVALID_MODIFIER');
  for (const group of item.groups) {
    const count = group.options.filter(o => line.modifierIds.includes(o.id)).length;
    requireCondition(count >= group.min && count <= group.max,'MODIFIER_SELECTION_LIMIT');
  }
  requireCondition(modifiers.every(o => availability[o.id] ?? o.available),'MODIFIER_UNAVAILABLE',409);
  const combination = item.pricingMode === 'MATRIX' ? item.combinationPrices?.find(c => c.variantId === line.variantId && c.optionIds.every((id,index) => id === item.groups[index].options.find(o => line.modifierIds.includes(o.id))?.id)) : undefined;
  if (item.pricingMode === 'MATRIX') requireCondition(combination && (availability[combination.id] ?? combination.available),'COMBINATION_UNAVAILABLE',409);
  const basePrice = combination?.price ?? variant?.price ?? item.price!;
  const unitPrice = money(BigInt(basePrice) + (item.pricingMode === 'MATRIX' ? 0n : modifiers.reduce((s,o) => s+BigInt(o.price),0n)));
  return { itemId: item.id, name: item.name, translations: structuredClone(item.translations ?? {}), menuRevision: revision, kitchen: item.kitchen, isPackaging:item.isPackaging===true, pricingMode:item.pricingMode??'ADDITIVE',
    variant: variant ? { id: variant.id, name: variant.name, price: variant.price } : null,
    combination: combination && (variant||modifiers.length) ? {id:combination.id,name:[variant?.name,...modifiers.map(o=>o.name)].filter(Boolean).join(' · '),translations:structuredClone(combination.translations??{})} : null,
    modifiers: modifiers.map(o => ({ id:o.id, name:o.name, price:o.price })), combinationId:combination?.id??null, basePrice, unitPrice, quantity:line.quantity,
    total: money(BigInt(unitPrice)*BigInt(line.quantity)), comment:line.comment ?? '' };
}
export function priceLine(catalog:Catalog,revision:number,raw:unknown,availability:Record<string,boolean>={}) {
  const custom=selection(raw);
  if(custom.kind==='CUSTOM_AMOUNT')return {kind:'CUSTOM_AMOUNT',itemId:'CUSTOM_AMOUNT',name:'Неизвестный товар',translations:{},menuRevision:revision,kitchen:false,isPackaging:false,pricingMode:'ADDITIVE',variant:null,combination:null,modifiers:[],combinationId:null,basePrice:custom.unitPrice!,unitPrice:custom.unitPrice!,quantity:custom.quantity,total:money(BigInt(custom.unitPrice!)*BigInt(custom.quantity)),comment:'',components:[]};
  const base=ordinaryPriceLine(catalog,revision,raw,availability),item=catalog.items.find(i=>i.id===base.itemId)!;
  const components=(item.kind==='SET'?item.components??[]:[]).map(component=>{
    const child=catalog.items.find(i=>i.id===component.itemId);
    requireCondition(child && child.kind!=='SET' && !child.isPackaging,'INVALID_SET_COMPONENT');
    integer(component.quantity*base.quantity,1,MAX_QUANTITY,'SET_QUANTITY_LIMIT');
    let line!:ReturnType<typeof ordinaryPriceLine>;
    try{line=ordinaryPriceLine(catalog,revision,{itemId:component.itemId,variantId:component.variantId,modifierIds:component.modifierIds,quantity:1},availability);}catch{requireCondition(false,'SET_COMPONENT_UNAVAILABLE',409);}
    requireCondition(line.combinationId===(component.combinationId??null),'INVALID_SET_SELECTION');
    return {itemId:line.itemId,name:line.name,translations:structuredClone(line.translations),variant:line.variant?{id:line.variant.id,name:line.variant.name,translations:structuredClone(child.variants.find(v=>v.id===line.variant!.id)?.translations??{})}:null,combination:line.combination,modifiers:line.modifiers.map(({id,name})=>({id,name,translations:structuredClone(child.groups.flatMap(g=>g.options).find(o=>o.id===id)?.translations??{})})),kitchen:line.kitchen,quantity:component.quantity};
  });
  return {...base,kind:item.kind??'ITEM',kitchen:item.kind==='SET'?components.some(c=>c.kitchen):base.kitchen,components};
}
export function totals(type: 'TABLE'|'COUNTER', lineTotals: number[], discount: number, inputFees: Fee[]) {
  requireCondition(type === 'TABLE' || type === 'COUNTER','INVALID_ORDER_TYPE');
  const subtotal = money(lineTotals.reduce((s,t) => s+BigInt(integer(t,0,MAX_MONEY)),0n));
  integer(discount,0,subtotal,'INVALID_DISCOUNT');
  const base = subtotal-discount;
  const fees = (type === 'TABLE' ? validateFees(inputFees) : []).map(f => ({ ...f, amount: money((BigInt(base)*BigInt(f.rate)+5000n)/10000n) }));
  return { subtotal, discount, base, fees, total:money(BigInt(base)+fees.reduce((s,f) => s+BigInt(f.amount),0n)) };
}
