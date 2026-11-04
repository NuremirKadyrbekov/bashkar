const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const code=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{22}$/.test(value);
const label=row=>({name:row.name,translations:row.translations??{}});
const option=row=>({id:row.id,...label(row),price:row.price,available:row.available});
function minimumPrice(item){
 if(item.pricingMode==='MATRIX')return Math.min(...item.combinationPrices.filter(row=>row.available).map(row=>row.price));
 const base=item.price??Math.min(...item.variants.filter(row=>row.available).map(row=>row.price));
 const required=item.groups.reduce((total,group)=>total+group.options.filter(row=>row.available).map(row=>row.price).sort((a,b)=>a-b).slice(0,group.min).reduce((sum,price)=>sum+price,0),0);
 return base+required;
}
export function projectPublicMenu(row,cdnOrigin,design={}){
 const c=row.catalog,hiddenCategories=new Set(design.hiddenCategoryIds??[]),activeCategories=c.categories.filter(category=>!category.archived&&!hiddenCategories.has(category.id)),ids=new Set(activeCategories.map(category=>category.id));
 const url=key=>typeof key==='string'&&/^[A-Za-z0-9_./-]+$/.test(key)?`${cdnOrigin.replace(/\/$/,'')}/${key}`:null;
 const categories=activeCategories.map(category=>({id:category.id,...label(category),titles:design.categoryTitles?.[category.id]??{},imageUrl:url(design.categoryImageKeys?.[category.id])}));
 const items=c.items.filter(item=>!item.archived&&!item.isPackaging&&item.publicVisible!==false&&ids.has(item.categoryId)).map(item=>{
  const minimum=minimumPrice(item);
  const photoKey=row.photos?.[item.id];
  return {id:item.id,categoryId:item.categoryId,kind:item.kind??'ITEM',...label(item),description:item.description??'',descriptionTranslations:item.descriptionTranslations??{},available:item.available,
   priceFrom:Number.isFinite(minimum)?minimum:null,priceIsFrom:item.pricingMode==='MATRIX'||item.variants.length>0||item.groups.some(group=>group.options.length>0),photoUrl:typeof photoKey==='string'&&/^[A-Za-z0-9_./-]+$/.test(photoKey)?`${cdnOrigin.replace(/\/$/,'')}/${photoKey}`:null,
   variants:item.variants.map(option),groups:item.groups.map(group=>({id:group.id,...label(group),min:group.min,max:group.max,options:group.options.map(option)})),
   combinationPrices:(item.combinationPrices??[]).map(combo=>({id:combo.id,variantId:combo.variantId,optionIds:combo.optionIds,price:combo.price,available:combo.available})),
   ...(item.kind==='SET'?{components:item.components}:{}),pricingMode:item.pricingMode??null};
 });
 return {design:{revision:design.revision??0,theme:design.theme??'emerald',defaultLanguage:design.defaultLanguage??c.mainLanguage,languages:design.languages??c.languages,copy:design.copy??{},template:design.template??'classic',wifi:design.wifi??{ssid:'',password:''},logoUrl:url(design.logoKey),bannerUrl:url(design.bannerKey)},branchId:row.branchId,branchName:row.branchName,table:row.table,menuVersionId:row.versionId,photoRevision:row.photoRevision,updatedAt:row.updatedAt,mainLanguage:c.mainLanguage,languages:c.languages,categories,items};
}
export function makePublicMenuHandler({rpc,cdnOrigin}){
 const headers={'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'apikey, content-type','cache-control':'no-store','x-content-type-options':'nosniff'};
 return async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return new Response(JSON.stringify({code:'METHOD_NOT_ALLOWED'}),{status:405,headers});
  const url=new URL(request.url),branch=url.searchParams.get('branch'),table=url.searchParams.get('table');
  if(!uuid(branch)||url.searchParams.getAll('branch').length!==1||url.searchParams.getAll('table').length>1||table!==null&&!code(table))return new Response(JSON.stringify({code:'INVALID_PUBLIC_PATH'}),{status:400,headers});
  try{const row=await rpc('public_menu_read',{p_branch:branch,p_code:table});let design={};try{design=await rpc('public_menu_design_read',{p_branch:branch});}catch{/* Existing Cloud deployments use default presentation. */}const body=projectPublicMenu(row,cdnOrigin,design);return new Response(JSON.stringify(body),{status:200,headers:{...headers,'cache-control':'public, max-age=30, s-maxage=30'}});}
  catch(error){const code=['PUBLIC_MENU_UNAVAILABLE','PUBLIC_TABLE_NOT_FOUND'].includes(error?.message)?error.message:'PUBLIC_MENU_UNAVAILABLE';return new Response(JSON.stringify({code}),{status:code==='PUBLIC_TABLE_NOT_FOUND'?404:503,headers});}
 };
}
