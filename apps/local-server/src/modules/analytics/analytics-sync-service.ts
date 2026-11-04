import {randomUUID} from 'node:crypto';
import {canonical,digest} from '../../command-bus';
import type Database from 'better-sqlite3';
import type {CommandBus} from '../../command-bus';
import type {MenuTransport} from '../menu/cloud-menu-transport';

type Kind='SETTLEMENT'|'PAYMENT'|'REFUND'|'CANCELLED'|'PRODUCT';
type Fact={kind:Kind;id:string;orderId:string;occurredAt:number;amount:string;discount:string;method:string|null;serviceType:string|null;hash:string;productId?:string;productName?:string;categoryId?:string;categoryName?:string;quantity?:number};
type State={settlement_rowid:number;payment_rowid:number;refund_rowid:number;correction_rowid:number;product_rowid:number;product_item_rowid:number;last_success_at:number|null;last_error:string|null};
const LIMIT=20;
const BACKFILL_PACE_MS=500;

/** Pushes immutable financial facts in bounded, idempotent batches. Never blocks POS writes. */
export class AnalyticsSyncService {
 private timer?:ReturnType<typeof setTimeout>;private task?:Promise<void>;private stopped=true;private failures=0;private more=false;private nextSendAt=0;
 constructor(private db:Database.Database,private bus:CommandBus,private branchId:string,private remote?:MenuTransport,private now=Date.now){}
 private state(){return this.db.prepare('SELECT * FROM analytics_sync_state WHERE branch_id=?').get(this.branchId) as State|undefined;}
 private async ensure(){await this.bus.system(()=>this.db.prepare('INSERT OR IGNORE INTO analytics_sync_state(branch_id) VALUES(?)').run(this.branchId));}
 status(){
  const s=this.state(),cursor=s??{settlement_rowid:0,payment_rowid:0,refund_rowid:0,correction_rowid:0,product_rowid:0,product_item_rowid:0};
  const count=(sql:string,after:number)=>(this.db.prepare(sql).get(this.branchId,after) as {n:number}).n;
  const pendingFacts=
   count('SELECT COUNT(*) n FROM settlements s JOIN settlement_seals z ON z.branch_id=s.branch_id AND z.settlement_id=s.id WHERE s.branch_id=? AND s.rowid>? AND s.amount>0',cursor.settlement_rowid)+
   count('SELECT COUNT(*) n FROM payments p JOIN settlement_seals z ON z.branch_id=p.branch_id AND z.settlement_id=p.settlement_id WHERE p.branch_id=? AND p.rowid>?',cursor.payment_rowid)+
   count('SELECT COUNT(*) n FROM refunds WHERE branch_id=? AND rowid>?',cursor.refund_rowid)+
   count("SELECT COUNT(*) n FROM order_corrections c JOIN orders o ON o.branch_id=c.branch_id AND o.id=c.order_id WHERE c.branch_id=? AND c.rowid>? AND o.status='CANCELLED' AND o.terminal_at=c.created_at",cursor.correction_rowid)+
   (this.db.prepare("SELECT COUNT(*) n FROM settlements s JOIN settlement_seals z ON z.branch_id=s.branch_id AND z.settlement_id=s.id JOIN order_batches b ON b.branch_id=s.branch_id AND b.order_id=s.order_id JOIN order_items i ON i.branch_id=b.branch_id AND i.batch_id=b.id WHERE s.branch_id=? AND s.kind='PAID' AND (s.rowid>? OR s.rowid=? AND i.rowid>?)").get(this.branchId,cursor.product_rowid,cursor.product_rowid,cursor.product_item_rowid) as {n:number}).n;
  return {enabled:!!this.remote,lastSuccessAt:s?.last_success_at??null,lastError:s?.last_error??null,pendingFacts};
 }
 start(){this.stopped=false;this.wake();}
 async stop(){this.stopped=true;clearTimeout(this.timer);await this.task;}
 async syncOnce(){if(this.remote)await this.cycle();}
 wake(){if(this.stopped||!this.remote||this.task)return;clearTimeout(this.timer);this.timer=setTimeout(()=>void this.run(),Math.max(0,this.nextSendAt-this.now()));this.timer.unref();}
 async run(){if(this.task||this.stopped||!this.remote)return this.task;this.task=this.cycle().finally(()=>{this.task=undefined;if(this.stopped)return;const delay=this.failures?Math.min(300000,15000*2**Math.min(this.failures-1,4)):this.more?BACKFILL_PACE_MS:30000;if(!this.failures&&this.more)this.nextSendAt=this.now()+BACKFILL_PACE_MS;this.timer=setTimeout(()=>void this.run(),delay);this.timer.unref();});return this.task;}
 private rows(s:State){
  const settlements=this.db.prepare(`SELECT s.rowid cursor,s.id,s.order_id orderId,s.settled_at occurredAt,s.amount,s.snapshot,o.type serviceType FROM settlements s JOIN settlement_seals z ON z.branch_id=s.branch_id AND z.settlement_id=s.id JOIN orders o ON o.branch_id=s.branch_id AND o.id=s.order_id WHERE s.branch_id=? AND s.rowid>? ORDER BY s.rowid LIMIT ?`).all(this.branchId,s.settlement_rowid,LIMIT) as {cursor:number;id:string;orderId:string;occurredAt:number;amount:number;snapshot:string;serviceType:string}[];
  const payments=this.db.prepare(`SELECT p.rowid cursor,p.id,p.order_id orderId,p.registered_at occurredAt,p.amount,p.method,o.type serviceType FROM payments p JOIN settlement_seals z ON z.branch_id=p.branch_id AND z.settlement_id=p.settlement_id JOIN orders o ON o.branch_id=p.branch_id AND o.id=p.order_id WHERE p.branch_id=? AND p.rowid>? ORDER BY p.rowid LIMIT ?`).all(this.branchId,s.payment_rowid,LIMIT) as {cursor:number;id:string;orderId:string;occurredAt:number;amount:number;method:string;serviceType:string}[];
  const refunds=this.db.prepare(`SELECT rowid cursor,id,order_id orderId,created_at occurredAt,amount,method FROM refunds WHERE branch_id=? AND rowid>? ORDER BY rowid LIMIT ?`).all(this.branchId,s.refund_rowid,LIMIT) as {cursor:number;id:string;orderId:string;occurredAt:number;amount:number;method:string}[];
  const corrections=this.db.prepare(`SELECT c.rowid cursor,c.id correctionId,o.id,o.terminal_at occurredAt,c.created_at correctionAt,o.status FROM order_corrections c JOIN orders o ON o.branch_id=c.branch_id AND o.id=c.order_id WHERE c.branch_id=? AND c.rowid>? ORDER BY c.rowid LIMIT ?`).all(this.branchId,s.correction_rowid,LIMIT) as {cursor:number;correctionId:string;id:string;occurredAt:number|null;correctionAt:number;status:string}[];
  const products=this.db.prepare(`SELECT s.rowid settlementCursor,i.rowid cursor,i.id,i.snapshot,b.order_id orderId,b.menu_revision menuRevision,s.settled_at occurredAt,
   COALESCE((SELECT SUM(p.quantity) FROM order_item_portions p WHERE p.branch_id=i.branch_id AND p.item_id=i.id),0) quantity,
   r.document menuDocument FROM order_items i JOIN order_batches b ON b.branch_id=i.branch_id AND b.id=i.batch_id
   JOIN settlements s ON s.branch_id=b.branch_id AND s.order_id=b.order_id AND s.kind='PAID'
   JOIN settlement_seals z ON z.branch_id=s.branch_id AND z.settlement_id=s.id
   LEFT JOIN menu_revisions r ON r.branch_id=b.branch_id AND r.revision=b.menu_revision
   WHERE i.branch_id=? AND (s.rowid>? OR s.rowid=? AND i.rowid>?) ORDER BY s.rowid,i.rowid LIMIT ?`).all(this.branchId,s.product_rowid,s.product_rowid,s.product_item_rowid,LIMIT) as {settlementCursor:number;cursor:number;id:string;snapshot:string;orderId:string;menuRevision:number;occurredAt:number;quantity:number;menuDocument:string|null}[];
  const catalogCache=new Map<number,{categories:{id:string;name:string}[];items:{id:string;categoryId:string}[]}>();
  const fact=(entry:Omit<Fact,'hash'>):Fact=>({...entry,hash:digest(canonical(entry))});const facts:Fact[]=[];
  for(const row of settlements){if(row.amount===0)continue;const snapshot=JSON.parse(row.snapshot) as {discount:number};facts.push(fact({kind:'SETTLEMENT',id:row.id,orderId:row.orderId,occurredAt:row.occurredAt,amount:String(row.amount),discount:String(snapshot.discount),method:null,serviceType:row.serviceType}));}
  for(const row of payments)facts.push(fact({kind:'PAYMENT',id:row.id,orderId:row.orderId,occurredAt:row.occurredAt,amount:String(row.amount),discount:'0',method:row.method,serviceType:row.serviceType}));
  for(const row of refunds)facts.push(fact({kind:'REFUND',id:row.id,orderId:row.orderId,occurredAt:row.occurredAt,amount:String(row.amount),discount:'0',method:row.method,serviceType:null}));
  for(const row of corrections)if(row.status==='CANCELLED'&&row.occurredAt===row.correctionAt)facts.push(fact({kind:'CANCELLED',id:row.id,orderId:row.id,occurredAt:row.occurredAt,amount:'0',discount:'0',method:null,serviceType:null}));
  for(const row of products){
   if(row.quantity<=0)continue;
   const line=JSON.parse(row.snapshot) as {kind?:string;itemId:string;name:string};
   if(line.kind==='CUSTOM_AMOUNT'||line.itemId==='CUSTOM_AMOUNT')continue;
   if(!row.menuDocument)throw Error('ANALYTICS_MENU_REVISION_MISSING');
   let catalog=catalogCache.get(row.menuRevision);if(!catalog){catalog=JSON.parse(row.menuDocument);catalogCache.set(row.menuRevision,catalog!);}
   const item=catalog!.items.find(item=>item.id===line.itemId),category=catalog!.categories.find(category=>category.id===item?.categoryId);
   if(!item||!category)throw Error('ANALYTICS_HISTORICAL_ITEM_MISSING');
   facts.push(fact({kind:'PRODUCT',id:row.id,orderId:row.orderId,occurredAt:row.occurredAt,amount:'0',discount:'0',method:null,serviceType:null,
    productId:line.itemId,productName:line.name,categoryId:category.id,categoryName:category.name,quantity:row.quantity}));
  }
  const cursor={settlement:Math.max(s.settlement_rowid,...settlements.map(r=>r.cursor)),payment:Math.max(s.payment_rowid,...payments.map(r=>r.cursor)),refund:Math.max(s.refund_rowid,...refunds.map(r=>r.cursor)),correction:Math.max(s.correction_rowid,...corrections.map(r=>r.cursor)),product:products.length?products.at(-1)!.settlementCursor:s.product_rowid,productItem:products.length?products.at(-1)!.cursor:s.product_item_rowid};
  return {facts,cursor,complete:[settlements,payments,refunds,corrections,products].every(rows=>rows.length<LIMIT)};
 }
 private async cycle(){try{
  await this.ensure();const s=this.state()!,batch=this.rows(s),body={commandId:randomUUID(),facts:batch.facts,backfillComplete:batch.complete};
  const receipt=await this.remote!.call('analyticsBatch',body);
  if(receipt?.state!=='APPLIED'||receipt.accepted!==batch.facts.length)throw Error('INVALID_ANALYTICS_RECEIPT');
  await this.bus.system(()=>this.db.prepare(`UPDATE analytics_sync_state SET settlement_rowid=?,payment_rowid=?,refund_rowid=?,correction_rowid=?,product_rowid=?,product_item_rowid=?,last_success_at=?,last_error=NULL WHERE branch_id=?`).run(batch.cursor.settlement,batch.cursor.payment,batch.cursor.refund,batch.cursor.correction,batch.cursor.product,batch.cursor.productItem,this.now(),this.branchId));
  this.failures=0;this.more=!batch.complete;
 }catch(error){this.failures++;const code=error instanceof Error?error.message:'ANALYTICS_CLOUD_UNAVAILABLE';await this.bus.system(()=>{if(this.state())this.db.prepare('UPDATE analytics_sync_state SET last_error=? WHERE branch_id=?').run(code,this.branchId);});}}
}
