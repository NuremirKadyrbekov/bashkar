import type Database from 'better-sqlite3';
import type {CommandBus} from '../../command-bus';
import {canonical,digest} from '../../command-bus';
import {randomUUID} from 'node:crypto';
import type {MenuTransport} from '../menu/cloud-menu-transport';

type Pending={report_id:string;shift_id:string;snapshot:string;sha256:string;attempts:number};
const SUCCESS_PACE_MS=500;

/** Best-effort network worker over an immutable, transactionally queued report. */
export class ShiftCloudDelivery {
 private timer?:ReturnType<typeof setTimeout>;private task?:Promise<void>;private stopped=true;private nextSendAt=0;
 constructor(private db:Database.Database,private bus:CommandBus,private branchId:string,private remote?:MenuTransport,private now=Date.now){}
 status(){const count=(table:string)=>(this.db.prepare(`SELECT count(*) n FROM ${table} WHERE branch_id=? AND delivered_at IS NULL`).get(this.branchId) as {n:number}).n;
  const row=this.db.prepare(`SELECT min(next_attempt_at) nextAttemptAt,max(last_error) lastError FROM (
   SELECT next_attempt_at,last_error FROM shift_cloud_delivery WHERE branch_id=? AND delivered_at IS NULL
   UNION ALL SELECT next_attempt_at,last_error FROM sale_cloud_delivery WHERE branch_id=? AND delivered_at IS NULL
   UNION ALL SELECT next_attempt_at,last_error FROM refund_cloud_delivery WHERE branch_id=? AND delivered_at IS NULL
   UNION ALL SELECT next_attempt_at,last_error FROM staff_cloud_delivery WHERE branch_id=? AND delivered_at IS NULL
  )`).get(this.branchId,this.branchId,this.branchId,this.branchId) as {nextAttemptAt:number|null;lastError:string|null};
  return {enabled:!!this.remote,pendingReports:count('shift_cloud_delivery'),pendingSales:count('sale_cloud_delivery'),pendingRefunds:count('refund_cloud_delivery'),pendingStaff:count('staff_cloud_delivery'),nextAttemptAt:row.nextAttemptAt,lastError:row.lastError};}
 start(){this.stopped=false;this.wake();}
 async stop(){this.stopped=true;clearTimeout(this.timer);await this.task;}
 wake(){if(this.stopped||!this.remote||this.task)return;clearTimeout(this.timer);this.timer=setTimeout(()=>void this.run(),Math.max(0,this.nextSendAt-this.now()));this.timer.unref();}
 async syncOnce(){if(this.remote)await this.cycle();}
 private async run(){if(this.task||this.stopped)return;let delivered=false;this.task=this.cycle().then(value=>{delivered=value;}).finally(()=>{this.task=undefined;if(this.stopped)return;this.nextSendAt=this.now()+SUCCESS_PACE_MS;this.timer=setTimeout(()=>void this.run(),delivered?SUCCESS_PACE_MS:30000);this.timer.unref();});await this.task;}
 private async cycle():Promise<boolean>{
  const row=this.db.prepare(`SELECT q.report_id,q.shift_id,q.attempts,r.snapshot,r.sha256 FROM shift_cloud_delivery q
   JOIN shift_reports r ON r.branch_id=q.branch_id AND r.id=q.report_id AND r.shift_id=q.shift_id
   WHERE q.branch_id=? AND q.delivered_at IS NULL AND q.next_attempt_at<=? ORDER BY r.created_at,r.id LIMIT 1`).get(this.branchId,this.now()) as Pending|undefined;
  if(!row)return this.cycleSale();
  try{
   const snapshot=JSON.parse(row.snapshot) as Record<string,unknown>;
   if(digest(canonical(snapshot))!==row.sha256)throw Error('REPORT_INTEGRITY_FAILED');
   const receipt=await this.remote!.call('shiftReport',{commandId:row.report_id,reportId:row.report_id,shiftId:row.shift_id,hash:row.sha256,snapshot});
   if(receipt?.state!=='APPLIED'||receipt.reportId!==row.report_id||receipt.hash!==row.sha256)throw Error('INVALID_SHIFT_REPORT_RECEIPT');
   await this.bus.system(()=>this.db.prepare('UPDATE shift_cloud_delivery SET delivered_at=?,last_error=NULL WHERE branch_id=? AND report_id=? AND delivered_at IS NULL').run(this.now(),this.branchId,row.report_id));
   return true;
  }catch(error){const code=error instanceof Error?error.message:'SHIFT_CLOUD_UNAVAILABLE';const attempts=row.attempts+1,delay=Math.min(300000,15000*2**Math.min(attempts-1,4));await this.bus.system(()=>this.db.prepare('UPDATE shift_cloud_delivery SET attempts=?,next_attempt_at=?,last_error=? WHERE branch_id=? AND report_id=? AND delivered_at IS NULL').run(attempts,this.now()+delay,code,this.branchId,row.report_id));}
  return false;
 }
 private async cycleSale():Promise<boolean>{
  const row=this.db.prepare(`SELECT q.settlement_id,q.order_id,q.shift_id,q.attempts,s.snapshot,s.settled_at
   FROM sale_cloud_delivery q JOIN settlements s ON s.branch_id=q.branch_id AND s.id=q.settlement_id
   WHERE q.branch_id=? AND q.delivered_at IS NULL AND q.next_attempt_at<=? ORDER BY s.settled_at,s.id LIMIT 1`).get(this.branchId,this.now()) as {settlement_id:string;order_id:string;shift_id:string;attempts:number;snapshot:string;settled_at:number}|undefined;
  if(!row)return this.cycleRefund();
  try{
   const record={settlementId:row.settlement_id,orderId:row.order_id,shiftId:row.shift_id,settledAt:row.settled_at,snapshot:JSON.parse(row.snapshot)};
   const hash=digest(canonical(record));
   const receipt=await this.remote!.call('saleRecord',{commandId:row.settlement_id,hash,record});
   if(receipt?.state!=='APPLIED'||receipt.settlementId!==row.settlement_id||receipt.hash!==hash)throw Error('INVALID_SALE_RECEIPT');
   await this.bus.system(()=>this.db.prepare('UPDATE sale_cloud_delivery SET delivered_at=?,last_error=NULL WHERE branch_id=? AND settlement_id=? AND delivered_at IS NULL').run(this.now(),this.branchId,row.settlement_id));return true;
  }catch(error){const attempts=row.attempts+1,delay=Math.min(300000,15000*2**Math.min(attempts-1,4));await this.bus.system(()=>this.db.prepare('UPDATE sale_cloud_delivery SET attempts=?,next_attempt_at=?,last_error=? WHERE branch_id=? AND settlement_id=? AND delivered_at IS NULL').run(attempts,this.now()+delay,error instanceof Error?error.message:'SALE_CLOUD_UNAVAILABLE',this.branchId,row.settlement_id));return false;}
 }
 private async cycleRefund():Promise<boolean>{
  const row=this.db.prepare(`SELECT q.refund_id,q.attempts,r.order_id,r.original_shift_id,r.shift_id,r.payment_id,r.method,r.amount,r.reason,r.actor_name,r.created_at
   FROM refund_cloud_delivery q JOIN refunds r ON r.branch_id=q.branch_id AND r.id=q.refund_id
   WHERE q.branch_id=? AND q.delivered_at IS NULL AND q.next_attempt_at<=? ORDER BY r.created_at,r.id LIMIT 1`).get(this.branchId,this.now()) as {refund_id:string;attempts:number;order_id:string;original_shift_id:string;shift_id:string;payment_id:string;method:string;amount:number;reason:string;actor_name:string;created_at:number}|undefined;
  if(!row)return this.cycleStaff();
  const record={refundId:row.refund_id,orderId:row.order_id,originalShiftId:row.original_shift_id,shiftId:row.shift_id,paymentId:row.payment_id,method:row.method,amount:row.amount,reason:row.reason,actorName:row.actor_name,createdAt:row.created_at};
  const hash=digest(canonical(record));
  try{
   const receipt=await this.remote!.call('refundRecord',{commandId:row.refund_id,hash,record});
   if(receipt?.state!=='APPLIED'||receipt.refundId!==row.refund_id||receipt.hash!==hash)throw Error('INVALID_REFUND_RECEIPT');
   await this.bus.system(()=>this.db.prepare('UPDATE refund_cloud_delivery SET delivered_at=?,last_error=NULL WHERE branch_id=? AND refund_id=? AND delivered_at IS NULL').run(this.now(),this.branchId,row.refund_id));return true;
  }catch(error){const attempts=row.attempts+1,delay=Math.min(300000,15000*2**Math.min(attempts-1,4));await this.bus.system(()=>this.db.prepare('UPDATE refund_cloud_delivery SET attempts=?,next_attempt_at=?,last_error=? WHERE branch_id=? AND refund_id=? AND delivered_at IS NULL').run(attempts,this.now()+delay,error instanceof Error?error.message:'REFUND_CLOUD_UNAVAILABLE',this.branchId,row.refund_id));return false;}
 }
 private async cycleStaff():Promise<boolean>{
  const row=this.db.prepare(`SELECT shift_id,employee_id,employee_name,employee_role,command_id,attempts FROM staff_cloud_delivery
   WHERE branch_id=? AND delivered_at IS NULL AND next_attempt_at<=? ORDER BY shift_id,employee_id LIMIT 1`).get(this.branchId,this.now()) as {shift_id:string;employee_id:string;employee_name:string;employee_role:string;command_id:string|null;attempts:number}|undefined;
  if(!row)return false;
  try{
   const count=(sql:string)=>(this.db.prepare(sql).get(this.branchId,row.shift_id,row.employee_id) as {n:number}).n;
   const openedTables=count("SELECT count(*) n FROM table_sessions WHERE branch_id=? AND shift_id=? AND opened_by=? AND table_id IS NOT NULL");
   const submittedBatches=count('SELECT count(*) n FROM order_batches WHERE branch_id=? AND order_id IN (SELECT id FROM orders WHERE branch_id=order_batches.branch_id AND shift_id=?) AND sender_id=?');
   const registeredPayments=count('SELECT count(*) n FROM payments WHERE branch_id=? AND shift_id=? AND actor_id=?');
   const corrections=count('SELECT count(*) n FROM order_corrections WHERE branch_id=? AND shift_id=? AND actor_id=?');
   const credit="COALESCE(CASE WHEN o.type='TABLE' THEN json_extract(s.snapshot,'$.responsibleWaiter.id') END,p.actor_id)";
   const paid=(this.db.prepare(`SELECT coalesce(sum(p.amount),0) n FROM payments p JOIN settlements s ON s.branch_id=p.branch_id AND s.id=p.settlement_id JOIN orders o ON o.branch_id=p.branch_id AND o.id=p.order_id WHERE p.branch_id=? AND p.shift_id=? AND ${credit}=?`).get(this.branchId,row.shift_id,row.employee_id) as {n:number}).n;
   const refunded=(this.db.prepare(`SELECT coalesce(sum(r.amount),0) n FROM refunds r JOIN payments p ON p.branch_id=r.branch_id AND p.id=r.payment_id JOIN settlements s ON s.branch_id=p.branch_id AND s.id=p.settlement_id JOIN orders o ON o.branch_id=p.branch_id AND o.id=p.order_id WHERE r.branch_id=? AND r.shift_id=? AND ${credit}=?`).get(this.branchId,row.shift_id,row.employee_id) as {n:number}).n;
   const record={shiftId:row.shift_id,employeeId:row.employee_id,name:row.employee_name,role:row.employee_role,openedTables,submittedBatches,registeredPayments,corrections,attributedSalesTyiyn:String(paid),attributedRefundsTyiyn:String(refunded),attributedNetTyiyn:String(paid-refunded)};
   const hash=digest(canonical(record));
   const commandId=row.command_id??randomUUID();
   if(!row.command_id)await this.bus.system(()=>this.db.prepare('UPDATE staff_cloud_delivery SET command_id=? WHERE branch_id=? AND shift_id=? AND employee_id=? AND command_id IS NULL').run(commandId,this.branchId,row.shift_id,row.employee_id));
   const receipt=await this.remote!.call('staffRecord',{commandId,hash,record});
   if(receipt?.state!=='APPLIED'||receipt.shiftId!==row.shift_id||receipt.employeeId!==row.employee_id||receipt.hash!==hash)throw Error('INVALID_STAFF_RECEIPT');
   await this.bus.system(()=>this.db.prepare('UPDATE staff_cloud_delivery SET delivered_at=?,last_error=NULL WHERE branch_id=? AND shift_id=? AND employee_id=? AND delivered_at IS NULL').run(this.now(),this.branchId,row.shift_id,row.employee_id));return true;
  }catch(error){const attempts=row.attempts+1,delay=Math.min(300000,15000*2**Math.min(attempts-1,4));await this.bus.system(()=>this.db.prepare('UPDATE staff_cloud_delivery SET attempts=?,next_attempt_at=?,last_error=? WHERE branch_id=? AND shift_id=? AND employee_id=? AND delivered_at IS NULL').run(attempts,this.now()+delay,error instanceof Error?error.message:'STAFF_CLOUD_UNAVAILABLE',this.branchId,row.shift_id,row.employee_id));return false;}
 }
}
