/** Volatile serialized source session; never durable replay or installed authority. */
import {validateFixturePolicy,fixtureReservation,FIXTURE_LIMITS} from './native-fixture-protocol.mjs';
const rejected=()=>Error('FIXTURE_SESSION_REJECTED');
export function createFixtureSession(input){
 const policy=validateFixturePolicy(input,Date.now()),reservation=fixtureReservation(policy),started=performance.now(),pending=new Set(),aborters=new Set(),ids=new Set();
 const quotas={preflight:1,'observe-selected-state':policy.plan.observations,'configuration-disable-local':policy.plan.configuration_disables};
 let status='idle',attempts=0,ready=false,closed=false,cleanupFailed=false;
 const poison=()=>{status='failed';for(const controller of aborters)controller.abort(rejected());};
 const remaining=()=>Math.min(policy.expires_at-Date.now(),FIXTURE_LIMITS.lifetimeMs-(performance.now()-started));
 function execute(signal,work){
  if(closed||status!=='idle'||typeof work!=='function'||remaining()<=0||attempts>=reservation.calls){poison();throw rejected();}
  attempts++;status='in-flight';const controller=new AbortController();aborters.add(controller);let listener,timer,admitted=false;
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const check=()=>{if(closed||status==='failed'||remaining()<=0||combined.aborted)throw rejected();};
  const admit=request=>{check();if(admitted||request.sequence!==attempts||ids.has(request.request_id)||quotas[request.operation]===undefined||quotas[request.operation]<1||(!ready&&request.operation!=='preflight')||(ready&&request.operation==='preflight'))throw rejected();admitted=true;ids.add(request.request_id);quotas[request.operation]--;};
  const actual=Promise.resolve().then(async()=>{check();const result=await work(combined,admit,check);check();if(!admitted)throw rejected();ready=true;return result;});
  pending.add(actual);actual.then(()=>{pending.delete(actual);aborters.delete(controller);if(status!=='failed'&&!closed)status='idle';},()=>{pending.delete(actual);aborters.delete(controller);poison();});
  const cutoff=new Promise((_,reject)=>{listener=()=>{poison();reject(rejected());};combined.addEventListener('abort',listener,{once:true});timer=setTimeout(()=>controller.abort(rejected()),Math.max(1,Math.min(FIXTURE_LIMITS.callMs,remaining())));if(combined.aborted)listener();});
  return Promise.race([actual,cutoff]).catch(()=>{poison();throw rejected();}).finally(()=>{clearTimeout(timer);combined.removeEventListener('abort',listener);});
 }
 const track=promise=>{const actual=Promise.resolve(promise);pending.add(actual);actual.then(()=>pending.delete(actual),()=>{pending.delete(actual);cleanupFailed=true;poison();});return actual;};
 return Object.freeze({execute,track,snapshot:()=>({status:closed&&pending.size===0&&!cleanupFailed?'closed':status,pending:pending.size,attempts,remaining:{...quotas},reservation:{...reservation}}),async close(){closed=true;poison();let timer;try{await Promise.race([Promise.allSettled([...pending]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('FIXTURE_SESSION_CLEANUP_UNKNOWN')),FIXTURE_LIMITS.callMs);})]);if(pending.size||cleanupFailed)throw Error('FIXTURE_SESSION_CLEANUP_UNKNOWN');return {status:'closed'};}finally{clearTimeout(timer);}}});
}
