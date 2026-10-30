/** Fixed source lifecycle only. Never runs CLI, grants authority or validates HTTP.
 * The transport separately counts received requests and owns request bodies.
 */
import {types} from 'node:util';
import {getNativeScenario} from './native-r2-scenario.mjs';
import {getCompleteProfile} from './native-complete-profile.mjs';
const fail=()=>{throw Error('NATIVE_COMPLETE_SEQUENCE_REJECTED');};
const check=x=>{if(!x)fail();};
const freeze=x=>{if(x&&typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;};
const scenario=getNativeScenario(),rows=[];
const add=(operation,slot=null,pass=null)=>rows.push({sequence:rows.length+1,operation,slot,pass});
const auxiliary=new Set(['prepare/fail-create','prepare/revoke-own-positive']);
const externalAfter=new Map([
 ['prepare/server-foreign-own-positive','server-foreign-workspace-denial'],
 ['prepare/runtime-own-after','server-wrong-runtime-proof-denial'],
]);
add('preflight');add('bind-run');
for(const step of scenario.steps){
 const slot={kind:step.kind==='control'?'control':'process',id:step.id};
 add('prepare-slot',slot);add(slot.kind==='process'?'complete-process':'execute-control',slot);
 if(slot.kind==='process')add('scan-process-output',slot,'immediate');
 add('observe-slot',slot);
 if(step.caseId||auxiliary.has(step.id)||step.id==='control/revoke-submitter')add('read-original',slot);
 if(externalAfter.has(step.id)){
  const external={kind:'external',id:externalAfter.get(step.id)};
  for(const op of ['prepare-slot','execute-external','observe-slot','read-original'])add(op,external);
 }
}
add('seal-scan-inventory');
for(const step of scenario.steps.filter(s=>s.kind!=='control'))add('scan-process-output',{kind:'process',id:step.id},'final');
add('finalize-run-scan');add('read-run-original');add('close-run');
check(rows.length===getCompleteProfile().limits.service_calls);
const schedule=freeze(rows);
export function completeCallSchedule(){return schedule;}
function data(value,names){
 check(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype);
 const keys=Reflect.ownKeys(value);check(keys.length===names.length&&keys.every(k=>names.includes(k)));const out={};
 for(const k of names){const d=Object.getOwnPropertyDescriptor(value,k);check(d?.enumerable&&Object.hasOwn(d,'value'));out[k]=d.value;}return out;
}
function metadata(value){
 const r=data(value,['sequence','request_id','operation','slot','pass']);
 check(Number.isSafeInteger(r.sequence)&&r.sequence>=1&&r.sequence<=370&&typeof r.request_id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(r.request_id)&&typeof r.operation==='string');
 if(r.slot!==null){r.slot=data(r.slot,['kind','id']);check(typeof r.slot.kind==='string'&&typeof r.slot.id==='string');}
 check(r.pass===null||r.pass==='immediate'||r.pass==='final');return r;
}
const equalSlot=(a,b)=>a===null?b===null:b!==null&&a.kind===b.kind&&a.id===b.id;
/** Trusted fixed service code supplies dispatch/cleanup functions, never config.
 * A caller timeout cannot release the actual in-flight callback. No retries.
 * Cleanup must return exact {status:closed} only after validating its backend
 * receipt/correlation. Fulfilled unknown or malformed results remain unknown.
 */
export function createCompleteCallOwner(){
 let calls=0,completed=0,failed=false,closing=false,closeAttempted=false,active=null,cleanupActual=null,cleanupState='not-started';
 const seen=new Set();
 const reject=()=>{failed=true;return fail();};
 const callable=fn=>check(typeof fn==='function'&&!types.isProxy(fn));
 function admit(request,allowFailureClose=false){
  const r=metadata(request);check(r.sequence===calls+1&&!seen.has(r.request_id));
  if(allowFailureClose){check(r.operation==='close-run'&&r.slot===null&&r.pass===null);}
  else{const expected=schedule[calls];check(expected&&r.operation===expected.operation&&r.pass===expected.pass&&equalSlot(r.slot,expected.slot)&&r.operation!=='close-run');}
  check(calls<370);seen.add(r.request_id);calls++;return r;
 }
 async function execute(request,dispatch){
  let owned=null;
  try{
   check(!failed&&!closing&&!active);callable(dispatch);admit(request);
   owned=Promise.resolve().then(()=>{check(!failed&&!closing);return dispatch();});active=owned;
   const result=await owned;check(!failed&&!closing);completed++;return result;
  }catch{failed=true;return fail();}
  finally{if(owned&&active===owned)active=null;}
 }
 async function close(request,cleanup){
  try{
   check(!closeAttempted);callable(cleanup);
   // Failure cleanup consumes the same reserved final call, not missing steps.
   if(!failed&&!active)check(calls===schedule.length-1);
   admit(request,true);closeAttempted=true;closing=true;cleanupState='pending';
  }catch{return reject();}
  const owned=active;
  const terminal=(async()=>{
   if(owned)await Promise.allSettled([owned]);
   const task=Promise.resolve().then(cleanup);cleanupActual=task;
   try{const receipt=data(await task,['status']);check(receipt.status==='closed');cleanupState='closed';return Object.freeze({status:'closed'});}
   catch{failed=true;cleanupState='cleanup-unknown';return Object.freeze({status:'cleanup-unknown'});}
   finally{if(cleanupActual===task)cleanupActual=null;}
  })();
  let timer;
  try{return await Promise.race([terminal,new Promise(resolve=>{timer=setTimeout(()=>{if(cleanupState!=='closed')cleanupState='cleanup-unknown';resolve(Object.freeze({status:'cleanup-unknown'}));},1000);})]);}
  finally{clearTimeout(timer);}
 }
 return Object.freeze({execute,close,snapshot:()=>Object.freeze({scope:'source-lifecycle-only',calls,completed,failed,closing,closeAttempted,pending:(active?1:0)+(cleanupActual?1:0),cleanup:cleanupState,installedAuthority:false,native_conformance:false})});
}
