const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const config=JSON.parse(readFileSync(resolve(__dirname,'../../config/cloud.public.json'),'utf8'));
async function main(){
  if(config.url!==`https://${config.projectRef}.supabase.co` || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey))throw Error('CLOUD_PUBLIC_CONFIG_INVALID');
  const response=await fetch(`${config.url}/auth/v1/settings`,{headers:{apikey:config.publishableKey},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`CLOUD_AUTH_HTTP_${response.status}`);
  const settings=await response.json();
  console.log(JSON.stringify({projectRef:config.projectRef,authReachable:true,emailEnabled:settings.external?.email===true,activationVerified:false}));
}
main().catch(error=>{console.error(/^[A-Z_0-9]+$/.test(error.message)?error.message:'CLOUD_CONNECTIVITY_FAILED');process.exitCode=1;});
