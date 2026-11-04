// Remote QA only. Invoked with a temporary QA account/branch, never the user's
// real branch. Exercises shipped main + actual macOS Keychain + actual Electron.
const {spawn,spawnSync}=require('node:child_process');
const {resolve,join}=require('node:path');
const {mkdtempSync,mkdirSync,rmSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {createHash}=require('node:crypto');
const net=require('node:net');
const {_electron}=require('playwright');
module.exports=async function desktopScenario({email,cloudPassword,branchId,localPassword}){
 if(process.platform!=='darwin')throw Error('DESKTOP_CLOUD_QA_MACOS_ONLY');
 const root=resolve(__dirname,'../..'),dir=mkdtempSync(join(tmpdir(),'bashkar-real-cloud-')),data=join(dir,'branch'),userData=join(dir,'desktop');
 mkdirSync(data);let server,desktop,startedKey=false;
 const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const env={...process.env,BASHKAR_DATA_DIR:data,BASHKAR_PORT:String(port),BASHKAR_DESKTOP_PORT:String(port),BASHKAR_TEST_CLIENT:'1'};
 const entry=resolve(root,'dist/apps/local-server/src/main.js');
 async function start(offline=false){
  const args=[];if(offline){const hook=join(dir,'offline.cjs');writeFileSync(hook,"globalThis.fetch=async()=>{throw Error('QA_NETWORK_BLOCKED')};\n");args.push('--require',hook);}args.push(entry);
  server=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(Error('CLOUD_QA_SERVER_START_TIMEOUT')),15000);server.once('exit',()=>{clearTimeout(timer);reject(Error('CLOUD_QA_SERVER_EXIT'));});server.stderr.on('data',()=>{});server.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){try{if(JSON.parse(line).event==='started'){clearTimeout(timer);resolve();}}catch{}}});});
 }
 async function stop(){if(server&&server.exitCode===null){const child=server;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});server=null;}}
 async function open(){desktop=await _electron.launch({executablePath:require('electron'),args:['--user-data-dir='+userData,resolve(root,'apps/pos-desktop/main.cjs')],env});return desktop.firstWindow();}
 async function localLogin(page){await page.getByRole('heading',{name:'Вход в филиал',exact:true}).waitFor();await page.getByLabel('Логин',{exact:true}).fill('qa-owner');await page.getByLabel('Пароль',{exact:true}).fill(localPassword);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('heading',{name:'Кассовая смена',exact:true}).waitFor();}
 try{
  const init=spawnSync(process.execPath,[entry,'init-db'],{env,stdio:'pipe'});if(init.status!==0)throw Error('CLOUD_QA_LOCAL_INIT_FAILED');
  await start();let page=await open();
  await page.getByLabel('Email облачного Owner',{exact:true}).fill(email);await page.getByLabel('Облачный пароль',{exact:true}).fill(cloudPassword);await page.getByRole('button',{name:'Войти в облако',exact:true}).click();
  try{await page.getByRole('heading',{name:'Локальный Owner филиала',exact:true}).waitFor({timeout:30000});startedKey=true;}catch{console.error('Desktop activation status:',await page.getByRole('status').textContent());throw Error('CLOUD_QA_DESKTOP_CLOUD_LOGIN_FAILED');}
  await page.getByLabel('Организация и филиал',{exact:true}).selectOption(branchId);
  await page.getByLabel('Имя сотрудника',{exact:true}).fill('QA Owner');await page.getByLabel('Логин',{exact:true}).fill('qa-owner');await page.getByLabel('Новый личный пароль',{exact:true}).fill(localPassword);await page.getByLabel('Повторите пароль',{exact:true}).fill(localPassword);
  await page.getByRole('button',{name:'Активировать филиал',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Подтвердить',exact:true}).click();
  try{await page.waitForFunction(()=>document.querySelector('#status').textContent||[...document.querySelectorAll('h1')].some(h=>h.textContent==='Вход в филиал'),{timeout:30000});await localLogin(page);}catch{console.error('Desktop local activation status:',await page.getByRole('status').textContent());throw Error('CLOUD_QA_DESKTOP_LOCAL_ACTIVATION_FAILED');}
  const output=resolve(root,'artifacts/desktop-qa');mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'cloud-activation.png'),fullPage:true});
  await desktop.close();desktop=null;await stop();await start(true);page=await open();
  await page.getByRole('heading',{name:'Кассовая смена',exact:true}).waitFor();await page.getByRole('button',{name:'Сменить пользователя',exact:true}).click();await localLogin(page);
  await page.screenshot({path:join(output,'cloud-offline-restart.png'),fullPage:true});
  console.log('PASS real cloud → Electron activation → Keychain → server restart with ALL server fetch calls blocked → local password login. macOS only; isolated QA branch.');
 }finally{
  if(desktop)await desktop.close();await stop();
  {const account=createHash('sha256').update(resolve(data)).digest('hex');const removed=spawnSync('/usr/bin/security',['delete-generic-password','-a',account,'-s','kg.bashkar.local-server.device'],{stdio:'pipe'});if(removed.status!==0&&removed.status!==44)console.error('CLOUD_QA_KEYCHAIN_CLEANUP_FAILED');}
  rmSync(dir,{recursive:true,force:true});
 }
};
