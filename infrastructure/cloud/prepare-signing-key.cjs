// Explicit initial provisioning only. Never rotates or overwrites a key.
const {generateKeyPairSync,createPrivateKey,createPublicKey}=require('node:crypto');
const {existsSync,writeFileSync,readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const privatePath=resolve(__dirname,'../../.env.cloud-signing.local');
const publicPath=resolve(__dirname,'../../config/activation-authority.public.pem');
if(existsSync(privatePath)||existsSync(publicPath)){
 if(!existsSync(privatePath)||!existsSync(publicPath))throw Error('INCOMPLETE_SIGNING_KEY_PROVISIONING');
 const line=readFileSync(privatePath,'utf8').trim();
 if(!line.startsWith('BASHKAR_ACTIVATION_PRIVATE_KEY_B64='))throw Error('SIGNING_KEY_FORMAT_INVALID');
 const key=createPrivateKey(Buffer.from(line.slice(line.indexOf('=')+1),'base64').toString('utf8'));
 if(createPublicKey(key).export({type:'spki',format:'pem'}).toString()!==readFileSync(publicPath,'utf8'))throw Error('SIGNING_KEY_MISMATCH');
 console.log('SIGNING_KEY_ALREADY_PREPARED');
}else{
 const keys=generateKeyPairSync('ed25519');
 const privatePem=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
 writeFileSync(privatePath,'BASHKAR_ACTIVATION_PRIVATE_KEY_B64='+Buffer.from(privatePem).toString('base64')+'\n',{mode:0o600,flag:'wx'});
 writeFileSync(publicPath,keys.publicKey.export({type:'spki',format:'pem'}),{mode:0o644,flag:'wx'});
 console.log('SIGNING_KEY_PREPARED');
}
