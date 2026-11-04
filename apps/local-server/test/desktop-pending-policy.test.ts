import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const {forgetRejectedShiftOpen,validShiftOpenReceipt}=createRequire(process.cwd()+'/package.json')('./apps/pos-desktop/pending-policy.cjs');
it('forgets only confirmed proof refusals of a first opening and never a prior uncertain opening',()=>{
 for(const [status,code]of [[401,'INVALID_CREDENTIALS'],[429,'PIN_RATE_LIMITED'],[429,'PIN_WORK_LIMIT'],[429,'AUTH_RATE_LIMITED']]){
  expect(forgetRejectedShiftOpen({action:'shiftOpen',hadPriorPending:false,status,code})).toBe(true);
  expect(forgetRejectedShiftOpen({action:'shiftOpen',hadPriorPending:true,status,code})).toBe(false);
 }
});
it('preserves financial commands, other authorization failures, malformed and unavailable responses',()=>{
 for(const action of ['settleCommit','refundCommit','shiftClose','counterSubmit','batchSubmit'])expect(forgetRejectedShiftOpen({action,hadPriorPending:false,status:401,code:'INVALID_CREDENTIALS'})).toBe(false);
 for(const [status,code]of [[401,'SESSION_EXPIRED'],[403,'PERMISSION_DENIED'],[429,'REQUEST_FAILED'],[500,'INVALID_CREDENTIALS'],[503,'SERVER_UNAVAILABLE'],[200,'INVALID_CREDENTIALS']])expect(forgetRejectedShiftOpen({action:'shiftOpen',hadPriorPending:false,status,code})).toBe(false);
});
it('accepts a real open-shift receipt but rejects JSON bodies that cannot confirm the mutation',()=>{
 const receipt={id:randomUUID(),openedBy:randomUUID(),openedAt:Date.now(),status:'OPEN',revision:1};expect(validShiftOpenReceipt(receipt)).toBe(true);
 for(const bad of [null,{},true,{...receipt,id:'bad'},{...receipt,status:'CLOSED'},{...receipt,revision:0},{...receipt,openedAt:'today'}])expect(validShiftOpenReceipt(bad)).toBe(false);
});
