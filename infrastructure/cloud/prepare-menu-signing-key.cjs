'use strict';
// Explicit staging provisioning; never rotates an existing key or prints private material.
const {generateKeyPairSync,createPrivateKey,createPublicKey}=require('node:crypto'),{existsSync,readFileSync,writeFileSync}=require('node:fs');
const privatePath='.env.menu-sync-signing.local',publicPath='config/menu-sync-authority.public.pem';
if(existsSync(privatePath)!==existsSync(publicPath))throw Error('MENU_SIGNING_INCOMPLETE');
if(!existsSync(privatePath)){const keys=generateKeyPairSync('ed25519');writeFileSync(privatePath,'BASHKAR_MENU_PRIVATE_KEY_B64='+Buffer.from(keys.privateKey.export({type:'pkcs8',format:'pem'})).toString('base64')+'\n',{mode:0o600,flag:'wx'});writeFileSync(publicPath,keys.publicKey.export({type:'spki',format:'pem'}),{flag:'wx'});}
const line=readFileSync(privatePath,'utf8').trim(),key=createPrivateKey(Buffer.from(line.slice(line.indexOf('=')+1),'base64'));
if(createPublicKey(key).export({type:'spki',format:'pem'}).toString()!==readFileSync(publicPath,'utf8'))throw Error('MENU_SIGNING_MISMATCH');
console.log('MENU_SIGNING_READY');
