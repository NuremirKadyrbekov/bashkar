// Sample data exclusively for disposable development preview/tests, never runtime initialization.
import {randomUUID} from 'node:crypto';
import type {Catalog,Item,SetComponent} from '../../src/modules/menu/catalog';
import {TableService} from '../../src/modules/tables/table-service';
import type {fixture} from './operations';

type PreviewFixture=Awaited<ReturnType<typeof fixture>>;
export function restaurantPreviewCatalog():Catalog {
 const categories=[['rolls','Суши и роллы'],['pizza','Пицца'],['hot','Горячие блюда'],['soups','Супы'],['salads','Салаты'],['snacks','Закуски'],['desserts','Десерты'],['drinks','Напитки'],['sets','Сеты'],['packaging','Упаковка']].map(([id,name])=>({id,name,archived:false}));
 const items:Item[]=[];
 const simple=(id:string,categoryId:string,name:string,price:number,kitchen=true):Item=>{const item:Item={id,categoryId,name,archived:false,available:true,kitchen,price:null,variants:[],groups:[],pricingMode:'MATRIX',combinationPrices:[{id:id+'_standard',variantId:null,optionIds:[],price:price*100,available:true}]};items.push(item);return item;};
 const dishes=(category:string,rows:[string,string,number][],kitchen=true)=>rows.forEach(([id,name,price])=>simple(id,category,name,price,kitchen));
 dishes('rolls',[
  ['philadelphia','Филадельфия',490],['california','Калифорния',420],['dragon','Дракон',580],['baked_salmon','Запечённый с лососем',460],['baked_chicken','Запечённый с курицей',350],['tempura_shrimp','Темпура с креветкой',480],['salmon_maki','Маки с лососем',260],['cucumber_maki','Маки с огурцом',180],['salmon_nigiri','Нигири с лососем — 2 шт.',220],['shrimp_nigiri','Нигири с креветкой — 2 шт.',240]
 ]);
 for(const [id,name,prices] of [
  ['margherita','Маргарита',[290,390,490]],['pepperoni','Пепперони',[390,540,690]],['four_cheese','Четыре сыра',[420,590,750]],['chicken_mushroom','Курица и грибы',[390,550,690]],['bbq','Барбекю',[450,620,790]],['seafood_pizza','Морская',[490,690,890]],['vegetarian','Овощная',[320,450,590]],['hawaiian','Гавайская',[370,520,670]]
 ] as [string,string,number[]][]){const item=simple(id,'pizza',name,0);item.variants=[25,30,35].map(n=>({id:id+'_'+n,name:n+' см',price:0,available:true}));item.groups=[{id:id+'_dough',name:'Тесто',min:1,max:1,options:['Тонкое','Классическое'].map((name,n)=>({id:id+'_dough_'+n,name,price:0,available:true}))}];item.combinationPrices=item.variants.flatMap((v,n)=>item.groups[0].options.map(o=>({id:v.id+'_'+o.id,variantId:v.id,optionIds:[o.id],price:prices[n]*100,available:true})));item.description='Моцарелла, фирменный соус и начинка по рецепту. Размер и тесто выбираются при заказе.';}
 dishes('hot', [['chicken_teriyaki','Курица терияки с рисом',390],['beef_wok','Вок с говядиной',440],['chicken_wok','Вок с курицей',350],['shrimp_wok','Вок с креветками',490],['carbonara','Паста карбонара',420],['salmon_rice','Лосось с рисом',690]]);
 dishes('soups',[['tom_yum','Том ям с креветками',490],['miso','Мисо-суп',190],['ramen','Рамен с курицей',380],['mushroom_soup','Грибной крем-суп',290]]);
 dishes('salads',[['caesar_chicken','Цезарь с курицей',340],['caesar_shrimp','Цезарь с креветками',440],['greek','Греческий салат',290],['chuka','Салат чука',250]]);
 dishes('snacks',[['fries','Картофель фри',160],['wedges','Картофельные дольки',180],['nuggets','Наггетсы — 6 шт.',220],['cheese_sticks','Сырные палочки',260],['onion_rings','Луковые кольца',190]]);
 dishes('desserts',[['cheesecake','Чизкейк',240],['tiramisu','Тирамису',280],['brownie','Брауни',230],['mochi','Моти — 2 шт.',260],['ice_cream','Мороженое',150]]);
 dishes('drinks',[['water','Вода 500 мл',70],['cola','Кола 500 мл',110],['lemonade','Домашний лимонад 400 мл',160],['orange_juice','Апельсиновый сок 250 мл',150],['apple_juice','Яблочный сок 250 мл',130],['green_tea','Зелёный чай — чайник',180],['black_tea','Чёрный чай — чайник',180]],false);
 for(const [id,name,prices] of [['cappuccino','Капучино',[[180,220,230],[230,270,280]]],['latte','Латте',[[190,230,240],[240,280,290]]]] as [string,string,number[][]][]){const item=simple(id,'drinks',name,0);item.variants=[250,400].map(n=>({id:id+'_'+n,name:n+' мл',price:0,available:true}));item.groups=[{id:id+'_milk',name:'Молоко',min:1,max:1,options:['Обычное','Овсяное','Миндальное'].map((name,n)=>({id:id+'_milk_'+n,name,price:0,available:true}))}];item.combinationPrices=item.variants.flatMap((v,n)=>item.groups[0].options.map((o,m)=>({id:v.id+'_'+o.id,variantId:v.id,optionIds:[o.id],price:prices[n][m]*100,available:true})));}
 const tea=simple('milk_tea','drinks','Чай с выбором молока',0);tea.variants=['Маленькая кружка','Большая кружка'].map((name,n)=>({id:'milk_tea_size_'+n,name,price:0,available:true}));tea.groups=[{id:'milk_tea_choice',name:'Молоко',min:1,max:1,options:['С молоком','Без молока'].map((name,n)=>({id:'milk_tea_milk_'+n,name,price:0,available:true}))}];tea.combinationPrices=tea.variants.flatMap((v,n)=>tea.groups[0].options.map((o,m)=>({id:v.id+'_'+o.id,variantId:v.id,optionIds:[o.id],price:[[45,40],[80,65]][n][m]*100,available:true})));
 for(const [id,name,price] of [['box_roll','Контейнер для роллов',15],['box_pizza','Коробка для пиццы',25],['box_hot','Контейнер для горячего',20]] as [string,string,number][]){const item=simple(id,'packaging',name,price,false);item.isPackaging=true;}
 for(const item of items){if(['rolls','hot','soups','salads','snacks','pizza'].includes(item.categoryId))item.containerId=item.categoryId==='pizza'?'box_pizza':item.categoryId==='rolls'?'box_roll':'box_hot';}
 const component=(id:string,quantity:number,size=0,option=0):SetComponent=>{const item=items.find(i=>i.id===id)!,row=item.combinationPrices!.find(r=>r.variantId===(item.variants[size]?.id??null)&&(!item.groups.length||r.optionIds[0]===item.groups[0].options[option].id))!;return {itemId:id,quantity,variantId:row.variantId,modifierIds:[...row.optionIds],combinationId:row.id};};
 const set=(id:string,name:string,price:number,components:SetComponent[],containerId:string)=>items.push({id,name,categoryId:'sets',archived:false,available:true,kitchen:true,kind:'SET',price:price*100,variants:[],groups:[],components,containerId,description:'Фиксированный состав. Указана конечная цена всего сета; упаковка предлагается отдельно только на вынос.'});
 set('set_classic','Сет «Классика»',990,[component('philadelphia',1),component('california',1),component('cucumber_maki',1)],'box_roll');
 set('set_party','Сет «Большая компания»',2190,[component('philadelphia',2),component('california',2),component('baked_chicken',1),component('cucumber_maki',2)],'box_roll');
 set('set_pizza_two','Две пиццы 30 см',850,[component('pepperoni',1,1),component('margherita',1,1)],'box_pizza');
 set('set_lunch','Обед с воком',590,[component('chicken_wok',1),component('miso',1),component('water',1)],'box_hot');
 set('set_family','Семейный сет',1290,[component('chicken_mushroom',1,1),component('baked_chicken',1),component('fries',2),component('cola',2)],'box_hot');
 return {mainLanguage:'ru',languages:['ru','ky','en'],categories,items};
}

export async function seedRestaurantPreview(f:PreviewFixture){
 const tables=new TableService(f.db,f.bus,f.auth,f.now);
 if(f.menu.active(f.token).revision!==0||tables.list(f.token).tables.length||tables.list(f.token).zones.length)throw new Error('PREVIEW_REQUIRES_EMPTY_FIXTURE');
 const catalog=restaurantPreviewCatalog();
 const draft=await f.menu.saveDraft(f.token,randomUUID(),{draftId:null,draftRevision:0,baseRevision:0,catalog});await f.menu.publish(f.token,randomUUID(),draft);
 const actor=f.auth.current(f.token);await f.auth.setPermission(f.token,randomUUID(),{employeeId:actor.id,revision:f.auth.employee(actor.id).revision,permission:'shift.open',allowed:true});
 await tables.setMode(f.token,randomUUID(),{revision:0,mode:'STRICT'});
 let tableCount=0;
 for(const [name,prefix,count] of [['Основной зал','',12],['Терраса','Т',6],['VIP','VIP ',3]] as [string,string,number][]){const zone=await tables.saveZone(f.token,randomUUID(),{zoneId:null,revision:0,name,active:true});for(let n=1;n<=count;n++){await tables.saveTable(f.token,randomUUID(),{tableId:null,zoneId:zone.id,revision:0,name:prefix+n,active:true});tableCount++;}}
 return {categories:catalog.categories.length,items:catalog.items.length,sets:catalog.items.filter(i=>i.kind==='SET').length,zones:3,tables:tableCount};
}
