import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,password} from './fixtures/operations';
import {CashDraftService,assertCurrentCashDraft} from '../src/modules/orders/cash-draft-service';

it('keeps independent cashier baskets, rejects stale writes and replays the same save',async()=>{
 const f=await fixture();try{
  for(const permission of ['shift.open','counter.view','counter.batch.submit'] as const)await f.auth.setPermission(f.token,randomUUID(),{employeeId:f.auth.current(f.token).id,revision:f.auth.employee(f.auth.current(f.token).id).revision,permission,allowed:true});
  await f.shifts.open(f.token,randomUUID(),'owner',password);
  let changed=0;const service=new CashDraftService(f.auth,()=>{changed++;}),a=randomUUID(),b=randomUUID(),draft=(name:string)=>({id:randomUUID(),lines:[{lineId:randomUUID(),itemId:name,variantId:null,modifierIds:[],quantity:1,comment:''}],discount:0,menuRevision:1,cashMeta:{mode:'COUNTER' as const,tableId:null,waiterId:null}});
  const one=draft('coffee'),two=draft('tea'),command=randomUUID();
  const saved=service.save(f.token,{id:a,expectedRevision:0,commandId:command,draft:one});expect(saved.revision).toBe(1);
  const actor=f.auth.current(f.token);const submission={draftId:one.id,lines:one.lines,discount:one.discount,menuRevision:one.menuRevision};
  expect(()=>assertCurrentCashDraft(f.db,actor,saved.shiftId,'COUNTER',submission)).not.toThrow();
  expect(()=>assertCurrentCashDraft(f.db,actor,saved.shiftId,'COUNTER',{...submission,lines:two.lines})).toThrow('DRAFT_REVISION_CONFLICT');
  expect(service.save(f.token,{id:a,expectedRevision:0,commandId:command,draft:one})).toEqual(saved);expect(changed).toBe(1);
  service.save(f.token,{id:b,expectedRevision:0,commandId:randomUUID(),draft:two});expect(service.list(f.token).map(row=>row.id).sort()).toEqual([a,b].sort());
  expect(()=>service.save(f.token,{id:a,expectedRevision:0,commandId:randomUUID(),draft:two})).toThrow('DRAFT_REVISION_CONFLICT');
  expect(service.get(f.token,a).draft.lines).toEqual(one.lines);
  vi.spyOn(Date,'now').mockReturnValue(saved.createdAt+1000);
  const updated=service.save(f.token,{id:a,expectedRevision:1,commandId:randomUUID(),draft:one});
  expect(updated.createdAt).toBe(saved.createdAt);expect(updated.updatedAt).toBe(saved.createdAt+1000);
  expect(()=>f.db.prepare('UPDATE cash_drafts SET created_at=created_at+1 WHERE id=?').run(a)).toThrow('IMMUTABLE_DRAFT_CREATION');
  expect(service.discard(f.token,a,2)).toEqual({discarded:true});expect(service.list(f.token).map(row=>row.id)).toEqual([b]);expect(changed).toBe(4);
 }finally{vi.restoreAllMocks();f.close();}
});
