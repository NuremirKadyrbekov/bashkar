'use strict';

// Only explicitly reviewed, independent GET requests may share a batch.
// Every other request waits for all preceding reads and requests.
function createRequestQueue(parallelReads,limit=5){
 let tail=Promise.resolve();
 let slots=Array.from({length:limit},()=>Promise.resolve());
 let nextSlot=0;
 return (action,execute)=>{
  if(parallelReads.has(action)){
   const slot=nextSlot++%limit;
   const result=Promise.all([tail,slots[slot]]).then(execute);
   slots[slot]=result.then(()=>{},()=>{});
   return result;
  }
  const result=Promise.all([tail,...slots]).then(execute);
  tail=result.then(()=>{},()=>{});
  slots=Array.from({length:limit},()=>Promise.resolve());
  nextSlot=0;
  return result;
 };
}

module.exports={createRequestQueue};
