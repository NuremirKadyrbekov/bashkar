// No client bearer/session token is trusted: registered-device proof on every operation.
import {makeMenuHandler} from '../_shared/menu-sync.mjs';
let handler:((request:Request)=>Promise<Response>)|undefined;
Deno.serve(async(request:Request)=>{
 try{
  if(!handler){const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),encoded=Deno.env.get('BASHKAR_MENU_PRIVATE_KEY_B64');if(!url||!key||!encoded)throw Error('UNCONFIGURED');handler=makeMenuHandler({privateKeyPem:atob(encoded),rpc:async(name:string,args:unknown)=>{const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});const result=await r.json();if(!r.ok)throw Error(typeof result.message==='string'?result.message:'MENU_CLOUD_UNAVAILABLE');return result;}});}
  return await handler(request);
 }catch{return new Response(JSON.stringify({code:'MENU_CLOUD_UNAVAILABLE'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});}
});
