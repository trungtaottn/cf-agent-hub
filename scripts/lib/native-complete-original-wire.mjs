/** Signed byte statement transport only. Real payload semantics and installed
 * trust are separately mandatory. Never signs host-local or private raw families.
 */
import {createHash,createPublicKey,sign,verify,KeyObject} from 'node:crypto';
import {types} from 'node:util';
import {canonicalCaseSubject} from './r2-case-policy.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import caps from './native-complete-original-caps.json' with {type:'json'};
const fail=()=>{throw Error('NATIVE_COMPLETE_ORIGINAL_REJECTED');};
const check=x=>{if(!x)fail();};
const hash=b=>createHash('sha256').update(b).digest('hex');
const domain='AGENTHUB_NATIVE_COMPLETE_ORIGINAL_V2\n';
const ids=['service_id','instance_id','run_id','request_id','producer_id','record_id'];
const hashes=['descriptor_sha256','policy_sha256','sha256'];
const common=['profile',...ids,...hashes,'sequence','family','byte_size'];
const runCaps=Object.freeze({'final-output-scan':1188,'control-roster':33615,'slot-coverage-roster':23390});
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
freeze(caps);
function closed(v,names){
 check(v&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype);
 const ds=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(ds).length===names.length);
 return Object.fromEntries(names.map(k=>{check(ds[k]?.enumerable&&Object.hasOwn(ds[k],'value'));return[k,ds[k].value];}));
}
const id=v=>check(typeof v==='string'&&v.length>0&&v.length<=128&&!/[^A-Za-z0-9_-]/.test(v));
const digest=v=>check(typeof v==='string'&&v.length===64&&!/[^a-f0-9]/.test(v));
const typed=s=>!!s.caseId||['prepare/fail-create','prepare/revoke-own-positive'].includes(s.id);
function metadata(input){
 check(input&&!types.isProxy(input)&&Object.getPrototypeOf(input)===Object.prototype);
 const scope=Object.getOwnPropertyDescriptor(input,'scope');
 const run=!!scope;
 const v=closed(input,[...common,...(run?['scope']:['slot','invocation_id','preparation_sha256'])]);
 const selected=selectCompleteProfile(v.profile);for(const k of ids)id(v[k]);for(const k of hashes)digest(v[k]);
 check(Number.isSafeInteger(v.sequence)&&v.sequence>0&&v.sequence<=selected.profile.limits.service_calls);
 check(typeof v.family==='string');let cap;
 if(run){check(v.scope==='run'&&Object.hasOwn(runCaps,v.family));cap=runCaps[v.family];}
 else{
  v.slot=closed(v.slot,['kind','id']);check(typeof v.slot.kind==='string'&&typeof v.slot.id==='string');digest(v.preparation_sha256);
  const step=selected.scenario.steps.find(s=>s.id===v.slot.id),external=selected.scenario.externalRequirements.find(s=>s.id===v.slot.id);
  check((step&&v.slot.kind===(step.kind==='control'?'control':'process'))||(external&&v.slot.kind==='external'));
  check(!v.slot.id.startsWith('control/prepare-swap-')&&!v.slot.id.startsWith('probe/swapped-'));
  if(v.slot.kind==='process')id(v.invocation_id);else check(v.invocation_id===null);
  if(v.family==='independent-observation'){check(step&&step.kind!=='control'&&typed(step));cap=9960;}
  else if(v.family==='disable-acknowledgment'){check(v.slot.id==='control/revoke-submitter');cap=9960;}
  else if(v.family==='external-observation'){check(!!external);cap=16384;}
  else if(v.family==='secret-inventory-scan'){check(step&&step.kind!=='control');cap=1557;}
  else if(v.family==='process-observation-summary'){check(step&&step.kind!=='control'&&!typed(step)&&Object.hasOwn(caps.summary_records,step.id));cap=caps.summary_records[step.id];}
  else if(v.family==='control-acknowledgment'){check(step?.kind==='control'&&Object.hasOwn(caps.control_records,step.id));cap=caps.control_records[step.id];}
  else fail();
 }
 check(Number.isSafeInteger(cap)&&Number.isSafeInteger(v.byte_size)&&v.byte_size>=1&&v.byte_size<=cap);
 return {value:v,cap};
}
export function completeOriginalCap(value){try{return metadata(value).cap;}catch{fail();}}
const typedArray=Object.getPrototypeOf(Uint8Array.prototype),getLength=Object.getOwnPropertyDescriptor(typedArray,'byteLength').get,getBuffer=Object.getOwnPropertyDescriptor(typedArray,'buffer').get;
function bytes(v,max){
 check(v&&!types.isProxy(v)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(v)));
 const n=getLength.call(v);check(n<=max&&Object.getPrototypeOf(getBuffer.call(v))===ArrayBuffer.prototype);
 check(Reflect.ownKeys(v).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));return Buffer.from(v);
}
function base64(v,n){
 check(typeof v==='string'&&v.length===4*Math.ceil(n/3)&&!/[^A-Za-z0-9+/=]/.test(v));
 const out=Buffer.from(v,'base64');check(out.length===n&&out.toString('base64')===v);return out;
}
function wireLimit(m,cap){
 const max={type:'native-complete-original',version:2,...m,sequence:selectCompleteProfile(m.profile).profile.limits.service_calls,byte_size:cap,payload_base64:'',signature_base64:'/'.repeat(86)+'=='};
 for(const k of ids)max[k]='z'.repeat(128);
 if(max.invocation_id!==undefined&&max.invocation_id!==null)max.invocation_id='z'.repeat(128);
 return Buffer.byteLength(canonicalCaseSubject(max))+4*Math.ceil(cap/3);
}
const keyType=Object.getOwnPropertyDescriptor(KeyObject.prototype,'type').get;
function privateKey(v){check(v&&!types.isProxy(v)&&v instanceof KeyObject);const ds=Object.getOwnPropertyDescriptors(v);check(!['type','asymmetricKeyType','export'].some(k=>Object.hasOwn(ds,k)));check(keyType.call(v)==='private'&&createPublicKey(v).asymmetricKeyType==='ed25519');return v;}
const signed=v=>Buffer.from(domain+canonicalCaseSubject(v));
export function encodeCompleteOriginal(input){
 try{
  const v=closed(input,['expected','bytes','privateKey']),{value:m,cap}=metadata(v.expected),raw=bytes(v.bytes,cap);
  check(raw.length===m.byte_size&&hash(raw)===m.sha256);const key=privateKey(v.privateKey);
  const envelope={type:'native-complete-original',version:2,...m,payload_base64:raw.toString('base64')};
  const signature=sign(null,signed(envelope),key);check(signature.length===64);
  const wire=Buffer.from(canonicalCaseSubject({...envelope,signature_base64:signature.toString('base64')}));check(wire.length<=wireLimit(m,cap));return wire;
 }catch{fail();}
}
export function verifyCompleteOriginal(input){
 try{
  const v=closed(input,['expected','wire','publicKeyDer']),{value:m,cap}=metadata(v.expected),wire=bytes(v.wire,wireLimit(m,cap));check(wire.length>0);
  const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(wire),envelope=closed(JSON.parse(text),['type','version',...Object.keys(m),'payload_base64','signature_base64']);
  check(envelope.type==='native-complete-original'&&envelope.version===2&&canonicalCaseSubject(envelope)===text);
  const {type,version,payload_base64,signature_base64,...observed}=envelope;metadata(observed);check(canonicalCaseSubject(observed)===canonicalCaseSubject(m));
  check(typeof payload_base64==='string'&&payload_base64.length===4*Math.ceil(m.byte_size/3));
  const der=bytes(v.publicKeyDer,44);check(der.length===44);const key=createPublicKey({key:der,type:'spki',format:'der'});check(key.asymmetricKeyType==='ed25519'&&key.export({type:'spki',format:'der'}).equals(der));
  const signature=base64(signature_base64,64);check(verify(null,signed({type,version,...observed,payload_base64}),key,signature));
  const raw=base64(payload_base64,m.byte_size);check(hash(raw)===m.sha256);
  return Object.freeze({scope:'signed-statement-only',installedAuthority:false,native_conformance:false,metadata:freeze(m),bytes:raw});
 }catch{fail();}
}
