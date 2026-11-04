import {makePublicMenuHandler} from '../_shared/public-menu.mjs';
let handler:((request:Request)=>Promise<Response>)|undefined;
Deno.serve(async request=>{
 try{
  if(!handler){const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),cdnOrigin=Deno.env.get('BUNNY_PULL_ZONE_URL');if(!url||!key||!cdnOrigin)throw Error('PUBLIC_MENU_UNCONFIGURED');
   handler=makePublicMenuHandler({cdnOrigin,rpc:async(name:string,args:unknown)=>{const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});const result=await response.json();if(!response.ok)throw Error(typeof result?.message==='string'?result.message:'PUBLIC_MENU_UNAVAILABLE');return result;}});}
  return await handler(request);
 }catch{return new Response(JSON.stringify({code:'PUBLIC_MENU_UNAVAILABLE'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*'}});}
});
