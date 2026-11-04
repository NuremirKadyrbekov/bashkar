'use strict';
// Only an explicit proof rejection of a first shift-open attempt is known not to apply.
// Any existing record (including IN_FLIGHT after a crash and legacy records) is uncertain.
function forgetRejectedShiftOpen({action,hadPriorPending,status,code}){
 if(action!=='shiftOpen'||hadPriorPending)return false;
 return status===401&&code==='INVALID_CREDENTIALS'||status===429&&['PIN_RATE_LIMITED','PIN_WORK_LIMIT','AUTH_RATE_LIMITED'].includes(code);
}
function validShiftOpenReceipt(value){const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;return !!value&&uuid.test(value.id)&&value.status==='OPEN'&&uuid.test(value.openedBy)&&Number.isSafeInteger(value.openedAt)&&value.openedAt>=0&&Number.isSafeInteger(value.revision)&&value.revision>0;}
module.exports={forgetRejectedShiftOpen,validShiftOpenReceipt};
