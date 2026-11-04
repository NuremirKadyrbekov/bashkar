// Deploy only after the migration and a private activation signing key exist.
// No CORS: this endpoint is called by the native Local POS Server.
import { loadAuthority, RegistrationError, signRegistration, validateRegistration } from '../_shared/registration.mjs';

const headers = {'content-type':'application/json','cache-control':'no-store'};
const reply = (status:number, body:unknown) => new Response(JSON.stringify(body),{status,headers});
const known = new Set(['BRANCH_ACCESS_DENIED','BRANCH_ALREADY_REGISTERED','REGISTRATION_ID_CONFLICT','REGISTRATION_CONFLICT','INVALID_REGISTRATION']);

Deno.serve(async (request:Request) => {
  try {
    if (request.method !== 'POST') return reply(405,{code:'METHOD_NOT_ALLOWED'});
    if (request.headers.has('origin')) return reply(403,{code:'NATIVE_CLIENT_REQUIRED'});
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply(415,{code:'JSON_REQUIRED'});
    const authorization = request.headers.get('authorization');
    if (!authorization || !/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(authorization)) return reply(401,{code:'CLOUD_LOGIN_REQUIRED'});
    // Service key stays inside the function, never in the installer/Desktop.
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return reply(503,{code:'CLOUD_CONFIGURATION_UNAVAILABLE'});
    // Verify Auth before expensive public-key operations or registry changes.
    const identity = await fetch(`${url}/auth/v1/user`,{headers:{apikey:serviceKey,authorization},signal:AbortSignal.timeout(10000)});
    if (identity.status === 401 || identity.status === 403) return reply(401,{code:'CLOUD_LOGIN_REQUIRED'});
    if (!identity.ok) return reply(503,{code:'CLOUD_AUTH_UNAVAILABLE'});
    const user = await identity.json();
    if (typeof user.id !== 'string' || !user.email_confirmed_at || user.is_anonymous) return reply(403,{code:'CONFIRMED_OWNER_REQUIRED'});
    // Bounded streaming read, even when the client omits Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return reply(400,{code:'INVALID_REGISTRATION'});
    const chunks:Uint8Array[]=[]; let size=0;
    while (true) {
      const {done,value}=await reader.read(); if(done)break;
      size+=value.length; if(size>8192){await reader.cancel();return reply(413,{code:'PAYLOAD_TOO_LARGE'});} chunks.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let input;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply(400,{code:'INVALID_REGISTRATION'});}
    const proof=await validateRegistration(input);
    // Check signer BEFORE committing a registry reservation. A lost response
    // after commit is recovered by the same signed request and registration ID.
    const encodedKey=Deno.env.get('BASHKAR_ACTIVATION_PRIVATE_KEY_B64');
    let privatePem;try{privatePem=encodedKey?atob(encodedKey):undefined;}catch{return reply(503,{code:'ACTIVATION_AUTHORITY_UNAVAILABLE'});}
    const authority=await loadAuthority(privatePem);
    const result=await fetch(`${url}/rest/v1/rpc/register_branch_server`,{
      method:'POST',headers:{apikey:serviceKey,authorization:`Bearer ${serviceKey}`,'content-type':'application/json'},
      body:JSON.stringify({p_owner_id:user.id,p_branch_id:proof.branchId,p_registration_id:proof.registrationId,p_instance_id:proof.instanceId,p_device_hash:proof.devicePublicKeyHash,p_nonce:proof.nonce}),
      signal:AbortSignal.timeout(10000)
    });
    if(!result.ok){
      const failure=await result.json().catch(()=>({}));
      const code=known.has(failure.message)?failure.message:'CLOUD_REGISTRY_UNAVAILABLE';
      return reply(code==='BRANCH_ACCESS_DENIED'?403:code==='INVALID_REGISTRATION'?400:known.has(code)?409:503,{code});
    }
    return reply(200,await signRegistration(await result.json(),authority));
  }catch(error){
    if(error instanceof RegistrationError)return reply(error.status,{code:error.message});
    // No request URL, bearer token, body, key or upstream detail in diagnostics.
    return reply(503,{code:'CLOUD_REGISTRATION_UNAVAILABLE'});
  }
});
