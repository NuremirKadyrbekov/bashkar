import type Database from 'better-sqlite3';
import {requireCondition} from '../../errors';

type ProductRow={id:string;menuRevision:number;snapshot:string;quantity:number;settledAt:number;document:string|null};
type Catalog={items:{id:string;categoryId:string}[];categories:{id:string;name:string}[]};

/** Paid quantities after pre-settlement corrections, attributed to the settlement date. */
export function buildProductMetrics(db:Database.Database,branchId:string,range:{from:number;to:number}){
 requireCondition(typeof branchId==='string'&&branchId.length>0,'INVALID_BRANCH');
 requireCondition(Number.isSafeInteger(range.from)&&Number.isSafeInteger(range.to)&&range.from>=0&&range.to>range.from&&range.to-range.from<=366*86_400_000,'INVALID_PERIOD');
 const rows=db.prepare(`SELECT i.id,b.menu_revision menuRevision,i.snapshot,s.settled_at settledAt,r.document,
  COALESCE((SELECT SUM(p.quantity) FROM order_item_portions p WHERE p.branch_id=i.branch_id AND p.item_id=i.id),0) quantity
  FROM settlements s JOIN settlement_seals z ON z.branch_id=s.branch_id AND z.settlement_id=s.id
  JOIN order_batches b ON b.branch_id=s.branch_id AND b.order_id=s.order_id
  JOIN order_items i ON i.branch_id=b.branch_id AND i.batch_id=b.id
  LEFT JOIN menu_revisions r ON r.branch_id=b.branch_id AND r.revision=b.menu_revision
  WHERE s.branch_id=? AND s.kind='PAID' AND s.settled_at>=? AND s.settled_at<?
  ORDER BY s.settled_at,i.rowid`).all(branchId,range.from,range.to) as ProductRow[];
 const catalogs=new Map<number,Catalog>(),products=new Map<string,{productId:string;name:string;categoryId:string;category:string;quantity:number}>();
 let totalUnits=0;
 for(const row of rows){
  if(row.quantity<=0)continue;
  const snapshot=JSON.parse(row.snapshot) as {kind?:string;itemId:string;name:string};
  if(snapshot.kind==='CUSTOM_AMOUNT'||snapshot.itemId==='CUSTOM_AMOUNT')continue;
  requireCondition(row.document,'ANALYTICS_MENU_REVISION_MISSING',500);
  let catalog=catalogs.get(row.menuRevision);if(!catalog){catalog=JSON.parse(row.document) as Catalog;catalogs.set(row.menuRevision,catalog);}
  const item=catalog.items.find(value=>value.id===snapshot.itemId),category=catalog.categories.find(value=>value.id===item?.categoryId);
  requireCondition(item&&category,'ANALYTICS_HISTORICAL_ITEM_MISSING',500);
  const key=JSON.stringify([snapshot.itemId,category.id]),current=products.get(key);
  if(current){current.quantity+=row.quantity;current.name=snapshot.name;current.category=category.name;}
  else products.set(key,{productId:snapshot.itemId,name:snapshot.name,categoryId:category.id,category:category.name,quantity:row.quantity});
  totalUnits+=row.quantity;
 }
 const topProducts=[...products.values()].sort((a,b)=>b.quantity-a.quantity||a.name.localeCompare(b.name,'ru')||a.productId.localeCompare(b.productId)).slice(0,10);
 return {branchId,range,totalUnits,topProducts};
}
