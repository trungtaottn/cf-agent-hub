/** Structural handoff only; the fixed adapter owns authenticated service intake. */
import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {validateCompletePreparation} from './native-complete-preparation.mjs';
import {snapshotCompleteValue as snapshot,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
import {completeClientFields as fields} from './native-complete-client-proof.mjs';
const fail=()=>{throw Error('NATIVE_COMPLETE_PRESPAWN_REJECTED');},check=v=>{if(!v)fail();},sha=v=>createHash('sha256').update(canonical(v)).digest('hex');
export function snapshotCompletePreSpawnHook(adapter){
 check(adapter&&['object','function'].includes(typeof adapter)&&!types.isProxy(adapter));
 const d=Object.getOwnPropertyDescriptor(adapter,'beforeNativeProcess');check(d?.enumerable&&Object.hasOwn(d,'value')&&typeof d.value==='function'&&!types.isProxy(d.value));
 return (...args)=>Reflect.apply(d.value,adapter,args);
}
export function validateCompletePreSpawnAck(input,expected){
 const a=snapshot(fields(input,['runId','invocationId','configSha256','scenarioSha256','completePreparation','ack'])),e=snapshot(fields(expected,['profile','stepId','runContext','invocationId','invocation','refs','pin','requestInput','inputPublication','inputAdmission','nativePreparation']));
 const slot={kind:'process',id:e.stepId},p=validateCompletePreparation(a.completePreparation,slot,e.profile),c=e.runContext;
 check(a.runId===c.runId&&a.invocationId===e.invocationId&&a.configSha256===c.configSha256&&a.scenarioSha256===c.scenarioSha256&&p.invocation_id===e.invocationId&&p.invocation_commitment_sha256===sha(e.invocation)&&p.refs_sha256===sha(e.refs));
 const ack=fields(a.ack,['status','slot','preparation_sha256']);fields(ack.slot,['kind','id']);check(ack.status==='prepared'&&canonical(ack.slot)===canonical(slot)&&ack.preparation_sha256===sha(p));
 check(e.invocation.nodeSha256===c.nodeSha256&&e.invocation.entrySha256===c.buildSha256);
 if(e.nativePreparation!==null){const n=e.nativePreparation;check(n.type==='native-case-preparation-original'&&n.version===1&&n.step_id===e.stepId&&n.run_id===c.runId&&n.config_sha256===c.configSha256&&n.scenario_sha256===c.scenarioSha256&&n.invocation_commitment_sha256===p.invocation_commitment_sha256&&canonical(n.subject)===canonical(p.subject));}
 else check(p.subject===null);
 if(e.pin===null)check(e.requestInput===null&&e.inputPublication===null&&e.inputAdmission===null&&p.input===null);
 else{
  fields(e.pin,['sha256','byteSize']);check(e.requestInput!==null&&e.inputPublication!==null&&e.inputAdmission!==null&&p.input!==null);
  for(const r of [e.requestInput,e.inputPublication,e.inputAdmission])check(r.sha256===e.pin.sha256&&r.byteSize===e.pin.byteSize);
  check(e.inputPublication.stepId===e.stepId&&e.inputAdmission.stepId===e.stepId&&p.input.sha256===e.pin.sha256&&p.input.byte_size===e.pin.byteSize&&p.input.semantic_body_sha256===sha(e.requestInput.body)&&p.input.publication_record_sha256===sha(e.inputPublication)&&p.input.admission_record_sha256===sha(e.inputAdmission));
 }
 return freeze(p);
}
