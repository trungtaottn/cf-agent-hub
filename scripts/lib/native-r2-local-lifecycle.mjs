/** Cleanup of source-owned local test resources; not an operator cleanup authority. */
export async function closeLocalSandbox({pending,close,remove,timeoutMs=10000}){
 if(!(pending instanceof Set)||typeof close!=='function'||typeof remove!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('LOCAL_SANDBOX_CLEANUP_UNKNOWN');
 const deadline=performance.now()+timeoutMs;
 async function bounded(work){
  const remaining=deadline-performance.now();if(remaining<=0)throw Error('LOCAL_SANDBOX_CLEANUP_UNKNOWN');
  let timer;
  try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('LOCAL_SANDBOX_CLEANUP_UNKNOWN')),remaining);})]);}
  finally{clearTimeout(timer);}
 }
 // First interrupt existing IO, then wait actual work (including newly retained
 // body/cancellation promises), and close again after late acquisition settles.
 await bounded(close);
 while(pending.size)await bounded(()=>Promise.allSettled([...pending]));
 await bounded(close);
 if(pending.size)throw Error('LOCAL_SANDBOX_CLEANUP_UNKNOWN');
 await bounded(remove);
}
/** Detach RPC-owned scalars while their current test harness context is alive. */
export function snapshotLocalInstallReceipt(value){
 try{
  const epoch=value.epoch,installationDigest=value.installationDigest;
  if(!Number.isSafeInteger(epoch)||epoch<1||typeof installationDigest!=='string'||!/^[a-f0-9]{64}$/.test(installationDigest))throw Error();
  return Object.freeze({epoch,installationDigest});
 }catch{throw Error('LOCAL_SANDBOX_RECEIPT_REJECTED');}
}

/** Source-owned configuration update: routing, secret references and other grants stay exact. */
export function assertLocalDisableChange(before,after){
 try{
  const expected=structuredClone(before);
  if(expected.config_epoch!==1||!Array.isArray(expected.static_credential_refs))throw Error();
  const selected=expected.static_credential_refs.filter(row=>row.credential_id==='credential_research_1');
  if(selected.length!==1||selected[0].enabled!==true)throw Error();
  expected.config_epoch=2;selected[0].enabled=false;
  if(JSON.stringify(expected)!==JSON.stringify(after))throw Error();
 }catch{throw Error('LOCAL_SANDBOX_CONFIGURATION_REJECTED');}
}
/** Do not replace an owned round until its actual operations and close are terminal. */
export async function closeLocalRound({pending,close}){
 if(!(pending instanceof Set)||pending.size!==0||typeof close!=='function')throw Error('LOCAL_SANDBOX_ROUND_PENDING');
 await close();
 if(pending.size!==0)throw Error('LOCAL_SANDBOX_ROUND_PENDING');
}
