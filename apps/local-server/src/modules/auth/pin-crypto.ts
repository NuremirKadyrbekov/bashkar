import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PosError, requireCondition } from '../../errors';
export interface PinKeys { get(create:boolean):Buffer }
export const keyFingerprint=(keys:Buffer)=>createHash('sha256').update(keys).digest('hex');
export function pinLookup(keys:Buffer,branch:string,pin:string){return createHmac('sha256',keys.subarray(0,32)).update(JSON.stringify(['pin-lookup-v1',branch,pin])).digest('hex');}
function aad(branch:string,employee:string,version:number){return Buffer.from(JSON.stringify(['pin-aes-gcm-v1',branch,employee,version]));}
export function encryptPin(keys:Buffer,branch:string,employee:string,version:number,pin:string){
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keys.subarray(32),nonce);cipher.setAAD(aad(branch,employee,version));
 return Buffer.concat([nonce,cipher.update(pin),cipher.final(),cipher.getAuthTag()]).toString('base64');
}
export function decryptPin(keys:Buffer,branch:string,employee:string,version:number,value:string){
 try{const data=Buffer.from(value,'base64');requireCondition(data.length===32,'PIN_CIPHERTEXT_INVALID',503);const cipher=createDecipheriv('aes-256-gcm',keys.subarray(32),data.subarray(0,12));cipher.setAAD(aad(branch,employee,version));cipher.setAuthTag(data.subarray(-16));const pin=Buffer.concat([cipher.update(data.subarray(12,-16)),cipher.final()]).toString();requireCondition(/^\d{4}$/.test(pin),'PIN_CIPHERTEXT_INVALID',503);return pin;}
 catch{throw new PosError('PIN_CIPHERTEXT_INVALID',503);}
}
// Keys never leave the server; marker detects loss without silently replacing keys.
export class PlatformPinKeys implements PinKeys {
 private readonly account:string;
 constructor(private readonly dir:string,private readonly namespace:'pin'|'web'|'tls'='pin'){this.account=createHash('sha256').update(resolve(dir)).digest('hex');}
 private file(path:string){const st=lstatSync(path);requireCondition(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1,'PIN_KEYS_UNAVAILABLE',503);}
 private windows(value:string,protect:boolean){
 const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-19'){throw 'IDENTITY'}; $v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::"+(protect?'Protect':'Unprotect')+"($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r));";
 return execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:value,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:20000,maxBuffer:16384}).trim();
 }
 private read(){
 if(process.platform==='darwin')return Buffer.from(execFileSync('/usr/bin/security',['find-generic-password','-a',this.account,'-s','kg.bashkar.local-server.'+this.namespace,'-w'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000}).trim(),'base64');
 if(process.platform==='win32'){const path=join(this.dir,this.namespace+'-keys.dpapi');this.file(path);return Buffer.from(this.windows(readFileSync(path,'utf8'),false),'base64');}
 throw new PosError('PIN_KEYS_UNAVAILABLE',503);
 }
 get(create:boolean){
 try{
 const marker=join(this.dir,this.namespace+'-keys.marker');const marked=existsSync(marker);let keys:Buffer;
 try{keys=this.read();}catch(error){
 const missing=process.platform==='darwin'?(error as {status?:number}).status===44:(error as {code?:string}).code==='ENOENT';
 requireCondition(create&&!marked&&missing,'PIN_KEYS_UNAVAILABLE',503);keys=randomBytes(64);
 if(process.platform==='darwin')execFileSync('/usr/bin/security',['-i'],{input:`add-generic-password -a ${this.account} -s kg.bashkar.local-server.${this.namespace} -w ${keys.toString('base64')}\n`,stdio:['pipe','pipe','pipe'],timeout:20000,maxBuffer:16384});
 else writeFileSync(join(this.dir,this.namespace+'-keys.dpapi'),this.windows(keys.toString('base64'),true),{mode:0o600,flag:'wx',flush:true});
 requireCondition(this.read().equals(keys),'PIN_KEYS_UNAVAILABLE',503);
 }
 requireCondition(keys.length===64,'PIN_KEYS_UNAVAILABLE',503);const fingerprint=keyFingerprint(keys);
 if(marked){this.file(marker);requireCondition(readFileSync(marker,'utf8')===fingerprint,'PIN_KEYS_UNAVAILABLE',503);}
 else{requireCondition(create,'PIN_KEYS_UNAVAILABLE',503);writeFileSync(marker,fingerprint,{mode:0o600,flag:'wx',flush:true});}
 return keys;
 }catch{throw new PosError('PIN_KEYS_UNAVAILABLE',503);}
 }
}
