import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,password,catalog} from './fixtures/operations';
import {TableService} from '../src/modules/tables/table-service';
import {OrderService} from '../src/modules/orders/order-service';
import {FinanceService} from '../src/modules/orders/finance-service';
import {ShiftFinanceService} from '../src/modules/shifts/shift-finance-service';
import {buildOverviewMetrics} from '../src/modules/analytics/overview-metrics';
import {buildProductMetrics} from '../src/modules/analytics/product-metrics';
import {AnalyticsSyncService} from '../src/modules/analytics/analytics-sync-service';
import {createServer} from '../src/server';

async function setup(){
 const f=await fixture(),tables=new TableService(f.db,f.bus,f.auth,f.now),orders=new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now),finance=new FinanceService(orders),shiftFinance=new ShiftFinanceService(finance);
 const owner=f.auth.current(f.token);
 for(const permission of ['shift.open','payment.refund','counter.view','counter.batch.submit','order.settle.counter'])await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:f.auth.employee(owner.id).revision,permission:permission as never,allowed:true});
 await f.shifts.open(f.token,randomUUID(),'owner',password);
 const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:catalog()});await f.menu.publish(f.token,randomUUID(),draft);
 const sale=async(payment:unknown,discount=0)=>{const request={draftId:randomUUID(),draftRevision:1,menuRevision:1,discount,lines:[{lineId:randomUUID(),itemId:'coffee',variantId:'small',modifierIds:['regular'],quantity:1,comment:''}],mode:'CHECKOUT',payment};const quote=finance.prepareCounter(f.token,null,request);return finance.counterCommit(f.token,null,{...request,expectedOrderRevision:quote.expectedOrderRevision,expectedVisitRevision:quote.expectedVisitRevision,shiftId:quote.shiftId,confirmationHash:quote.confirmationHash},randomUUID());};
 const metrics=(from=f.now()-1000,to=f.now()+1000)=>buildOverviewMetrics(f.db,f.claims.branchId,{from,to,timeZone:'Asia/Bishkek',granularity:'hour'});
 return {...f,finance,shiftFinance,sale,metrics};
}

it('uses sealed payments for mixed methods, one paid order and final discount',async()=>{const f=await setup();try{
 await f.sale({kind:'MIXED',firstMethod:'CASH',firstAmount:5000,secondMethod:'QR_TRANSFER_MANUAL'},1000);
 const m=f.metrics();expect(m).toMatchObject({grossPaymentsAmount:'17000',netReceiptsAmount:'17000',paidOrdersCount:1,averageCheckAmount:'17000',discountsAmount:'1000',paymentMethods:{CASH:'5000',QR_TRANSFER_MANUAL:'12000',CARD_MANUAL:'0'},serviceTypes:{COUNTER:{amount:'17000',paidOrdersCount:1},TABLE:{amount:'0',paidOrdersCount:0}}});
 expect(m.dynamics.reduce((sum,row)=>sum+BigInt(row.amount),0n)).toBe(17000n);
 }finally{f.close();}});

it('attributes a later refund to its registration day without changing paid order history',async()=>{const f=await setup();try{
 await f.sale({kind:'SINGLE',method:'CARD_MANUAL'});const payment=f.db.prepare('SELECT id FROM payments').get() as {id:string};const before=f.now();
 f.advance(86_400_001);const token=(await f.auth.login('owner',password,'POS')).token;
 const quote=f.shiftFinance.prepareRefund(token,payment.id,{reason:'Возврат гостю'});
 await f.shiftFinance.refund(token,payment.id,{reason:quote.reason,currentShiftId:quote.currentShiftId,confirmedExternalReturn:true,confirmationHash:quote.confirmationHash},randomUUID());
 const yesterday=buildOverviewMetrics(f.db,f.claims.branchId,{from:before-1000,to:before+1000,timeZone:'Asia/Bishkek',granularity:'hour'});
 const today=buildOverviewMetrics(f.db,f.claims.branchId,{from:f.now()-1000,to:f.now()+1000,timeZone:'Asia/Bishkek',granularity:'hour'});
 expect(yesterday).toMatchObject({grossPaymentsAmount:'18000',refundsAmount:'0',paidOrdersCount:1});
 expect(today).toMatchObject({grossPaymentsAmount:'0',refundsAmount:'18000',netReceiptsAmount:'-18000',paidOrdersCount:0,averageCheckAmount:'0'});
 }finally{f.close();}});

it('counts paid dish units from historical menu and keeps them after refund',async()=>{const f=await setup();try{
 const empty=buildProductMetrics(f.db,f.claims.branchId,{from:f.now()-1000,to:f.now()+1000});expect(empty).toMatchObject({totalUnits:0,topProducts:[]});
 await f.sale({kind:'SINGLE',method:'CASH'});
 const before=buildProductMetrics(f.db,f.claims.branchId,{from:f.now()-1000,to:f.now()+1000});
 expect(before).toMatchObject({totalUnits:1,topProducts:[{productId:'coffee',name:'Кофе',categoryId:'drinks',category:'Напитки',quantity:1}]});
 const payment=f.db.prepare('SELECT id FROM payments').get() as {id:string};const quote=f.shiftFinance.prepareRefund(f.token,payment.id,{reason:'Возврат гостю'});
 await f.shiftFinance.refund(f.token,payment.id,{reason:quote.reason,currentShiftId:quote.currentShiftId,confirmedExternalReturn:true,confirmationHash:quote.confirmationHash},randomUUID());
 expect(buildProductMetrics(f.db,f.claims.branchId,{from:f.now()-1000,to:f.now()+1000})).toEqual(before);
 }finally{f.close();}});

it('returns zeroes for empty ranges and rejects invalid periods',async()=>{const f=await setup();try{
 const empty=f.metrics();expect(empty).toMatchObject({grossPaymentsAmount:'0',refundsAmount:'0',paidOrdersCount:0,averageCheckAmount:'0'});
 expect(()=>buildOverviewMetrics(f.db,f.claims.branchId,{from:0,to:0,timeZone:'Asia/Bishkek',granularity:'day'})).toThrow('INVALID_PERIOD');
 }finally{f.close();}});

it('retries immutable payment facts after a failed cloud response without advancing its cursor',async()=>{const f=await setup();try{
 await f.sale({kind:'SINGLE',method:'CASH'});
 let fail=true;const batches:any[]=[];const remote={call:async(operation:string,body:any)=>{expect(operation).toBe('analyticsBatch');batches.push(body);if(fail)throw Error('OFFLINE');return {state:'APPLIED',accepted:body.facts.length};}};
 const sync=new AnalyticsSyncService(f.db,f.bus,f.claims.branchId,remote,f.now);
 expect(sync.status().pendingFacts).toBe(3);
 await sync.syncOnce();expect(sync.status()).toMatchObject({lastError:'OFFLINE',pendingFacts:3});
 await sync.syncOnce();expect(batches[1].facts).toEqual(batches[0].facts);
 fail=false;await sync.syncOnce();expect(batches[2].facts.map((fact:any)=>fact.kind).sort()).toEqual(['PAYMENT','PRODUCT','SETTLEMENT']);
 const product=batches[2].facts.find((fact:any)=>fact.kind==='PRODUCT');
 expect(product).toMatchObject({productId:'coffee',categoryId:'drinks',quantity:1,amount:'0'});
 expect(sync.status()).toMatchObject({lastSuccessAt:f.now(),pendingFacts:0});
 await sync.syncOnce();expect(batches[3].facts).toEqual([]);
 }finally{f.close();}});

it('serves local overview only to Owner and reports unacknowledged Cloud facts',async()=>{const f=await setup();let server;try{
 await f.sale({kind:'SINGLE',method:'CASH'});
 const employee=await f.auth.createEmployee(f.token,randomUUID(),{login:'analytics-cashier',name:'Кассир',role:'CASHIER'});
 const first=await f.auth.login('analytics-cashier',employee.temporaryPassword,'POS');
 await f.auth.changePassword(first.token,randomUUID(),employee.temporaryPassword,password);
 const cashier=(await f.auth.login('analytics-cashier',password,'POS')).token;
 const day=new Date(f.now()+6*3_600_000).toISOString().slice(0,10);
 f.storage.close();server=await createServer(f.dir,0,false,f.trust);
 const url=`/api/v1/analytics/overview?from=${day}&to=${day}`;
 const productsUrl=`/api/v1/analytics/products?from=${day}&to=${day}`;
 const owner=await server.inject({method:'GET',url,headers:{authorization:'Bearer '+f.token}});
 expect(owner.statusCode).toBe(200);
 expect(owner.json()).toMatchObject({grossPaymentsAmount:'18000',paidOrdersCount:1,cloudSync:{pendingFacts:3,lastSuccessAt:null}});
 expect((await server.inject({method:'GET',url:productsUrl,headers:{authorization:'Bearer '+f.token}})).json()).toMatchObject({totalUnits:1,topProducts:[{productId:'coffee',quantity:1}]});
 expect((await server.inject({method:'GET',url:productsUrl,headers:{authorization:'Bearer '+cashier}})).statusCode).toBe(403);
 expect((await server.inject({method:'GET',url,headers:{authorization:'Bearer '+cashier}})).statusCode).toBe(403);
 expect((await server.inject({method:'GET',url:'/api/v1/analytics/overview?from=2026-02-31&to=2026-02-31',headers:{authorization:'Bearer '+f.token}})).statusCode).toBe(400);
 }finally{await server?.close();f.close();}});
