'use strict';
// Shift proof errors stay in this dialog. Real uncertain commands remain durable in main.
let shiftOpenIndicatorActor=null,shiftOpenNeedsCheck=false;
function initShiftOpenUi(ru,ky){
 const labels={shiftPinWrong:['Неверный PIN. Попробуйте ещё раз.','PIN туура эмес. Кайра аракет кылыңыз.'],shiftPasswordWrong:['Неверный логин или пароль.','Логин же сырсөз туура эмес.'],shiftProofLimited:['Слишком много попыток. Повторите позже.','Аракеттер өтө көп. Кийинчерээк кайталаңыз.'],shiftOpenVerify:['Проверить открытие смены','Нөөмөттүн ачылышын текшерүү'],shiftOpenRecoveryTitle:['Проверка открытия смены','Нөөмөттүн ачылышын текшерүү'],shiftOpenUncertain:['Не удалось подтвердить открытие смены. Проверьте результат исходного действия.','Нөөмөттүн ачылышы ырасталган жок. Баштапкы аракеттин жыйынтыгын текшериңиз.'],shiftOpenStillUncertain:['Результат предыдущей попытки ещё не проверен.','Мурунку аракеттин жыйынтыгы текшериле элек.'],shiftNeedsCheck:['Требует проверки','Текшерүү керек'],shiftOpenAlready:['Смена уже открыта','Нөөмөт ачылган'],shiftOpenOriginalClosed:['Исходное открытие подтверждено, но эта смена уже закрыта. Для новой смены выполните новое открытие.','Баштапкы ачылыш ырасталды, бирок ал нөөмөт жабылган. Жаңы нөөмөт үчүн кайра ачыңыз.'],shiftOpenOtherCurrent:['Исходное действие проверено. Сейчас открыта другая смена.','Баштапкы аракет текшерилди. Азыр башка нөөмөт ачык.']};
 for(const [key,[r,k]]of Object.entries(labels)){ru[key]=r;ky[key]=k;}
}
function paintShiftOpenIndicator(){
 const indicator=document.getElementById('shift-indicator');if(!indicator)return;
 indicator.querySelector('.shift-recovery-indicator')?.remove();
 const active=!!me&&shiftOpenIndicatorActor===me.id&&shiftOpenNeedsCheck;indicator.classList.toggle('needs-recovery',active);
 if(active)indicator.append(el('span',t('shiftNeedsCheck'),{className:'shift-recovery-indicator'}));
}
function updateShiftOpenIndicator(records){shiftOpenIndicatorActor=me?.id??null;shiftOpenNeedsCheck=records.some(r=>r.action==='shiftOpen');paintShiftOpenIndicator();}
async function shiftOpenRecords(){const rows=await api('pending');updateShiftOpenIndicator(rows);return rows.filter(r=>r.action==='shiftOpen');}
async function shiftOpenDialog(){
 if(shiftOpening)return false;shiftOpening=true;
 try{
  me=await api('me');if(!me.permissions.includes('shift.open'))throw Error('PERMISSION_DENIED');
  const actor=me.id;let records=await shiftOpenRecords(),current=await api('shift');
  if(current&&!records.length){await render();return true;}
  const m=shiftModal(records.length?'shiftOpenRecoveryTitle':'open');m.dialog.classList.add('shift-open-modal');m.dialog.dataset.permission='shift.open';
  m.body.append(el('p',current?t('shiftOpenAlready')+' · '+current.openedByName:t('noShift')),el('p',me.role==='CASHIER'&&me.hasPin?t('pinHint'):t('closePersonal')));
  let submit,proof,busy=false,opened=false,uncertain=records.length>0,waitUntil=0,showCountdown=false;
  let resolveOutcome;const outcome=new Promise(resolve=>{resolveOutcome=resolve;});
  const note=el('div','',{className:'shift-proof-error',role:'alert',hidden:true}),recovery=el('p','',{className:'shift-open-recovery',role:'status',hidden:true}),countdown=el('p','',{className:'shift-proof-countdown',role:'status',hidden:true});
  function update(){
   const waiting=performance.now()<waitUntil;
   if(submit){submit.disabled=busy||waiting||!proof?.ready();submit.textContent=t(uncertain?'shiftOpenVerify':'open');}
   for(const control of proof?.controls??[])control.disabled=busy||waiting;
   countdown.hidden=!waiting||!showCountdown;if(!countdown.hidden){const text=t('pinWait')+' '+Math.ceil((waitUntil-performance.now())/1000)+' '+t('pinSeconds');if(countdown.textContent!==text)countdown.textContent=text;}
   recovery.hidden=!uncertain;if(recovery.textContent!==t('shiftOpenUncertain'))recovery.textContent=t('shiftOpenUncertain');
  }
  proof=shiftProofFields(m.body,(_ready,change)=>{if(change?.edited&&!busy){note.hidden=true;note.textContent='';}update();});
  const feedback=el('div',undefined,{className:'shift-proof-feedback'});feedback.append(note,countdown);proof.errorAnchor?.after(feedback);m.body.append(recovery);
  function errorText(text,info=false){note.textContent=text;note.hidden=false;note.classList.toggle('is-info',info);note.setAttribute('role',info?'status':'alert');}
  async function refreshRecords(){records=await shiftOpenRecords();uncertain=records.length>0;update();}
  async function finish(receipt,already=false){
   await refreshRecords();current=await api('shift');await refreshShellShift();
   if(records.length){errorText(t('shiftOpenStillUncertain'),true);return;}
   if(!current){errorText(receipt?t('shiftOpenOriginalClosed'):t('conditionsChanged'),true);return;}
   const messageKey=already?'shiftOpenAlready':receipt&&current.id!==receipt.id?'shiftOpenOtherCurrent':'opened';
   opened=true;m.dialog.close();try{await render();}finally{resolveOutcome(true);}message();toast('success',t(messageKey));
  }
  async function attempt(){
   if(busy||performance.now()<waitUntil||!proof.ready())return;
   busy=true;const controls=[...m.dialog.querySelectorAll('button,input,select,textarea')],disabled=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);note.hidden=true;
   try{
    if(me?.id!==actor)throw Error('SESSION_INVALID');
    // Never create a new command when a previous opening still requires reconciliation.
    await refreshRecords();
    const credentials=proof.read(),result=records.length?await api('retryPending',{key:records[0].key,...credentials}):await api('shiftOpen',credentials);
    await finish(result);
   }catch(error){
    const code=error.message;
    if(['SESSION_INVALID','SESSION_EXPIRED','PERMISSION_DENIED','OWNER_CLOUD_RELOGIN_REQUIRED','OWNER_CLOUD_UNAVAILABLE','OWNER_CLOUD_INVALID','OWNER_CLOUD_ACCESS_DENIED'].includes(code))throw error;
    if(code==='RESULT_UNKNOWN_RETRY_SAME_ACTION'){uncertain=true;shiftOpenIndicatorActor=actor;shiftOpenNeedsCheck=true;paintShiftOpenIndicator();}
    try{await refreshRecords();}catch{ /* Keep known uncertainty until a live authenticated read is possible. */ }
    if(code==='SHIFT_ALREADY_OPEN'){await finish(null,true);}
    else if(code==='INVALID_CREDENTIALS')errorText(t(proof.kind==='PIN'?'shiftPinWrong':'shiftPasswordWrong')+(uncertain?' '+t('shiftOpenStillUncertain'):''));
    else if(['PIN_RATE_LIMITED','PIN_WORK_LIMIT','AUTH_RATE_LIMITED'].includes(code)){
     const seconds=Number.isFinite(error.retryAfterSeconds)&&error.retryAfterSeconds>0?error.retryAfterSeconds:null;waitUntil=performance.now()+(seconds??1)*1000;showCountdown=seconds!==null||code==='PIN_WORK_LIMIT';errorText(t('shiftProofLimited')+(uncertain?' '+t('shiftOpenStillUncertain'):''));
    }else if(['RESULT_UNKNOWN_RETRY_SAME_ACTION','SERVER_UNAVAILABLE'].includes(code)&&uncertain)note.hidden=true;else errorText(t(code==='SERVER_UNAVAILABLE'?'connection':'conditionsChanged'));
    await refreshShellShift();
   }finally{
    proof.clear();busy=false;controls.forEach((c,i)=>{c.disabled=disabled[i];});update();if(m.dialog.open)proof.focus();
   }
  }
  submit=el('button',t(uncertain?'shiftOpenVerify':'open'),{type:'button',className:'primary shift-open-submit',disabled:true});submit.onclick=()=>run(attempt);m.footer.append(submit);update();
  m.dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  const timer=setInterval(update,250);m.dialog.addEventListener('close',()=>{clearInterval(timer);proof.clear();if(!opened)resolveOutcome(false);},{once:true});
  return await outcome;
 }finally{shiftOpening=false;}
}
