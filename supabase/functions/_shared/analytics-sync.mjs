const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const exact=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===names.slice().sort().join(',');
export function validateAnalyticsBatch(body){
 if(!exact(body,['commandId','backfillComplete','facts'])||!uuid(body.commandId)||typeof body.backfillComplete!=='boolean'||!Array.isArray(body.facts)||body.facts.length>100)throw Error('INVALID_ANALYTICS_BATCH');
 for(const fact of body.facts){
  const product=fact?.kind==='PRODUCT';
  const fields=['kind','id','orderId','occurredAt','amount','discount','method','serviceType','hash',...(product?['productId','productName','categoryId','categoryName','quantity']:[])];
  if(!exact(fact,fields)||!['SETTLEMENT','PAYMENT','REFUND','CANCELLED','PRODUCT'].includes(fact.kind)||!uuid(fact.id)||!uuid(fact.orderId)||!Number.isSafeInteger(fact.occurredAt)||fact.occurredAt<0||typeof fact.amount!=='string'||!/^[0-9]{1,15}$/.test(fact.amount)||typeof fact.discount!=='string'||!/^[0-9]{1,15}$/.test(fact.discount)||typeof fact.hash!=='string'||!/^[0-9a-f]{64}$/.test(fact.hash))throw Error('INVALID_ANALYTICS_BATCH');
  const payment=fact.kind==='PAYMENT',settlement=fact.kind==='SETTLEMENT',refund=fact.kind==='REFUND',cancel=fact.kind==='CANCELLED';
  if((payment||refund)!==['CASH','CARD_MANUAL','QR_TRANSFER_MANUAL'].includes(fact.method)||(payment||settlement)!==['TABLE','COUNTER'].includes(fact.serviceType)||((cancel||product)&&fact.amount!=='0')||(!(cancel||product)&&fact.amount==='0')||(!settlement&&fact.discount!=='0'))throw Error('INVALID_ANALYTICS_BATCH');
  if(product&&(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(fact.productId)||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(fact.categoryId)||typeof fact.productName!=='string'||!fact.productName.trim()||fact.productName.length>300||typeof fact.categoryName!=='string'||!fact.categoryName.trim()||fact.categoryName.length>300||!Number.isSafeInteger(fact.quantity)||fact.quantity<1||fact.quantity>9999))throw Error('INVALID_ANALYTICS_BATCH');
 }
}
