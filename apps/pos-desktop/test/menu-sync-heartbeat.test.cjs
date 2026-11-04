'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const vm=require('node:vm');

test('idle menu does not write a lease; editing renews it and leaving releases it',async()=>{
 const calls=[];
 const context=vm.createContext({me:{permissions:['menu.edit']},screen:'menu',serverSchema:12,menuUi:{root:{isConnected:true,dataset:{}},formDirty:false,view:'catalog',item:null},dirty:false,draft:null,document:{querySelector:()=>null},canMenuEdit:()=>true,api:async(action,payload)=>{calls.push({action,payload});return {};},setInterval:()=>0,el:()=>({}),menuButton:()=>{},lang:'ru',domainMessages:{}});
 vm.runInContext(readFileSync(resolve(__dirname,'../menu-sync-ui.js'),'utf8')+'\nmenuSyncRefresh=async()=>{};',context);
 await vm.runInContext('menuSyncHeartbeat()',context);
 assert.equal(calls.length,0);
 context.menuUi.item='dish';
 await vm.runInContext('menuSyncHeartbeat()',context);
 assert.equal(calls.length,1);assert.equal(calls[0].payload.active,true);
 context.screen='shift';
 await vm.runInContext('menuSyncHeartbeat()',context);
 assert.equal(calls.length,2);assert.equal(calls[1].payload.active,false);
 await vm.runInContext('menuSyncHeartbeat()',context);
 assert.equal(calls.length,2);
});
