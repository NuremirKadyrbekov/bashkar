const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const itemId=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(value);
const bytes=value=>new TextEncoder().encode(value);
const hex=value=>[...new Uint8Array(value)].map(n=>n.toString(16).padStart(2,'0')).join('');
const digest=async value=>hex(await crypto.subtle.digest('SHA-256',value));
const from64=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const keyBytes=pem=>from64(pem.replace(/-----[^-]+-----|\s/g,''));
const json=(status,body,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const fail=(condition,code,status=400)=>{if(!condition)throw Object.assign(Error(code),{status});};
const mimeExtension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
function validMagic(data,mime){
 if(mime==='image/jpeg')return data.length>3&&data[0]===255&&data[1]===216&&data[2]===255;
 if(mime==='image/png')return data.length>8&&[137,80,78,71,13,10,26,10].every((b,i)=>data[i]===b);
 if(mime==='image/webp')return data.length>12&&String.fromCharCode(...data.slice(0,4))==='RIFF'&&String.fromCharCode(...data.slice(8,12))==='WEBP';
 return false;
}
async function readImage(request){
 const reader=request.body?.getReader();fail(reader,'PHOTO_EMPTY');let size=0;const chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10485760){await reader.cancel();fail(false,'PHOTO_TOO_LARGE',413);}chunks.push(value);}
 fail(size>0,'PHOTO_EMPTY');const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
export function makePhotoHandler({rpc,bunny,remove=async()=>{},authUser,config,now=Date.now}){
 const zone=config.zone,endpoint=new URL(config.endpoint),cdn=new URL(config.cdnOrigin);
 fail(/^[a-zA-Z0-9_-]{1,80}$/.test(zone)&&endpoint.protocol==='https:'&&endpoint.pathname==='/'&&!endpoint.search&&!endpoint.hash&&!endpoint.username&&cdn.protocol==='https:'&&cdn.pathname==='/'&&!cdn.search&&!cdn.hash&&!cdn.username,'PHOTO_CONFIGURATION_UNAVAILABLE',503);
 return async request=>{
  const origin=request.headers.get('origin'),cors=origin&&origin===config.ownerOrigin?{'access-control-allow-origin':origin,'vary':'Origin'}:{};
  try{
   if(origin&&origin!==config.ownerOrigin)fail(false,'PHOTO_ORIGIN_DENIED',403);
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'access-control-allow-methods':'GET, POST, DELETE, OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-photo-grant,x-branch-id,x-item-id,x-expected-revision','access-control-max-age':'600'}});
   fail(['GET','POST','DELETE'].includes(request.method),'METHOD_NOT_ALLOWED',405);
   const operation=request.method==='GET'?'READ':request.method==='DELETE'?'REMOVE':'UPLOAD';
   const mime=request.headers.get('content-type')?.split(';')[0]?.trim();if(operation==='UPLOAD')fail(Object.hasOwn(mimeExtension,mime),'PHOTO_TYPE_UNSUPPORTED',415);
   let branchId,item,actorId,expectedRevision;
   const grantHeader=request.headers.get('x-photo-grant');
   if(grantHeader){
    fail(!origin&&grantHeader.length<4096,'PHOTO_GRANT_INVALID',403);
    let grant;try{grant=JSON.parse(new TextDecoder().decode(from64(grantHeader)));}catch{fail(false,'PHOTO_GRANT_INVALID',403);}
    const p=grant?.payload;
    fail(p&&Object.keys(p).sort().join(',')==='actorId,branchId,expectedRevision,expiresAt,instanceId,itemId,nonce,operation,registrationId'&&p.operation===operation&&uuid(p.branchId)&&uuid(p.instanceId)&&uuid(p.registrationId)&&uuid(p.actorId)&&uuid(p.nonce)&&itemId(p.itemId)&&Number.isSafeInteger(p.expectedRevision)&&p.expectedRevision>=0&&Number.isSafeInteger(p.expiresAt)&&p.expiresAt>now()&&p.expiresAt<=now()+120000&&typeof grant.publicKey==='string'&&grant.publicKey.length<2048&&typeof grant.signature==='string','PHOTO_GRANT_INVALID',403);
    const device=await rpc('menu_device_assert',{p_registration:p.registrationId});
    fail(device.branchId===p.branchId&&device.instanceId===p.instanceId&&device.registrationId===p.registrationId&&device.deviceHash===await digest(bytes(grant.publicKey)),'PHOTO_DEVICE_DENIED',403);
    const key=await crypto.subtle.importKey('spki',keyBytes(grant.publicKey),{name:'Ed25519'},false,['verify']);
    fail(await crypto.subtle.verify('Ed25519',key,from64(grant.signature),bytes(JSON.stringify(p))),'PHOTO_GRANT_INVALID',403);
    branchId=p.branchId;item=p.itemId;actorId=p.actorId;expectedRevision=p.expectedRevision;
    await rpc('menu_photo_claim',{p_branch:branchId,p_registration:p.registrationId,p_nonce:p.nonce,p_item:item,p_operation:operation,p_expires_ms:p.expiresAt});
   }else{
    const auth=request.headers.get('authorization');fail(auth?.startsWith('Bearer '),'CLOUD_LOGIN_REQUIRED',401);
    const user=await authUser(auth);fail(uuid(user?.id)&&user.email_confirmed_at&&!user.is_anonymous,'CLOUD_LOGIN_REQUIRED',401);
    branchId=request.headers.get('x-branch-id');item=request.headers.get('x-item-id');expectedRevision=Number(request.headers.get('x-expected-revision'));actorId=user.id;
    fail(uuid(branchId)&&itemId(item)&&(operation==='READ'||request.headers.has('x-expected-revision')&&Number.isSafeInteger(expectedRevision)&&expectedRevision>=0),'PHOTO_REQUEST_INVALID');
    fail(await rpc('menu_photo_owner',{p_branch:branchId,p_owner:actorId}),'PHOTO_OWNER_DENIED',403);
    fail(await rpc('menu_photo_item_exists',{p_branch:branchId,p_item:item}),'PHOTO_ITEM_UNPUBLISHED',409);
   }
   if(operation==='READ'){const current=await rpc('menu_photo_current',{p_branch:branchId,p_item:item});return json(200,{itemId:item,itemRevision:current.itemRevision,photoRevision:current.photoRevision,url:current.objectKey?`${cdn.origin}/${current.objectKey}`:null},cors);}
   if(operation==='REMOVE'){const removed=await rpc('menu_photo_remove',{p_branch:branchId,p_item:item,p_expected:expectedRevision,p_actor:actorId});return json(200,{...removed,itemId:item,url:null},cors);}
   const data=await readImage(request);fail(validMagic(data,mime),'PHOTO_INVALID_IMAGE',415);
   const hash=await digest(data),assetId=crypto.randomUUID(),key=`menu/${branchId}/${assetId}/${hash}.${mimeExtension[mime]}`;
   const storagePath=`${endpoint.origin}/${zone}/${key}`;
   const uploaded=await bunny(storagePath,data,config.accessKey,mime);
   fail(uploaded,'PHOTO_STORAGE_UNAVAILABLE',503);
   let result;try{result=await rpc('menu_photo_commit',{p_branch:branchId,p_item:item,p_asset:assetId,p_key:key,p_mime:mime,p_size:data.length,p_hash:hash,p_actor:actorId,p_expected:expectedRevision});}catch(error){try{await remove(storagePath,config.accessKey);}catch{/* Orphan cleanup can be retried from Cloud metadata/operational logs. */}throw error;}
   return json(200,{...result,itemId:item,url:`${cdn.origin}/${key}`},cors);
  }catch(error){const known=new Set(['PHOTO_ORIGIN_DENIED','PHOTO_GRANT_INVALID','PHOTO_DEVICE_DENIED','PHOTO_GRANT_EXPIRED','PHOTO_ITEM_UNPUBLISHED','PHOTO_REVISION_CONFLICT','PHOTO_TYPE_UNSUPPORTED','PHOTO_TOO_LARGE','PHOTO_EMPTY','PHOTO_INVALID_IMAGE','PHOTO_REQUEST_INVALID','PHOTO_OWNER_DENIED','PHOTO_STORAGE_UNAVAILABLE','CLOUD_LOGIN_REQUIRED','METHOD_NOT_ALLOWED']);const code=known.has(error?.message)?error.message:'PHOTO_CLOUD_UNAVAILABLE';return json(error?.status??(code==='PHOTO_ITEM_UNPUBLISHED'||code==='PHOTO_REVISION_CONFLICT'?409:code==='PHOTO_CLOUD_UNAVAILABLE'?503:400),{code},cors);}
 };
}
