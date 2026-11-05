import {createHash,randomUUID} from 'node:crypto';
import {closeSync,fsyncSync,linkSync,lstatSync,openSync,readFileSync,readdirSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {canonical} from '../command-bus';
import type {AuthorizedUpdate,SignedInstallGrant} from './update-authorization';
import {validateReleaseManifest,type SignedRelease} from './release-verifier';

const name='update-job.json',tempPrefix='.update-job-';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,hash=/^[0-9a-f]{64}$/;
export type UpdateJob={format:1;operationId:string;actorId:string;manifestSha256:string;grantSha256:string;signedRelease:SignedRelease;signedGrant:SignedInstallGrant;createdAt:string};
function directory(path:string){const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('UPDATE_JOB_DIRECTORY_INVALID');if(process.platform!=='win32'&&(stat.mode&0o077)!==0)throw Error('UPDATE_JOB_DIRECTORY_UNSAFE');const real=realpathSync(path);if(process.platform==='win32'&&(!process.env.ProgramData||real.toLowerCase()!==resolve(process.env.ProgramData,'BashkarPOS','config').toLowerCase()))throw Error('UPDATE_JOB_DIRECTORY_INVALID');return real;}
function syncDirectory(path:string){if(process.platform==='win32')return;const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function sha(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex');}
const exact=(value:unknown,names:string[])=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...names].sort().join(',');
function validated(value:unknown):UpdateJob{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('UPDATE_JOB_INVALID');const row=value as Record<string,unknown>;if(Object.keys(row).sort().join(',')!=='actorId,createdAt,format,grantSha256,manifestSha256,operationId,signedGrant,signedRelease'||row.format!==1||typeof row.operationId!=='string'||!uuid.test(row.operationId)||typeof row.actorId!=='string'||!uuid.test(row.actorId)||typeof row.manifestSha256!=='string'||!hash.test(row.manifestSha256)||typeof row.grantSha256!=='string'||!hash.test(row.grantSha256)||typeof row.createdAt!=='string'||Number.isNaN(Date.parse(row.createdAt)))throw Error('UPDATE_JOB_INVALID');const release=row.signedRelease as SignedRelease,grant=row.signedGrant as SignedInstallGrant;if(!exact(release,['manifest','signature'])||!exact(grant,['claims','signature'])||!exact(grant.claims,['format','action','keyId','operationId','branchId','instanceId','registrationId','actorId','releaseId','manifestSha256','artifactSha256','issuedAt','expiresAt','nonce','requiresClosedShift','requiresBackup'])||typeof release.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(release.signature)||typeof grant.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(grant.signature))throw Error('UPDATE_JOB_INVALID');try{validateReleaseManifest(release.manifest);}catch{throw Error('UPDATE_JOB_INVALID');}if(grant.claims.operationId!==row.operationId||grant.claims.actorId!==row.actorId||grant.claims.manifestSha256!==row.manifestSha256||release.manifest.releaseId!==grant.claims.releaseId||sha(release.manifest)!==row.manifestSha256||sha(grant)!==row.grantSha256)throw Error('UPDATE_JOB_INVALID');return row as UpdateJob;}

/** POS writes a one-shot job after fresh Cloud Owner authorization. No bearer token or private key is persisted. */
export function writeUpdateJob(configDir:string,authorization:AuthorizedUpdate,signedRelease:SignedRelease,signedGrant:SignedInstallGrant,now=Date.now()){
 const dir=directory(configDir);
 if(!Number.isSafeInteger(now)||now>=authorization.expiresAt)throw Error('UPDATE_AUTHORIZATION_EXPIRED');
 const row:UpdateJob={format:1,operationId:authorization.operationId,actorId:authorization.actorId,manifestSha256:authorization.release.manifestSha256,grantSha256:authorization.grantSha256,signedRelease,signedGrant,createdAt:new Date(now).toISOString()};
 validated(row);
 if(Buffer.byteLength(JSON.stringify(row))>32768)throw Error('UPDATE_JOB_INVALID');
 if(readdirSync(dir).some(item=>item.startsWith(tempPrefix)))throw Error('UPDATE_JOB_INCOMPLETE');
 const path=join(dir,name),temp=join(dir,`${tempPrefix}${randomUUID()}.tmp`);
 try{writeFileSync(temp,JSON.stringify(row),{flag:'wx',mode:0o600,flush:true});linkSync(temp,path);syncDirectory(dir);return row;}
 catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error('UPDATE_JOB_EXISTS');throw error;}
 finally{try{unlinkSync(temp);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}syncDirectory(dir);}
}
/** A corrupt/incomplete job blocks preparation; the agent never guesses the intended operation. */
export function readUpdateJob(configDir:string){const dir=directory(configDir);if(readdirSync(dir).some(item=>item.startsWith(tempPrefix)))throw Error('UPDATE_JOB_INCOMPLETE');const path=join(dir,name);let stat;try{stat=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('UPDATE_JOB_INVALID');}if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<1||stat.size>32768)throw Error('UPDATE_JOB_INVALID');try{return validated(JSON.parse(readFileSync(path,'utf8')));}catch{throw Error('UPDATE_JOB_INVALID');}}
