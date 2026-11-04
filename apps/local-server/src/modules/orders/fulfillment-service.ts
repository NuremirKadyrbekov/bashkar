import {randomUUID} from 'node:crypto';
import {audit,outbox} from '../../command-bus';
import {integer,requireCondition} from '../../errors';
import {orderId} from './order-service';
import type {FinanceService} from './finance-service';
type Event={revision:number;issued:number;quantity:number;actor_id:string;actor_name:string;created_at:number};
export const HISTORY_STATE_ITEMS_SQL=`SELECT i.id itemId,b.sequence,COALESCE(MAX(e.revision),0) fulfillmentRevision
 FROM order_batches b INDEXED BY order_batches_history
 JOIN order_items i INDEXED BY order_items_batch ON i.branch_id=b.branch_id AND i.batch_id=b.id
 LEFT JOIN order_fulfillment_events e ON e.branch_id=i.branch_id AND e.item_id=i.id
 WHERE b.branch_id=? AND b.order_id=? GROUP BY i.id,b.sequence ORDER BY b.sequence,i.rowid`;
export const HISTORY_STATE_JOBS_SQL=`SELECT j.id,b.sequence,COALESCE(d.state,j.status) status,COALESCE(d.revision,0) revision,COALESCE(d.generation,0) generation
 FROM print_jobs j INDEXED BY print_jobs_order JOIN order_batches b ON b.branch_id=j.branch_id AND b.id=j.batch_id
 LEFT JOIN print_dispatches d ON d.branch_id=j.branch_id AND d.job_id=j.id
  AND d.generation=(SELECT MAX(x.generation) FROM print_dispatches x WHERE x.branch_id=j.branch_id AND x.job_id=j.id)
 WHERE j.branch_id=? AND j.order_id=? AND j.type='KITCHEN' ORDER BY b.sequence,j.rowid`;
// Operational history is independent of financial snapshots and print dispatch.
export class FulfillmentService {
 constructor(readonly finance:FinanceService){}
 private latest(branch:string,item:string){return this.finance.db.prepare('SELECT * FROM order_fulfillment_events WHERE branch_id=? AND item_id=? ORDER BY revision DESC LIMIT 1').get(branch,item) as Event|undefined;}
 history(token:string,id:string,after=0,limit=20){
  const f=this.finance,row=f.row(id);f.readAccess(token,row);integer(after,0,Number.MAX_SAFE_INTEGER);integer(limit,1,100);
  const rows=f.db.prepare('SELECT * FROM order_batches WHERE branch_id=? AND order_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(row.branch_id,row.id,after,limit+1) as {id:string;sequence:number;sender_name:string;submitted_at:number;subtotal:number}[];
  const batches=rows.slice(0,limit);
  const portions=f.portions(row);
  return {orderId:id,orderRevision:row.revision,batches:batches.map(b=>({...b,lines:(f.db.prepare('SELECT id,snapshot FROM order_items WHERE branch_id=? AND batch_id=? ORDER BY rowid').all(row.branch_id,b.id) as {id:string;snapshot:string}[]).map(i=>{
   const remaining=portions.filter(p=>p.itemId===i.id),quantity=remaining.reduce((sum,p)=>sum+p.quantity,0),event=this.latest(row.branch_id,i.id);
   return {...JSON.parse(i.snapshot),id:i.id,currentQuantity:quantity,currentTotal:remaining.reduce((sum,p)=>sum+Number(p.total),0),portions:remaining,fulfillment:{revision:event?.revision??0,issued:quantity>0&&!!event?.issued&&event.quantity>=quantity,quantity:event?.quantity??0,issuedQuantity:event?.issued?Math.min(event.quantity,quantity):0,actor:event?.actor_name??null,at:event?.created_at??null}};
  }),kitchenJobs:f.db.prepare("SELECT j.id,COALESCE((SELECT d.state FROM print_dispatches d WHERE d.branch_id=j.branch_id AND d.job_id=j.id ORDER BY d.generation DESC LIMIT 1),j.status) status FROM print_jobs j WHERE j.branch_id=? AND j.batch_id=? AND j.type='KITCHEN'").all(row.branch_id,b.id)})),next:rows.length>limit?batches.at(-1)!.sequence:null};
 }
 state(token:string,id:string){
  return this.finance.db.transaction(()=>{
  const f=this.finance,row=f.row(id);f.readAccess(token,row);
  const branch=row.branch_id;
  // Three order-scoped statements regardless of package count. The existing
  // batch, item and print indexes keep this independent of branch history.
  const last=f.db.prepare('SELECT COALESCE(MAX(sequence),0) last FROM order_batches WHERE branch_id=? AND order_id=?').get(branch,id) as {last:number};
  const items=f.db.prepare(HISTORY_STATE_ITEMS_SQL).all(branch,id) as {itemId:string;sequence:number;fulfillmentRevision:number}[];
  const jobs=f.db.prepare(HISTORY_STATE_JOBS_SQL).all(branch,id) as {id:string;sequence:number;status:string;revision:number;generation:number}[];
  return {orderId:id,orderRevision:row.revision,maxSequence:last.last,items,jobs};
  }).deferred();
 }
 events(token:string,id:string,after=0,limit=50){
  const f=this.finance,row=f.row(id);f.readAccess(token,row);integer(after,0,Number.MAX_SAFE_INTEGER);integer(limit,1,100);
  const events=f.db.prepare('SELECT rowid cursor,item_id itemId,revision,issued,quantity,actor_name actor,created_at at FROM order_fulfillment_events WHERE branch_id=? AND order_id=? AND rowid>? ORDER BY rowid LIMIT ?').all(row.branch_id,row.id,after,limit) as {cursor:number;issued:number;quantity:number}[];
  return {events:events.map(e=>({...e,issued:!!e.issued,issuedQuantity:e.issued?e.quantity:0})),next:events.length===limit?events.at(-1)!.cursor:null};
 }
 async mark(token:string,id:string,input:{itemId:string;issued?:boolean;issuedQuantity?:number;expectedRevision:number;expectedOrderRevision:number},commandId:string){
  const f=this.finance,actor=f.auth.current(token,'order.fulfillment.mark');orderId(input.itemId);integer(input.expectedRevision,0,Number.MAX_SAFE_INTEGER);integer(input.expectedOrderRevision,1,Number.MAX_SAFE_INTEGER);requireCondition((input.issued===undefined)!==(input.issuedQuantity===undefined),'INVALID_PAYLOAD');if(input.issued!==undefined)requireCondition(typeof input.issued==='boolean','INVALID_BOOLEAN');if(input.issuedQuantity!==undefined)integer(input.issuedQuantity,0,9999,'INVALID_QUANTITY');
  const access=()=>{f.auth.current(token,'order.fulfillment.mark');f.readAccess(token,f.row(id));};
  return f.bus.run({id:commandId,type:'order.fulfillment.mark',actor,payload:{orderId:id,...input}},access,()=>{
   const row=f.row(id);requireCondition(row.status==='OPEN','ORDER_NOT_OPEN',409);requireCondition(f.db.prepare("SELECT 1 FROM shifts WHERE branch_id=? AND id=? AND status='OPEN'").get(row.branch_id,row.shift_id),'SHIFT_REQUIRED',409);requireCondition(row.revision===input.expectedOrderRevision,'ORDER_REVISION_CONFLICT',409);
   const prior=this.latest(actor.branchId,input.itemId);requireCondition((prior?.revision??0)===input.expectedRevision,'REVISION_CONFLICT',409);
   const quantity=f.portions(row).filter(p=>p.itemId===input.itemId).reduce((sum,p)=>sum+p.quantity,0);requireCondition(quantity>0,'INVALID_PORTION',409);
   const issuedQuantity=input.issuedQuantity??(input.issued?quantity:0);requireCondition(issuedQuantity<=quantity,'INVALID_QUANTITY',409);
   const revision=(prior?.revision??0)+1,time=f.now();f.db.prepare('INSERT INTO order_fulfillment_events VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),actor.branchId,id,input.itemId,revision,issuedQuantity>0?1:0,issuedQuantity||quantity,actor.id,actor.employee.name,time,commandId);
   const result={orderId:id,itemId:input.itemId,revision,issued:issuedQuantity===quantity,quantity,issuedQuantity};audit(f.db,actor,'order.fulfillment.marked',input.itemId,commandId,time,result);outbox(f.db,actor.branchId,'order.fulfillment.marked',result,time);return result;
  });
 }
}
