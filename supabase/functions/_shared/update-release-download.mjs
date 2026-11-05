const encoder=new TextEncoder(),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
const exact=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...names].sort().join(',');
function canonical(value){if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isSafeInteger(value))return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';throw Error('UPDATE_REQUEST_INVALID');}
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const from64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const pemBytes=pem=>from64(pem.replace(/-----[^-]+-----|\s/g,''));
const sha256=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
export function makeUpdateReleaseDownloadHandler({rpc,authUser,tokenKey,pullZoneOrigin,now=Date.now}){
 return async request=>{
  try{
   if(request.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
   if(request.headers.has('origin'))return reply(403,{code:'NATIVE_CLIENT_REQUIRED'});
   if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply(415,{code:'JSON_REQUIRED'});
   const bearer=request.headers.get('authorization');if(!bearer||!/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(bearer))return reply(401,{code:'CLOUD_LOGIN_REQUIRED'});
   const user=await authUser(bearer);if(!user||!uuid.test(user.id)||!user.email_confirmed_at||user.is_anonymous)return reply(403,{code:'CONFIRMED_OWNER_REQUIRED'});
   const url=new URL(pullZoneOrigin);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password||typeof tokenKey!=='string'||tokenKey.length<32)throw Error('UPDATE_CONFIGURATION_UNAVAILABLE');
   const reader=request.body?.getReader();if(!reader)return reply(400,{code:'UPDATE_REQUEST_INVALID'});let size=0,parts=[];for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8192){await reader.cancel();return reply(413,{code:'PAYLOAD_TOO_LARGE'});}parts.push(part.value);}let input;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(parts.flatMap(part=>[...part]))));}catch{return reply(400,{code:'UPDATE_REQUEST_INVALID'});}
   if(!exact(input,['format','action','releaseId','branchId','instanceId','registrationId','nonce','issuedAt','devicePublicKey','deviceSignature'])||input.format!==1||input.action!=='DOWNLOAD'||!['branchId','instanceId','registrationId','nonce'].every(k=>uuid.test(input[k]))||typeof input.releaseId!=='string'||!/^[a-z0-9_-]{1,80}$/.test(input.releaseId)||typeof input.devicePublicKey!=='string'||input.devicePublicKey.length>2048||typeof input.deviceSignature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(input.deviceSignature)||!Number.isSafeInteger(input.issuedAt)||Math.abs(now()-input.issuedAt)>30000)return reply(400,{code:'UPDATE_REQUEST_INVALID'});
   const {devicePublicKey,deviceSignature,...proof}=input;let key;try{key=await crypto.subtle.importKey('spki',pemBytes(devicePublicKey),{name:'Ed25519'},false,['verify']);}catch{return reply(403,{code:'UPDATE_DEVICE_DENIED'});}
   if(!await crypto.subtle.verify('Ed25519',key,from64(deviceSignature),encoder.encode(canonical(proof))))return reply(403,{code:'UPDATE_DEVICE_DENIED'});
   const deviceHash=await sha256(devicePublicKey);
   const row=await rpc('update_get_release_download',{p_owner:user.id,p_registration:input.registrationId,p_branch:input.branchId,p_instance:input.instanceId,p_device_hash:deviceHash,p_release:input.releaseId});
   const path=row?.storagePath;if(typeof path!=='string'||!new RegExp(`^updates/${input.releaseId}/[0-9a-f-]{36}/Bashkar(?:-POS|POS)-Setup-[A-Za-z0-9._-]+\\.exe$`).test(path)||row.releaseId!==input.releaseId||typeof row.manifestSha256!=='string'||!/^([0-9a-f]{64})$/.test(row.manifestSha256)||typeof row.artifactSha256!=='string'||!/^([0-9a-f]{64})$/.test(row.artifactSha256)||!Number.isSafeInteger(row.sizeBytes)||row.sizeBytes<1||!row.signedRelease)throw Error('UPDATE_CLOUD_RESPONSE_INVALID');
   const expires=Math.floor(now()/1000)+300,relative='/'+path;
   const hmacKey=await crypto.subtle.importKey('raw',encoder.encode(tokenKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const signature=await crypto.subtle.sign('HMAC',hmacKey,encoder.encode(relative+expires));
   const downloadUrl=`${url.origin}${relative}?token=HS256-${b64(signature)}&expires=${expires}`;
   return reply(200,{releaseId:row.releaseId,signedRelease:row.signedRelease,manifestSha256:row.manifestSha256,artifactSha256:row.artifactSha256,sizeBytes:row.sizeBytes,downloadUrl,expiresAt:expires*1000});
  }catch(error){const code=['UPDATE_REQUEST_INVALID','UPDATE_DEVICE_DENIED','UPDATE_OWNER_DENIED','UPDATE_RELEASE_DENIED'].includes(error?.message)?error.message:'UPDATE_CLOUD_UNAVAILABLE';return reply(code==='UPDATE_DEVICE_DENIED'||code==='UPDATE_OWNER_DENIED'||code==='UPDATE_RELEASE_DENIED'?403:code==='UPDATE_REQUEST_INVALID'?400:503,{code});}
 };
}
