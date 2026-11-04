// Explicit remote integration test. Creates isolated QA Auth users/org/branch;
// never signs in as or mutates the real Owner/branch. Exact created IDs only.
const {execFileSync}=require('node:child_process');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {generateKeyPairSync,randomUUID,randomBytes,createHash,sign,verify}=require('node:crypto');
const root=resolve(__dirname,'../..');
const config=JSON.parse(readFileSync(resolve(root,'config/cloud.public.json'),'utf8'));
const authority=readFileSync(resolve(root,'config/activation-authority.public.pem'),'utf8');
function canonical(v){if(v===null||typeof v!=='object')return JSON.stringify(v);return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
async function main(){
 const cli=process.argv[2];if(!cli||config.projectRef!=='veghvtxwhtvocpuvmrlr')throw Error('CLOUD_QA_PROJECT_REQUIRED');
 let keys;try{keys=JSON.parse(execFileSync(cli,['projects','api-keys','--project-ref',config.projectRef,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch{throw Error('CLOUD_QA_ADMIN_UNAVAILABLE');}
 const adminKey=keys.find(k=>k.name==='service_role')?.api_key;if(!adminKey)throw Error('CLOUD_QA_ADMIN_UNAVAILABLE');
 const org=randomUUID(),branch=randomUUID(),run=randomUUID(),users=[],createdBranches=[];let orgCreated=false;
 async function api(path,{method='GET',body,token=adminKey,admin=true}={}){
  const response=await fetch(config.url+path,{method,headers:{apikey:admin?adminKey:config.publishableKey,authorization:'Bearer '+token,'content-type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const data=response.status===204?null:await response.json().catch(()=>null);return {status:response.status,data};
 }
 function expect(ok,code){if(!ok)throw Error(code);}
 function payload(){
  const device=generateKeyPairSync('ed25519'),devicePublicKey=device.publicKey.export({type:'spki',format:'pem'}).toString();
  const proof={version:1,registrationId:randomUUID(),branchId:branch,instanceId:randomUUID(),devicePublicKeyHash:createHash('sha256').update(devicePublicKey).digest('hex'),nonce:randomBytes(32).toString('base64url')};
  const {devicePublicKeyHash,...fields}=proof;
  return {...fields,devicePublicKey,deviceSignature:sign(null,Buffer.from(canonical(proof)),device.privateKey).toString('base64url')};
 }
 try{
  const tokens=[],accounts=[];
  for(let i=0;i<2;i++){
   const email=`bashkar-qa-${run}-${i}@example.com`,password=randomBytes(24).toString('base64url');
   accounts.push({email,password});
   const created=await api('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true,user_metadata:{bashkar_qa_run:run}}});
   expect(created.status===200&&created.data?.id,'CLOUD_QA_CREATE_USER_FAILED');users.push(created.data.id);
   const login=await api('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},token:config.publishableKey,admin:false});
   expect(login.status===200&&login.data?.access_token,'CLOUD_QA_LOGIN_FAILED');tokens.push(login.data.access_token);
  }
  const organization=await api('/rest/v1/organizations',{method:'POST',body:{id:org,owner_id:users[0],name:'QA isolated '+run}});expect(organization.status===201,'CLOUD_QA_ORGANIZATION_FAILED');orgCreated=true;
  const location=await api('/rest/v1/branches',{method:'POST',body:{id:branch,organization_id:org,name:'QA isolated '+run}});expect(location.status===201,'CLOUD_QA_BRANCH_FAILED');createdBranches.push(branch);
  const foreign=await api('/rest/v1/branches?select=id&id=eq.'+branch,{token:tokens[1],admin:false});expect(foreign.status===200&&foreign.data.length===0,'CLOUD_QA_RLS_FAILED');
  const input=payload();
  const denied=await api('/functions/v1/register-server',{method:'POST',body:input,token:tokens[1],admin:false});expect(denied.status===403&&denied.data?.code==='BRANCH_ACCESS_DENIED','CLOUD_QA_FOREIGN_OWNER_FAILED');
  const first=await api('/functions/v1/register-server',{method:'POST',body:input,token:tokens[0],admin:false});
  expect(first.status===200&&first.data?.claims?.ownerCloudId===users[0]&&first.data?.claims?.branchId===branch,'CLOUD_QA_REGISTRATION_FAILED');
  expect(verify(null,Buffer.from(canonical(first.data.claims)),authority,Buffer.from(first.data.signature,'base64url')),'CLOUD_QA_SIGNATURE_FAILED');
  console.log(JSON.stringify({receiptIssuedUtc:new Date(first.data.claims.issuedAt).toISOString(),localUtc:new Date().toISOString(),receiptExpiresInMs:first.data.claims.expiresAt-Date.now()}));
  const replay=await api('/functions/v1/register-server',{method:'POST',body:input,token:tokens[0],admin:false});expect(replay.status===200&&canonical(replay.data)===canonical(first.data),'CLOUD_QA_REPLAY_FAILED');
  const other=await api('/functions/v1/register-server',{method:'POST',body:payload(),token:tokens[0],admin:false});expect(other.status===409&&other.data?.code==='BRANCH_ALREADY_REGISTERED','CLOUD_QA_SECOND_SERVER_FAILED');
  const rows=await api('/rest/v1/server_registrations?select=id&branch_id=eq.'+branch);expect(rows.status===200&&rows.data.length===1,'CLOUD_QA_DUPLICATE_FAILED');
  if(process.argv[3]==='--desktop'){
   const desktopBranch=randomUUID();
   const made=await api('/rest/v1/branches',{method:'POST',body:{id:desktopBranch,organization_id:org,name:'QA Desktop '+run}});expect(made.status===201,'CLOUD_QA_DESKTOP_BRANCH_FAILED');createdBranches.push(desktopBranch);
   await require('./desktop-scenario.cjs')({email:accounts[0].email,cloudPassword:accounts[0].password,branchId:desktopBranch,localPassword:randomBytes(24).toString('base64url')});
  }
  console.log(JSON.stringify({projectRef:config.projectRef,remoteCloudQa:'PASS',ownerPasswordLogin:true,foreignOwnerRejected:true,rls:true,signedDeviceRegistration:true,replay:true,secondServerRejected:true,realBranchActivated:false}));
 }finally{
  for(const createdBranch of createdBranches){
   expect((await api('/rest/v1/activation_audit?branch_id=eq.'+createdBranch,{method:'DELETE'})).status===200,'CLOUD_QA_CLEANUP_AUDIT_FAILED');
   expect((await api('/rest/v1/server_registrations?branch_id=eq.'+createdBranch,{method:'DELETE'})).status===200,'CLOUD_QA_CLEANUP_REGISTRY_FAILED');
   expect((await api('/rest/v1/branches?id=eq.'+createdBranch,{method:'DELETE'})).status===200,'CLOUD_QA_CLEANUP_BRANCH_FAILED');
  }
  if(orgCreated)expect((await api('/rest/v1/organizations?id=eq.'+org,{method:'DELETE'})).status===200,'CLOUD_QA_CLEANUP_ORG_FAILED');
  for(const id of users)expect((await api('/auth/v1/admin/users/'+id,{method:'DELETE'})).status===200,'CLOUD_QA_CLEANUP_USER_FAILED');
  console.log('CLOUD_QA_FIXTURES_REMOVED');
 }
}
main().catch(error=>{console.error(/^[A-Z_0-9]+$/.test(error.message)?error.message:'CLOUD_QA_FAILED');process.exitCode=1;});
