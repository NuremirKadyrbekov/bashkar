import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {catalog,fixture} from './fixtures/operations';
import {validateCatalog} from '../src/modules/menu/catalog';
import {priceLine} from '../src/modules/menu/pricing';

function menu(){const c=catalog();c.items[0].containerId='container';c.items.push({id:'container',name:'Контейнер',categoryId:'drinks',archived:false,available:true,kitchen:false,isPackaging:true,price:null,variants:[],groups:[],pricingMode:'MATRIX',combinationPrices:[{id:'container_standard',variantId:null,optionIds:[],price:1500,available:true}]});return c;}

it('marks packaging explicitly and rejects ordinary, archived, recursive and self-linked targets',()=>{
 expect(validateCatalog(menu()).items[1].isPackaging).toBe(true);
 expect(validateCatalog(catalog()).items[0].isPackaging).toBeUndefined();
 const unmarked=menu();delete unmarked.items[1].isPackaging;expect(()=>validateCatalog(unmarked)).toThrow('INVALID_CONTAINER_TARGET');
 const archived=menu();archived.items[1].archived=true;expect(()=>validateCatalog(archived)).toThrow('INVALID_CONTAINER_TARGET');
 archived.items[0].archived=true;expect(()=>validateCatalog(archived)).not.toThrow();
 const recursive=menu();recursive.items[1].containerId='coffee';expect(()=>validateCatalog(recursive)).toThrow('INVALID_CONTAINER');
 const self=menu();self.items[0].containerId='coffee';expect(()=>validateCatalog(self)).toThrow('INVALID_CONTAINER');
 const flagged=menu();flagged.items[0].isPackaging=true;expect(()=>validateCatalog(flagged)).toThrow('INVALID_CONTAINER');
 const invalidFlag=menu();(invalidFlag.items[1] as unknown as {isPackaging:string}).isPackaging='true';expect(()=>validateCatalog(invalidFlag)).toThrow('INVALID_BOOLEAN');
});

it('keeps packaging optional, separately priced and subject to stop-list in real server commands',async()=>{
 const f=await fixture();try{
  const c=menu(),draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog:c});
  expect(f.menu.active(f.token).revision).toBe(0);await f.menu.publish(f.token,randomUUID(),draft);
  const dish={itemId:'coffee',variantId:'small',modifierIds:['regular'],quantity:2},container={itemId:'container',variantId:null,modifierIds:[],quantity:2};
  for(const type of ['TABLE','COUNTER'] as const){const quote=f.menu.quote(f.token,{menuRevision:1,type,lines:[dish],discount:0});expect(quote.lines).toHaveLength(1);expect(quote.total).toBe(36000);}
  const packaged=f.menu.quote(f.token,{menuRevision:1,type:'COUNTER',lines:[dish,container],discount:0});expect(packaged.total).toBe(39000);expect(packaged.lines[1]).toMatchObject({isPackaging:true,unitPrice:1500});
  await f.menu.stoplist(f.token,randomUUID(),{entityId:'container_standard',available:false,revision:0});
  expect(()=>f.menu.quote(f.token,{menuRevision:1,type:'COUNTER',lines:[dish,container],discount:0})).toThrow('COMBINATION_UNAVAILABLE');
  expect(f.menu.quote(f.token,{menuRevision:1,type:'COUNTER',lines:[dish],discount:0}).total).toBe(36000);
  const changed=menu();changed.items[1].isPackaging=false;await expect(f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:1,catalog:changed})).rejects.toThrow('INVALID_CONTAINER_TARGET');
  expect(f.menu.active(f.token).revision).toBe(1);
  expect(priceLine(validateCatalog(menu()),1,container).isPackaging).toBe(true);
 }finally{f.close();}
});
