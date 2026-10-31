/** Internal source-scoped read of already-issued recorder originals. This is not
 * a fresh authority check, a recorder substitute or installed custody proof. */
import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {completeClientFields as fields} from './native-complete-client-proof.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {loadNativeOriginals} from './native-r2-evidence.mjs';
const fail=()=>{throw Error('NATIVE_COMPLETE_CASE_RECORDS_REJECTED');},check=v=>{if(!v)fail();};
const typed=Object.getPrototypeOf(Uint8Array.prototype),sizeOf=Object.getOwnPropertyDescriptor(typed,'byteLength').get,backing=Object.getOwnPropertyDescriptor(typed,'buffer').get;
function reserve(input){
 check(input&&!types.isProxy(input)&&Array.isArray(input)&&Object.getPrototypeOf(input)===Array.prototype);
 const ds=Object.getOwnPropertyDescriptors(input),n=ds.length?.value;check(Number.isSafeInteger(n)&&n>=33&&n<=235&&Reflect.ownKeys(ds).length===n+1);let total=0;
 return Array.from({length:n},(_,i)=>{const d=ds[i];check(d?.enumerable&&Object.hasOwn(d,'value'));const r=fields(d.value,['id','sha256','bytes']),b=r.bytes;check(typeof r.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(r.id)&&typeof r.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256));
  check(b&&!types.isProxy(b)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(b)));const size=sizeOf.call(b);check(size>0&&size<=65536&&Object.getPrototypeOf(backing.call(b))===ArrayBuffer.prototype&&Reflect.ownKeys(b).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));total+=size;check(total<=16777216);return r;
 });
}
export function createCompleteCaseRecords(input){
 try{
  const a=fields(input,['profile','readRecords','signal','remainingMs']);check(typeof a.readRecords==='function'&&!types.isProxy(a.readRecords)&&typeof a.remainingMs==='function'&&!types.isProxy(a.remainingMs)&&a.signal&&!types.isProxy(a.signal)&&a.signal instanceof AbortSignal);
  const expected=selectCompleteProfile(a.profile).scenario.steps.filter(s=>s.caseId&&s.id.startsWith('success/')).map(s=>({step:s.id,case:s.caseId}));check(expected.length===33);
  let active=true,used=false;const revoke=()=>{active=false;},aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
  const live=()=>{check(active&&!aborted.call(a.signal));const remaining=a.remainingMs();check(Number.isFinite(remaining)&&remaining>0);check(active&&!aborted.call(a.signal));};
  function read(){check(!used);try{
   used=true;live();const rows=reserve(a.readRecords());live();const map=loadNativeOriginals(rows),byId=new Map(rows.map(r=>[r.id,r]));
   const harnesses=[...map].filter(([,r])=>r.value.type==='native-case-harness-original');check(harnesses.length===33);
   const out=expected.map(e=>{const found=harnesses.filter(([,r])=>r.value.step_id===e.step);check(found.length===1);const [id,r]=found[0],v=r.value;check(v.version===1&&v.id===id&&v.case_id===e.case&&v.exit_code===0);const source=byId.get(id);check(source&&source.sha256===r.sha256&&sizeOf.call(source.bytes)===r.byte_size);return {id,sha256:r.sha256,bytes:source.bytes};});
   const detached=out.map(r=>({id:r.id,sha256:r.sha256,bytes:Buffer.from(r.bytes)}));
   live();for(const r of detached)check(createHash('sha256').update(r.bytes).digest('hex')===r.sha256);
   return detached.map(Object.freeze);
  }catch{active=false;fail();}}
  return Object.freeze({read,revoke});
 }catch{fail();}
}
