// Disposable desktop preview. Uses the test fixture and never opens a real profile.
'use strict';
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {fixture,password}=require('../../dist/apps/local-server/test/fixtures/operations.js');
const {seedRestaurantPreview}=require('../../dist/apps/local-server/test/fixtures/restaurant-preview.js');
const {createServer}=require('../../dist/apps/local-server/src/server.js');

async function main(){
 const f=await fixture();
 const userData=mkdtempSync(join(tmpdir(),'bashkar-clean-preview-'));
 let server,desktop;
 const stop=()=>desktop?.kill('SIGTERM');
 process.once('SIGINT',stop);
 process.once('SIGTERM',stop);
 try{
  const seeded=await seedRestaurantPreview(f);
  f.storage.close();
  server=await createServer(f.dir,0,true,f.trust);
  const port=server.server.address().port;
  desktop=spawn(require('electron'),[
   `--user-data-dir=${userData}`,
   resolve(__dirname,'../../apps/pos-desktop/main.cjs')
  ],{
   env:{...process.env,BASHKAR_DESKTOP_PORT:String(port),BASHKAR_TEST_CLIENT:'1',BASHKAR_TEST_PROFILE:'clean-preview'},
   stdio:'inherit'
  });
  console.log('\nВременный Bashkar POS с меню суши-ресторана и пиццерии открыт.');
  console.log(`Меню: ${seeded.items} позиций, ${seeded.categories} категорий, ${seeded.sets} сетов. Столы: ${seeded.tables}, зон: ${seeded.zones}.`);
  console.log(`Тестовый вход: owner / ${password}`);
  console.log('Данные этого запуска удалятся после закрытия окна.\n');
  const result=await new Promise((done,reject)=>{
   desktop.once('error',reject);
   desktop.once('exit',(code,signal)=>done({code,signal}));
  });
  if(result.code!==0&&result.signal!=='SIGTERM')process.exitCode=result.code??1;
 }finally{
  process.removeListener('SIGINT',stop);
  process.removeListener('SIGTERM',stop);
  if(desktop&&desktop.exitCode===null&&!desktop.killed)desktop.kill('SIGTERM');
  if(server)await server.close();
  f.close();
  rmSync(userData,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
