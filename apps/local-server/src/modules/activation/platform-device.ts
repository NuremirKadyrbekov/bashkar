import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PosError, requireCondition } from '../../errors';
import type { ProtectedDeviceIdentity } from './activation-service';

export interface SigningDeviceIdentity extends ProtectedDeviceIdentity {
  initialize():void;
  sign(message:string):string;
}
// Device private key never enters SQLite, renderer, environment or command args.
// Windows CurrentUser DPAPI runs under LocalService (SID S-1-5-19); directory
// ACL is installed separately. macOS development uses the login Keychain.
export class PlatformDeviceIdentity implements SigningDeviceIdentity {
  private key?:KeyObject;
  private readonly publicPath:string;
  private readonly protectedPath:string;
  private readonly account:string;
  constructor(private readonly dir:string){
    this.publicPath=join(dir,'device-public.pem');this.protectedPath=join(dir,'device-key.dpapi');
    this.account=createHash('sha256').update(resolve(dir)).digest('hex');
  }
  private file(path:string){const stat=lstatSync(path);requireCondition(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1,'DEVICE_STORAGE_INVALID',503);}
  private windows(input:string,protect:boolean){
    const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-19'){throw 'IDENTITY'}; $v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::"+(protect?'Protect':'Unprotect')+"($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r));";
    return execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:20000,maxBuffer:16384}).trim();
  }
  private readPrivate(){
    if(process.platform==='darwin')return Buffer.from(execFileSync('/usr/bin/security',['find-generic-password','-a',this.account,'-s','kg.bashkar.local-server.device','-w'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000}).trim(),'base64').toString('utf8');
    if(process.platform==='win32'){this.file(this.protectedPath);return Buffer.from(this.windows(readFileSync(this.protectedPath,'utf8'),false),'base64').toString('utf8');}
    throw new PosError('PROTECTED_DEVICE_UNSUPPORTED',503);
  }
  initialize(){
    try{
      requireCondition(lstatSync(this.dir).isDirectory()&&!lstatSync(this.dir).isSymbolicLink(),'DEVICE_STORAGE_INVALID',503);
      if(existsSync(this.publicPath)){this.assertAvailable();return;}
      let privatePem:string;
      if(process.platform==='darwin'){
        try{privatePem=this.readPrivate();}
        catch(error){
          // Only "item not found" is a fresh identity. Keychain denial/locking
          // cannot silently replace an existing private key.
          if((error as {status?:number}).status!==44)throw error;
          privatePem=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}).toString();
          const encoded=Buffer.from(privatePem).toString('base64');
          execFileSync('/usr/bin/security',['-i'],{input:`add-generic-password -a ${this.account} -s kg.bashkar.local-server.device -w ${encoded}\n`,stdio:['pipe','pipe','pipe'],timeout:20000,maxBuffer:16384});
          // security interactive mode may return zero after a command fails.
          requireCondition(this.readPrivate()===privatePem,'DEVICE_KEY_PROTECTION_FAILED',503);
        }
      }else if(process.platform==='win32'){
        if(existsSync(this.protectedPath))privatePem=this.readPrivate();
        else{
          privatePem=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}).toString();
          const protectedValue=this.windows(Buffer.from(privatePem).toString('base64'),true);
          writeFileSync(this.protectedPath,protectedValue,{mode:0o600,flag:'wx',flush:true});
        }
      }else throw new PosError('PROTECTED_DEVICE_UNSUPPORTED',503);
      const key=createPrivateKey(privatePem);requireCondition(key.asymmetricKeyType==='ed25519','DEVICE_KEY_INVALID',503);
      writeFileSync(this.publicPath,createPublicKey(key).export({type:'spki',format:'pem'}),{mode:0o600,flag:'wx',flush:true});
      this.assertAvailable();
    }catch(error){if(error instanceof PosError)throw error;throw new PosError('PROTECTED_DEVICE_UNAVAILABLE',503);}
  }
  assertAvailable(){
    try{
      this.file(this.publicPath);
      if(!this.key)this.key=createPrivateKey(this.readPrivate());
      requireCondition(this.key.asymmetricKeyType==='ed25519'&&createPublicKey(this.key).export({type:'spki',format:'pem'}).toString()===readFileSync(this.publicPath,'utf8'),'DEVICE_KEY_MISMATCH',503);
    }catch(error){if(error instanceof PosError)throw error;throw new PosError('PROTECTED_DEVICE_UNAVAILABLE',503);}
  }
  publicKey(){this.assertAvailable();return createPublicKey(this.key!).export({type:'spki',format:'pem'}).toString();}
  sign(message:string){this.assertAvailable();return sign(null,Buffer.from(message),this.key!).toString('base64url');}
}
