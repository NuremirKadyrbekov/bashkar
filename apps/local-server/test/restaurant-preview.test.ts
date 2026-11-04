import {expect,it} from 'vitest';
import {fixture} from './fixtures/operations';
import {seedRestaurantPreview} from './fixtures/restaurant-preview';
import {TableService} from '../src/modules/tables/table-service';

it('seeds only a fresh disposable preview with published selectable restaurant food, fixed sets and free tables',async()=>{
 const f=await fixture();try{
  expect(await seedRestaurantPreview(f)).toEqual({categories:10,items:60,sets:5,zones:3,tables:21});
  const active=f.menu.active(f.token);expect(active.revision).toBe(1);expect(active.catalog!.items).toHaveLength(60);
  for(const item of active.catalog!.items){
   const choices=item.kind==='SET'?[{variantId:null,optionIds:[],price:item.price!}]:item.combinationPrices!;
   for(const choice of choices){const quote=f.menu.quote(f.token,{menuRevision:1,type:'COUNTER',discount:0,lines:[{itemId:item.id,variantId:choice.variantId,modifierIds:choice.optionIds,quantity:1}]});expect(quote.total).toBe(choice.price);}
  }
  const tables=new TableService(f.db,f.bus,f.auth,f.now).list(f.token);expect(tables.zones.map(z=>z.name).sort()).toEqual(['VIP','Основной зал','Терраса']);expect(tables.tables).toHaveLength(21);expect(tables.tables.every(t=>t.state==='FREE'&&t.active)).toBe(true);expect(tables.settings).toMatchObject({configured:true,mode:'SHARED'});
  expect(()=>f.auth.current(f.token,'shift.open')).not.toThrow();
  for(const table of ['orders','table_sessions','shifts'])expect((f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n).toBe(0);
  await expect(seedRestaurantPreview(f)).rejects.toThrow('PREVIEW_REQUIRES_EMPTY_FIXTURE');expect(f.menu.active(f.token).revision).toBe(1);expect(new TableService(f.db,f.bus,f.auth,f.now).list(f.token).tables).toHaveLength(21);
 }finally{f.close();}
});
