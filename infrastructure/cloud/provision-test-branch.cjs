// Administrative test provisioning. CLI service key is consumed in memory only;
// it is never logged, persisted, sent to clients or included in distributions.
const {execFileSync}=require('node:child_process');
const {readFileSync,writeFileSync,existsSync}=require('node:fs');
const {resolve}=require('node:path');
const {randomUUID}=require('node:crypto');
const root=resolve(__dirname,'../..');
const config=JSON.parse(readFileSync(resolve(root,'config/cloud.public.json'),'utf8'));
const [cli,email,organizationName='BASHKAR.KG',branchName='Тестовый филиал',profile='default']=process.argv.slice(2);
if(!/^[a-z0-9][a-z0-9-]{0,31}$/.test(profile))throw Error('INVALID_PROVISIONING_PROFILE');
const statePath=resolve(root,profile==='default'?'.env.cloud-bootstrap.local':'.env.cloud-bootstrap.'+profile+'.local');
async function main(){
 if(!cli||!email||!/^\S+@\S+\.\S+$/.test(email)||config.projectRef!=='veghvtxwhtvocpuvmrlr')throw Error('INVALID_PROVISIONING_INPUT');
 let keys;try{keys=JSON.parse(execFileSync(cli,['projects','api-keys','--project-ref',config.projectRef,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024}));}catch{throw Error('CLOUD_ADMIN_ACCESS_UNAVAILABLE');}
 const key=keys.find(k=>k.name==='service_role')?.api_key;
 if(!key)throw Error('CLOUD_ADMIN_KEY_UNAVAILABLE');
 async function api(path,options={}){
  const response=await fetch(config.url+path,{...options,headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('CLOUD_PROVISIONING_HTTP_'+response.status);
  return response.status===204?null:response.json();
 }
 let user;
 for(let page=1;page<=100;page++){
  const result=await api('/auth/v1/admin/users?page='+page+'&per_page=100');
  user=result.users?.find(u=>u.email?.toLowerCase()===email.toLowerCase());
  if(user||result.users?.length<100)break;
 }
 if(!user?.id||!user.email_confirmed_at||user.is_anonymous)throw Error('CONFIRMED_OWNER_NOT_FOUND');
 let state;
 if(existsSync(statePath)){
  state=JSON.parse(readFileSync(statePath,'utf8'));
  if(state.projectRef!==config.projectRef||state.ownerId!==user.id||state.organizationName!==organizationName||state.branchName!==branchName)throw Error('PROVISIONING_STATE_MISMATCH');
 }else{
  const existing=await api('/rest/v1/organizations?select=id&owner_id=eq.'+encodeURIComponent(user.id)+'&name=eq.'+encodeURIComponent(organizationName));
  if(existing.length>1)throw Error('AMBIGUOUS_ORGANIZATION');
  const organizationId=existing[0]?.id??randomUUID();
  const branches=existing.length?await api('/rest/v1/branches?select=id&organization_id=eq.'+organizationId+'&name=eq.'+encodeURIComponent(branchName)):[];
  if(branches.length>1)throw Error('AMBIGUOUS_BRANCH');
  state={projectRef:config.projectRef,ownerId:user.id,organizationId,branchId:branches[0]?.id??randomUUID(),organizationName,branchName};
  writeFileSync(statePath,JSON.stringify(state)+'\n',{mode:0o600,flag:'wx'});
 }
 for(const [table,row] of [['organizations',{id:state.organizationId,owner_id:user.id,name:organizationName}],['branches',{id:state.branchId,organization_id:state.organizationId,name:branchName}]]){
  await api('/rest/v1/'+table,{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(row)});
  const saved=await api('/rest/v1/'+table+'?select=*&id=eq.'+row.id);
  if(saved.length!==1||Object.entries(row).some(([k,v])=>saved[0][k]!==v))throw Error('PROVISIONING_VERIFICATION_FAILED');
 }
 const registrations=await api('/rest/v1/server_registrations?select=id&branch_id=eq.'+state.branchId+'&status=eq.ACTIVE');
 console.log(JSON.stringify({projectRef:config.projectRef,ownerConfirmed:true,organizationId:state.organizationId,branchId:state.branchId,organizationName,branchName,activated:registrations.length>0}));
}
main().catch(error=>{console.error(/^[A-Z_0-9]+$/.test(error.message)?error.message:'CLOUD_PROVISIONING_FAILED');process.exitCode=1;});
