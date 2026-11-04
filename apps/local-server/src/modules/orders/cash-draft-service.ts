import {createHash} from 'node:crypto';
import {requireCondition} from '../../errors';
import {canonical,uuidPattern} from '../../command-bus';
import type {AuthService} from '../auth/auth-service';
import type Database from 'better-sqlite3';
import {hasPermission} from '../auth/permissions';

type Draft={id:string;lines:unknown[];discount:number;menuRevision:number;cashMeta:{mode:'TABLE'|'COUNTER';tableId:string|null;waiterId:string|null};preview?:unknown;guestLabel?:string;containerLinks?:unknown};
type Row={id:string;branch_id:string;employee_id:string;shift_id:string;draft_number:number;revision:number;payload:string;created_at:number;updated_at:number;last_command_id:string;last_request_hash:string};
const integer=(value:unknown,min=0)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min;
export function assertCurrentCashDraft(db:Database.Database,actor:{branchId:string;id:string},shiftId:string,mode:'TABLE'|'COUNTER',input:{draftId:string;lines:unknown[];discount:number;menuRevision:number}){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cash_drafts'").get())return;
 const row=db.prepare("SELECT * FROM cash_drafts WHERE branch_id=? AND json_extract(payload,'$.id')=?").get(actor.branchId,input.draftId) as Row|undefined;
 if(!row)return;
 const draft=JSON.parse(row.payload) as Draft;
 requireCondition(row.employee_id===actor.id&&row.shift_id===shiftId&&draft.cashMeta.mode===mode&&draft.discount===input.discount&&draft.menuRevision===input.menuRevision&&canonical(draft.lines)===canonical(input.lines),'DRAFT_REVISION_CONFLICT',409);
}
export class CashDraftService {
 constructor(private readonly auth:AuthService,private readonly onChanged?:()=>void){}
 private get db(){return this.auth.db;}
 private actor(token:string){const actor=this.auth.current(token);requireCondition(actor.audience!=='WAITER_WEB','CLIENT_AUDIENCE_DENIED',403);requireCondition(hasPermission(this.db,actor.employee,'table.view_status')||hasPermission(this.db,actor.employee,'counter.view'),'PERMISSION_DENIED',403);return actor;}
 private row(token:string,id:string){requireCondition(uuidPattern.test(id),'INVALID_ID');const actor=this.actor(token);const row=this.db.prepare('SELECT * FROM cash_drafts WHERE id=? AND branch_id=? AND employee_id=?').get(id,actor.branchId,actor.id) as Row|undefined;requireCondition(row,'DRAFT_NOT_FOUND',404);const mode=(JSON.parse(row.payload) as Draft).cashMeta.mode;this.auth.current(token,mode==='TABLE'?'table.view_status':'counter.view');return row;}
 private dto(row:Row){return {id:row.id,number:row.draft_number,revision:row.revision,shiftId:row.shift_id,createdAt:row.created_at,updatedAt:row.updated_at,draft:JSON.parse(row.payload) as Draft};}
 list(token:string){const actor=this.actor(token);const rows=this.db.prepare("SELECT d.* FROM cash_drafts d WHERE d.branch_id=? AND d.employee_id=? AND json_array_length(d.payload,'$.lines')>0 AND NOT EXISTS(SELECT 1 FROM order_batches b WHERE b.branch_id=d.branch_id AND b.draft_id=json_extract(d.payload,'$.id')) ORDER BY d.updated_at DESC LIMIT 100").all(actor.branchId,actor.id) as Row[];return rows.filter(row=>hasPermission(this.db,actor.employee,(JSON.parse(row.payload) as Draft).cashMeta.mode==='TABLE'?'table.view_status':'counter.view')).map(row=>this.dto(row));}
 get(token:string,id:string){return this.dto(this.row(token,id));}
 save(token:string,input:{id:string;expectedRevision:number;commandId:string;draft:Draft}){
  const actor=this.actor(token);requireCondition(uuidPattern.test(input.id)&&uuidPattern.test(input.commandId),'INVALID_ID');requireCondition(integer(input.expectedRevision),'INVALID_NUMBER');
  const d=input.draft;requireCondition(d&&typeof d==='object'&&uuidPattern.test(d.id)&&Array.isArray(d.lines)&&d.lines.length<=1000&&integer(d.discount)&&d.discount<=999999999&&integer(d.menuRevision)&&d.cashMeta&&['TABLE','COUNTER'].includes(d.cashMeta.mode)&&[d.cashMeta.tableId,d.cashMeta.waiterId].every(id=>id===null||typeof id==='string'&&uuidPattern.test(id)),'INVALID_DRAFT');
  this.auth.current(token,d.cashMeta.mode==='TABLE'?'table.batch.submit':'counter.batch.submit');
  const payload=JSON.stringify(d);requireCondition(Buffer.byteLength(payload)<=2*1024*1024,'INVALID_DRAFT');
  // Validate line shape, while retaining selections if the current menu has changed.
  const ids=new Set<string>();for(const line of d.lines as Record<string,unknown>[]){requireCondition(line&&typeof line==='object'&&typeof line.lineId==='string'&&uuidPattern.test(line.lineId)&&!ids.has(line.lineId)&&typeof line.itemId==='string'&&line.itemId.length<=200&&integer(line.quantity,1)&&Number(line.quantity)<=9999&&Array.isArray(line.modifierIds)&&line.modifierIds.every(x=>typeof x==='string')&&(line.variantId===null||typeof line.variantId==='string')&&(line.comment===undefined||typeof line.comment==='string'&&[...line.comment].length<=300),'INVALID_DRAFT');ids.add(line.lineId as string);}
  const requestHash=createHash('sha256').update(JSON.stringify([input.id,input.expectedRevision,payload])).digest('hex');
  let changed=false;
  const result=this.db.transaction(()=>{
   const prior=this.db.prepare('SELECT * FROM cash_drafts WHERE id=?').get(input.id) as Row|undefined;
   if(prior?.last_command_id===input.commandId){requireCondition(prior.last_request_hash===requestHash,'COMMAND_PAYLOAD_CONFLICT',409);return this.dto(prior);}
   requireCondition(!prior||prior.branch_id===actor.branchId&&prior.employee_id===actor.id,'DRAFT_NOT_FOUND',404);
   requireCondition((prior?.revision??0)===input.expectedRevision,'DRAFT_REVISION_CONFLICT',409);
   requireCondition(!this.db.prepare('SELECT 1 FROM order_batches WHERE branch_id=? AND draft_id=?').get(actor.branchId,d.id),'DRAFT_ALREADY_ACCEPTED',409);
   const shift=this.db.prepare("SELECT id FROM shifts WHERE branch_id=? AND status='OPEN'").get(actor.branchId) as {id:string}|undefined;requireCondition(shift,'SHIFT_REQUIRED',409);
   requireCondition(!prior||prior.shift_id===shift.id,'DRAFT_SHIFT_CHANGED',409);
   const now=Date.now();if(prior)this.db.prepare('UPDATE cash_drafts SET revision=revision+1,payload=?,updated_at=?,last_command_id=?,last_request_hash=? WHERE id=?').run(payload,now,input.commandId,requestHash,input.id);
   else{const number=(this.db.prepare('SELECT COALESCE(MAX(draft_number),0)+1 n FROM cash_drafts WHERE branch_id=? AND shift_id=?').get(actor.branchId,shift.id) as {n:number}).n;this.db.prepare('INSERT INTO cash_drafts VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(input.id,actor.branchId,actor.id,shift.id,number,1,payload,now,input.commandId,requestHash,now);}
   changed=true;
   return this.dto(this.db.prepare('SELECT * FROM cash_drafts WHERE id=?').get(input.id) as Row);
  }).immediate();
  if(changed)try{this.onChanged?.();}catch{/* notifications never change a saved draft */}
  return result;
 }
 discard(token:string,id:string,expectedRevision:number){const row=this.row(token,id);requireCondition(integer(expectedRevision)&&row.revision===expectedRevision,'DRAFT_REVISION_CONFLICT',409);requireCondition(this.db.prepare('DELETE FROM cash_drafts WHERE id=? AND revision=?').run(id,expectedRevision).changes===1,'DRAFT_REVISION_CONFLICT',409);try{this.onChanged?.();}catch{/* saved result stands */}return {discarded:true};}
 resume(token:string,id:string,expectedRevision:number){let changed=false;const result=this.db.transaction(()=>{const row=this.row(token,id),draft=JSON.parse(row.payload) as Draft;this.auth.current(token,draft.cashMeta.mode==='TABLE'?'table.batch.submit':'counter.batch.submit');requireCondition(integer(expectedRevision)&&row.revision===expectedRevision,'DRAFT_REVISION_CONFLICT',409);const shift=this.db.prepare("SELECT id FROM shifts WHERE branch_id=? AND status='OPEN'").get(row.branch_id) as {id:string}|undefined;requireCondition(shift,'SHIFT_REQUIRED',409);if(row.shift_id!==shift.id){const number=(this.db.prepare('SELECT COALESCE(MAX(draft_number),0)+1 n FROM cash_drafts WHERE branch_id=? AND shift_id=?').get(row.branch_id,shift.id) as {n:number}).n;requireCondition(this.db.prepare('UPDATE cash_drafts SET shift_id=?,draft_number=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(shift.id,number,Date.now(),id,expectedRevision).changes===1,'DRAFT_REVISION_CONFLICT',409);changed=true;}return this.get(token,id);}).immediate();if(changed)try{this.onChanged?.();}catch{/* saved result stands */}return result;}
}
