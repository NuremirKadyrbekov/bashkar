import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,catalog} from './fixtures/operations';
it('reads immutable published history with paging, keeps drafts separate and checks menu.edit',async()=>{
 const f=await fixture();try{
  const publish=async(price:number,baseRevision:number)=>{const c=catalog();c.items[0].variants[0].price=price;const d=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision,catalog:c});await f.menu.publish(f.token,randomUUID(),d);};
  await publish(18000,0);await publish(19000,1);
  const first=f.menu.revisions(f.token,0,1);expect(first.revisions.map(r=>r.revision)).toEqual([2]);expect(first.next).toBe(2);expect(f.menu.revisions(f.token,2,1).revisions.map(r=>r.revision)).toEqual([1]);
  expect(f.menu.revision(f.token,1).catalog.items[0].variants[0].price).toBe(18000);expect(f.menu.revision(f.token,2).catalog.items[0].variants[0].price).toBe(19000);
  await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:2,catalog:catalog()});expect(f.menu.revisions(f.token).revisions).toHaveLength(2);expect(()=>f.menu.revision(f.token,3)).toThrow('MENU_REVISION_NOT_FOUND');
  const actor=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:actor.id,revision:actor.employee.revision,permission:'menu.edit',allowed:false});expect(()=>f.menu.revisions(f.token)).toThrow();expect(()=>f.menu.revision(f.token,1)).toThrow();
 }finally{f.close();}
});
