import {catalog} from './operations';
import type {Catalog} from '../../src/modules/menu/catalog';
export function setCatalog():Catalog {
 const c=catalog();
 c.items.push({id:'tea',name:'Чай',translations:{ky:'Чай KY'},categoryId:'drinks',archived:false,available:true,kitchen:true,price:null,pricingMode:'MATRIX',variants:[{id:'tea_small',name:'Маленькая кружка',price:0,available:true}],groups:[{id:'tea_milk',name:'Молоко',min:1,max:1,options:[{id:'tea_with',name:'С молоком',price:0,available:true}]}],combinationPrices:[{id:'tea_small_with',variantId:'tea_small',optionIds:['tea_with'],price:4500,available:true,translations:{ky:'Кичине сүттүү чай'}}]});
 c.items.push({id:'water',name:'Вода',categoryId:'drinks',archived:false,available:true,kitchen:false,price:10000,variants:[],groups:[]});
 c.items.push({id:'set',name:'Сет на двоих',translations:{ky:'Эки адамга сет'},categoryId:'drinks',archived:false,available:true,kitchen:false,kind:'SET',price:60000,variants:[],groups:[],components:[{itemId:'coffee',variantId:'large',modifierIds:['oat'],quantity:2},{itemId:'tea',variantId:'tea_small',modifierIds:['tea_with'],combinationId:'tea_small_with',quantity:1},{itemId:'water',variantId:null,modifierIds:[],quantity:1}]});
 return c;
}
