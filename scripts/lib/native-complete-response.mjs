/** Structural transport framing only. A pinned original signature, owned phase
 * state and payload semantics remain mandatory before any evidence is consumed. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalCaseSubject} from './r2-case-policy.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
import {validateCompleteRequest} from './native-complete-request.mjs';
import {completeOriginalCap} from './native-complete-original-wire.mjs';
import {snapshotCompleteValue as snapshot,completeKeys as keys,completeCheck as check,completeId as id,completeDigest as digest,completeInteger as integer,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
import rows from './native-complete-response-limits.json' with {type:'json'};
const hash=v=>createHash('sha256').update(canonicalCaseSubject(v)).digest('hex');
const same=(a,b)=>check(canonicalCaseSubject(a)===canonicalCaseSubject(b));
const limits=new Map(rows.map(r=>[[r.operation,r.slot,r.pass??''].join('\0'),r.response_bytes]));
check(rows.length===370&&limits.size===370&&rows.reduce((n,row)=>n+row.response_bytes,0)===1585635);
const fail=()=>{throw Error('NATIVE_COMPLETE_RESPONSE_REJECTED');};
const typed=s=>!!s?.caseId||['prepare/fail-create','prepare/revoke-own-positive'].includes(s?.id);
const envelopeKeys='type version profile service_id instance_id run_id descriptor_sha256 policy_sha256 sequence request_id operation data installedAuthority native_conformance';
function admitted(request,policy,options){
 const r=validateCompleteRequest(request,policy,options),selected=selectCompleteProfile(r.profile);
 const cap=limits.get([r.operation,r.payload.slot?.id??'run',r.payload.pass??''].join('\0'));integer(cap,1,80140);return {r,selected,cap};
}
export function completeResponseByteLimit(request,policy,options){try{return admitted(request,policy,options).cap;}catch{fail();}}
function subjectFor(r,input){
 if(!r.payload.slot){check(input===null);return null;}
 const s=snapshot(input,512);keys(s,'preparation_sha256 invocation_id');digest(s.preparation_sha256);
 if(r.payload.slot.kind==='process')id(s.invocation_id);else check(s.invocation_id===null);
 if(r.payload.preparation_sha256!==undefined)check(s.preparation_sha256===r.payload.preparation_sha256);
 if(r.payload.invocation_id!==undefined)check(s.invocation_id===r.payload.invocation_id);
 if(r.operation==='prepare-slot'){check(s.preparation_sha256===hash(r.payload.preparation));if(r.payload.slot.kind==='process')check(s.invocation_id===r.payload.preparation.invocation_id);}return s;
}
function reference(v,family,cap){keys(v,'record_id family sha256 byte_size');id(v.record_id);digest(v.sha256);check(v.family===family);integer(v.byte_size,1,cap);return v;}
function usage(v,reservation){keys(v,'commands mutations artifact_bytes output_bytes');for(const k of Object.keys(v))integer(v[k],0,reservation[k]);}
function signed(v,r,subject,family,ref=null,prior=false){
 const {payload_base64,signature_base64,type,version,...metadata}=v;
 check(type==='native-complete-original'&&version===2);completeOriginalCap(metadata);
 // The metadata validator is closed. No decoded payload allocation or signature
 // verification occurs here, and no caller may interpret this as authentication.
 check(metadata.family===family&&metadata.profile===r.profile);
 for(const k of ['service_id','instance_id','run_id','descriptor_sha256','policy_sha256'])check(metadata[k]===r[k]);
 if(!prior)for(const k of ['sequence','request_id'])check(metadata[k]===r[k]);else check(metadata.sequence<r.sequence&&metadata.request_id!==r.request_id);
 if(subject){same(metadata.slot,r.payload.slot);check(metadata.preparation_sha256===subject.preparation_sha256&&metadata.invocation_id===subject.invocation_id);}else check(metadata.scope==='run');
 if(ref){for(const k of ['record_id','family','sha256','byte_size'])check(metadata[k]===ref[k]);}
 check(typeof payload_base64==='string'&&payload_base64.length===4*Math.ceil(metadata.byte_size/3)&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload_base64));
 if(payload_base64.endsWith('=='))check('AQgw'.includes(payload_base64.at(-3)));else if(payload_base64.endsWith('='))check('AEIMQUYcgkosw048'.includes(payload_base64.at(-2)));
 check(typeof signature_base64==='string'&&signature_base64.length===88&&/^[A-Za-z0-9+/]{86}==$/.test(signature_base64)&&'AQgw'.includes(signature_base64.at(-3)));return v;
}
export function validateCompleteResponse(input,request,policy,options,slotSubject=null){
 try{
  const {r,selected,cap}=admitted(request,policy,options),v=snapshot(input,cap),subject=subjectFor(r,slotSubject),p=selected.profile;
  check(Buffer.byteLength(canonicalCaseSubject(v))<=cap);
  const direct={'execute-control':'control-acknowledgment','read-original':r.payload.family,'scan-process-output':'secret-inventory-scan','read-run-original':'final-output-scan'};
  if(Object.hasOwn(direct,r.operation)){
   const ref=['read-original','read-run-original'].includes(r.operation)?r.payload:null;
   // Read operations return the retained issuance envelope, not a newly signed
   // read receipt. Its issuance identity must be resolved by the semantic owner.
   signed(v,r,subject,direct[r.operation],ref,!!ref);
  }else{
   keys(v,envelopeKeys);check(v.type==='native-complete-response'&&v.version===2&&v.installedAuthority===false&&v.native_conformance===false);
   for(const k of ['profile','service_id','instance_id','run_id','descriptor_sha256','policy_sha256','sequence','request_id','operation'])check(v[k]===r[k]);
   const d=v.data,slot=r.payload.slot;
   switch(r.operation){
    case 'preflight':{
     keys(d,'status coverage_sha256 family_ledger_sha256 unsupported');check(['ready','blocked'].includes(d.status));check(d.coverage_sha256===hash(policy.coverage)&&d.family_ledger_sha256===selected.commitments.family_ledger_sha256);
     const absent=['control/prepare-swap-','probe/swapped-'].flatMap(prefix=>['slot','generation','principal'].map(part=>prefix+part)).filter(id=>selected.scenario.steps.some(s=>s.id===id));same(d.unsupported,absent);
     if(d.status==='ready')check(absent.length===0&&policy.coverage.every(row=>row.supported));break;
    }
    case 'bind-run':keys(d,'status policy_sha256 reservation_sha256');check(d.status==='bound'&&d.policy_sha256===r.policy_sha256&&d.reservation_sha256===hash(p.reservation));break;
    case 'prepare-slot':keys(d,'status slot preparation_sha256');check(d.status==='prepared'&&d.preparation_sha256===subject.preparation_sha256);same(d.slot,slot);break;
    case 'complete-process':keys(d,'status slot invocation_id preparation_sha256 process_final_sha256');check(d.status==='process-recorded'&&d.invocation_id===subject.invocation_id&&d.preparation_sha256===subject.preparation_sha256&&d.process_final_sha256===r.payload.custody.final.sha256);same(d.slot,slot);break;
    case 'execute-external':keys(d,'status slot preparation_sha256 effect_original');check(d.status==='effect-recorded'&&d.preparation_sha256===subject.preparation_sha256);same(d.slot,slot);reference(d.effect_original,'external-observation',16384);break;
    case 'observe-slot':{
     keys(d,'manifest original');const m=d.manifest;
     keys(m,'type version profile run_id slot preparation_sha256 effect_record_sha256 producer_id assurance records typed_observation_ref observed_at usage');
     check(m.type==='native-complete-slot-manifest'&&m.version===2&&m.profile===r.profile&&m.run_id===r.run_id&&m.preparation_sha256===subject.preparation_sha256&&m.assurance===policy.assurance);same(m.slot,slot);id(m.producer_id);const producer=policy.coverage.find(row=>row.kind===slot.kind&&row.id===slot.id);check(producer?.supported&&m.producer_id===producer.producer_id);digest(m.effect_record_sha256);integer(m.observed_at);usage(m.usage,p.reservation);
     const step=selected.scenario.steps.find(s=>s.id===slot.id),summary=slot.kind==='process'&&!typed(step);
     const family=slot.kind==='external'?'external-observation':slot.kind==='control'?(slot.id==='control/revoke-submitter'?'disable-acknowledgment':'control-acknowledgment'):summary?'process-observation-summary':'independent-observation';
     check(Array.isArray(m.records)&&m.records.length===1);const ref=m.records[0];
     reference(ref,family,completeOriginalCap({profile:r.profile,service_id:r.service_id,instance_id:r.instance_id,run_id:r.run_id,request_id:r.request_id,producer_id:m.producer_id,record_id:ref.record_id,descriptor_sha256:r.descriptor_sha256,policy_sha256:r.policy_sha256,sha256:ref.sha256,sequence:r.sequence,family,byte_size:ref.byte_size,slot,invocation_id:subject.invocation_id,preparation_sha256:subject.preparation_sha256}));
     if(slot.kind==='control')check(m.typed_observation_ref===null);else same(m.typed_observation_ref,ref);
     if(summary){signed(d.original,r,subject,family,ref);check(d.original.producer_id===m.producer_id);}else check(d.original===null);break;
    }
    case 'seal-scan-inventory':keys(d,'status inventory_generation inventory_sha256 secret_pattern_count foreign_pattern_count secret_inventory_sha256 foreign_inventory_sha256 secret_provenance_sha256 foreign_provenance_sha256');check(d.status==='inventory-sealed'&&d.inventory_generation===15&&d.secret_pattern_count===10&&d.foreign_pattern_count===5);for(const k of Object.keys(d).filter(k=>k.endsWith('sha256')))digest(d[k]);break;
    case 'finalize-run-scan':keys(d,'status scan_ref control_roster coverage_roster');check(d.status==='run-scan-complete');reference(d.scan_ref,'final-output-scan',1188);signed(d.control_roster,r,null,'control-roster');signed(d.coverage_roster,r,null,'slot-coverage-roster');break;
    case 'close-run':keys(d,'status attempted_slots observed_slots originals_read pending usage');check(['closed','cleanup-unknown'].includes(d.status));integer(d.attempted_slots,0,selected.scenario.steps.length+selected.scenario.externalRequirements.length);integer(d.observed_slots,0,d.attempted_slots);integer(d.originals_read,0,43);integer(d.pending);if(d.status==='closed')check(d.pending===0);usage(d.usage,p.reservation);break;
    default:check(false);
   }
  }
  return freeze({scope:'structural-response-only',signature_verified:false,installedAuthority:false,native_conformance:false,value:v});
 }catch{fail();}
}
export function parseCompleteResponseWire(wire,request,policy,options,slotSubject=null){
 try{
  const cap=completeResponseByteLimit(request,policy,options);
  check(wire&&!types.isProxy(wire)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(wire)));
  const proto=Object.getPrototypeOf(Uint8Array.prototype),n=Object.getOwnPropertyDescriptor(proto,'byteLength').get.call(wire),buffer=Object.getOwnPropertyDescriptor(proto,'buffer').get.call(wire);
  check(n>0&&n<=cap&&Object.getPrototypeOf(buffer)===ArrayBuffer.prototype);
  check(Reflect.ownKeys(wire).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));
  const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(wire)),value=JSON.parse(text);check(canonicalCaseSubject(value)===text);
  return validateCompleteResponse(value,request,policy,options,slotSubject);
 }catch{fail();}
}
