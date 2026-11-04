import {createHash,randomUUID} from 'node:crypto';
import type {Server,IncomingMessage} from 'node:http';
import type {Socket} from 'node:net';
import type {AuthService} from './modules/auth/auth-service';
import {hasPermission} from './modules/auth/permissions';
import type {ChangeScope} from './realtime-scope';

type Client={socket:Socket;token:string;branchId:string};
const frame=(value:string)=>{const data=Buffer.from(value);const header=data.length<126?Buffer.from([0x81,data.length]):Buffer.from([0x81,126,data.length>>8,data.length&255]);return Buffer.concat([header,data]);};
export function createRealtime(server:Server,auth:()=>AuthService|undefined){
 const clients=new Set<Client>();
 const epoch=randomUUID(),sequences=new Map<string,number>();
 const reject=(socket:Socket)=>{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');};
 const upgrade=(request:IncomingMessage,socket:Socket)=>{
  const protocols=(request.headers['sec-websocket-protocol']??'').split(',').map(v=>v.trim());
  const token=protocols.find(v=>v.startsWith('token.'))?.slice(6),key=request.headers['sec-websocket-key'];
  if(request.url!=='/api/v1/events'||!/^((127\.0\.0\.1)|(localhost))(:\d+)?$/.test(request.headers.host??'')||request.headers.origin||request.headers.upgrade?.toLowerCase()!=='websocket'||request.headers['sec-websocket-version']!=='13'||!protocols.includes('bashkar.events')||!token||!/^[-_A-Za-z0-9]{43}$/.test(token)||typeof key!=='string'||Buffer.from(key,'base64').length!==16){reject(socket);return;}
  let branchId:string;
  try{const service=auth();if(!service)throw Error();const actor=service.current(token,undefined,true);if(!['LOCAL_ADMIN','CASHIER_POS'].includes(actor.audience)||!hasPermission(service.db,actor.employee,'table.view_status'))throw Error();branchId=actor.branchId;}catch{reject(socket);return;}
  const accept=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\nSec-WebSocket-Protocol: bashkar.events\r\n\r\n');
  const client={socket,token,branchId};clients.add(client);socket.write(frame(JSON.stringify({type:'ready',epoch,seq:sequences.get(branchId)??0})));socket.setTimeout(0);socket.on('close',()=>clients.delete(client));socket.on('error',()=>clients.delete(client));
  // Client messages never carry business operations. They only close the channel.
  socket.on('data',data=>{if((data[0]&15)===8)socket.end();});
 };
 server.on('upgrade',upgrade);
 return {publish(branchId:string,scope:ChangeScope='full'){const seq=(sequences.get(branchId)??0)+1;sequences.set(branchId,seq);const message=JSON.stringify({type:'changed',serverTime:Date.now(),epoch,seq,scope});for(const client of clients){if(client.branchId!==branchId)continue;try{const service=auth();if(!service)throw Error();const actor=service.current(client.token,undefined,true);if(!['LOCAL_ADMIN','CASHIER_POS'].includes(actor.audience)||!hasPermission(service.db,actor.employee,'table.view_status'))throw Error();client.socket.write(frame(message));}catch{client.socket.destroy();clients.delete(client);}}},close(){server.off('upgrade',upgrade);for(const client of clients)client.socket.destroy();clients.clear();}};
}
