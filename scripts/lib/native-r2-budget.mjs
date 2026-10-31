import {performance} from 'node:perf_hooks';
const keys=['commands','mutations','artifact_bytes','output_bytes'];
const fail=()=>{throw Error('NATIVE_BUDGET_EXCEEDED');};
/** Conservatively reserves upper bounds. Uncertain effects never earn refunds. */
export function createNativeBudget(limits,clock=()=>performance.now()){
 if(!limits||typeof clock!=='function'||!Number.isSafeInteger(limits.duration_ms)||limits.duration_ms<=0)fail();
 for(const key of keys)if(!Number.isSafeInteger(limits[key])||limits[key]<0)fail();
 const maximum=structuredClone(limits),used=Object.fromEntries(keys.map(k=>[k,0]));
 const started=clock();let previous=started;if(!Number.isFinite(started))fail();
 const remainingMs=()=>{const now=clock();if(!Number.isFinite(now)||now<previous||now-started>=maximum.duration_ms)fail();previous=now;return maximum.duration_ms-(now-started);};
 return Object.freeze({remainingMs,snapshot:()=>({...used}),reserve(cost){
  remainingMs();if(!cost||Object.keys(cost).sort().join(',')!==[...keys].sort().join(','))fail();
  for(const key of keys)if(!Number.isSafeInteger(cost[key])||cost[key]<0||cost[key]>maximum[key]-used[key])fail();
  for(const key of keys)used[key]+=cost[key];return {...used};
 }});
}
/** Bounds awaiting cooperative trusted adapters; not a JavaScript sandbox.
 * On timeout, abort and stop dispatch. The adapter must honor cancellation;
 * otherwise its external outcome remains unknown and cannot be retried. */
export async function withNativeDeadline(work,timeoutMs){
 if(typeof work!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>300000)throw Error('NATIVE_ADAPTER_TIMEOUT');
 const controller=new AbortController();let timer;
 try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('NATIVE_ADAPTER_TIMEOUT'));},Math.ceil(timeoutMs));})]);}
 finally{clearTimeout(timer);}
}
