// Portable Edge handler. Service credentials and request secrets never enter logs.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();
class AdminError extends Error{constructor(code,status=400){super(code);this.status=status;}}
const fail=(ok,code,status)=>{if(!ok)throw new AdminError(code,status);};
const known=new Set(['PLATFORM_ADMIN_REQUIRED','ADMIN_RATE_LIMITED','INVALID_PROVISIONING','INVALID_BRANCHES','INVALID_BRANCH','INVALID_PAGE','ADMIN_COMMAND_CONFLICT','OWNER_EMAIL_IN_USE','OWNER_AUTH_NOT_READY','ADMIN_COMMAND_NOT_FOUND','ORGANIZATION_NOT_FOUND','BRANCH_NAME_USED']);
function fields(input,keys){fail(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===keys.length&&keys.every(k=>Object.hasOwn(input,k)),'INVALID_REQUEST');}
function name(value){fail(typeof value==='string'&&[...value.trim()].length>=1&&[...value.trim()].length<=200&&!/[\u0000-\u001f\u007f]/u.test(value),'INVALID_NAME');return value.trim();}
function password(value){fail(typeof value==='string'&&[...value].length>=12&&encoder.encode(value).length<=256&&!/^(.)\1+$/u.test(value)&&!['password1234','password12345','123456789012','qwerty123456','admin1234567','bashkar123456'].includes(value.toLowerCase()),'PASSWORD_POLICY');return value;}
async function proof(value,id){const key=await crypto.subtle.importKey('raw',encoder.encode(value),'PBKDF2',false,['deriveBits']);const result=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode('bashkar-admin-password-v1:'+id),iterations:210000},key,256);return Array.from(new Uint8Array(result),v=>v.toString(16).padStart(2,'0')).join('');}
async function read(request){const reader=request.body?.getReader();fail(reader,'INVALID_REQUEST');const chunks=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>16384){await reader.cancel();throw new AdminError('PAYLOAD_TOO_LARGE',413);}chunks.push(value);}const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AdminError('INVALID_REQUEST');}}
export function createPlatformAdminHandler({env,network=fetch}){
 return async request=>{
 const origin=request.headers.get('origin');const allowed=(env('BASHKAR_ADMIN_ORIGINS')??'').split(',').map(s=>s.trim()).filter(Boolean);
 const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin'};
 const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers});
 try{
 fail(!origin||allowed.includes(origin),'ORIGIN_DENIED',403);if(origin)headers['access-control-allow-origin']=origin;
 if(request.method==='OPTIONS'){headers['access-control-allow-methods']='POST';headers['access-control-allow-headers']='authorization,apikey,content-type';headers['access-control-max-age']='600';return new Response(null,{status:204,headers});}
 fail(request.method==='POST','METHOD_NOT_ALLOWED',405);fail(request.headers.get('content-type')?.split(';')[0].trim()==='application/json','JSON_REQUIRED',415);
 const authorization=request.headers.get('authorization');fail(authorization&&/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(authorization),'CLOUD_LOGIN_REQUIRED',401);
 const url=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY');fail(url&&service,'CLOUD_CONFIGURATION_UNAVAILABLE',503);
 const api=async(path,body,method='POST')=>{
 let response;try{response=await network(url+path,{method,headers:{apikey:service,authorization:'Bearer '+service,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}catch{throw new AdminError('CLOUD_ADMIN_UNAVAILABLE',503);}
 const data=await response.json().catch(()=>null);return {ok:response.ok,status:response.status,data};
 };
 const rpc=async(action,body)=>{const r=await api('/rest/v1/rpc/'+action,body);if(!r.ok){const code=known.has(r.data?.message)?r.data.message:'CLOUD_ADMIN_UNAVAILABLE';throw new AdminError(code,code==='PLATFORM_ADMIN_REQUIRED'?403:code==='ADMIN_RATE_LIMITED'?429:code.startsWith('INVALID_')?400:['ADMIN_COMMAND_CONFLICT','OWNER_EMAIL_IN_USE','BRANCH_NAME_USED'].includes(code)?409:503);}return r.data;};
 let identity;try{identity=await network(url+'/auth/v1/user',{headers:{apikey:service,authorization},signal:AbortSignal.timeout(10000)});}catch{throw new AdminError('CLOUD_AUTH_UNAVAILABLE',503);}
 if(identity.status===401||identity.status===403)throw new AdminError('CLOUD_LOGIN_REQUIRED',401);fail(identity.ok,'CLOUD_AUTH_UNAVAILABLE',503);
 const user=await identity.json();fail(typeof user.id==='string'&&user.email_confirmed_at&&!user.is_anonymous,'CONFIRMED_ADMIN_REQUIRED',403);
 await rpc('platform_admin_assert',{p_actor:user.id});
 const input=await read(request);fail(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_REQUEST');
 if(input.action==='snapshot'){fields(input,['action','offset']);fail(Number.isSafeInteger(input.offset)&&input.offset>=0&&input.offset<=100000,'INVALID_PAGE');return reply(200,{...await rpc('platform_admin_snapshot',{p_actor:user.id,p_offset:input.offset}),admin:{id:user.id,email:user.email}});}
 if(input.action==='addBranch'){fields(input,['action','commandId','organizationId','name']);fail(uuid.test(input.commandId)&&uuid.test(input.organizationId),'INVALID_REQUEST');return reply(200,await rpc('platform_admin_add_branch',{p_actor:user.id,p_command:input.commandId,p_organization:input.organizationId,p_name:name(input.name)}));}
 fail(input.action==='createOwner','INVALID_REQUEST');fields(input,['action','commandId','email','name','organization','branches','password']);fail(uuid.test(input.commandId),'INVALID_REQUEST');
 fail(typeof input.email==='string'&&input.email.trim().length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()),'INVALID_EMAIL');fail(Array.isArray(input.branches)&&input.branches.length>=1&&input.branches.length<=20,'INVALID_BRANCHES');
 const branches=input.branches.map(name);fail(new Set(branches.map(v=>v.toLowerCase())).size===branches.length,'INVALID_BRANCHES');
 const payload={email:input.email.trim().toLowerCase(),name:name(input.name),organization:name(input.organization),branches},secret=password(input.password);
 const prepared=await rpc('platform_admin_prepare',{p_actor:user.id,p_command:input.commandId,p_payload:payload,p_proof:await proof(secret,input.commandId)});
 if(prepared.status==='DONE')return reply(200,prepared.result);
 // A lost create-user response is recovered only by the precommitted UUID/tag.
 let auth=await api('/auth/v1/admin/users/'+prepared.ownerId,undefined,'GET');
 if(auth.status===404){
 const created=await api('/auth/v1/admin/users',{id:prepared.ownerId,email:payload.email,password:secret,email_confirm:true,user_metadata:{name:payload.name},app_metadata:{bashkar_provisioning:input.commandId}});
 if(!created.ok){auth=await api('/auth/v1/admin/users/'+prepared.ownerId,undefined,'GET');if(!auth.ok)throw new AdminError(created.status===422?'OWNER_EMAIL_IN_USE':'PROVISIONING_PENDING',created.status===422?409:503);}else auth=created;
 }
 fail(auth.ok,'PROVISIONING_PENDING',503);const owner=auth.data?.user??auth.data;
 fail(owner.id===prepared.ownerId&&owner.email?.toLowerCase()===payload.email&&owner.app_metadata?.bashkar_provisioning===input.commandId&&owner.email_confirmed_at,'OWNER_AUTH_NOT_READY',503);
 return reply(200,await rpc('platform_admin_finish',{p_actor:user.id,p_command:input.commandId}));
 }catch(error){return reply(error instanceof AdminError?error.status:503,{code:error instanceof AdminError?error.message:'CLOUD_ADMIN_UNAVAILABLE'});}
 };
}
