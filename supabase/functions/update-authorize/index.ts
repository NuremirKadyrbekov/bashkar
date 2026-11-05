// Device proof and an online confirmed Owner session are both required.
// Deploy only after the update authorization migration and a separate key.
import { makeUpdateAuthorizeHandler } from '../_shared/update-authorize.mjs';

let handler: ((request: Request) => Promise<Response>) | undefined;
Deno.serve(async (request: Request) => {
 try {
  if (!handler) {
   const url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),encoded=Deno.env.get('BASHKAR_UPDATE_AUTH_PRIVATE_KEY_B64');
   if (!url||!serviceKey||!encoded) throw Error('UPDATE_CLOUD_UNAVAILABLE');
   handler=makeUpdateAuthorizeHandler({privateKeyPem:atob(encoded),keyId:'update-cloud-v1',
    authUser:async (bearer:string)=>{
     const response=await fetch(url+'/auth/v1/user',{headers:{apikey:serviceKey,authorization:bearer},signal:AbortSignal.timeout(10000)});
     if(response.status===401||response.status===403)return null;
     if(!response.ok)throw Error('UPDATE_CLOUD_UNAVAILABLE');
     return response.json();
    },
    rpc:async (name:string,args:unknown)=>{
     const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
     const result=await response.json();
     if(!response.ok)throw Error(typeof result.message==='string'?result.message:'UPDATE_CLOUD_UNAVAILABLE');
     return result;
    }});
  }
  return await handler(request);
 } catch { return new Response(JSON.stringify({code:'UPDATE_CLOUD_UNAVAILABLE'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}}); }
});
