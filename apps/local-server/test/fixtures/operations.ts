// Test-only fixture: not imported by the runtime or shipped as an activation path.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { Storage } from '../../src/storage';
import { canonical, CommandBus, digest } from '../../src/command-bus';
import { ActivationService } from '../../src/modules/activation/activation-service';
import { AuthService } from '../../src/modules/auth/auth-service';
import { MenuService } from '../../src/modules/menu/menu-service';
import { ShiftService } from '../../src/modules/shifts/shift-service';
import type { Catalog } from '../../src/modules/menu/catalog';
export const password='correct horse battery staple';
export function blankFixture() {
 const dir=mkdtempSync(join(tmpdir(),'bashkar-ops-')); const storage=new Storage(dir);storage.initialize();storage.open();const db=storage.connection();
 const authority=generateKeyPairSync('ed25519'),device=generateKeyPairSync('ed25519');
 const trust={authority:{publicKey:authority.publicKey.export({format:'pem',type:'spki'}).toString()},device:{publicKey:()=>device.publicKey.export({format:'pem',type:'spki'}).toString(),assertAvailable:()=>{},sign:(message:string)=>sign(null,Buffer.from(message),device.privateKey).toString('base64url')}};
 let time=Date.now();const now=()=>time;
 const activation=new ActivationService(db,trust.authority,trust.device,now);
 const instance=db.prepare('SELECT id FROM bootstrap_instance').get() as {id:string};
 const claims={version:1 as const,instanceId:instance.id,branchId:randomUUID(),organizationId:randomUUID(),ownerCloudId:randomUUID(),registrationId:randomUUID(),devicePublicKeyHash:digest(trust.device.publicKey()),nonce:randomUUID(),issuedAt:time-1000,expiresAt:time+60000};
 const receipt={claims,signature:sign(null,Buffer.from(canonical(claims)),authority.privateKey).toString('base64url')};
 return {dir,storage,db,trust,activation,claims,receipt,now,advance:(ms:number)=>{time+=ms;},close:()=>{storage.close();rmSync(dir,{recursive:true,force:true});}};
}
export async function fixture() {
 const f=blankFixture();await f.activation.activate(f.receipt,{login:'owner',name:'Owner',password},f.claims.nonce);
 const bus=new CommandBus(f.db,f.now);const auth=new AuthService(f.db,bus,f.claims.branchId,f.now);
 const token=(await auth.login('owner',password,'POS')).token;
 return {...f,bus,auth,token,menu:new MenuService(f.db,bus,auth,f.now),shifts:new ShiftService(f.db,bus,auth,f.now)};
}
export function catalog():Catalog {return {mainLanguage:'ru',languages:['ru','ky','en'],categories:[{id:'drinks',name:'Напитки',archived:false}],items:[{id:'coffee',categoryId:'drinks',name:'Кофе',archived:false,available:true,kitchen:true,price:null,variants:[{id:'small',name:'250 мл',price:18000,available:true},{id:'large',name:'400 мл',price:23000,available:true}],groups:[{id:'milk',name:'Молоко',min:1,max:1,options:[{id:'oat',name:'Овсяное',price:4000,available:true},{id:'regular',name:'Обычное',price:0,available:true}]}]}]};}
