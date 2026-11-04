import {makePhotoHandler} from '../_shared/menu-photo.mjs';

let handler:((request:Request)=>Promise<Response>)|undefined;
Deno.serve(async request=>{
 try{
  if(!handler){
   const url=Deno.env.get('SUPABASE_URL');
   let service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
   if(!service){try{service=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')??'{}').default;}catch{/* Missing admin credentials are reported below. */}}
   const zone=Deno.env.get('BUNNY_STORAGE_ZONE'),endpoint=Deno.env.get('BUNNY_STORAGE_ENDPOINT'),accessKey=Deno.env.get('BUNNY_STORAGE_ACCESS_KEY'),cdnOrigin=Deno.env.get('BUNNY_PULL_ZONE_URL');
   const missing=Object.entries({SUPABASE_URL:url,SUPABASE_ADMIN_KEY:service,BUNNY_STORAGE_ZONE:zone,BUNNY_STORAGE_ENDPOINT:endpoint,BUNNY_STORAGE_ACCESS_KEY:accessKey,BUNNY_PULL_ZONE_URL:cdnOrigin}).filter(([,value])=>!value).map(([name])=>name);
   if(missing.length){console.error('menu-photo missing configuration names:',missing.join(','));throw Error('PHOTO_CONFIGURATION_MISSING');}
   const rpc=async(name:string,args:Record<string,unknown>)=>{const result=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:service,authorization:`Bearer ${service}`,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});const body=await result.json();if(!result.ok)throw Error(typeof body?.message==='string'?body.message:'PHOTO_CLOUD_UNAVAILABLE');return body;};
   const authUser=async(authorization:string)=>{const result=await fetch(`${url}/auth/v1/user`,{headers:{apikey:service,authorization},signal:AbortSignal.timeout(10000)});if(!result.ok)throw Error('CLOUD_LOGIN_REQUIRED');return result.json();};
   const bunny=async(path:string,data:Uint8Array,key:string,mime:string)=>{const result=await fetch(path,{method:'PUT',headers:{AccessKey:key,'content-type':mime},body:data,signal:AbortSignal.timeout(30000)});return result.ok;};
   const remove=async(path:string,key:string)=>{await fetch(path,{method:'DELETE',headers:{AccessKey:key},signal:AbortSignal.timeout(15000)});};
   handler=makePhotoHandler({rpc,bunny,remove,authUser,config:{zone,endpoint,accessKey,cdnOrigin,ownerOrigin:Deno.env.get('BASHKAR_OWNER_ORIGIN')}});
  }
  return await handler(request);
 }catch(error){const code=error instanceof Error&&error.message==='PHOTO_CONFIGURATION_MISSING'?'PHOTO_CONFIGURATION_MISSING':'PHOTO_CONFIGURATION_INVALID';if(code==='PHOTO_CONFIGURATION_INVALID')console.error('menu-photo initialization failed:',error instanceof Error?error.name:'unknown');return new Response(JSON.stringify({code}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});}
});
