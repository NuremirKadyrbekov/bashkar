import {randomUUID} from 'node:crypto';
import {canonical,digest} from '../../command-bus';
import {PosError,requireCondition} from '../../errors';
import type {TableService} from './table-service';
import type {MenuTransport} from '../menu/cloud-menu-transport';
import QRCode from 'qrcode';

type State={revision:number;command_id:string;acknowledged_revision:number;last_error:string|null;last_attempt_at:number|null;last_success_at:number|null};
export class TableCloudSyncService {
 private timer?:ReturnType<typeof setTimeout>;private task?:Promise<void>;private stopped=true;private failures=0;
 private publication?:{revision:number;state:'PUBLISHED'|'DISABLED'|'UNAVAILABLE';expiresAt:number};
 constructor(readonly tables:TableService,readonly remote?:MenuTransport,private now=Date.now,private publicBaseUrl?:string){}
 private get db(){return this.tables.db;}private get branch(){return this.tables.auth.branchId;}
 private state(){return this.db.prepare('SELECT * FROM table_cloud_sync_state WHERE branch_id=?').get(this.branch) as State|undefined;}
 private async ensure(){await this.tables.bus.system(()=>{if(!this.state())this.db.prepare('INSERT INTO table_cloud_sync_state(branch_id,revision,command_id) VALUES(?,1,?)').run(this.branch,randomUUID());});}
 private document(){
  const zones=this.db.prepare('SELECT id,name,active,revision FROM dining_zones WHERE branch_id=? ORDER BY id').all(this.branch) as {id:string;name:string;active:number;revision:number}[];
  const tables=this.db.prepare('SELECT t.id,t.zone_id AS zoneId,l.code,t.name,t.active,t.revision FROM dining_tables t JOIN dining_table_public_links l ON l.branch_id=t.branch_id AND l.table_id=t.id WHERE t.branch_id=? ORDER BY t.id').all(this.branch) as {id:string;zoneId:string;code:string;name:string;active:number;revision:number}[];
  const count=(this.db.prepare('SELECT count(*) n FROM dining_tables WHERE branch_id=?').get(this.branch) as {n:number}).n;
  requireCondition(tables.length===count,'TABLE_LINK_MISSING',503);
  return {zones:zones.map(z=>({...z,active:z.active===1})),tables:tables.map(t=>({...t,active:t.active===1}))};
 }
 status(token:string){this.tables.auth.current(token,'table.manage');const s=this.state();return {enabled:!!this.remote,revision:s?.revision??0,acknowledgedRevision:s?.acknowledged_revision??0,state:!this.remote?'DISABLED':s?.last_error??(s&&s.acknowledged_revision===s.revision?'SYNCED':'PENDING'),lastAttempt:s?.last_attempt_at??null,lastSuccess:s?.last_success_at??null};}
 private publicOrigin(){try{const url=new URL(this.publicBaseUrl??'');return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'?url.origin:null;}catch{return null;}}
 links(token:string){
  const rows=this.tables.publicLinks(token),origin=this.publicOrigin(),s=this.status(token);
  const publication=this.publication?.revision===s.revision&&this.publication.expiresAt>this.now()?this.publication.state:null;
  return rows.map(row=>{const active=row.publicLinkStatus!=='INACTIVE',status=!active?'INACTIVE':!origin||!this.remote?'PENDING_HOST':s.revision===0||s.acknowledgedRevision!==s.revision?'PENDING_SYNC':publication==='UNAVAILABLE'?'CLOUD_UNAVAILABLE':publication==='DISABLED'?'MENU_NOT_PUBLISHED':publication==='PUBLISHED'?'READY':'PENDING_VERIFY';return {...row,publicUrl:status==='READY'?origin+row.publicPath:null,publicLinkStatus:status};});
 }
 async linksFresh(token:string){
  const s=this.status(token),origin=this.publicOrigin();
  if(origin&&this.remote&&s.revision>0&&s.acknowledgedRevision===s.revision){try{const value=await this.remote.call('publicMenuStatus',{});this.publication={revision:s.revision,state:value?.enabled===true&&typeof value.versionId==='string'?'PUBLISHED':'DISABLED',expiresAt:this.now()+30000};}catch{this.publication={revision:s.revision,state:'UNAVAILABLE',expiresAt:this.now()+5000};}}
  return this.links(token);
 }
 async qr(token:string,tableId:string){const row=(await this.linksFresh(token)).find(link=>link.tableId===tableId);requireCondition(row,'TABLE_NOT_FOUND',404);return {...row,qrDataUrl:row.publicUrl?await QRCode.toDataURL(row.publicUrl,{width:240,margin:2}):null};}
 async qrBatch(token:string,tableIds:unknown){
  requireCondition(Array.isArray(tableIds)&&tableIds.length>0&&tableIds.length<=24&&tableIds.every(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id))&&new Set(tableIds).size===tableIds.length,'INVALID_TABLE_IDS');
  const links=new Map(this.links(token).map(row=>[row.tableId,row]));
  return Promise.all(tableIds.map(async tableId=>{
   const row=links.get(tableId);requireCondition(row,'TABLE_NOT_FOUND',404);
   return {tableId,publicUrl:row.publicUrl,qrDataUrl:row.publicUrl?await QRCode.toDataURL(row.publicUrl,{width:240,margin:2}):null};
  }));
 }
 start(){this.stopped=false;this.tables.onConfigurationChanged=()=>this.wake();this.wake();}
 async stop(){this.stopped=true;clearTimeout(this.timer);this.tables.onConfigurationChanged=undefined;await this.task;}
 wake(){if(this.stopped||!this.remote)return;clearTimeout(this.timer);if(this.task)return;this.timer=setTimeout(()=>void this.run(),0);this.timer.unref();}
 async run(){if(this.task||this.stopped||!this.remote)return this.task;this.task=this.cycle().finally(()=>{this.task=undefined;if(this.stopped)return;const pending=this.state();const delay=this.failures?Math.min(300000,15000*2**Math.min(this.failures-1,4)):pending&&pending.revision>pending.acknowledged_revision?0:30000;this.timer=setTimeout(()=>void this.run(),delay);this.timer.unref();});return this.task;}
 private async cycle(){
  try{
   await this.ensure();
   const s=this.state()!;if(s.acknowledged_revision>=s.revision){this.failures=0;return;}
   const document=this.document(),hash=digest(canonical(document));
   requireCondition(Buffer.byteLength(canonical(document))<1500000,'TABLE_SNAPSHOT_TOO_LARGE');
   await this.tables.bus.system(()=>this.db.prepare('UPDATE table_cloud_sync_state SET last_attempt_at=?,last_error=NULL WHERE branch_id=?').run(this.now(),this.branch));
   const receipt=await this.remote!.call('tableSnapshot',{commandId:s.command_id,revision:s.revision,hash,document});
   requireCondition(receipt?.state==='APPLIED'&&receipt.revision===s.revision&&receipt.hash===hash&&receipt.zoneCount===document.zones.length&&receipt.tableCount===document.tables.length,'INVALID_TABLE_RECEIPT');
   await this.tables.bus.system(()=>this.db.prepare('UPDATE table_cloud_sync_state SET acknowledged_revision=max(acknowledged_revision,?),last_error=NULL,last_success_at=? WHERE branch_id=?').run(s.revision,this.now(),this.branch));
   this.failures=0;if(this.state()!.revision>s.revision)this.wake();
  }catch(error){this.failures++;const code=error instanceof PosError?error.code:'TABLE_CLOUD_UNAVAILABLE';await this.tables.bus.system(()=>{if(this.state())this.db.prepare('UPDATE table_cloud_sync_state SET last_error=? WHERE branch_id=?').run(code,this.branch);});}
 }
}
