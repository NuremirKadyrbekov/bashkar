import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fixture,catalog,password} from './fixtures/operations';
import {TableService} from '../src/modules/tables/table-service';
import {OrderService} from '../src/modules/orders/order-service';
import {FinanceService} from '../src/modules/orders/finance-service';
import {FulfillmentService,HISTORY_STATE_ITEMS_SQL,HISTORY_STATE_JOBS_SQL} from '../src/modules/orders/fulfillment-service';

it('reads only the selected order for 10, 50 and 200 batches and stops at the true final page',async()=>{
 const f=await fixture();try{
  for(const permission of ['shift.open','counter.view','counter.batch.submit','order.fulfillment.mark'] as const)await f.auth.setPermission(f.token,randomUUID(),{employeeId:f.auth.current(f.token).id,revision:f.auth.employee(f.auth.current(f.token).id).revision,permission,allowed:true});
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  const menu=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});await f.menu.publish(f.token,randomUUID(),menu);
  const tables=new TableService(f.db,f.bus,f.auth,f.now),finance=new FinanceService(new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now)),service=new FulfillmentService(finance);
  const line={lineId:randomUUID(),itemId:'coffee',variantId:'small',modifierIds:['regular'],quantity:1,comment:''},input={draftId:randomUUID(),draftRevision:1,menuRevision:1,lines:[line],discount:0,mode:'ACCEPT' as const};
  const prepared=finance.prepareCounter(f.token,null,input),accepted=await finance.counterCommit(f.token,null,{...input,expectedOrderRevision:prepared.expectedOrderRevision,expectedVisitRevision:prepared.expectedVisitRevision,shiftId:prepared.shiftId,confirmationHash:prepared.confirmationHash},randomUUID());
  const original=f.db.prepare('SELECT id FROM order_batches WHERE order_id=?').get(accepted.orderId) as {id:string};
  for(let n=2;n<=200;n++){
   const batchId=randomUUID(),itemId=randomUUID(),jobId=randomUUID();
   f.db.prepare('INSERT INTO order_batches(id,branch_id,order_id,sequence,command_id,draft_id,draft_revision,sender_id,sender_name,submitted_at,menu_revision,subtotal) SELECT ?,branch_id,order_id,?,?,?,draft_revision,sender_id,sender_name,submitted_at,menu_revision,subtotal FROM order_batches WHERE id=?').run(batchId,n,randomUUID(),randomUUID(),original.id);
   f.db.prepare('INSERT INTO order_items(id,branch_id,batch_id,line_id,snapshot,quantity,total,kitchen) SELECT ?,branch_id,?, ?,snapshot,quantity,total,kitchen FROM order_items WHERE batch_id=?').run(itemId,batchId,randomUUID(),original.id);
   f.db.prepare('INSERT INTO print_jobs(id,branch_id,order_id,batch_id,type,purpose,snapshot_version,status,payload,created_at) SELECT ?,branch_id,order_id,?,type,purpose,snapshot_version,status,payload,created_at FROM print_jobs WHERE batch_id=?').run(jobId,batchId,original.id);
   f.db.prepare('UPDATE orders SET revision=revision+1 WHERE id=?').run(accepted.orderId);
   if([10,20,50,200].includes(n)){
    const state=service.state(f.token,accepted.orderId),pages=[];let after=0,calls=0;
    do{const page=service.history(f.token,accepted.orderId,after);calls++;pages.push(...page.batches);after=page.next??0;if(page.next===null)break;}while(calls<20);
    expect(pages).toHaveLength(n);expect(calls).toBe(Math.ceil(n/20));expect(state.maxSequence).toBe(n);expect(state.items).toHaveLength(n);expect(state.jobs).toHaveLength(n);
    expect(state.items[0]).toMatchObject({sequence:1,fulfillmentRevision:0});
    const full=()=>{let cursor=0,requests=0,bytes=0;do{const page=service.history(f.token,accepted.orderId,cursor);requests++;bytes+=Buffer.byteLength(JSON.stringify(page));if(page.next===null)break;cursor=page.next;}while(requests<20);return {requests,bytes};};
    const sample=(run:()=>unknown)=>{const times:number[]=[];let value:unknown;for(let sample=0;sample<7;sample++){const start=performance.now();value=run();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return {ms:Number(times[3].toFixed(3)),value};};
    const current=sample(full),compact=sample(()=>service.state(f.token,accepted.orderId)),one=sample(()=>service.history(f.token,accepted.orderId,0,1));
    console.log('HISTORY_BENCH',JSON.stringify({batches:n,full:{...(current.value as ReturnType<typeof full>),medianMs:current.ms},compact:{requests:1,bytes:Buffer.byteLength(JSON.stringify(compact.value)),medianMs:compact.ms},changedBatch:{requests:1,bytes:Buffer.byteLength(JSON.stringify(one.value)),medianMs:one.ms}}));
   }
  }
  const itemPlan=f.db.prepare('EXPLAIN QUERY PLAN '+HISTORY_STATE_ITEMS_SQL).all(f.claims.branchId,accepted.orderId) as {detail:string}[];
  const jobPlan=f.db.prepare('EXPLAIN QUERY PLAN '+HISTORY_STATE_JOBS_SQL).all(f.claims.branchId,accepted.orderId) as {detail:string}[];
  expect(itemPlan.some(row=>row.detail.includes('SEARCH b USING INDEX order_batches_history'))).toBe(true);
  expect(itemPlan.some(row=>row.detail.includes('SEARCH i USING INDEX order_items_batch'))).toBe(true);
  expect(jobPlan.some(row=>row.detail.includes('SEARCH j USING INDEX print_jobs_order'))).toBe(true);
  expect([...itemPlan,...jobPlan].some(row=>/SCAN (order_batches|order_items|print_jobs|order_fulfillment_events)\b/.test(row.detail))).toBe(false);
  const before=service.state(f.token,accepted.orderId),itemId=before.items[0].itemId,jobId=before.jobs[0].id;
  await service.mark(f.token,accepted.orderId,{itemId,issued:true,expectedRevision:0,expectedOrderRevision:200},randomUUID());
  expect(service.state(f.token,accepted.orderId).items[0].fulfillmentRevision).toBe(1);
  f.db.prepare("UPDATE print_dispatches SET state='SENT',revision=revision+1 WHERE branch_id=? AND job_id=?").run(f.claims.branchId,jobId);
  expect(service.state(f.token,accepted.orderId).jobs[0].status).toBe('SENT');
 }finally{f.close();}
});
