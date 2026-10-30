/** Closed complete-profile framing. Structure and hashes do not grant authority.
 * Runtime sequence/DAG ownership and installed producer admission are separate.
 */
import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {canonicalCaseSubject} from './r2-case-policy.mjs';

const fail=()=>{throw Error('NATIVE_COMPLETE_PROTOCOL_REJECTED');};
const check=value=>{if(!value)fail();};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const sha=value=>createHash('sha256').update(canonicalCaseSubject(value)).digest('hex');
function selectedSlots(scenario){return freeze([...scenario.steps.map(step=>({kind:step.kind==='control'?'control':'process',id:step.id,requirements:[...step.requires]})),...scenario.externalRequirements.map(step=>({kind:'external',id:step.id,requirements:[...step.requires]}))]);}
const unavailable=new Set(['slot','generation','principal'].flatMap(d=>['control/prepare-swap-'+d,'probe/swapped-'+d]));
const contextKeys='version runId configSha256 scenarioSha256 candidateSha candidateTreeSha compositionSha256 nodeSha256 buildSha256 authorityRecordSha256';
function keys(value,names){check(value&&typeof value==='object'&&!Array.isArray(value));const expected=names?names.split(' '):[],actual=Object.keys(value);check(actual.length===expected.length&&actual.every(k=>expected.includes(k)));}
const id=value=>check(typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value));
const digest=(value,length=64)=>check(typeof value==='string'&&new RegExp(`^[a-f0-9]{${length}}$`).test(value));
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>check(Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=min&&value<=max);
function snapshot(value,maxBytes=65536){
 let nodes=0,bytes=0;const charge=n=>{bytes+=n;check(bytes<=maxBytes);};
 function copy(v,depth=0){
  check(++nodes<=8192&&depth<=24);
  if(v===null||typeof v==='boolean'){charge(v===null||v===true?4:5);return v;}
  if(typeof v==='number'){integer(v);charge(String(v).length);return v;}
  if(typeof v==='string'){check(v.length<=maxBytes);charge(Buffer.byteLength(JSON.stringify(v)));return v;}
  check(v&&typeof v==='object'&&!types.isProxy(v));
  if(Array.isArray(v)){
   check(Object.getPrototypeOf(v)===Array.prototype);const n=Object.getOwnPropertyDescriptor(v,'length')?.value;integer(n,0,512);check(Reflect.ownKeys(v).length===n+1);charge(2+Math.max(0,n-1));const out=[];
   for(let i=0;i<n;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));check(d?.enumerable&&Object.hasOwn(d,'value'));out.push(copy(d.value,depth+1));}return out;
  }
  check(Object.getPrototypeOf(v)===Object.prototype);const names=Reflect.ownKeys(v);check(names.length<=128);charge(2+Math.max(0,names.length-1));const out={};
  for(const name of names){check(typeof name==='string'&&name.length<=128&&!['__proto__','constructor','prototype'].includes(name));const d=Object.getOwnPropertyDescriptor(v,name);check(d?.enumerable&&Object.hasOwn(d,'value'));charge(Buffer.byteLength(JSON.stringify(name))+1);out[name]=copy(d.value,depth+1);}return out;
 }
 return copy(value);
}
export function completeSlotRegistry(tag){return selectedSlots(selectCompleteProfile(tag).scenario);}
function context(value,scenario){keys(value,contextKeys);check(value.version===2);id(value.runId);for(const key of contextKeys.split(' ').filter(k=>!['version','runId'].includes(k)))digest(value[key],['candidateSha','candidateTreeSha'].includes(key)?40:64);check(value.scenarioSha256===sha(scenario));return value;}
export function validateCompletePolicy(input,options){
 try{
  const p=snapshot(input),o=snapshot(options,4096),selected=selectCompleteProfile(p.profile),profile=selected.profile,scenario=selected.scenario,slots=selectedSlots(scenario);keys(o,'context now operationalMs');const expected=context(o.context,scenario);integer(o.now);integer(o.operationalMs,1,300000);
  keys(p,'type version profile assurance service_id instance_id run_id descriptor_sha256 run_context actors_sha256 workspaces_sha256 fixture_stores_sha256 source_inventory_sha256 family_ledger_sha256 coverage expires_at');
  check(p.type==='native-complete-run-policy'&&p.version===2&&p.profile===profile.profile&&['source-test-only','installed'].includes(p.assurance));
  for(const key of ['service_id','instance_id','run_id'])id(p[key]);
  for(const key of ['descriptor_sha256','actors_sha256','workspaces_sha256','fixture_stores_sha256','source_inventory_sha256','family_ledger_sha256'])digest(p[key]);
  check(p.family_ledger_sha256===selected.commitments.family_ledger_sha256);
  context(p.run_context,scenario);check(p.run_id===expected.runId&&canonicalCaseSubject(p.run_context)===canonicalCaseSubject(expected));
  integer(p.expires_at,1);check(p.expires_at-o.now>=o.operationalMs+1000&&p.expires_at-o.now<=300000);
  check(Array.isArray(p.coverage)&&p.coverage.length===slots.length);
  for(let i=0;i<slots.length;i++){
   const row=p.coverage[i],fixed=slots[i];keys(row,'kind id requirements supported producer_id');
   check(row.kind===fixed.kind&&row.id===fixed.id&&canonicalCaseSubject(row.requirements)===canonicalCaseSubject(fixed.requirements)&&typeof row.supported==='boolean');
   if(!row.supported)check(row.producer_id===null);
   else check(!unavailable.has(row.id)&&row.producer_id==='native-complete-'+fixed.kind);
  }
  return freeze(p);
 }catch{fail();}
}
/** Digest only; callers must separately validate and authenticate their policy. */
export function completePolicyDigest(value){return sha(snapshot(value));}

// Shared private protocol primitives; none performs authority or effect admission.
export {snapshot as snapshotCompleteValue,keys as completeKeys,check as completeCheck,
  id as completeId,digest as completeDigest,integer as completeInteger,freeze as freezeCompleteValue};
