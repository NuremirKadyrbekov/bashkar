import { ABSOLUTE_LIMIT, IDLE_LIMIT, type ClientType } from '../auth/session-policy';
import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {audit,canonical,CommandBus,digest,outbox,uuidPattern} from '../../command-bus';
import {integer,requireCondition} from '../../errors';
import {hasPermission,type Permission} from '../auth/permissions';
import {AuthService} from '../auth/auth-service';
import {MenuService} from '../menu/menu-service';
import {object,type Fee} from '../menu/catalog';
import {priceLine,selection,totals} from '../menu/pricing';
import {TableService} from '../tables/table-service';
import {nextOrderNumber,assignOrderNumber,readOrderNumber} from './order-numbers';
import {assertCurrentCashDraft} from './cash-draft-service';
export type Order={id:string;branch_id:string;shift_id:string;table_session_id:string|null;type:'TABLE'|'COUNTER';financial_state:string;terminal_at:number|null;counter_number:number|null;guest_label:string|null;revision:number;status:string;discount:number;subtotal:number;total:number;fees_snapshot:string};
export type Request={draftId:string;draftRevision:number;menuRevision:number;lines:unknown[];discount:number};
export const orderId=(id:unknown)=>{requireCondition(typeof id==='string'&&uuidPattern.test(id),'INVALID_ID');return id;};
export class OrderService {
 constructor(readonly db:Database.Database,readonly bus:CommandBus,readonly auth:AuthService,readonly menu:MenuService,readonly tables:TableService,readonly now=Date.now){}
 terminalPolicy:((token:string,row:Order)=>void)|undefined;
 receiptAccess(token:string,id:string,permission:Permission,fallback:()=>unknown){const actor=this.auth.current(token,permission);const record=this.db.prepare('SELECT actor_id,result FROM commands WHERE branch_id=? AND id=?').get(actor.branchId,id) as {actor_id:string;result:string}|undefined;let terminal=false;if(record?.actor_id===actor.id){const receipt=JSON.parse(record.result);const row=receipt.orderId?this.db.prepare('SELECT status FROM orders WHERE branch_id=? AND id=?').get(actor.branchId,receipt.orderId) as {status:string}|undefined:undefined;terminal=!!row&&row.status!=='OPEN';}if(!terminal)fallback();}
 private read(token:string,sessionId:string){const row=this.row(sessionId);if(row&&row.status!=='OPEN'&&this.terminalPolicy)this.terminalPolicy(token,row);else this.visit(token,sessionId);return row;}
 private visit(token:string,id:string,permission:Permission='table.view_details') {this.auth.current(token,permission);return this.tables.details(token,orderId(id));}
 context(token:string,sessionId:string){const visit=this.visit(token,sessionId);const actor=this.auth.current(token);const instance=this.db.prepare('SELECT id FROM bootstrap_instance').get() as {id:string};const session=this.db.prepare('SELECT issued_at,last_activity,client FROM auth_sessions WHERE id=?').get(actor.sessionId) as {issued_at:number;last_activity:number;client:ClientType};return {instanceId:instance.id,branchId:actor.branchId,employeeId:actor.id,sessionId,open:visit.status==='OPEN',canSubmit:hasPermission(this.db,actor.employee,'table.batch.submit'),serverTime:this.now(),validUntil:Math.min(session.issued_at+ABSOLUTE_LIMIT,session.last_activity+IDLE_LIMIT[session.client])};}
 private row(sessionId:string){return this.db.prepare('SELECT * FROM orders WHERE branch_id=? AND table_session_id=?').get(this.auth.branchId,sessionId) as Order|undefined;}
 dto(row:Order){return {id:row.id,orderNumber:readOrderNumber(this.db,row.branch_id,row.id),sessionId:row.table_session_id,status:row.status,revision:row.revision,financialState:row.financial_state,type:row.type,shiftId:row.shift_id,...totals(row.type,[row.subtotal],row.discount,JSON.parse(row.fees_snapshot).fees)};}
 get(token:string,sessionId:string){const row=this.read(token,sessionId);return row?this.dto(row):null;}
 history(token:string,sessionId:string,after=0,limit=20){this.read(token,sessionId);integer(after,0,Number.MAX_SAFE_INTEGER);integer(limit,1,100);const row=this.row(sessionId);if(!row)return {orderNumber:null,batches:[],next:null};
  const rows=this.db.prepare('SELECT * FROM order_batches WHERE branch_id=? AND order_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(this.auth.branchId,row.id,after,limit+1) as {id:string;sequence:number;sender_id:string;sender_name:string;submitted_at:number;menu_revision:number;subtotal:number}[];
  const batches=rows.slice(0,limit);
  return {orderNumber:readOrderNumber(this.db,row.branch_id,row.id),batches:batches.map(b=>({id:b.id,sequence:b.sequence,sender:{id:b.sender_id,name:b.sender_name},submittedAt:b.submitted_at,menuRevision:b.menu_revision,subtotal:b.subtotal,lines:(this.db.prepare('SELECT id,line_id,snapshot FROM order_items WHERE branch_id=? AND batch_id=? ORDER BY rowid').all(this.auth.branchId,b.id) as {id:string;line_id:string;snapshot:string}[]).map(i=>({id:i.id,lineId:i.line_id,...JSON.parse(i.snapshot)})),kitchenJobs:this.db.prepare('SELECT j.id,COALESCE((SELECT d.state FROM print_dispatches d WHERE d.branch_id=j.branch_id AND d.job_id=j.id ORDER BY d.generation DESC LIMIT 1),j.status) status FROM print_jobs j WHERE branch_id=? AND batch_id=?').all(this.auth.branchId,b.id)})),next:rows.length>limit?batches.at(-1)!.sequence:null};
 }
 jobs(token:string,sessionId:string){this.read(token,sessionId);const row=this.row(sessionId);return row?(this.db.prepare("SELECT j.id,COALESCE((SELECT d.state FROM print_dispatches d WHERE d.branch_id=j.branch_id AND d.job_id=j.id ORDER BY d.generation DESC LIMIT 1),j.status) status,j.payload FROM print_jobs j WHERE branch_id=? AND order_id=? AND type='KITCHEN' ORDER BY j.rowid").all(this.auth.branchId,row.id) as {id:string;status:string;payload:string}[]).map(j=>({...j,payload:JSON.parse(j.payload)})):[];}
 validate(input:Request){orderId(input.draftId);integer(input.draftRevision,1,Number.MAX_SAFE_INTEGER);integer(input.menuRevision,1,Number.MAX_SAFE_INTEGER);integer(input.discount,0,999999999);
  requireCondition(Array.isArray(input.lines)&&input.lines.length>0&&input.lines.length<=1000,'INVALID_LINES');
  const seen=new Set();return input.lines.map(raw=>{const r=object(raw,['lineId','itemId','variantId','modifierIds','quantity','comment','kind','unitPrice']);const lineId=orderId(r.lineId);requireCondition(!seen.has(lineId),'DUPLICATE_LINE');seen.add(lineId);const {lineId:_,...rest}=r;return {lineId,...selection(rest)};});
 }
 prepare(token:string,sessionId:string,input:Request){
  const visit=this.visit(token,sessionId,'table.batch.submit'),actor=this.auth.current(token),selections=this.validate(input);
  if(selections.some(s=>s.kind==='CUSTOM_AMOUNT'))this.auth.current(token,'order.custom_item.create');
  requireCondition(visit.status==='OPEN','VISIT_CLOSED',409);
  const shift=this.db.prepare("SELECT id FROM shifts WHERE branch_id=? AND status='OPEN'").get(actor.branchId) as {id:string}|undefined;
  requireCondition(shift?.id===visit.shiftId,'SHIFT_REQUIRED',409);const row=this.row(sessionId);requireCondition(!row||row.status==='OPEN','ORDER_NOT_OPEN',409);
  assertCurrentCashDraft(this.db,actor,visit.shiftId,'TABLE',input);
  if(!row&&input.discount>0)this.auth.current(token,'order.discount.set');
  requireCondition(!row||row.discount===input.discount,'ORDER_REVISION_CONFLICT',409);
  const current=this.menu.active(token);requireCondition(current.catalog,'MENU_NOT_PUBLISHED',409);
  const availability=Object.fromEntries(Object.entries(this.menu.availability()).map(([id,r])=>[id,r.available]));
  const lines=selections.map(s=>{const {lineId,...sel}=s;return {lineId,...priceLine(current.catalog!,current.revision,sel,availability)};});
  const settings=this.db.prepare('SELECT revision,fees FROM branch_settings WHERE branch_id=?').get(actor.branchId) as {revision:number;fees:string}|undefined;
  const feeSnapshot=row?JSON.parse(row.fees_snapshot):{revision:settings?.revision??0,fees:settings?JSON.parse(settings.fees):[]};
  const batchSubtotal=totals('TABLE',lines.map(l=>l.total),0,[]).subtotal;
  const amount=totals('TABLE',[row?.subtotal??0,batchSubtotal],row?.discount??input.discount,feeSnapshot.fees as Fee[]);
  const proposal={sessionId,visitRevision:visit.revision,draftId:input.draftId,draftRevision:input.draftRevision,menuRevision:current.revision,orderRevision:row?.revision??0,lines,batchSubtotal,feeSnapshot,current:row?this.dto(row):null,...amount};
  return {...proposal,menuChanged:input.menuRevision!==current.revision,confirmationHash:digest(canonical({branchId:actor.branchId,actorId:actor.id,...proposal}))};
 }
 async submit(token:string,id:string,sessionId:string,input:Request&{orderRevision:number;confirmationHash:string}){
  const actor=this.auth.current(token,'table.batch.submit');this.validate(input);integer(input.orderRevision,0,Number.MAX_SAFE_INTEGER);requireCondition(typeof input.confirmationHash==='string'&&/^[a-f0-9]{64}$/.test(input.confirmationHash),'INVALID_CONFIRMATION');
  return this.bus.run({id,type:'table.batch.submit',actor,payload:{sessionId,...input}},()=>{this.receiptAccess(token,id,'table.batch.submit',()=>this.visit(token,sessionId,'table.batch.submit'));},()=>{
   const quote=this.prepare(token,sessionId,input);requireCondition(!quote.menuChanged&&quote.orderRevision===input.orderRevision&&quote.confirmationHash===input.confirmationHash,'CONFIRMATION_STALE',409);
   return this.acceptPrepared(token,id,sessionId,input,quote);
  });
 }
 // Shared transaction body. Called only after prepare/hash checks inside CommandBus.
 acceptPrepared(token:string,id:string,sessionId:string,input:Request,quote:ReturnType<OrderService['prepare']>){
  const actor=this.auth.current(token,'table.batch.submit');
   requireCondition(!this.db.prepare('SELECT 1 FROM order_batches WHERE branch_id=? AND draft_id=?').get(actor.branchId,input.draftId),'DRAFT_ALREADY_ACCEPTED',409);
   const visit=this.visit(token,sessionId),prior=this.row(sessionId),orderId=prior?.id??randomUUID(),batchId=randomUUID(),time=this.now(),revision=(prior?.revision??0)+1;
   if(!prior){const number=nextOrderNumber(this.db,actor.branchId,visit.shiftId);this.db.prepare("INSERT INTO orders(id,branch_id,shift_id,table_session_id,type,status,revision,discount,subtotal,total,fees_snapshot,created_at) VALUES(?,?,?,?,'TABLE','OPEN',?,?,?,?,?,?)").run(orderId,actor.branchId,visit.shiftId,sessionId,revision,quote.discount,quote.subtotal,quote.total,canonical(quote.feeSnapshot),time);assignOrderNumber(this.db,actor.branchId,visit.shiftId,orderId,number);}
   else this.db.prepare('UPDATE orders SET revision=?,subtotal=?,total=? WHERE branch_id=? AND id=?').run(revision,quote.subtotal,quote.total,actor.branchId,orderId);
   const sequence=(this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 n FROM order_batches WHERE order_id=?').get(orderId) as {n:number}).n;integer(sequence,1,Number.MAX_SAFE_INTEGER,'BATCH_SEQUENCE_EXHAUSTED');
   this.db.prepare('INSERT INTO order_batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(batchId,actor.branchId,orderId,sequence,id,input.draftId,input.draftRevision,actor.id,actor.employee.name,time,quote.menuRevision,quote.batchSubtotal);
   for(const line of quote.lines)this.db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),actor.branchId,batchId,line.lineId,canonical(line),line.quantity,line.total,line.kitchen?1:0);
   this.db.prepare('UPDATE table_sessions SET has_accepted_batch=1,revision=revision+1 WHERE branch_id=? AND id=?').run(actor.branchId,sessionId);
   if(!prior&&quote.discount>0)this.discountEvent(actor,id,orderId,0,quote.discount,time);
   const kitchen=quote.lines.filter(l=>l.kitchen),kitchenJobIds:string[]=[];
   if(kitchen.length){const jobId=randomUUID();kitchenJobIds.push(jobId);const payload={snapshotVersion:1,orderNumber:readOrderNumber(this.db,actor.branchId,orderId),tableName:visit.tableName,zoneName:visit.zoneName,responsibleWaiter:visit.responsibleWaiter,openedBy:visit.openedBy,submittedAt:time,sender:{id:actor.id,name:actor.employee.name},lines:kitchen};const previous=this.db.prepare("SELECT id FROM print_jobs WHERE branch_id=? AND order_id=? AND type='KITCHEN' ORDER BY rowid DESC LIMIT 1").get(actor.branchId,orderId) as {id:string}|undefined;this.db.prepare("INSERT INTO print_jobs(id,branch_id,order_id,batch_id,type,purpose,snapshot_version,status,payload,created_at) VALUES(?,?,?,?,'KITCHEN','NEW_BATCH',1,'PENDING',?,?)").run(jobId,actor.branchId,orderId,batchId,canonical(payload),time);if(previous)this.db.prepare('INSERT INTO print_job_dependencies VALUES(?,?,?)').run(actor.branchId,previous.id,jobId);}
   const receipt={commandId:id,sessionId,orderId,orderNumber:readOrderNumber(this.db,actor.branchId,orderId),batchId,batchSequence:sequence,orderRevision:revision,kitchenJobIds};audit(this.db,actor,'table.batch.accepted',batchId,id,time,receipt);outbox(this.db,actor.branchId,'table.batch.accepted',receipt,time);return receipt;
 }
 private discountEvent(actor:{id:string;branchId:string},id:string,orderId:string,before:number,after:number,time:number){this.db.prepare('INSERT INTO order_discount_events VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),actor.branchId,orderId,id,actor.id,before,after,time);}
 async discount(token:string,id:string,orderId:string,input:{expectedRevision:number;amount:number}){
  orderId=orderIdCheck(orderId);const actor=this.auth.current(token,'order.discount.set');integer(input.expectedRevision,1,Number.MAX_SAFE_INTEGER);integer(input.amount,0,999999999);
  const authorize=()=>{this.auth.current(token,'order.discount.set');const r=this.db.prepare('SELECT * FROM orders WHERE branch_id=? AND id=?').get(actor.branchId,orderId) as Order|undefined;requireCondition(r,'ORDER_NOT_FOUND',404);if(r.type==='TABLE')this.visit(token,r.table_session_id!,'order.discount.set');else this.auth.current(token,'counter.view');return r;};
  return this.bus.run({id,type:'order.discount.set',actor,payload:{orderId,...input}},()=>this.receiptAccess(token,id,'order.discount.set',authorize),()=>{const row=authorize();requireCondition(row.status==='OPEN','ORDER_NOT_OPEN',409);requireCondition(!!this.db.prepare("SELECT 1 FROM shifts WHERE branch_id=? AND id=? AND status='OPEN'").get(actor.branchId,row.shift_id),'SHIFT_REQUIRED',409);requireCondition(row.revision===input.expectedRevision,'ORDER_REVISION_CONFLICT',409);
   const amount=totals(row.type,[row.subtotal],input.amount,JSON.parse(row.fees_snapshot).fees),time=this.now();this.db.prepare('UPDATE orders SET revision=revision+1,discount=?,total=? WHERE branch_id=? AND id=?').run(input.amount,amount.total,actor.branchId,row.id);this.discountEvent(actor,id,row.id,row.discount,input.amount,time);const result={orderId:row.id,revision:row.revision+1};audit(this.db,actor,'order.discount.changed',row.id,id,time,{before:row.discount,after:input.amount});outbox(this.db,actor.branchId,'order.discount.changed',result,time);return result;
  });
 }
}
const orderIdCheck=orderId;
