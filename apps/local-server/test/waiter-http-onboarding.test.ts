import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createServer} from '../src/server';
import {fixture} from './fixtures/operations';

it('enables waiter HTTP from the authenticated desktop API and restores the QR URL after restart',async()=>{
 const f=await fixture();f.storage.close();
 const headers={authorization:'Bearer '+f.token};
 let app=await createServer(f.dir,0,false,{...f.trust,fixtureLoopback:true});
 try{
  const initial=await app.inject({url:'/api/v1/waiter/network-status',headers});
  expect(initial.json()).toMatchObject({code:'WEB_UNCONFIGURED',url:null,localIps:expect.arrayContaining(['127.0.0.1'])});
  const denied=await app.inject({method:'POST',url:'/api/v1/waiter/network/http',payload:{ip:'8.8.8.8',port:3002},headers});
  expect(denied.statusCode).toBe(400);
  const configured=await app.inject({method:'POST',url:'/api/v1/waiter/network/http',payload:{ip:'127.0.0.1',port:3002},headers});
  expect(configured.statusCode).toBe(200);
  expect(configured.json()).toMatchObject({mode:'HTTP_MVP',url:'http://127.0.0.1:3002/waiter/'});
  expect(configured.json().qrDataUrl).toMatch(/^data:image\/png;base64,/);
  expect(JSON.parse(readFileSync(f.dir+'/waiter-http.json','utf8'))).toMatchObject({ip:'127.0.0.1',port:3002});
 }finally{await app.close();}
 app=await createServer(f.dir,0,false,{...f.trust,fixtureLoopback:true});
 try{expect((await app.inject({url:'/api/v1/waiter/network-status',headers})).json()).toMatchObject({mode:'HTTP_MVP',url:'http://127.0.0.1:3002/waiter/'});}finally{await app.close();f.close();}
});
