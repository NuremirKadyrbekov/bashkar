import {requireCondition} from '../../errors';
import {object} from '../menu/catalog';
import {totals} from '../menu/pricing';
import {FinanceService} from './finance-service';
import {orderId,type Request} from './order-service';
import {assertCurrentCashDraft} from './cash-draft-service';

type Input={orderId:string|null;type:'TABLE'|'COUNTER';sessionId:string|null;opening:{tableId:string|null;responsibleWaiterId:string|null}|null;draft:Request|null;payment:unknown};
type Confirmation={confirmationHash:string;expectedOrderRevision:number;expectedVisitRevision:number|null;shiftId:string};
// One writer transaction owns visit creation, batch acceptance, payments and print intents.
// It shares the existing domain bodies; it never submits nested commands or HTTP calls.
export class CheckoutService {
 constructor(readonly finance:FinanceService){}
 prepare(token:string,input:Input){
  const f=this.finance,actor=f.auth.current(token);
  requireCondition(input.type==='TABLE'||input.type==='COUNTER','INVALID_ORDER_TYPE');
  if(input.orderId!==null)orderId(input.orderId);if(input.sessionId!==null)orderId(input.sessionId);
  const permission=input.type==='TABLE'?'order.settle.table':'order.settle.counter';f.auth.current(token,permission);
  const shift=f.shift(),row=input.orderId?f.row(input.orderId):null;
  if(row){requireCondition(row.type===input.type&&row.table_session_id===input.sessionId,'ORDER_NOT_FOUND',404);f.access(token,row,permission);f.open(row);f.currentAmount(row);}
  let visit=null,opening=null;
  if(input.type==='COUNTER'){requireCondition(input.sessionId===null&&input.opening===null,'INVALID_CHECKOUT_CONTEXT');f.auth.current(token,'counter.view');}
  else if(input.sessionId){
   requireCondition(input.opening===null,'INVALID_CHECKOUT_CONTEXT');visit=f.tables.details(token,input.sessionId);requireCondition(f.tables.canSettle(token,input.sessionId),'VISIT_ACCESS_DENIED',403);requireCondition(visit.status==='OPEN'&&visit.shiftId===shift.id,'SHIFT_CHANGED',409);
   const existing=f.orders.get(token,input.sessionId);requireCondition((existing?.id??null)===(row?.id??null),'ORDER_REVISION_CONFLICT',409);
  }else{
   requireCondition(!row&&input.opening!==null,'INVALID_CHECKOUT_CONTEXT');object(input.opening,['tableId','responsibleWaiterId']);opening=f.tables.opening(token,input.opening);requireCondition(opening.canAccess,'VISIT_ACCESS_DENIED',403);
  }
  requireCondition(!!row||input.draft!==null,'INVALID_LINES');
  if(input.draft) {
   object(input.draft,['draftId','draftRevision','menuRevision','lines','discount']);
   assertCurrentCashDraft(f.db,actor,shift.id,input.type,input.draft);
   f.auth.current(token,input.type==='TABLE'?'table.batch.submit':'counter.batch.submit');
   if(!row&&input.draft.discount>0)f.auth.current(token,'order.discount.set');
   requireCondition(!row||row.discount===input.draft.discount,'ORDER_REVISION_CONFLICT',409);
   requireCondition(!f.db.prepare('SELECT 1 FROM order_batches WHERE branch_id=? AND draft_id=?').get(actor.branchId,input.draft.draftId),'DRAFT_ALREADY_ACCEPTED',409);
  }
  const priced=input.draft?f.price(token,input.draft):{menuRevision:null,menuChanged:false,lines:[]};
  const settings=f.db.prepare('SELECT revision,fees FROM branch_settings WHERE branch_id=?').get(actor.branchId) as {revision:number;fees:string}|undefined;
  const feeSnapshot=row?JSON.parse(row.fees_snapshot):input.type==='TABLE'?{revision:settings?.revision??0,fees:settings?JSON.parse(settings.fees):[]}:{revision:0,fees:[]};
  const batchSubtotal=totals(input.type,priced.lines.map(l=>l.total),0,[]).subtotal;
  const amount=totals(input.type,[row?.subtotal??0,batchSubtotal],row?.discount??input.draft?.discount??0,feeSnapshot.fees);
  const proposal={orderId:row?.id??null,type:input.type,sessionId:input.sessionId,opening,expectedOrderRevision:row?.revision??0,expectedVisitRevision:visit?.revision??null,shiftId:shift.id,draftId:input.draft?.draftId??null,draftRevision:input.draft?.draftRevision??null,feeSnapshot,...priced,batchSubtotal,...amount,payment:input.payment,payments:f.selection(input.payment,amount.total)};
  return {...proposal,confirmationHash:f.quoteHash(actor,'checkout',proposal)};
 }
 async commit(token:string,input:Input&Confirmation,commandId:string){
  const f=this.finance,permission=input.type==='TABLE'?'order.settle.table':'order.settle.counter',actor=f.auth.current(token,permission);
  requireCondition(typeof input.confirmationHash==='string'&&/^[a-f0-9]{64}$/.test(input.confirmationHash),'INVALID_CONFIRMATION');
  return f.bus.run({id:commandId,type:'order.checkout',actor,payload:input},()=>{
   f.auth.current(token,permission);
   if(input.draft){f.auth.current(token,input.type==='TABLE'?'table.batch.submit':'counter.batch.submit');if(f.orders.validate(input.draft).some(l=>l.kind==='CUSTOM_AMOUNT'))f.auth.current(token,'order.custom_item.create');if(!input.orderId&&input.draft.discount>0)f.auth.current(token,'order.discount.set');}
   if(input.type==='TABLE'&&!input.sessionId)f.auth.current(token,'table.open');
   f.orders.receiptAccess(token,commandId,permission,()=>{if(input.orderId)f.access(token,f.row(input.orderId),permission);else if(input.sessionId)f.tables.details(token,input.sessionId);else if(input.type==='COUNTER')f.auth.current(token,'counter.view');});
  },()=>{
   const q=this.prepare(token,input);f.confirm(q,input);requireCondition(!q.menuChanged,'CONFIRMATION_STALE',409);
   let id=input.orderId,sessionId=input.sessionId,batchId:string|null=null,kitchenJobIds:string[]=[];
   if(input.draft){
    if(input.type==='TABLE'){
     if(!sessionId)sessionId=f.tables.createOpen(token,commandId,input.opening!).sessionId;
     const prepared=f.orders.prepare(token,sessionId,input.draft),accepted=f.orders.acceptPrepared(token,commandId,sessionId,input.draft,prepared);id=accepted.orderId;batchId=accepted.batchId;kitchenJobIds=accepted.kitchenJobIds;
    }else{
     const request={...input.draft,mode:'ACCEPT'},prepared=f.prepareCounter(token,id,request),accepted=f.acceptCounterPrepared(token,id,request,prepared,commandId);id=accepted.orderId;batchId=accepted.batchId;kitchenJobIds=accepted.printJobIds;
    }
   }
   const row=f.row(id!);requireCondition(row.total===q.total,'CONFIRMATION_STALE',409);
   return {...f.finalize(actor,row,q.payments,commandId),batchId,kitchenJobIds};
  });
 }
}
