const encoder = new TextEncoder();
const headers = {'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const exact = (value,names) => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join(',') === [...names].sort().join(',');
function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isSafeInteger(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 throw Error('UPDATE_REQUEST_INVALID');
}
const from64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const to64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const pemBytes=pem=>from64(pem.replace(/-----[^-]+-----|\s/g,''));
const sha256=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
function reply(status,codeOrBody){return new Response(JSON.stringify(typeof codeOrBody==='string'?{code:codeOrBody}:codeOrBody),{status,headers});}

export function makeUpdateAuthorizeHandler({rpc,authUser,privateKeyPem,keyId='update-cloud-v1'}){
 let signing;
 const signingKey=()=>signing??=crypto.subtle.importKey('pkcs8',pemBytes(privateKeyPem),{name:'Ed25519'},false,['sign']);
 return async request=>{
  try{
   if(request.method!=='POST')return reply(405,'METHOD_NOT_ALLOWED');
   if(request.headers.has('origin'))return reply(403,'NATIVE_CLIENT_REQUIRED');
   if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply(415,'JSON_REQUIRED');
   const bearer=request.headers.get('authorization');
   if(!bearer||!/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(bearer))return reply(401,'CLOUD_LOGIN_REQUIRED');
   const user=await authUser(bearer);
   if(!user||!uuid(user.id)||!user.email_confirmed_at||user.is_anonymous)return reply(403,'CONFIRMED_OWNER_REQUIRED');
   await signingKey();
   const reader=request.body?.getReader();if(!reader)return reply(400,'UPDATE_REQUEST_INVALID');
   let size=0;const parts=[];for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8192){await reader.cancel();return reply(413,'PAYLOAD_TOO_LARGE');}parts.push(part.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   const input=JSON.parse(new TextDecoder().decode(bytes));
   const names=['format','action','operationId','branchId','instanceId','registrationId','actorId','releaseId','manifestSha256','artifactSha256','nonce','devicePublicKey','deviceSignature'];
   if(!exact(input,names)||input.format!==1||input.action!=='INSTALL'||!['operationId','branchId','instanceId','registrationId','actorId','nonce'].every(key=>uuid(input[key]))||typeof input.releaseId!=='string'||!/^[a-z0-9_-]{1,80}$/.test(input.releaseId)||!hash(input.manifestSha256)||!hash(input.artifactSha256)||typeof input.devicePublicKey!=='string'||input.devicePublicKey.length>2048||typeof input.deviceSignature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(input.deviceSignature))return reply(400,'UPDATE_REQUEST_INVALID');
   const deviceHash=await sha256(input.devicePublicKey);
   const key=await crypto.subtle.importKey('spki',pemBytes(input.devicePublicKey),{name:'Ed25519'},false,['verify']);
   const {devicePublicKey,deviceSignature,...proof}=input;
   if(!await crypto.subtle.verify('Ed25519',key,from64(deviceSignature),encoder.encode(canonical(proof))))return reply(403,'UPDATE_DEVICE_DENIED');
   const result=await rpc('update_issue_install_grant',{p_owner:user.id,p_registration:input.registrationId,p_branch:input.branchId,p_instance:input.instanceId,p_device_hash:deviceHash,p_actor:input.actorId,p_operation:input.operationId,p_release:input.releaseId,p_manifest_hash:input.manifestSha256,p_artifact_hash:input.artifactSha256,p_nonce:input.nonce});
   for(const name of ['operationId','branchId','instanceId','registrationId','actorId','releaseId','manifestSha256','artifactSha256','nonce'])if(result?.[name]!==input[name])throw Error('UPDATE_CLOUD_RESPONSE_INVALID');
   if(!Number.isSafeInteger(result.issuedAt)||!Number.isSafeInteger(result.expiresAt)||result.expiresAt-result.issuedAt!==60000)throw Error('UPDATE_CLOUD_RESPONSE_INVALID');
   const claims={format:1,action:'INSTALL',keyId,operationId:result.operationId,branchId:result.branchId,instanceId:result.instanceId,registrationId:result.registrationId,actorId:result.actorId,releaseId:result.releaseId,manifestSha256:result.manifestSha256,artifactSha256:result.artifactSha256,issuedAt:result.issuedAt,expiresAt:result.expiresAt,nonce:result.nonce,requiresClosedShift:true,requiresBackup:true};
   const signature=to64(await crypto.subtle.sign('Ed25519',await signingKey(),encoder.encode(canonical(claims))));
   return reply(200,{claims,signature});
  }catch(error){
   const known=['UPDATE_REQUEST_INVALID','UPDATE_DEVICE_DENIED','UPDATE_OWNER_DENIED','UPDATE_RELEASE_DENIED','UPDATE_OPERATION_REPLAY'];
   const code=known.includes(error?.message)?error.message:'UPDATE_CLOUD_UNAVAILABLE';
   return reply(code==='UPDATE_OPERATION_REPLAY'?409:code==='UPDATE_OWNER_DENIED'||code==='UPDATE_DEVICE_DENIED'||code==='UPDATE_RELEASE_DENIED'?403:code==='UPDATE_REQUEST_INVALID'?400:503,code);
  }
 };
}
