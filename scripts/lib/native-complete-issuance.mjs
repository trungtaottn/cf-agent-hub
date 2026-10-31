/** Private fixed-service byte ownership. Not a payload producer or trust installer.
 * Call only after actual source validation; signatures do not prove semantics. */
import {createHash,createPublicKey,KeyObject} from 'node:crypto';
import {types} from 'node:util';
import {isOwnedEd25519PrivateKey} from './native-owned-ed25519-key.mjs';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {completeClientFields as fields} from './native-complete-client-proof.mjs';
import {validateCompletePolicy,completePolicyDigest,snapshotCompleteValue as snapshot,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
import {validateCompleteRequest} from './native-complete-request.mjs';
import {completeCallSchedule} from './native-complete-call-owner.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {createCompleteServiceAuthenticator} from './native-complete-service-auth.mjs';
import {completeOriginalCap,encodeCompleteOriginal} from './native-complete-original-wire.mjs';
const fail=()=>{throw Error('NATIVE_COMPLETE_ISSUANCE_REJECTED');},check=v=>{if(!v)fail();},hash=v=>createHash('sha256').update(v).digest('hex'),same=(a,b)=>canonical(a)===canonical(b);
const typed=s=>!!s?.caseId||['prepare/fail-create','prepare/revoke-own-positive'].includes(s?.id);
function families(row,selected){
 if(row.operation==='execute-control')return ['control-acknowledgment'];
 if(row.operation==='execute-external')return ['external-observation'];
 if(row.operation==='scan-process-output')return ['secret-inventory-scan'];
 if(row.operation==='finalize-run-scan')return ['final-output-scan','control-roster','slot-coverage-roster'];
 if(row.operation!=='observe-slot')return [];
 if(row.slot.kind==='external')return [];
 if(row.slot.kind==='control')return row.slot.id==='control/revoke-submitter'?['disable-acknowledgment']:[];
 return [typed(selected.scenario.steps.find(s=>s.id===row.slot.id))?'independent-observation':'process-observation-summary'];
}
const logical=(row,family)=>[row.slot?.kind??'run',row.slot?.id??'run',family,row.pass??''].join('\0');
export function createCompleteIssuanceOwner(input){try{
 const a=fields(input,['policy','validationOptions','installation','privateKey']),options=freeze(snapshot(a.validationOptions,4096)),policy=validateCompletePolicy(a.policy,options),selected=selectCompleteProfile(policy.profile),installation=freeze(snapshot(a.installation,16384));
 createCompleteServiceAuthenticator({policy,validationOptions:options,installation});
 if(!isOwnedEd25519PrivateKey(a.privateKey)){check(a.privateKey&&!types.isProxy(a.privateKey)&&a.privateKey instanceof KeyObject);const kd=Object.getOwnPropertyDescriptors(a.privateKey),keyType=Object.getOwnPropertyDescriptor(KeyObject.prototype,'type')?.get;check(!['type','asymmetricKeyType','export'].some(k=>Object.hasOwn(kd,k))&&typeof keyType==='function');check(keyType.call(a.privateKey)==='private');}const key=createPublicKey(a.privateKey);check(key.asymmetricKeyType==='ed25519');
 const der=key.export({type:'spki',format:'der'});check(der.length===44&&der.toString('base64')===installation.payload.service_key_spki_base64);
 const schedule=completeCallSchedule(policy.profile),roster=new Map();
 for(const row of schedule)for(const family of families(row,selected)){const id=logical(row,family);check(!roster.has(id));roster.set(id,{row,family});}
 const records=new Map(),logicalRecords=new Map(),reads=new Set();let total=0,closed=false,failed=false,busy=false;
 const guard=fn=>{try{check(!closed&&!failed&&!busy);busy=true;return fn();}catch{failed=true;fail();}finally{busy=false;}};
 function request(value){const r=validateCompleteRequest(value,policy,options),row=schedule[r.sequence-1];check(row&&row.operation===r.operation&&same(row.slot,r.payload.slot??null)&&row.pass===(r.payload.pass??null));return {r,row};}
 function subject(r,input){if(!r.payload.slot){check(input===null);return null;}const s=freeze(snapshot(fields(input,['preparation_sha256','invocation_id']),512));check(typeof s.preparation_sha256==='string'&&/^[a-f0-9]{64}$/.test(s.preparation_sha256));check(r.payload.slot.kind==='process'?typeof s.invocation_id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s.invocation_id):s.invocation_id===null);if(r.payload.preparation_sha256!==undefined)check(r.payload.preparation_sha256===s.preparation_sha256);if(r.payload.invocation_id!==undefined)check(r.payload.invocation_id===s.invocation_id);return s;}
 function lookup(input){const ref=freeze(snapshot(fields(input,['record_id','family','sha256','byte_size']),512)),found=records.get(ref.record_id);check(found&&same(ref,found.reference));return found;}
 const result=found=>Object.freeze({scope:'source-issuance-only',installedAuthority:false,native_conformance:false,reference:found.reference,metadata:found.metadata,wire:Buffer.from(found.wire)});
 function issue(input){return guard(()=>{
  const v=fields(input,['request','slotSubject','family','payload']),{r,row}=request(v.request),s=subject(r,v.slotSubject);check(typeof v.family==='string');const id=logical(row,v.family);check(roster.has(id)&&families(row,selected).includes(v.family)&&!logicalRecords.has(id));
  if(row.slot){const coverage=policy.coverage.find(c=>c.kind===row.slot.kind&&c.id===row.slot.id);check(coverage?.supported===true&&coverage.producer_id==='native-complete-'+row.slot.kind);}
  const recordId=hash('AGENTHUB_COMPLETE_ISSUANCE_V2\n'+canonical({policy_sha256:completePolicyDigest(policy),logical:id,request_id:r.request_id,sequence:r.sequence}));
  const metadata={profile:policy.profile,service_id:policy.service_id,instance_id:policy.instance_id,run_id:policy.run_id,request_id:r.request_id,producer_id:r.payload.slot?'native-complete-'+r.payload.slot.kind:'native-complete-run',record_id:recordId,descriptor_sha256:policy.descriptor_sha256,policy_sha256:completePolicyDigest(policy),sha256:'0'.repeat(64),sequence:r.sequence,family:v.family,byte_size:1,...(s?{slot:r.payload.slot,invocation_id:s.invocation_id,preparation_sha256:s.preparation_sha256}:{scope:'run'})};
  const cap=completeOriginalCap(metadata),payload=freeze(snapshot(v.payload,cap)),bytes=Buffer.from(canonical(payload));check(bytes.length>0&&bytes.length<=cap&&records.size<roster.size&&records.size<selected.profile.release.records&&total+bytes.length<=Math.min(16*1024*1024,selected.profile.release.total_bytes));
  metadata.sha256=hash(bytes);metadata.byte_size=bytes.length;const wire=encodeCompleteOriginal({expected:metadata,bytes,privateKey:a.privateKey}),reference=freeze({record_id:recordId,family:v.family,sha256:metadata.sha256,byte_size:bytes.length}),found={metadata:freeze(metadata),reference,bytes,wire};
  records.set(recordId,found);logicalRecords.set(id,found);total+=bytes.length;return result(found);
 });}
 function read(input){return guard(()=>{const v=fields(input,['request','slotSubject']),{r}=request(v.request);check(['read-original','read-run-original'].includes(r.operation));const s=subject(r,v.slotSubject),{slot,...ref}=r.payload,found=lookup(ref),m=found.metadata;check(!reads.has(m.record_id)&&m.sequence<r.sequence&&m.request_id!==r.request_id);if(s)check(same(m.slot,slot)&&m.invocation_id===s.invocation_id&&m.preparation_sha256===s.preparation_sha256);else check(m.scope==='run');reads.add(m.record_id);return Buffer.from(found.wire);});}
 function reuseControl(input){return guard(()=>{const v=fields(input,['request','slotSubject']),{r,row}=request(v.request),s=subject(r,v.slotSubject);check(r.operation==='observe-slot'&&row.slot.kind==='control'&&row.slot.id!=='control/revoke-submitter');const found=logicalRecords.get(logical(row,'control-acknowledgment'));check(found&&found.metadata.sequence<r.sequence&&found.metadata.preparation_sha256===s.preparation_sha256);return result(found);});}
 function reuseExternal(input){return guard(()=>{const v=fields(input,['request','slotSubject']),{r,row}=request(v.request),s=subject(r,v.slotSubject);check(r.operation==='observe-slot'&&row.slot.kind==='external');const found=logicalRecords.get(logical(row,'external-observation'));check(found&&found.metadata.sequence<r.sequence&&found.metadata.request_id!==r.request_id&&found.metadata.preparation_sha256===s.preparation_sha256&&found.metadata.invocation_id===s.invocation_id);return result(found);});}
 return Object.freeze({issue,read,reuseControl,reuseExternal,resolve:ref=>guard(()=>result(lookup(ref))),snapshot:()=>freeze({scope:'source-issuance-only',records:records.size,payload_bytes:total,maximum_records:roster.size,reads:reads.size,closed,failed,installedAuthority:false,native_conformance:false}),close(){closed=true;for(const found of records.values()){found.bytes.fill(0);found.wire.fill(0);}records.clear();logicalRecords.clear();reads.clear();return Object.freeze({status:'closed',scope:'source-local-memory-only'});}});
}catch{fail();}}
