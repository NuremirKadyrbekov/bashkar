'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const vm=require('node:vm');

test('stop-list ignores unrelated events, coalesces menu changes and resyncs on gaps/reconnect',async()=>{
 let listener,reads=0;
 const document={hidden:false,addEventListener(){}};
 const context=vm.createContext({window:{pos:{onChanged(callback){listener=callback;}}},document,screen:'stopList',setTimeout,clearTimeout,api:async()=>{reads++;return {catalog:{categories:[],items:[]},availability:{}};},handleError(error){throw error;}});
 vm.runInContext(readFileSync(resolve(__dirname,'../stop-list.js'),'utf8')+'\nstopListDraw=()=>{};',context);
 const wait=()=>new Promise(resolve=>setTimeout(resolve,100));
 listener({type:'changed',epoch:'one',seq:0,scope:'orders'});await wait();assert.equal(reads,0);
 listener({type:'sync'});listener({type:'ready',epoch:'one',seq:0});await wait();assert.equal(reads,1);
 for(let seq=1;seq<=10;seq++)listener({type:'changed',epoch:'one',seq,scope:'orders'});
 await wait();assert.equal(reads,1);
 for(let seq=11;seq<=20;seq++)listener({type:'changed',epoch:'one',seq,scope:'menu'});
 await wait();assert.equal(reads,2);
 listener({type:'changed',epoch:'one',seq:22,scope:'orders'});await wait();assert.equal(reads,3);
 listener({type:'sync'});listener({type:'ready',epoch:'two',seq:0});await wait();assert.equal(reads,4);
 listener({type:'unknown'});await wait();assert.equal(reads,5);
});
