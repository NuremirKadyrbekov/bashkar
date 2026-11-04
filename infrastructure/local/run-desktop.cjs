// Explicit persistent development installation using REAL cloud activation.
// Closing Electron leaves the server running; Ctrl+C stops this local server.
const {spawn,spawnSync}=require('node:child_process');
const {mkdirSync,existsSync}=require('node:fs');
const {resolve}=require('node:path');
const root=resolve(__dirname,'../..'),mode=process.argv[2]??'start';
const profile=process.argv[3]??'default';
if(!/^[a-z0-9][a-z0-9-]{0,31}$/.test(profile))throw Error('INVALID_LOCAL_PROFILE');
const base=resolve(root,'.local',...(profile==='default'?[]:[profile]));
const dir=resolve(base,'branch'),userData=resolve(base,'desktop');
const entry=resolve(root,'dist/apps/local-server/src/main.js');
const port=Number(process.env.BASHKAR_LOCAL_PORT??(profile==='default'?'3213':'3214'));
if(!Number.isInteger(port)||port<1||port>65535)throw Error('INVALID_LOCAL_PORT');
const env={...process.env,BASHKAR_DATA_DIR:dir,BASHKAR_PORT:String(port),BASHKAR_DESKTOP_PORT:String(port),BASHKAR_TEST_CLIENT:'1',BASHKAR_TEST_PROFILE:profile};
if(!['init','start','window'].includes(mode))throw Error('INVALID_LOCAL_MODE');
if(mode==='init'){
 mkdirSync(dir,{recursive:true,mode:0o700});
 const result=spawnSync(process.execPath,[entry,'init-db'],{env,stdio:'inherit'});process.exitCode=result.status??1;
}else{
 if(!existsSync(resolve(dir,'installation.json')))throw Error('LOCAL_INSTALL_REQUIRED_RUN_DESKTOP_LOCAL_INIT');
 const open=()=>{const app=spawn(require('electron'),['--user-data-dir='+userData,resolve(root,'apps/pos-desktop/main.cjs')],{env,stdio:'inherit'});app.once('error',()=>console.error('DESKTOP_START_FAILED'));return app;};
 if(mode==='window')open();
 else{
  const server=spawn(process.execPath,[entry],{env,stdio:['ignore','pipe','inherit']});let desktop,started=false,stopping=false,buffer='';
  server.stdout.on('data',chunk=>{process.stdout.write(chunk);buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){try{if(JSON.parse(line).event==='started'&&!started){started=true;desktop=open();desktop.once('exit',()=>console.log('Desktop закрыт. Сервер продолжает работать; Ctrl+C — остановить сервер.'));}}catch{}}});
  function stop(){if(stopping)return;stopping=true;desktop?.kill('SIGTERM');server.kill('SIGTERM');}
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  server.once('exit',code=>{desktop?.kill('SIGTERM');if(!stopping)process.exitCode=code??1;});
 }
}
