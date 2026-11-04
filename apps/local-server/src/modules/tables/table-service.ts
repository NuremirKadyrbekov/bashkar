import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { audit, canonical, CommandBus, outbox, uuidPattern } from '../../command-bus';
import { integer, PosError, requireCondition, textField } from '../../errors';
import { AuthService, type Principal } from '../auth/auth-service';
import { hasPermission } from '../auth/permissions';
import {ensureTablePublicLink} from '../../migrations';
type Zone={id:string;branch_id:string;name:string;name_key:string;active:number;revision:number};
type Table=Zone&{zone_id:string};
type Visit={id:string;branch_id:string;table_id:string|null;shift_id:string;opened_by:string;responsible_waiter_id:string|null;table_name:string;zone_name:string;opened_by_name:string;responsible_waiter_name:string|null;opened_at:number;status:'OPEN'|'CLOSED';closed_at:number|null;closed_by:string|null;close_reason:'EMPTY'|null;revision:number;has_accepted_batch:number;has_registered_payment:number};
export type TableOverviewRow={id:string;name:string;active:boolean;revision:number;zoneId:string;state:'FREE'|'OCCUPIED';isMine:boolean;canViewDetails:boolean;sessionId?:string;openedAt?:number;openedBy?:{id:string;name:string};responsibleWaiter?:{id:string;name:string}|null;batchCount?:number;currentTotal?:number};
export type FloorPlan={version:1;zones:{zoneId:string;kind:'RECT';x:number;y:number;width:number;height:number}[];tables:{tableId:string;kind:'ROUND'|'RECT';x:number;y:number;rotation:0|90|180|270}[]};
const emptyFloorPlan=():FloorPlan=>({version:1,zones:[],tables:[]});
function validateFloorPlan(value:unknown):FloorPlan{
 const valid=(row:unknown,keys:string[])=>!!row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).sort().join(',')===keys.slice().sort().join(',');
 const coordinate=(value:unknown,min:number,max:number)=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
 requireCondition(valid(value,['version','zones','tables']),'INVALID_FLOOR_PLAN');const plan=value as FloorPlan;
 requireCondition(plan.version===1&&Array.isArray(plan.zones)&&plan.zones.length<=100&&Array.isArray(plan.tables)&&plan.tables.length<=1000,'INVALID_FLOOR_PLAN');
 const zones=new Set<string>(),tables=new Set<string>();
 for(const zone of plan.zones){requireCondition(valid(zone,['zoneId','kind','x','y','width','height'])&&zone.kind==='RECT'&&typeof zone.zoneId==='string'&&uuidPattern.test(zone.zoneId)&&!zones.has(zone.zoneId),'INVALID_FLOOR_PLAN');zones.add(zone.zoneId);requireCondition(coordinate(zone.x,0,950)&&coordinate(zone.y,0,650)&&coordinate(zone.width,50,1000)&&coordinate(zone.height,50,700)&&zone.x+zone.width<=1000&&zone.y+zone.height<=700,'INVALID_FLOOR_PLAN');}
 for(const table of plan.tables){requireCondition(valid(table,['tableId','kind','x','y','rotation'])&&['ROUND','RECT'].includes(table.kind)&&typeof table.tableId==='string'&&uuidPattern.test(table.tableId)&&!tables.has(table.tableId),'INVALID_FLOOR_PLAN');tables.add(table.tableId);requireCondition(coordinate(table.x,20,980)&&coordinate(table.y,20,680)&&[0,90,180,270].includes(table.rotation),'INVALID_FLOOR_PLAN');}
 requireCondition(Buffer.byteLength(canonical(plan))<=262144,'INVALID_FLOOR_PLAN');return plan;
}
const identifier=(id:unknown)=>{requireCondition(typeof id==='string'&&uuidPattern.test(id),'INVALID_ID');return id;};
function label(input:unknown){const name=textField(input,200).normalize('NFKC').replace(/\s+/gu,' ');return {name,key:name.toLowerCase()};}
export class TableService {
 constructor(readonly db:Database.Database,readonly bus:CommandBus,readonly auth:AuthService,readonly now=Date.now){}
 onConfigurationChanged:(()=>void)|undefined;
 terminalRead:((token:string,id:string)=>void)|undefined;
 private zone(id:string){const z=this.db.prepare('SELECT * FROM dining_zones WHERE branch_id=? AND id=?').get(this.auth.branchId,identifier(id)) as Zone|undefined;requireCondition(z,'ZONE_NOT_FOUND',404);return z;}
 private table(id:string){const t=this.db.prepare('SELECT * FROM dining_tables WHERE branch_id=? AND id=?').get(this.auth.branchId,identifier(id)) as Table|undefined;requireCondition(t,'TABLE_NOT_FOUND',404);return t;}
 private visit(id:string){const v=this.db.prepare('SELECT * FROM table_sessions WHERE branch_id=? AND id=?').get(this.auth.branchId,identifier(id)) as Visit|undefined;requireCondition(v,'VISIT_NOT_FOUND',404);return v;}
 private settings(){const r=this.db.prepare('SELECT revision FROM table_settings WHERE branch_id=?').get(this.auth.branchId) as {revision:number}|undefined;return {mode:'SHARED' as const,revision:r?.revision??0,configured:true};}
 private accessible(p:Principal,v:Pick<Visit,'responsible_waiter_id'|'opened_by'|'status'>){return v.responsible_waiter_id===p.id||p.role!=='WAITER'&&v.responsible_waiter_id===null&&v.opened_by===p.id||this.settings().mode==='SHARED'&&v.status==='OPEN'||hasPermission(this.db,p.employee,'table.access_others');}
 private requireAccess(p:Principal,v:Visit){requireCondition(this.accessible(p,v),'VISIT_ACCESS_DENIED',403);}
 private changed(p:Principal,id:string,action:string,target:string,details:unknown){audit(this.db,p,action,target,id,this.now(),details);outbox(this.db,p.branchId,action,{targetId:target,...details as object},this.now());}
 private markCloudRevision(branchId:string){this.db.prepare('INSERT INTO table_cloud_sync_state(branch_id,revision,command_id) VALUES(?,1,?) ON CONFLICT(branch_id) DO UPDATE SET revision=revision+1,command_id=excluded.command_id,last_error=NULL').run(branchId,randomUUID());}
 private activeVisit(tableId:string){return this.db.prepare("SELECT * FROM table_sessions WHERE branch_id=? AND table_id=? AND status='OPEN'").get(this.auth.branchId,tableId) as Visit|undefined;}
 private zoneDto(z:Zone){return {id:z.id,name:z.name,active:z.active===1,revision:z.revision};}
 private tableDto(t:Table){return {...this.zoneDto(t),zoneId:t.zone_id};}
 publicLinks(token:string){
  const p=this.auth.current(token,'table.manage');
  const rows=this.db.prepare('SELECT l.table_id AS tableId,l.code,t.active AS tableActive,z.active AS zoneActive FROM dining_table_public_links l JOIN dining_tables t ON t.branch_id=l.branch_id AND t.id=l.table_id JOIN dining_zones z ON z.branch_id=t.branch_id AND z.id=t.zone_id WHERE l.branch_id=? ORDER BY t.name,t.id').all(p.branchId) as {tableId:string;code:string;tableActive:number;zoneActive:number}[];
  return rows.map(row=>({tableId:row.tableId,publicPath:`/b/${p.branchId}/t/${row.code}`,publicUrl:null,publicLinkStatus:row.tableActive&&row.zoneActive?'PENDING_HOST':'INACTIVE'}));
 }
 floorPlan(token:string){const p=this.auth.current(token,'table.view_status');const row=this.db.prepare('SELECT revision,plan_json FROM dining_floor_plans WHERE branch_id=?').get(p.branchId) as {revision:number;plan_json:string}|undefined;if(!row)return {revision:0,plan:emptyFloorPlan()};try{return {revision:row.revision,plan:validateFloorPlan(JSON.parse(row.plan_json))};}catch{throw new PosError('FLOOR_PLAN_UNAVAILABLE',409);}}
 async saveFloorPlan(token:string,id:string,input:{revision:number;plan:unknown}){
  const actor=this.auth.current(token,'table.manage'),plan=validateFloorPlan(input.plan);integer(input.revision,0,Number.MAX_SAFE_INTEGER);
  return this.bus.run({id,type:'table.floor_plan.save',actor,payload:{revision:input.revision,plan}},()=>this.auth.current(token,'table.manage'),()=>{
   const previous=this.db.prepare('SELECT revision FROM dining_floor_plans WHERE branch_id=?').get(actor.branchId) as {revision:number}|undefined;requireCondition((previous?.revision??0)===input.revision,'REVISION_CONFLICT',409);
   for(const zone of plan.zones)this.zone(zone.zoneId);
   for(const table of plan.tables)this.table(table.tableId);
   const revision=(previous?.revision??0)+1;this.db.prepare('INSERT INTO dining_floor_plans(branch_id,revision,plan_json) VALUES(?,?,?) ON CONFLICT(branch_id) DO UPDATE SET revision=excluded.revision,plan_json=excluded.plan_json').run(actor.branchId,revision,canonical(plan));
   this.changed(actor,id,'table.floor_plan.saved',actor.branchId,{revision,zoneCount:plan.zones.length,tableCount:plan.tables.length});return {revision,plan};
  });
 }
 list(token:string){
  const p=this.auth.current(token,'table.view_status'),manage=hasPermission(this.db,p.employee,'table.manage');
  const shiftOpen=!!this.db.prepare("SELECT 1 FROM shifts WHERE branch_id=? AND status='OPEN'").get(p.branchId);
  const zones=(this.db.prepare('SELECT * FROM dining_zones WHERE branch_id=? ORDER BY name,id').all(p.branchId) as Zone[]).filter(z=>manage||z.active===1);
  const tables=(this.db.prepare('SELECT * FROM dining_tables WHERE branch_id=? ORDER BY name,id').all(p.branchId) as Table[]).filter(t=>manage||t.active===1&&zones.some(z=>z.id===t.zone_id&&z.active===1));
  // Count accepted batches only for orders attached to open visits.
  const active=this.db.prepare(`SELECT v.*,o.total current_total,
   COALESCE((SELECT COUNT(*) FROM order_batches b WHERE b.branch_id=v.branch_id AND b.order_id=o.id),0) batch_count
   FROM table_sessions v LEFT JOIN orders o ON o.branch_id=v.branch_id AND o.table_session_id=v.id
   WHERE v.branch_id=? AND v.status='OPEN'`).all(p.branchId) as (Visit&{current_total:number|null;batch_count:number})[];
  const visits=new Map(active.map(v=>[v.table_id,v]));
  return {serverTime:this.now(),shiftOpen,settings:this.settings(),zones:zones.map(z=>this.zoneDto(z)),tables:tables.map(t=>{
   const v=visits.get(t.id),canView=!!v&&hasPermission(this.db,p.employee,'table.view_details')&&this.accessible(p,v);
   return {...this.tableDto(t),state:v?'OCCUPIED':'FREE',isMine:!!v&&v.responsible_waiter_id===p.id,canViewDetails:canView,...(canView?{sessionId:v.id,openedAt:v.opened_at,openedBy:{id:v.opened_by,name:v.opened_by_name},responsibleWaiter:v.responsible_waiter_id?{id:v.responsible_waiter_id,name:v.responsible_waiter_name!}:null,batchCount:v.batch_count,currentTotal:v.current_total??0}:{})};
  })};
 }
 waiters(token:string){const p=this.auth.current(token);requireCondition(hasPermission(this.db,p.employee,'table.open')||hasPermission(this.db,p.employee,'table.responsible.change'),'PERMISSION_DENIED',403);if(p.role==='WAITER'&&(this.settings().mode!=='SHARED'||!hasPermission(this.db,p.employee,'table.responsible.change')))return [{id:p.id,name:p.employee.name}];return this.db.prepare("SELECT id,name FROM employees WHERE branch_id=? AND role='WAITER' AND status='ACTIVE' ORDER BY name,id").all(this.auth.branchId);}
 waiterShiftSummary(token:string){
  const actor=this.auth.current(token,'table.view_status');this.auth.current(token,'shift.report.view');
  return this.db.transaction(()=>{
   const shift=this.db.prepare("SELECT id FROM shifts WHERE branch_id=? AND status='OPEN'").get(actor.branchId) as {id:string}|undefined;
   const employees=this.db.prepare("SELECT id,name,status FROM employees WHERE branch_id=? AND role='WAITER' ORDER BY name,id").all(actor.branchId) as {id:string;name:string;status:string}[];
   const counts=new Map<string,{openTableCount:number;acceptedBatchCount:number;acceptedSubtotalTyiyn:bigint}>();
   const countFor=(id:string)=>{let value=counts.get(id);if(!value){value={openTableCount:0,acceptedBatchCount:0,acceptedSubtotalTyiyn:0n};counts.set(id,value);}return value;};
   if(shift){
    const visits=this.db.prepare("SELECT responsible_waiter_id id,COUNT(*) count FROM table_sessions WHERE branch_id=? AND shift_id=? AND status='OPEN' AND table_id IS NOT NULL AND responsible_waiter_id IS NOT NULL GROUP BY responsible_waiter_id").all(actor.branchId,shift.id) as {id:string;count:number}[];
    for(const visit of visits)countFor(visit.id).openTableCount=visit.count;
    const batches=this.db.prepare("SELECT b.sender_id id,b.subtotal FROM order_batches b JOIN orders o ON o.branch_id=b.branch_id AND o.id=b.order_id WHERE b.branch_id=? AND o.shift_id=? AND o.type='TABLE'").all(actor.branchId,shift.id) as {id:string;subtotal:number}[];
    for(const batch of batches){const count=countFor(batch.id);count.acceptedBatchCount++;count.acceptedSubtotalTyiyn+=BigInt(batch.subtotal);}
   }
   return {shiftId:shift?.id??null,asOf:this.now(),waiters:employees.filter(employee=>employee.status==='ACTIVE'||counts.has(employee.id)).map(employee=>({id:employee.id,name:employee.name,active:employee.status==='ACTIVE',openTableCount:counts.get(employee.id)?.openTableCount??0,acceptedBatchCount:counts.get(employee.id)?.acceptedBatchCount??0,acceptedSubtotalTyiyn:String(counts.get(employee.id)?.acceptedSubtotalTyiyn??0n)}))};
  })();
 }
 details(token:string,id:string){const p=this.auth.current(token,'table.view_details'),v=this.visit(id);this.requireAccess(p,v);if(v.status==='CLOSED')this.terminalRead?.(token,id);return this.visitDto(v);}
 visibleOpenVisits(token:string){
  const p=this.auth.current(token,'table.view_status'),visible=new Map<string,string|null>();
  if(!hasPermission(this.db,p.employee,'table.view_details'))return visible;
  const visits=this.db.prepare("SELECT id,table_id,opened_by,responsible_waiter_id,status FROM table_sessions WHERE branch_id=? AND status='OPEN'").all(p.branchId) as Pick<Visit,'id'|'table_id'|'opened_by'|'responsible_waiter_id'|'status'>[];
  for(const visit of visits)if(this.accessible(p,visit))visible.set(visit.id,visit.table_id);
  return visible;
 }
 canSettle(token:string,id:string){const p=this.auth.current(token);if(p.role!=='WAITER')return true;const visit=this.visit(id);return visit.responsible_waiter_id===p.id||this.settings().mode==='SHARED';}
 private visitDto(v:Visit){return {id:v.id,tableId:v.table_id,shiftId:v.shift_id,tableName:v.table_name,zoneName:v.zone_name,status:v.status,revision:v.revision,openedAt:v.opened_at,openedBy:{id:v.opened_by,name:v.opened_by_name},responsibleWaiter:v.responsible_waiter_id?{id:v.responsible_waiter_id,name:v.responsible_waiter_name}:null,closedAt:v.closed_at,closedBy:v.closed_by,closeReason:v.close_reason,hasAcceptedBatch:v.has_accepted_batch===1,hasRegisteredPayment:v.has_registered_payment===1};}
 async saveZone(token:string,id:string,input:{zoneId:string|null;revision:number;name:unknown;active:boolean}){
  const p=this.auth.current(token,'table.manage'),named=label(input.name);integer(input.revision,0,Number.MAX_SAFE_INTEGER);requireCondition(typeof input.active==='boolean','INVALID_BOOLEAN');if(input.zoneId!==null)identifier(input.zoneId);
  return this.bus.run({id,type:'table.zone.save',actor:p,payload:{...input,name:named.name}},()=>{this.auth.current(token,'table.manage');},()=>{
   let before:unknown=null,zoneId=input.zoneId??randomUUID();
   const duplicate=this.db.prepare('SELECT id FROM dining_zones WHERE branch_id=? AND name_key=?').get(p.branchId,named.key) as {id:string}|undefined;requireCondition(!duplicate||duplicate.id===zoneId,'ZONE_NAME_USED',409);
   if(input.zoneId){const z=this.zone(input.zoneId);requireCondition(z.revision===input.revision,'REVISION_CONFLICT',409);before=this.zoneDto(z);
    requireCondition(!this.db.prepare("SELECT 1 FROM table_sessions s JOIN dining_tables t ON t.id=s.table_id AND t.branch_id=s.branch_id WHERE t.zone_id=? AND s.branch_id=? AND s.status='OPEN'").get(z.id,p.branchId),'ZONE_OCCUPIED',409);
    if(!input.active)requireCondition(!this.db.prepare('SELECT 1 FROM dining_tables WHERE branch_id=? AND zone_id=? AND active=1').get(p.branchId,z.id),'ZONE_HAS_ACTIVE_TABLES',409);
    this.db.prepare('UPDATE dining_zones SET name=?,name_key=?,active=?,revision=revision+1 WHERE branch_id=? AND id=?').run(named.name,named.key,input.active?1:0,p.branchId,z.id);
   }else{requireCondition(input.revision===0,'REVISION_CONFLICT',409);this.db.prepare('INSERT INTO dining_zones VALUES(?,?,?,?,?,1)').run(zoneId,p.branchId,named.name,named.key,input.active?1:0);}
   const result=this.zoneDto(this.zone(zoneId));this.markCloudRevision(p.branchId);this.changed(p,id,'table.zone.saved',zoneId,{before,after:result});return result;
  }).then(result=>{this.onConfigurationChanged?.();return result;});
 }
 async saveTable(token:string,id:string,input:{tableId:string|null;revision:number;zoneId:string;name:unknown;active:boolean}){
  const p=this.auth.current(token,'table.manage'),named=label(input.name);integer(input.revision,0,Number.MAX_SAFE_INTEGER);identifier(input.zoneId);if(input.tableId!==null)identifier(input.tableId);requireCondition(typeof input.active==='boolean','INVALID_BOOLEAN');
  return this.bus.run({id,type:'table.config.save',actor:p,payload:{...input,name:named.name}},()=>{this.auth.current(token,'table.manage');},()=>{
   let before:unknown=null;const tableId=input.tableId??randomUUID(),z=this.zone(input.zoneId);requireCondition(!input.active||z.active===1,'ZONE_INACTIVE',409);
   const duplicate=this.db.prepare('SELECT id FROM dining_tables WHERE branch_id=? AND name_key=?').get(p.branchId,named.key) as {id:string}|undefined;requireCondition(!duplicate||duplicate.id===tableId,'TABLE_NAME_USED',409);
   if(input.tableId){const t=this.table(input.tableId);requireCondition(t.revision===input.revision,'REVISION_CONFLICT',409);requireCondition(!this.activeVisit(t.id),'TABLE_OCCUPIED',409);before=this.tableDto(t);
    this.db.prepare('UPDATE dining_tables SET zone_id=?,name=?,name_key=?,active=?,revision=revision+1 WHERE branch_id=? AND id=?').run(z.id,named.name,named.key,input.active?1:0,p.branchId,t.id);
   }else{requireCondition(input.revision===0,'REVISION_CONFLICT',409);this.db.prepare('INSERT INTO dining_tables VALUES(?,?,?,?,?,?,1)').run(tableId,p.branchId,z.id,named.name,named.key,input.active?1:0);}
   const code=ensureTablePublicLink(this.db,p.branchId,tableId,this.now());
   const result={...this.tableDto(this.table(tableId)),publicPath:`/b/${p.branchId}/t/${code}`,publicUrl:null};this.markCloudRevision(p.branchId);this.changed(p,id,'table.config.saved',tableId,{before,after:result});return result;
  }).then(result=>{this.onConfigurationChanged?.();return result;});
 }
 async setMode(token:string,id:string,input:{mode:'STRICT'|'SHARED';revision:number}){
  const p=this.auth.current(token,'settings.table_access_mode.manage');integer(input.revision,0,Number.MAX_SAFE_INTEGER);requireCondition(['STRICT','SHARED'].includes(input.mode),'INVALID_TABLE_MODE');
  return this.bus.run({id,type:'table.mode.set',actor:p,payload:input},()=>{this.auth.current(token,'settings.table_access_mode.manage');},()=>{
   const before=this.settings();requireCondition(before.revision===input.revision,'REVISION_CONFLICT',409);
   this.db.prepare('INSERT INTO table_settings VALUES(?,?,?) ON CONFLICT(branch_id) DO UPDATE SET mode=excluded.mode,revision=excluded.revision').run(p.branchId,input.mode,before.revision+1);
   const result=this.settings();this.changed(p,id,'table.mode.changed',p.branchId,{before,after:result});return result;
  });
 }
 async open(token:string,id:string,input:{tableId:string|null;responsibleWaiterId:string|null}){
  const p=this.auth.current(token,'table.open');if(input.tableId!==null)identifier(input.tableId);if(input.responsibleWaiterId!==null)identifier(input.responsibleWaiterId);
  return this.bus.run({id,type:'table.visit.open',actor:p,payload:input},()=>{this.auth.current(token,'table.open');if(input.tableId!==null)this.table(input.tableId);},()=>{
   return this.createOpen(token,id,input);
  });
 }
 opening(token:string,input:{tableId:string|null;responsibleWaiterId:string|null}){
  const actor=this.auth.current(token,'table.open');if(input.tableId!==null)identifier(input.tableId);if(input.responsibleWaiterId!==null)identifier(input.responsibleWaiterId);
  const t=input.tableId===null?null:this.table(input.tableId),z=t?this.zone(t.zone_id):null,settings=this.settings();
  requireCondition(settings.configured,'TABLE_MODE_REQUIRED',409);requireCondition(!t||t.active===1&&z?.active===1,'TABLE_INACTIVE',409);
  const shift=this.db.prepare("SELECT id FROM shifts WHERE branch_id=? AND status='OPEN'").get(actor.branchId) as {id:string}|undefined;requireCondition(shift,'SHIFT_REQUIRED',409);
  requireCondition(!t||!this.activeVisit(t.id),'TABLE_OCCUPIED',409);
  const chosenId=input.responsibleWaiterId;
  if(actor.role==='WAITER')requireCondition(chosenId===null||chosenId===actor.id,'RESPONSIBLE_WAITER_FORBIDDEN',403);
  const responsible=chosenId?this.auth.employee(chosenId):actor.employee;
  requireCondition(responsible.status==='ACTIVE'&&(!chosenId||responsible.role==='WAITER'),'INVALID_RESPONSIBLE_WAITER',409);
  return {tableId:t?.id??null,tableName:t?.name??'Без стола',zoneName:z?.name??'',tableRevision:t?.revision??null,zoneRevision:z?.revision??null,shiftId:shift.id,responsibleWaiterId:responsible.id,responsibleWaiterName:responsible.name,settings,canAccess:this.accessible(actor,{opened_by:actor.id,responsible_waiter_id:responsible.id,status:'OPEN'})};
 }
 createOpen(token:string,id:string,input:Parameters<TableService['opening']>[1]){
  const actor=this.auth.current(token,'table.open'),plan=this.opening(token,input),sessionId=randomUUID();
  this.db.prepare("INSERT INTO table_sessions(id,branch_id,table_id,shift_id,opened_by,responsible_waiter_id,table_name,zone_name,opened_by_name,responsible_waiter_name,opened_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'OPEN')").run(sessionId,actor.branchId,plan.tableId,plan.shiftId,actor.id,plan.responsibleWaiterId,plan.tableName,plan.zoneName,actor.employee.name,plan.responsibleWaiterName,this.now());
  const result={sessionId,tableId:plan.tableId,state:plan.tableId?'OCCUPIED':'UNASSIGNED',revision:1};this.changed(actor,id,'table.visit.opened',sessionId,result);return result;
 }
 private assignmentEvent(actor:Principal,id:string,before:Visit,after:Visit,kind:'MOVE'|'RESPONSIBLE'){
  this.db.prepare('INSERT INTO table_assignment_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),actor.branchId,before.id,before.revision+1,kind,before.table_id,after.table_id,before.table_name,after.table_name,before.zone_name,after.zone_name,before.responsible_waiter_id,after.responsible_waiter_id,before.responsible_waiter_name,after.responsible_waiter_name,actor.id,actor.employee.name,id,this.now());
 }
 async move(token:string,id:string,input:{sessionId:string;tableId:string;revision:number}){return this.changeAssignment(token,id,input,'MOVE');}
 async responsible(token:string,id:string,input:{sessionId:string;responsibleWaiterId:string|null;revision:number}){return this.changeAssignment(token,id,input,'RESPONSIBLE');}
 private async changeAssignment(token:string,id:string,input:{sessionId:string;revision:number;tableId?:string;responsibleWaiterId?:string|null},kind:'MOVE'|'RESPONSIBLE'){
  const permission=kind==='MOVE'?'table.move':'table.responsible.change',actor=this.auth.current(token,permission);identifier(input.sessionId);integer(input.revision,1,Number.MAX_SAFE_INTEGER);
  if(kind==='MOVE')identifier(input.tableId);else if(input.responsibleWaiterId!==null)identifier(input.responsibleWaiterId);
  return this.bus.run({id,type:'table.visit.'+kind,actor,payload:input},()=>{
   const p=this.auth.current(token,permission),receipt=this.db.prepare('SELECT actor_id FROM commands WHERE branch_id=? AND id=?').get(p.branchId,id) as {actor_id:string}|undefined;
   if(p.role==='WAITER'&&receipt?.actor_id!==p.id){const visit=this.visit(input.sessionId);requireCondition(this.settings().mode==='SHARED','SHARED_MODE_REQUIRED',403);requireCondition(visit.responsible_waiter_id===p.id,'RESPONSIBLE_WAITER_REQUIRED',403);}
   if(receipt?.actor_id!==p.id)this.requireAccess(p,this.visit(input.sessionId));
  },()=>{
   const before=this.visit(input.sessionId);requireCondition(before.status==='OPEN','VISIT_CLOSED',409);requireCondition(before.revision===input.revision,'REVISION_CONFLICT',409);
   requireCondition(this.db.prepare("SELECT 1 FROM shifts WHERE branch_id=? AND id=? AND status='OPEN'").get(actor.branchId,before.shift_id),'SHIFT_REQUIRED',409);
   const after={...before};
   if(kind==='MOVE'){
    const table=this.table(input.tableId!),zone=this.zone(table.zone_id);requireCondition(table.active===1&&zone.active===1,'TABLE_INACTIVE',409);requireCondition(!this.activeVisit(table.id),'TABLE_OCCUPIED',409);Object.assign(after,{table_id:table.id,table_name:table.name,zone_name:zone.name});
   }else{
    const waiter=input.responsibleWaiterId?this.auth.employee(input.responsibleWaiterId):null;
    requireCondition(!waiter||waiter.role==='WAITER'&&waiter.status==='ACTIVE','INVALID_RESPONSIBLE_WAITER',409);
    if(!waiter)requireCondition(!this.db.prepare("SELECT 1 FROM employees WHERE branch_id=? AND role='WAITER' AND status='ACTIVE'").get(actor.branchId),'RESPONSIBLE_WAITER_REQUIRED',409);
    Object.assign(after,{responsible_waiter_id:waiter?.id??null,responsible_waiter_name:waiter?.name??null});
   }
   this.assignmentEvent(actor,id,before,after,kind);
   this.db.prepare('UPDATE table_sessions SET table_id=?,table_name=?,zone_name=?,responsible_waiter_id=?,responsible_waiter_name=?,revision=revision+1 WHERE branch_id=? AND id=?').run(after.table_id,after.table_name,after.zone_name,after.responsible_waiter_id,after.responsible_waiter_name,actor.branchId,before.id);
   const result={sessionId:before.id,revision:before.revision+1};this.changed(actor,id,'table.visit.assignment.changed',before.id,{...result,kind});return result;
  });
 }
 async assign(token:string,id:string,input:{sessionId:string;tableId:string;revision:number}){
  const actor=this.auth.current(token,'table.open');identifier(input.sessionId);identifier(input.tableId);integer(input.revision,1,Number.MAX_SAFE_INTEGER);
  const authorize=()=>{this.auth.current(token,'table.open');this.requireAccess(this.auth.current(token),this.visit(input.sessionId));};
  return this.bus.run({id,type:'table.visit.assign',actor,payload:input},authorize,()=>{
   const visit=this.visit(input.sessionId),table=this.table(input.tableId),zone=this.zone(table.zone_id);
   requireCondition(visit.status==='OPEN','VISIT_CLOSED',409);requireCondition(visit.table_id===null,'TABLE_ALREADY_ASSIGNED',409);
   requireCondition(visit.revision===input.revision,'REVISION_CONFLICT',409);
   requireCondition(this.db.prepare("SELECT 1 FROM shifts WHERE branch_id=? AND id=? AND status='OPEN'").get(actor.branchId,visit.shift_id),'SHIFT_REQUIRED',409);
   requireCondition(table.active===1&&zone.active===1,'TABLE_INACTIVE',409);requireCondition(!this.activeVisit(table.id),'TABLE_OCCUPIED',409);
   this.assignmentEvent(actor,id,visit,{...visit,table_id:table.id,table_name:table.name,zone_name:zone.name},'MOVE');
   this.db.prepare('UPDATE table_sessions SET table_id=?,table_name=?,zone_name=?,revision=revision+1 WHERE branch_id=? AND id=?').run(table.id,table.name,zone.name,actor.branchId,visit.id);
   const result=this.visitDto(this.visit(visit.id));this.changed(actor,id,'table.visit.assigned',visit.id,result);return result;
  });
 }
 async closeEmpty(token:string,id:string,input:{sessionId:string;revision:number}){
  const p=this.auth.current(token,'table.close_empty');identifier(input.sessionId);integer(input.revision,1,Number.MAX_SAFE_INTEGER);
  return this.bus.run({id,type:'table.visit.close_empty',actor:p,payload:input},()=>{const actor=this.auth.current(token,'table.close_empty'),receipt=this.db.prepare('SELECT actor_id FROM commands WHERE branch_id=? AND id=?').get(actor.branchId,id) as {actor_id:string}|undefined;if(receipt?.actor_id!==actor.id)this.requireAccess(actor,this.visit(input.sessionId));},()=>{
   const v=this.visit(input.sessionId);requireCondition(v.status==='OPEN','VISIT_CLOSED',409);requireCondition(v.revision===input.revision,'REVISION_CONFLICT',409);
   requireCondition(v.has_accepted_batch===0&&v.has_registered_payment===0,'VISIT_NOT_EMPTY',409);
   this.db.prepare("UPDATE table_sessions SET status='CLOSED',closed_at=?,closed_by=?,close_reason='EMPTY',revision=revision+1 WHERE branch_id=? AND id=?").run(this.now(),p.id,p.branchId,v.id);
   const result={sessionId:v.id,tableId:v.table_id,status:'CLOSED',closeReason:'EMPTY',revision:v.revision+1};this.changed(p,id,'table.visit.closed_empty',v.id,result);return result;
  });
 }
}
