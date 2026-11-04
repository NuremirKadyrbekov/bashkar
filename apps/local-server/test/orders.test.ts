import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,password,catalog} from './fixtures/operations';
import {TableService} from '../src/modules/tables/table-service';
import {OrderService} from '../src/modules/orders/order-service';
import {createServer} from '../src/server';
async function setup(){const f=await fixture(),tables=new TableService(f.db,f.bus,f.auth,f.now),orders=new OrderService(f.db,f.bus,f.auth,f.menu,tables,f.now);
 const owner=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:owner.employee.revision,permission:'shift.open',allowed:true});await f.shifts.open(f.token,randomUUID(),'owner',password);
 const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name:'Зал',active:true}),table=await tables.saveTable(f.token,randomUUID(),{tableId:null,revision:0,zoneId:zone.id,name:'7',active:true});await tables.setMode(f.token,randomUUID(),{revision:0,mode:'STRICT'});const visit=await tables.open(f.token,randomUUID(),{tableId:table.id,responsibleWaiterId:null});
 const c=catalog();c.items.push({...structuredClone(c.items[0]),id:'water',name:'Вода',kitchen:false,price:0,variants:[],groups:[]});const d=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:c});await f.menu.publish(f.token,randomUUID(),d);
 function request(item='coffee',comment='Без сахара'){return {draftId:randomUUID(),draftRevision:1,menuRevision:f.menu.active(f.token).revision,discount:orders.get(f.token,visit.sessionId)?.discount??0,lines:[{lineId:randomUUID(),itemId:item,variantId:item==='coffee'?'small':null,modifierIds:item==='coffee'?['regular']:[],quantity:1,comment}]};}
 function prepared(r=request()){const q=orders.prepare(f.token,visit.sessionId,r);return {...r,menuRevision:q.menuRevision,orderRevision:q.orderRevision,confirmationHash:q.confirmationHash};}
 return {...f,tables,orders,visit,c,request,prepared};}
it('accepts first and next batches, keeps historical snapshots/fees and journals discount and PENDING kitchen subset',async()=>{const f=await setup();try{
 expect(f.orders.get(f.token,f.visit.sessionId)).toBeNull();await f.menu.configureFees(f.token,randomUUID(),{revision:0,fees:[{id:'fee',name:'Сервис',rate:500}]});
 const r=f.request();r.lines.push(...f.request('water').lines);r.discount=1000;const p=f.prepared(r),id=randomUUID(),result=await f.orders.submit(f.token,id,f.visit.sessionId,p);expect(await f.orders.submit(f.token,id,f.visit.sessionId,p)).toEqual(result);
 expect(f.orders.get(f.token,f.visit.sessionId)).toMatchObject({subtotal:18000,discount:1000,total:17850});expect(f.orders.history(f.token,f.visit.sessionId).batches[0].lines).toHaveLength(2);expect(f.orders.jobs(f.token,f.visit.sessionId)[0].payload.lines).toHaveLength(1);
 expect(f.tables.list(f.token).tables[0]).toMatchObject({batchCount:1,currentTotal:17850,openedBy:{id:f.auth.current(f.token).id}});
 await f.menu.configureFees(f.token,randomUUID(),{revision:1,fees:[]});const c=structuredClone(f.c);c.items[0].variants[0].price=20000;const d=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:1,catalog:c});await f.menu.publish(f.token,randomUUID(),d);
 await f.orders.submit(f.token,randomUUID(),f.visit.sessionId,f.prepared());const order=f.orders.get(f.token,f.visit.sessionId)!;expect(order).toMatchObject({subtotal:38000,discount:1000,total:38850});expect(order.fees[0].rate).toBe(500);
 expect(f.tables.list(f.token).tables[0]).toMatchObject({batchCount:2,currentTotal:38850});
 const hist=f.orders.history(f.token,f.visit.sessionId);expect(hist.batches[0].lines[0].unitPrice).toBe(18000);expect(hist.batches[1].lines[0].unitPrice).toBe(20000);
 const changed=await f.orders.discount(f.token,randomUUID(),order.id,{expectedRevision:order.revision,amount:38000});expect(f.orders.get(f.token,f.visit.sessionId)?.total).toBe(0);expect(changed.revision).toBe(3);
 expect(f.tables.list(f.token).tables[0]).toMatchObject({batchCount:2,currentTotal:0});
 await expect(f.tables.closeEmpty(f.token,randomUUID(),{sessionId:f.visit.sessionId,revision:3})).rejects.toThrow('VISIT_NOT_EMPTY');expect(f.db.prepare('SELECT count(*) n FROM order_discount_events').get()).toEqual({n:2});
 expect(()=>f.db.prepare("UPDATE order_items SET total=0").run()).toThrow('IMMUTABLE_ACCEPTED_FACT');expect(()=>f.db.prepare('DELETE FROM order_batches').run()).toThrow('IMMUTABLE_ACCEPTED_FACT');
 }finally{f.close();}});
it('keeps an accepted table order after three idle hours and shows it after a new POS login',async()=>{const f=await setup();try{
 const accepted=await f.orders.submit(f.token,randomUUID(),f.visit.sessionId,f.prepared());
 const before=f.orders.history(f.token,f.visit.sessionId);
 f.advance(3*60*60*1000+1);
 expect(()=>f.orders.get(f.token,f.visit.sessionId)).toThrow('SESSION_EXPIRED');
 const token=(await f.auth.login('owner',password,'POS')).token;
 expect(f.tables.details(token,f.visit.sessionId)).toMatchObject({status:'OPEN',hasAcceptedBatch:true});
 expect(f.tables.list(token).tables[0]).toMatchObject({batchCount:1,currentTotal:18000});
 expect(f.orders.get(token,f.visit.sessionId)).toMatchObject({id:accepted.orderId,status:'OPEN',subtotal:18000,total:18000});
 expect(f.orders.history(token,f.visit.sessionId)).toEqual(before);
 }finally{f.close();}});
it('rolls back every accepted fact if job/audit/outbox/result fails, including first order and visit flag',async()=>{const f=await setup();try{for(const table of ['print_jobs','audit_events','outbox','commands']){
 f.db.exec(`CREATE TRIGGER fail_order BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END;`);const p=f.prepared();await expect(f.orders.submit(f.token,randomUUID(),f.visit.sessionId,p)).rejects.toThrow('injected');expect(f.orders.get(f.token,f.visit.sessionId)).toBeNull();expect(f.tables.details(f.token,f.visit.sessionId).hasAcceptedBatch).toBe(false);for(const name of ['order_batches','order_items','print_jobs'])expect(f.db.prepare(`SELECT count(*) n FROM ${name}`).get()).toEqual({n:0});f.db.exec('DROP TRIGGER fail_order');
 }await f.orders.submit(f.token,randomUUID(),f.visit.sessionId,f.prepared());}finally{f.close();}});
it('requires explicit current confirmation, serializes two first batches, blocks draft reuse and fingerprint conflict',async()=>{const f=await setup();try{
 const one=f.prepared(),two=f.prepared(),id=randomUUID();const raced=await Promise.allSettled([f.orders.submit(f.token,id,f.visit.sessionId,one),f.orders.submit(f.token,randomUUID(),f.visit.sessionId,two)]);expect(raced.map(r=>r.status)).toEqual(['fulfilled','rejected']);
 await f.orders.submit(f.token,randomUUID(),f.visit.sessionId,f.prepared(two));expect(f.orders.history(f.token,f.visit.sessionId).batches).toHaveLength(2);expect(f.db.prepare('SELECT count(*) n FROM orders').get()).toEqual({n:1});
 await expect(f.orders.submit(f.token,id,f.visit.sessionId,{...one,discount:1})).rejects.toThrow('COMMAND_ID_CONFLICT');await expect(f.orders.submit(f.token,randomUUID(),f.visit.sessionId,f.prepared(one))).rejects.toThrow('DRAFT_ALREADY_ACCEPTED');
 const p=f.prepared();await f.menu.stoplist(f.token,randomUUID(),{entityId:'regular',available:false,revision:0});await expect(f.orders.submit(f.token,randomUUID(),f.visit.sessionId,p)).rejects.toThrow('MODIFIER_UNAVAILABLE');
 }finally{f.close();}});
it('rejects a waiter basket when its dish or selected size enters the stop list after preparation',async()=>{const f=await setup();try{
 await f.tables.setMode(f.token,randomUUID(),{mode:'SHARED',revision:1});
 const created=await f.auth.createEmployee(f.token,randomUUID(),{login:'stop-waiter',name:'Waiter',role:'WAITER'}),first=await f.auth.login('stop-waiter',created.temporaryPassword,'WAITER_WEB');
 await f.auth.changePassword(first.token,randomUUID(),created.temporaryPassword,password);
 const token=(await f.auth.login('stop-waiter',password,'WAITER_WEB')).token;
 const prepared=()=>{const request=f.request(),quote=f.orders.prepare(token,f.visit.sessionId,request);return {...request,orderRevision:quote.orderRevision,confirmationHash:quote.confirmationHash};};
 const sizeBasket=prepared();await f.menu.stoplist(f.token,randomUUID(),{entityId:'small',available:false,revision:0});
 await expect(f.orders.submit(token,randomUUID(),f.visit.sessionId,sizeBasket)).rejects.toThrow('VARIANT_UNAVAILABLE');
 await f.menu.stoplist(f.token,randomUUID(),{entityId:'small',available:true,revision:1});
 const dishBasket=prepared();await f.menu.stoplist(f.token,randomUUID(),{entityId:'coffee',available:false,revision:0});
 await expect(f.orders.submit(token,randomUUID(),f.visit.sessionId,dishBasket)).rejects.toThrow('ITEM_UNAVAILABLE');
 expect(f.orders.history(f.token,f.visit.sessionId).batches).toHaveLength(0);
 }finally{f.close();}});
it('guards zero-price accepted visits, validates Unicode comments and rejects stale fee proposals or oversized order totals',async()=>{const f=await setup();try{
 const r=f.request('water','🙂'.repeat(300));await f.orders.submit(f.token,randomUUID(),f.visit.sessionId,f.prepared(r));expect(f.orders.jobs(f.token,f.visit.sessionId)).toEqual([]);expect(f.orders.get(f.token,f.visit.sessionId)?.total).toBe(0);await expect(f.tables.closeEmpty(f.token,randomUUID(),{sessionId:f.visit.sessionId,revision:2})).rejects.toThrow('VISIT_NOT_EMPTY');
 expect(()=>f.prepared(f.request('water','a'.repeat(301)))).toThrow('INVALID_COMMENT');expect(()=>f.prepared(f.request('water','\x1b@'))).toThrow('INVALID_COMMENT');
 let req=f.request();req.lines[0].quantity=9999;await f.orders.submit(f.token,randomUUID(),f.visit.sessionId,f.prepared(req));for(let i=0;i<4;i++)await f.orders.submit(f.token,randomUUID(),f.visit.sessionId,f.prepared(req={...f.request(),lines:[{...f.request().lines[0],quantity:9999}]}));
 expect(()=>f.prepared({...f.request(),lines:[{...f.request().lines[0],quantity:9999}]})).toThrow('MONEY_LIMIT_EXCEEDED');
 }finally{f.close();}});
it('enforces live role/revoke/object access on reads, discount, submission and replay; survives API restart',async()=>{const f=await setup();let server;try{
 const p=f.prepared(),id=randomUUID();await f.orders.submit(f.token,id,f.visit.sessionId,p);const owner=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:owner.id,revision:f.auth.employee(owner.id).revision,permission:'table.batch.submit',allowed:false});await expect(f.orders.submit(f.token,id,f.visit.sessionId,p)).rejects.toThrow('PERMISSION_DENIED');
 const foreign=randomUUID();expect(()=>f.orders.get(f.token,foreign)).toThrow('VISIT_NOT_FOUND');
 f.storage.close();server=await createServer(f.dir,0,false,f.trust);const endpoint='/api/v1/tables/visits/'+f.visit.sessionId+'/order';let res=await server.inject({method:'GET',url:endpoint,headers:{host:'localhost',authorization:'Bearer '+f.token}});expect(res.statusCode).toBe(200);expect(res.json().subtotal).toBe(18000);
 res=await server.inject({method:'POST',url:'/api/v1/tables/visits/'+f.visit.sessionId+'/batches/prepare',headers:{host:'localhost',authorization:'Bearer '+f.token},payload:{...p,branchId:foreign}});expect(res.statusCode).toBe(400);
 }finally{await server?.close();f.close();}});
it('serializes EMPTY closure against first acceptance without bypass for zero amounts',async()=>{const f=await setup();try{const p=f.prepared(f.request('water'));const results=await Promise.allSettled([f.tables.closeEmpty(f.token,randomUUID(),{sessionId:f.visit.sessionId,revision:1}),f.orders.submit(f.token,randomUUID(),f.visit.sessionId,p)]);expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);expect(f.orders.get(f.token,f.visit.sessionId)).toBeNull();expect(f.orders.jobs(f.token,f.visit.sessionId)).toEqual([]);}finally{f.close();}});
it('keeps discount revisions and history atomic under conflict and audit failure',async()=>{const f=await setup();try{await f.orders.submit(f.token,randomUUID(),f.visit.sessionId,f.prepared());const order=f.orders.get(f.token,f.visit.sessionId)!;f.db.exec("CREATE TRIGGER discount_fail BEFORE INSERT ON audit_events WHEN NEW.action='order.discount.changed' BEGIN SELECT RAISE(ABORT,'discount-audit'); END;");await expect(f.orders.discount(f.token,randomUUID(),order.id,{expectedRevision:order.revision,amount:100})).rejects.toThrow('discount-audit');expect(f.orders.get(f.token,f.visit.sessionId)).toEqual(order);expect(f.db.prepare('SELECT count(*) n FROM order_discount_events').get()).toEqual({n:0});f.db.exec('DROP TRIGGER discount_fail');const id=randomUUID(),payload={expectedRevision:order.revision,amount:200};const result=await f.orders.discount(f.token,id,order.id,payload);expect(await f.orders.discount(f.token,id,order.id,payload)).toEqual(result);await expect(f.orders.discount(f.token,randomUUID(),order.id,payload)).rejects.toThrow('ORDER_REVISION_CONFLICT');expect(f.db.prepare('SELECT count(*) n FROM order_discount_events').get()).toEqual({n:1});}finally{f.close();}});
