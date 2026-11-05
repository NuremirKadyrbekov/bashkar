import {makeUpdateReleaseDownloadHandler} from '../_shared/update-release-download.mjs';
const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const tokenKey=Deno.env.get('BASHKAR_UPDATE_TOKEN_KEY'),pullZoneOrigin=Deno.env.get('BASHKAR_UPDATE_PULL_ZONE_URL');
if(!url||!service||!tokenKey||!pullZoneOrigin)throw Error('UPDATE_CONFIGURATION_UNAVAILABLE');
const authUser=async(authorization:string)=>{const response=await fetch(url+'/auth/v1/user',{headers:{apikey:service,authorization},signal:AbortSignal.timeout(10000)});if(!response.ok)return null;return response.json();};
const rpc=async(name:string,body:Record<string,unknown>)=>{const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:service,authorization:'Bearer '+service,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const value=await response.json().catch(()=>null);if(!response.ok)throw Error(value?.message??'UPDATE_CLOUD_UNAVAILABLE');return value;};
Deno.serve(makeUpdateReleaseDownloadHandler({rpc,authUser,tokenKey,pullZoneOrigin}));
