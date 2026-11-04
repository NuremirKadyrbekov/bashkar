import type Database from 'better-sqlite3';
import {requireCondition} from '../../errors';

type Method='CASH'|'CARD_MANUAL'|'QR_TRANSFER_MANUAL';
type ServiceType='TABLE'|'COUNTER';
export type OverviewRange={from:number;to:number;timeZone:string;granularity:'hour'|'day'};
const methods:Method[]=['CASH','CARD_MANUAL','QR_TRANSFER_MANUAL'];
const types:ServiceType[]=['TABLE','COUNTER'];

function key(time:number,format:Intl.DateTimeFormat,granularity:OverviewRange['granularity']){
 const parts=Object.fromEntries(format.formatToParts(time).map(part=>[part.type,part.value]));
 const date=`${parts.year}-${parts.month}-${parts.day}`;
 return granularity==='hour'?`${date}T${parts.hour}`:date;
}
function bucketKeys(range:OverviewRange,format:Intl.DateTimeFormat){
 const result=new Set<string>(),step=range.granularity==='hour'?3_600_000:86_400_000;
 for(let time=range.from;time<range.to;time+=step)result.add(key(time,format,range.granularity));
 return [...result].sort();
}

/** Read-only calendar projection over sealed local financial facts. Amounts are integer tiyin strings. */
export function buildOverviewMetrics(db:Database.Database,branchId:string,range:OverviewRange){
 requireCondition(typeof branchId==='string'&&branchId.length>0,'INVALID_BRANCH');
 requireCondition(Number.isSafeInteger(range.from)&&Number.isSafeInteger(range.to)&&range.from>=0&&range.to>range.from&&range.to-range.from<=366*86_400_000,'INVALID_PERIOD');
 requireCondition(range.granularity==='hour'||range.granularity==='day','INVALID_GRANULARITY');
 requireCondition(typeof range.timeZone==='string'&&range.timeZone.length>0,'INVALID_TIME_ZONE');
 let format:Intl.DateTimeFormat;
 try{format=new Intl.DateTimeFormat('en-US',{timeZone:range.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});}catch{throw new Error('INVALID_TIME_ZONE');}
 const buckets=new Map(bucketKeys(range,format).map(label=>[label,0n]));
 const paymentByMethod=Object.fromEntries(methods.map(method=>[method,0n])) as Record<Method,bigint>;
 const byService=Object.fromEntries(types.map(type=>[type,{amount:0n,count:0}])) as Record<ServiceType,{amount:bigint;count:number}>;
 const payments=db.prepare(`SELECT p.id,p.amount,p.method,p.registered_at,o.type
  FROM payments p JOIN settlement_seals z ON z.branch_id=p.branch_id AND z.settlement_id=p.settlement_id
  JOIN orders o ON o.branch_id=p.branch_id AND o.id=p.order_id
  WHERE p.branch_id=? AND p.registered_at>=? AND p.registered_at<? ORDER BY p.registered_at,p.id`).all(branchId,range.from,range.to) as {id:string;amount:number;method:Method;registered_at:number;type:ServiceType}[];
 let gross=0n;
 for(const p of payments){
  requireCondition(methods.includes(p.method)&&types.includes(p.type),'FINANCIAL_GRAPH_INVALID',500);
  const amount=BigInt(p.amount);gross+=amount;paymentByMethod[p.method]+=amount;byService[p.type].amount+=amount;
  const label=key(p.registered_at,format,range.granularity);buckets.set(label,(buckets.get(label)??0n)+amount);
 }
 const settlements=db.prepare(`SELECT s.id,s.amount,s.snapshot,o.type FROM settlements s
  JOIN settlement_seals z ON z.branch_id=s.branch_id AND z.settlement_id=s.id
  JOIN orders o ON o.branch_id=s.branch_id AND o.id=s.order_id
  WHERE s.branch_id=? AND s.kind='PAID' AND s.settled_at>=? AND s.settled_at<?`).all(branchId,range.from,range.to) as {id:string;amount:number;snapshot:string;type:ServiceType}[];
 let discounts=0n;
 for(const s of settlements){
  requireCondition(types.includes(s.type),'FINANCIAL_GRAPH_INVALID',500);
  byService[s.type].count++;
  const snapshot=JSON.parse(s.snapshot) as {discount:number};
  discounts+=BigInt(snapshot.discount);
 }
 const refundRows=db.prepare(`SELECT amount FROM refunds WHERE branch_id=? AND created_at>=? AND created_at<?`).all(branchId,range.from,range.to) as {amount:number}[];
 const refunds=refundRows.reduce((sum,row)=>sum+BigInt(row.amount),0n);
 const cancelled=(db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE branch_id=? AND status='CANCELLED' AND terminal_at>=? AND terminal_at<?`).get(branchId,range.from,range.to) as {n:number}).n;
 const paidOrders=settlements.length;
 return {branchId,range,grossPaymentsAmount:gross.toString(),refundsAmount:refunds.toString(),netReceiptsAmount:(gross-refunds).toString(),paidOrdersCount:paidOrders,averageCheckAmount:paidOrders?((gross+BigInt(Math.floor(paidOrders/2)))/BigInt(paidOrders)).toString():'0',discountsAmount:discounts.toString(),cancelledOrdersCount:cancelled,
  dynamics:[...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([period,amount])=>({period,amount:amount.toString()})),
  paymentMethods:Object.fromEntries(methods.map(method=>[method,paymentByMethod[method].toString()])) as Record<Method,string>,
  serviceTypes:Object.fromEntries(types.map(type=>[type,{amount:byService[type].amount.toString(),paidOrdersCount:byService[type].count}])) as Record<ServiceType,{amount:string;paidOrdersCount:number}>};
}
