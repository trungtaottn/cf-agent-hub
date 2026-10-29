/** Pure, bounded projection of custody originals. No I/O or authentication. */
import {createHash} from 'node:crypto';
import {CASE_POLICY,caseSchemas,validateCaseFamily,validateNativeCaseCore,canonicalCaseSubject} from './r2-case-policy.mjs';
const HASH=/^[a-f0-9]{64}$/, ID=/^[A-Za-z0-9_-]{1,128}$/;
const reject=code=>{throw Error('NATIVE_EVIDENCE_'+code);};
const typedArrayProto=Object.getPrototypeOf(Uint8Array.prototype);
const typedLength=Object.getOwnPropertyDescriptor(typedArrayProto,'byteLength').get;
const typedBuffer=Object.getOwnPropertyDescriptor(typedArrayProto,'buffer').get;
const sha=value=>createHash('sha256').update(value).digest('hex');
function closed(value,keys){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)reject('SHAPE');
 const d=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!Object.hasOwn(d,k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))reject('SHAPE');
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function array(value,max){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>max)reject('BUDGET');
 const ds=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(ds).length!==value.length+1)reject('SHAPE');
 return Array.from({length:value.length},(_,i)=>{const d=ds[i];if(!d||!Object.hasOwn(d,'value'))reject('SHAPE');return d.value;});
}
function plain(value,depth=0){
 if(depth>32)reject('SHAPE');
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isSafeInteger(value))reject('SHAPE');return value;}
 if(Array.isArray(value))return array(value,4096).map(v=>plain(v,depth+1));
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)reject('SHAPE');
 const ds=Object.getOwnPropertyDescriptors(value),out={};
 for(const k of Reflect.ownKeys(ds)){if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable)reject('SHAPE');out[k]=plain(ds[k].value,depth+1);}return out;
}
/** Limits apply before parsing/copying already materialized buffers, not upstream reads. */
function reserveOriginals(input){
 const rows=array(input,512).map(value=>closed(value,['id','sha256','bytes']));let total=0;
 for(const row of rows){if(!ID.test(row.id)||!HASH.test(row.sha256)||!(row.bytes instanceof Uint8Array)||Object.getPrototypeOf(row.bytes)!==Uint8Array.prototype&&Object.getPrototypeOf(row.bytes)!==Buffer.prototype)reject('SHAPE');for(const k of ['byteLength','byteOffset','buffer','length','constructor','valueOf',Symbol.toPrimitive])if(Object.hasOwn(row.bytes,k))reject('SHAPE');const buffer=typedBuffer.call(row.bytes);if(buffer instanceof SharedArrayBuffer)reject('SHAPE');const n=typedLength.call(row.bytes);if(n<1||n>65536||total+n>16777216)reject('BUDGET');total+=n;}
 return {rows,total};
}
export function loadNativeOriginals(input){
 const {rows}=reserveOriginals(input);
 const result=new Map();
 for(const row of rows){if(result.has(row.id))reject('DUPLICATE');const copy=new Uint8Array(typedLength.call(row.bytes));Uint8Array.prototype.set.call(copy,row.bytes);const bytes=Buffer.from(copy.buffer);if(sha(bytes)!==row.sha256)reject('DIGEST');if(bytes[0]===239&&bytes[1]===187&&bytes[2]===191)reject('UTF8');let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{reject('JSON');}result.set(row.id,{sha256:row.sha256,byte_size:bytes.length,value:plain(parsed)});}return result;
}
export function nativeSourceInventoryDigest(input){
 const rows=array(input,2048).map(v=>closed(v,['path','sha256','byte_size','mode'])),paths=new Set();
 if(rows.length===0)reject('INVENTORY');
 for(const r of rows){if(typeof r.path!=='string'||Buffer.byteLength(r.path)>256||!r.path||r.path.startsWith('/')||r.path.includes('\\')||r.path.split('/').some(p=>!p||p==='.'||p==='..')||/[\x00-\x20\x7f]/.test(r.path)||/^[a-z]:/i.test(r.path)||!HASH.test(r.sha256)||!Number.isSafeInteger(r.byte_size)||r.byte_size<0||!['100644','100755'].includes(r.mode)||paths.has(r.path))reject('INVENTORY');paths.add(r.path);}
 rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);const encoded=canonicalCaseSubject(rows);if(Buffer.byteLength(encoded)>4194304)reject('BUDGET');return sha(encoded);
}

import Ajv from 'ajv';
import {validR2Command,receiptPolicies} from './r2-schema-registry.mjs';
import {getNativeScenario} from './native-r2-scenario.mjs';
import {validateNativeConfig} from './native-r2-config.mjs';
import {nativeConfigDigest} from './native-r2-admission.mjs';
const ajv=new Ajv({strict:true,allErrors:false,inlineRefs:false});ajv.addSchema(caseSchemas);
const subjectShape=ajv.compile({$ref:caseSchemas.$id+'#/$defs/prepared_subject'});
const fields=text=>text.split(' ');
const same=(a,b)=>canonicalCaseSubject(a)===canonicalCaseSubject(b);
const requireValue=(v,code='JOIN')=>{if(!v)reject(code);};
const n=v=>Number.isSafeInteger(v)&&v>=0;
const boundedIds=(v,max=128)=>{const values=array(v,max);requireValue(values.every(x=>typeof x==='string'&&/^[\x20-\x7e]{1,128}$/.test(x))&&new Set(values).size===values.length,'SHAPE');return values;};
const boundedHashes=v=>{const values=array(v,128);requireValue(values.every(x=>HASH.test(x)),'SHAPE');return values;};
const hashObject=v=>sha(canonicalCaseSubject(v));
const CONTEXT=fields('config_record_id run_id candidate_sha candidate_git_tree_sha source_inventory environment_id composition_sha256 config_sha256 scenario_sha256 authority_record_sha256 node_sha256 executable_sha256 actors_sha256 workspaces_sha256 workspace_id config_epoch observer_id');
const SHARED=fields('run_id candidate_sha source_tree_sha256 environment_id composition_sha256 config_sha256 scenario_sha256 authority_record_sha256');
const SUBJECTS=fields('config_sha256 candidate_sha candidate_tree_sha composition_sha256 node_sha256 build_sha256 authority_record_sha256 scenario_sha256 actors_sha256 workspaces_sha256');
const OBSERVER=fields('type version run_id case_id step_id invocation_id observed_at config_sha256 scenario_sha256 authority_record_sha256 process_final_sha256 preparation_sha256 subject_sha256 observer_id binding projection transport resources artifact journal revocation');
function contextInput(input){
 const c=plain(closed(input,CONTEXT));for(const k of CONTEXT.filter(k=>k.endsWith('_sha256')))requireValue(HASH.test(c[k]),'CONTEXT');
 requireValue(/^[a-f0-9]{40}$/.test(c.candidate_sha)&&/^[a-f0-9]{40}$/.test(c.candidate_git_tree_sha)&&ID.test(c.config_record_id)&&ID.test(c.run_id)&&/^[a-z0-9][a-z0-9_-]{0,127}$/.test(c.environment_id)&&typeof c.workspace_id==='string'&&/^[\x20-\x7e]{1,128}$/.test(c.workspace_id)&&ID.test(c.observer_id)&&n(c.config_epoch),'CONTEXT');
 const scenario=getNativeScenario();requireValue(hashObject(scenario)===c.scenario_sha256,'SCENARIO');
 return {...c,source_tree_sha256:nativeSourceInventoryDigest(c.source_inventory),processIdentities:new Map(),processOriginalDigests:new Map()};
}
function requireShared(value,c,keys=SHARED){for(const k of keys)requireValue(value[k]===c[k],'CONTEXT');}
function original(store,id,keys,type){requireValue(ID.test(id)&&store.has(id),'REFERENCE');const r=store.get(id);const value=closed(r.value,keys);if(type)requireValue(value.type===type&&value.version===1,'TYPE');return {...r,value};}
function preparation(store,id,c,caseId,stepId){
 const r=original(store,id,[...fields('type version case_id step_id prepared_at subject invocation_commitment_sha256 record_source_id'),...SHARED],'native-case-preparation-original');
 const p=r.value;requireShared(p,c);requireValue(p.case_id===caseId&&p.step_id===stepId&&n(p.prepared_at)&&HASH.test(p.invocation_commitment_sha256)&&ID.test(p.record_source_id)&&subjectShape(p.subject),'PREPARATION');return r;
}
function processOriginals(store,ids,c,prep){
 const p=original(store,ids.prepared,fields('version status invocationId subjects invocationSha256 timeoutMs maxOutputBytes preparedAt retryAllowed'));
 const s=original(store,ids.spawned,fields('version status invocationId subjects prepared identity spawnedAt retryAllowed'));
 const f=original(store,ids.final,fields('version invocationId subjects status reason startedAt endedAt closeObserved exitCode signal observedBytes retainedBytes truncated prepared spawned transcripts retryAllowed effectOutcome descendants'));
 const id=p.value.invocationId;requireValue(/^inv_[a-z0-9]{1,64}$/.test(id),'CUSTODY');
 const expected={config_sha256:c.config_sha256,candidate_sha:c.candidate_sha,candidate_tree_sha:c.candidate_git_tree_sha,composition_sha256:c.composition_sha256,node_sha256:c.node_sha256,build_sha256:c.executable_sha256,authority_record_sha256:c.authority_record_sha256,scenario_sha256:c.scenario_sha256,actors_sha256:c.actors_sha256,workspaces_sha256:c.workspaces_sha256};
 for(const r of [p,s,f]){closed(r.value.subjects,SUBJECTS);requireValue(r.value.version===1&&r.value.invocationId===id&&r.value.retryAllowed===false&&same(r.value.subjects,expected),'CUSTODY');}
 const link=(ref,r,suffix)=>{closed(ref,['name','sha256','byteSize']);requireValue(ref.name===id+suffix&&ref.sha256===r.sha256&&ref.byteSize===r.byte_size,'CUSTODY');};
 link(s.value.prepared,p,'.prepared.json');link(f.value.prepared,p,'.prepared.json');link(f.value.spawned,s,'.spawned.json');
 const pv=p.value,sv=s.value,fv=f.value;
 requireValue(pv.status==='prepared'&&sv.status==='spawned'&&pv.invocationSha256===prep.value.invocation_commitment_sha256&&n(pv.timeoutMs)&&pv.timeoutMs>0&&pv.timeoutMs<=300000&&n(pv.maxOutputBytes)&&pv.maxOutputBytes>0&&pv.maxOutputBytes<=1048576,'CUSTODY');
 closed(sv.identity,['pid','startTicks','bootId']);requireValue(n(sv.identity.pid)&&sv.identity.pid>0&&/^(?:0|[1-9][0-9]{0,19})$/.test(sv.identity.startTicks)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sv.identity.bootId),'CUSTODY');
 for(const t of [pv.preparedAt,sv.spawnedAt,fv.startedAt,fv.endedAt])requireValue(n(t),'TIME');
 requireValue(prep.value.prepared_at<=pv.preparedAt&&pv.preparedAt<=fv.startedAt&&fv.startedAt<=sv.spawnedAt&&sv.spawnedAt<=fv.endedAt,'TIME');
 requireValue(fv.status==='terminal'&&fv.reason==='exit'&&fv.closeObserved===true&&fv.signal===null&&fv.truncated===false&&n(fv.exitCode)&&fv.effectOutcome==='unknown'&&fv.descendants==='unverified','CUSTODY');
 closed(fv.transcripts,['stdout','stderr']);let size=0;
 for(const stream of ['stdout','stderr']){const t=closed(fv.transcripts[stream],['name','sha256','byteSize','complete']);requireValue(t.name===id+'.'+stream&&HASH.test(t.sha256)&&n(t.byteSize)&&t.complete===true,'CUSTODY');if(t.byteSize===0)requireValue(t.sha256===sha(''),'CUSTODY');size+=t.byteSize;}
 requireValue(size<=pv.maxOutputBytes&&fv.observedBytes===size&&fv.retainedBytes===size,'CUSTODY');
 const identity=canonicalCaseSubject(sv.identity);
 requireValue((!c.processIdentities.has(identity)||c.processIdentities.get(identity)===id)&&(!c.processOriginalDigests.has(id)||c.processOriginalDigests.get(id)===f.sha256),'PROCESS_IDENTITY');
 c.processIdentities.set(identity,id);c.processOriginalDigests.set(id,f.sha256);
 return {prepared:p,spawned:s,final:f,id};
}
function observation(store,id,c,b,prep,proc){
 const r=original(store,id,OBSERVER,'native-independent-observation'),o=r.value,s=prep.value.subject;
 requireShared(o,c,fields('run_id config_sha256 scenario_sha256 authority_record_sha256'));requireValue(o.case_id===b.case_id&&o.step_id===b.step_id&&o.invocation_id===proc.id&&o.process_final_sha256===proc.final.sha256&&o.preparation_sha256===prep.sha256&&o.subject_sha256===hashObject(s)&&o.observer_id===c.observer_id&&n(o.observed_at)&&o.observed_at>=proc.final.value.endedAt,'OBSERVER');
 closed(o.binding,fields('workspace_id principal_id agent_id credential_id runtime_id config_epoch grant_sha256 proof_sha256'));
 for(const k of fields('workspace_id principal_id agent_id credential_id runtime_id grant_sha256 proof_sha256'))requireValue(o.binding[k]===s[k],'SUBJECT');requireValue(o.binding.config_epoch===s.authority_epoch,'SUBJECT');
 const p=closed(o.projection,fields('record_sha256 stdout_sha256 stderr_sha256 stdout_bytes stderr_bytes schema_error_codes foreign_identifier_hashes secret_match_hashes runtime_token_output_count'));
 requireValue(HASH.test(p.record_sha256),'OBSERVER');for(const stream of ['stdout','stderr'])requireValue(p[stream+'_sha256']===proc.final.value.transcripts[stream].sha256&&p[stream+'_bytes']===proc.final.value.transcripts[stream].byteSize,'TRANSCRIPT');
 boundedIds(p.schema_error_codes);boundedHashes(p.foreign_identifier_hashes);boundedHashes(p.secret_match_hashes);
 return r;
}
function makeCommand(c,r,kind,caseEntry=null){
 const v=r.value,command={type:'command',version:1,id:v.id,kind,revision:c.candidate_sha,tree_sha256:c.source_tree_sha256,environment_id:c.environment_id,composition_sha256:c.composition_sha256,started_at:v.started_at,ended_at:v.ended_at,exit_code:v.exit_code,invocation:kind==='contract'?'r2-contract-v1':'r2-native-live-v1',provenance:kind==='contract'?'source':'real-run',case_ids:caseEntry?[caseEntry.case_id]:[],results:[],subjects:{graph:null,recovery:null,cases:caseEntry?[{case_id:caseEntry.case_id,subject_sha256:caseEntry.subject_sha256}]:[],platform:null},record_sha256:r.sha256};
 requireValue(validR2Command(command)&&v.exit_code===0&&v.started_at<=v.ended_at,'COMMAND');return command;
}
function projection(o,proc,c){
 const p=o.projection,b=o.binding;
 return {observer_record_sha256:null,request_record_sha256:o.transport.record_sha256,outcome_record_sha256:proc.final.sha256,projection_verifier_record_sha256:p.record_sha256,projection_error_count:p.schema_error_codes.length,foreign_leak_count:p.foreign_identifier_hashes.length,observed_workspace_id:b.workspace_id,observed_principal_id:b.principal_id,observed_agent_id:b.agent_id,observed_credential_id:b.credential_id,observed_runtime_id:b.runtime_id,observed_authority_epoch:b.config_epoch,process_id:proc.id,executable_sha256:c.executable_sha256,output_secret_count:p.secret_match_hashes.length,process_exit:proc.final.value.exitCode,request_count:0,outcome_kind:'process-transcript'};
}
function transport(o,step,subject){
 const t=o.transport;requireValue(t&&HASH.test(t.record_sha256),'TRANSPORT');
 if(o.journal!==null){closed(t,fields('record_sha256 attempted_requests client_response server_commit_record_sha256'));const requests=array(t.attempted_requests,1);requireValue(t.client_response===null,'TRANSPORT');for(const r of requests){closed(r,['operation','request_sha256']);requireValue(r.operation==='createTask'&&r.request_sha256===subject.request_sha256,'TRANSPORT');}requireValue(requests.length===step.expectedRequests&&(requests.length===1?HASH.test(t.server_commit_record_sha256):t.server_commit_record_sha256===null),'TRANSPORT');return {request_count:requests.length};}
 closed(t,['record_sha256','requests']);const requests=array(t.requests,2),ops=step.expectedRequests===2?['getArtifact',step.operation]:[step.operation];requireValue(requests.length===ops.length,'TRANSPORT');
 for(let i=0;i<requests.length;i++){const r=closed(requests[i],['operation','request_sha256','response_record_sha256','status']);requireValue(r.operation===ops[i]&&HASH.test(r.request_sha256)&&HASH.test(r.response_record_sha256)&&n(r.status)&&r.status>=100&&r.status<=599,'TRANSPORT');}
 requireValue(requests.at(-1).request_sha256===subject.request_sha256,'TRANSPORT');return {request_count:requests.length,http_status:requests.at(-1).status,...(requests.length===2?{metadata_status:requests[0].status}:{})};
}
function journalProjection(store,o,related,c,prep,proc,step){
 const j=closed(o.journal,fields('intent_id record_sha256 state original_invocation_id request_sha256 key_sha256'));
 requireValue(HASH.test(j.record_sha256)&&j.request_sha256===prep.value.subject.request_sha256&&j.key_sha256===prep.value.subject.key_sha256,'JOURNAL');
 let original=proc;
 if(step.id==='case/lost-response-retained'){requireValue(related===null,'RELATED');}
 else{
  const l=closed(related,fields('original_prepared original_spawned original_final original_preparation'));
  const oldStep=step.id==='case/restart-no-send'?'case/lost-response-retained':'prepare/fail-create';
  const oldCase=step.id==='case/restart-no-send'?'native/lost-response-retained':null;
  const oldPrep=preparation(store,l.original_preparation,c,oldCase,oldStep);
  requireValue(same(oldPrep.value.subject,prep.value.subject),'JOURNAL');
  original=processOriginals(store,{prepared:l.original_prepared,spawned:l.original_spawned,final:l.original_final},c,oldPrep);
  requireValue(original.id!==proc.id&&original.final.value.endedAt<=prep.value.prepared_at&&original.final.value.exitCode===(oldCase?5:0),'JOURNAL');
 }
 requireValue(j.original_invocation_id===original.id,'JOURNAL');
 return {intent_id:j.intent_id,journal_record_sha256:j.record_sha256,journal_state:j.state,original_process_id:original.id,retained_request_sha256:j.request_sha256,retained_key_sha256:j.key_sha256};
}
function revocationProjection(store,o,related,c,prep,proc){
 const l=closed(related,fields('positive_prepared positive_spawned positive_final positive_preparation positive_observation disable_control'));
 const v=closed(o.revocation,fields('positive_observation_record_id disable_control_record_id negative_sequence credential_version credential_slot_sha256 current_grant_state'));
 requireValue(v.positive_observation_record_id===l.positive_observation&&v.disable_control_record_id===l.disable_control,'REVOCATION');
 const positivePrep=preparation(store,l.positive_preparation,c,null,'prepare/revoke-own-positive');
 requireValue(same(positivePrep.value.subject,prep.value.subject),'REVOCATION');
 const positiveProcess=processOriginals(store,{prepared:l.positive_prepared,spawned:l.positive_spawned,final:l.positive_final},c,positivePrep);
 const pr=original(store,l.positive_observation,fields('type version run_id step_id invocation_id observed_at sequence config_sha256 scenario_sha256 authority_record_sha256 process_final_sha256 preparation_sha256 workspace_id principal_id agent_id credential_id credential_version credential_slot_sha256 current_grant_state runtime_id authority_epoch grant_sha256 proof_sha256 key_sha256 request_sha256 status foreign_identifier_hashes request_record_sha256'),'native-revocation-positive-original');
 const dr=original(store,l.disable_control,fields('type version run_id step_id observed_at sequence config_sha256 scenario_sha256 authority_record_sha256 positive_observation_sha256 workspace_id principal_id agent_id credential_id credential_version credential_slot_sha256 current_grant_state authority_epoch grant_sha256 acknowledgment_record_sha256'),'native-revocation-disable-original');
 const p=pr.value,d=dr.value,s=prep.value.subject;
 for(const r of [p,d]){requireShared(r,c,fields('run_id config_sha256 scenario_sha256 authority_record_sha256'));for(const k of fields('workspace_id principal_id agent_id credential_id authority_epoch grant_sha256'))requireValue(r[k]===s[k],'REVOCATION');requireValue(n(r.sequence)&&r.sequence>0&&n(r.observed_at)&&n(r.credential_version)&&r.credential_version>0&&HASH.test(r.credential_slot_sha256),'REVOCATION');}
 for(const k of fields('runtime_id proof_sha256 key_sha256 request_sha256'))requireValue(p[k]===s[k],'REVOCATION');
 requireValue(p.step_id==='prepare/revoke-own-positive'&&d.step_id==='control/revoke-submitter'&&p.invocation_id===positiveProcess.id&&positiveProcess.id!==proc.id&&positiveProcess.final.value.exitCode===0&&p.process_final_sha256===positiveProcess.final.sha256&&p.preparation_sha256===positivePrep.sha256&&p.status===200&&HASH.test(p.request_record_sha256)&&HASH.test(d.acknowledgment_record_sha256)&&d.positive_observation_sha256===pr.sha256,'REVOCATION');
 boundedHashes(p.foreign_identifier_hashes);
 requireValue(n(v.negative_sequence)&&p.sequence<d.sequence&&d.sequence<v.negative_sequence&&positiveProcess.final.value.endedAt<=p.observed_at&&p.observed_at<=d.observed_at&&d.observed_at<=prep.value.prepared_at&&prep.value.prepared_at<=proc.final.value.startedAt,'REVOCATION');
 requireValue(p.credential_version<Number.MAX_SAFE_INTEGER&&d.credential_version===p.credential_version+1&&v.credential_version===d.credential_version&&v.credential_slot_sha256===d.credential_slot_sha256&&d.credential_slot_sha256===p.credential_slot_sha256,'REVOCATION');
 requireValue(s.proof_sha256===null&&s.key_sha256===null&&p.current_grant_state==='current'&&d.current_grant_state==='current'&&v.current_grant_state==='current','REVOCATION');
 return {positive_status:p.status,positive_leak_count:p.foreign_identifier_hashes.length,positive_original_record_sha256:pr.sha256,positive_seq:p.sequence,disable_seq:d.sequence,negative_seq:v.negative_sequence,disable_record_sha256:dr.sha256,disabled_credential_id:d.credential_id,positive_grant_sha256:p.grant_sha256,positive_proof_sha256:p.proof_sha256,negative_proof_sha256:o.binding.proof_sha256,positive_request_sha256:p.request_sha256,negative_request_sha256:o.transport.requests.at(-1).request_sha256,positive_key_sha256:p.key_sha256,negative_key_sha256:s.key_sha256,positive_epoch:p.authority_epoch,credential_version:d.credential_version,current_grant_state:v.current_grant_state,current_proof_state:'not-applicable'};
}
const incomplete=code=>({status:'incomplete',scope:'native37',acceptance:'pending-external-inspection',issue48Complete:false,errors:[code]});
/** All originals are structural inputs. Their independent authentication remains external. */
function projectNative(input,coreOnly=false){
 try{
  const outer=closed(input,['version','context','records','caseBindings','assemblyBinding']);requireValue(outer.version===1,'VERSION');
  const c=contextInput(outer.context),store=loadNativeOriginals(outer.records),bindings=plain(array(outer.caseBindings,37)),assemblyBinding=plain(closed(outer.assemblyBinding,['record_id','command_id','native_artifact_path']));
  const scenario=getNativeScenario(),steps=new Map(scenario.steps.filter(s=>s.caseId).map(s=>[s.caseId,s])),roster=CASE_POLICY.filter(r=>r.family==='native');
  requireValue(store.has(c.config_record_id),'CONFIG');const config=validateNativeConfig(store.get(c.config_record_id).value);
  requireValue(nativeConfigDigest(config)===c.config_sha256&&hashObject({actors:config.actors,fixture_stores:config.fixture_stores})===c.actors_sha256&&hashObject(config.workspaces)===c.workspaces_sha256,'CONFIG');
  requireValue(config.candidate_sha===c.candidate_sha&&config.candidate_tree_sha===c.candidate_git_tree_sha&&config.composition_sha256===c.composition_sha256&&config.node.sha256===c.node_sha256&&config.build.sha256===c.executable_sha256&&config.authority_record_sha256===c.authority_record_sha256&&config.workspaces.primary===c.workspace_id,'CONFIG');
  requireValue(bindings.length===37&&new Set(bindings.map(b=>b.case_id)).size===37,'COVERAGE');
  const commands=[],entries=[],rows=[],usedInvocations=new Set(),usedIdentities=new Set();
  for(const b0 of bindings){
   const b=closed(b0,fields('case_id step_id preparation_record_id process_prepared_record_id process_spawned_record_id process_final_record_id observer_record_id harness_record_id related_record_ids')),step=steps.get(b.case_id);
   requireValue(step&&step.id===b.step_id,'COVERAGE');
   const prep=preparation(store,b.preparation_record_id,c,b.case_id,b.step_id),s=prep.value.subject;
   const actor=config.fixture_stores.find(x=>x.fixture===step.fixture&&x.actor_slot===step.actor)??config.actors.find(x=>x.id===step.actor);
   requireValue(actor&&s.principal_id===actor.principal_id&&s.agent_id===actor.agent_id&&s.workspace_id===config.workspaces.primary,'ACTOR_ROLE');
   const proc=processOriginals(store,{prepared:b.process_prepared_record_id,spawned:b.process_spawned_record_id,final:b.process_final_record_id},c,prep);
   requireValue(!usedInvocations.has(proc.id),'DUPLICATE');usedInvocations.add(proc.id);const identityKey=canonicalCaseSubject(proc.spawned.value.identity);requireValue(!usedIdentities.has(identityKey),'PROCESS_IDENTITY');usedIdentities.add(identityKey);
   const or=observation(store,b.observer_record_id,c,b,prep,proc),o=or.value;
   const hr=original(store,b.harness_record_id,[...fields('type version id step_id case_id subject_sha256 preparation_sha256 process_final_sha256 observer_sha256 started_at ended_at exit_code'),...SHARED],'native-case-harness-original'),h=hr.value;
   requireShared(h,c);requireValue(h.step_id===b.step_id&&h.case_id===b.case_id&&h.subject_sha256===hashObject(s)&&h.preparation_sha256===prep.sha256&&h.process_final_sha256===proc.final.sha256&&h.observer_sha256===or.sha256,'HARNESS');
   requireValue(n(h.started_at)&&n(h.ended_at)&&prep.value.prepared_at<=h.started_at&&h.started_at<=proc.prepared.value.preparedAt&&proc.final.value.endedAt<=o.observed_at&&o.observed_at<=h.ended_at,'TIME');
   const entry={case_id:b.case_id,subject_sha256:hashObject(s),subject:s,prepared_at:prep.value.prepared_at,preparation_record_sha256:prep.sha256,harness_command_id:h.id};entries.push(entry);commands.push(makeCommand(c,hr,'native-live',entry));
   const obs={...projection(o,proc,c),...transport(o,step,s),observer_record_sha256:or.sha256};
   if(b.case_id.endsWith('/success')){
    requireValue(b.related_record_ids===null&&o.journal===null&&o.revocation===null,'APPLICABILITY');
    const r=closed(o.resources,['response_ids','state_ids','state_record_sha256']);boundedIds(r.response_ids,64);boundedIds(r.state_ids,64);requireValue(HASH.test(r.state_record_sha256),'OBSERVER');
    Object.assign(obs,{http_status:o.transport.requests.at(-1).status,response_resource_ids:r.response_ids,observer_resource_ids:r.state_ids,observer_state_record_sha256:r.state_record_sha256,preparation_record_sha256:prep.sha256});
    if(step.operation==='createRuntime'){requireValue(n(o.projection.runtime_token_output_count),'APPLICABILITY');obs.runtime_token_output_count=o.projection.runtime_token_output_count;}else requireValue(o.projection.runtime_token_output_count===null,'APPLICABILITY');
    if(['uploadArtifactContent','downloadArtifactContent'].includes(step.operation)){const a=closed(o.artifact,['source_sha256','source_bytes','target_sha256','target_bytes']);for(const key of ['source','target'])requireValue(HASH.test(a[key+'_sha256'])&&n(a[key+'_bytes'])&&a[key+'_bytes']<=10485760,'ARTIFACT');Object.assign(obs,a);}else requireValue(o.artifact===null,'APPLICABILITY');
   }else{
    requireValue(o.resources===null&&o.artifact===null&&o.projection.runtime_token_output_count===null,'APPLICABILITY');
    if(b.case_id==='native/revoked-after-disable'){requireValue(o.journal===null,'APPLICABILITY');Object.assign(obs,revocationProjection(store,o,b.related_record_ids,c,prep,proc));}
    else{requireValue(o.revocation===null,'APPLICABILITY');Object.assign(obs,journalProjection(store,o,b.related_record_ids,c,prep,proc,step));}
   }
   rows.push({id:b.case_id,command_id:h.id,subject_sha256:entry.subject_sha256,observed_at:o.observed_at,observations:obs});
  }
  requireValue(roster.every(r=>rows.some(x=>x.id===r.id)),'COVERAGE');
  const lostBinding=bindings.find(b=>b.case_id==='native/lost-response-retained'),restartBinding=bindings.find(b=>b.case_id==='native/restart-no-send');
  for(const [related,actual] of [['original_prepared','process_prepared_record_id'],['original_spawned','process_spawned_record_id'],['original_final','process_final_record_id'],['original_preparation','preparation_record_id']])requireValue(restartBinding.related_record_ids[related]===lostBinding[actual],'RESTART_JOIN');
  const lost=rows.find(r=>r.id===lostBinding.case_id).observations,restart=rows.find(r=>r.id===restartBinding.case_id).observations;
  requireValue(restart.original_process_id===lost.process_id,'RESTART_JOIN');for(const key of ['intent_id','retained_request_sha256','retained_key_sha256'])requireValue(restart[key]===lost[key],'RESTART_JOIN');
  if(coreOnly){
   requireValue(!store.has(assemblyBinding.record_id)&&ID.test(assemblyBinding.record_id)&&ID.test(assemblyBinding.command_id)&&!commands.some(cmd=>cmd.id===assemblyBinding.command_id),'ASSEMBLY');
   requireNativeArtifactPath(assemblyBinding.native_artifact_path);
   const header={type:'r2-native',version:1,revision:c.candidate_sha,tree_sha256:c.source_tree_sha256,environment_id:c.environment_id,composition_sha256:c.composition_sha256,records:rows};
   for(const row of rows)requireValue(nativeRecordShapes.get(row.id)?.(row),'SCHEMA');
   requireValue(validateNativeCaseCore(header,caseContext(c,commands,entries)).length===0,'POLICY');
   requireValue(Buffer.byteLength(canonicalCaseSubject(entries))<=4194304&&commands.every(cmd=>Buffer.byteLength(canonicalCaseSubject(cmd))<=65536),'BUDGET');
   const manifestSha256=inputManifest(outer.context,bindings,store,assemblyBinding.record_id);
   const token=Object.freeze(Object.create(null));
   const retainedContext=Object.fromEntries(fields('run_id candidate_sha source_tree_sha256 environment_id composition_sha256 workspace_id config_epoch executable_sha256 observer_id').map(k=>[k,c[k]]));
   const state=deepFreeze({c:retainedContext,commands,entries,rows,assemblyBinding,manifestSha256,originalCount:store.size,originalBytes:[...store.values()].reduce((sum,r)=>sum+r.byte_size,0)});
   pendingTokens.set(token,state);
   return {status:'core-validated',scope:'native37',acceptance:'pending-external-inspection',issue48Complete:false,input_manifest_sha256:manifestSha256,token};
  }
  const ar=original(store,assemblyBinding.record_id,fields('type version id run_id candidate_sha source_tree_sha256 environment_id composition_sha256 input_manifest_sha256 started_at ended_at observed_at exit_code observer_id'),'native-assembly-original'),a=ar.value;
  const manifestSha256=inputManifest(outer.context,bindings,store,assemblyBinding.record_id);
  return completeProjection({c,commands,entries,rows,assemblyBinding,manifestSha256},ar);
 }catch(error){return incomplete(/^NATIVE_EVIDENCE_[A-Z_]+$/.test(error?.message)?error.message:'NATIVE_EVIDENCE_INCOMPLETE');}
}

const pendingTokens=new WeakMap();
const nativeRecordShapes=new Map(CASE_POLICY.map((row,index)=>[row,index]).filter(([row])=>row.family==='native').map(([row,index])=>[row.id,ajv.compile({$ref:caseSchemas.$id+'#/$defs/case_'+index})]));
function deepFreeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))deepFreeze(item);Object.freeze(value);}return value;}
function inputManifest(context,bindings,store,assemblyId){return hashObject({context:plain(context),caseBindings:bindings,records:[...store].filter(([id])=>id!==assemblyId).map(([id,r])=>({id,sha256:r.sha256})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)});}
function caseContext(c,commands,entries){return {commands:new Map(commands.map(cmd=>[cmd.id,cmd])),preparations:{subjects:entries,observed_at:Math.min(...entries.map(x=>x.prepared_at))},subjectDigests:new Map(entries.map(e=>[e.case_id,e.subject_sha256])),workspaceId:c.workspace_id,configEpoch:c.config_epoch,nativeExecutableSha256:c.executable_sha256};}
function requireNativeArtifactPath(path){requireValue(typeof path==='string'&&Buffer.byteLength(path)<=256&&/^validation\/releases\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_.-]+\.json$/.test(path),'PATH');}
function completeProjection(state,ar){
 const {c,assemblyBinding,manifestSha256}=state,a=ar.value;
 const commands=plain(state.commands),entries=plain(state.entries),rows=plain(state.rows);
  requireShared(a,c,fields('run_id candidate_sha source_tree_sha256 environment_id composition_sha256'));
  requireValue(a.input_manifest_sha256===manifestSha256&&a.id===assemblyBinding.command_id&&a.observer_id===c.observer_id,'ASSEMBLY');
  requireValue(n(a.started_at)&&n(a.ended_at)&&n(a.observed_at)&&commands.every(cmd=>cmd.ended_at<=a.started_at)&&a.started_at<=a.observed_at&&a.observed_at<=a.ended_at,'TIME');
  const assembly=makeCommand(c,ar,'contract');commands.push(assembly);requireValue(new Set(commands.map(v=>v.id)).size===commands.length,'DUPLICATE');
  const header={version:1,revision:c.candidate_sha,tree_sha256:c.source_tree_sha256,environment_id:c.environment_id,composition_sha256:c.composition_sha256};
  const native={type:'r2-native',...header,command_id:a.id,observed_at:a.observed_at,observer_id:a.observer_id,record_sha256:ar.sha256,records:rows};
  requireValue(receiptPolicies['r2-native'].validate(native),'SCHEMA');
  const context={commands:new Map(commands.map(cmd=>[cmd.id,cmd])),preparations:{subjects:entries,observed_at:Math.min(...entries.map(x=>x.prepared_at))},subjectDigests:new Map(entries.map(e=>[e.case_id,e.subject_sha256])),workspaceId:c.workspace_id,configEpoch:c.config_epoch,nativeExecutableSha256:c.executable_sha256};
  requireValue(validateCaseFamily(native,context).length===0,'POLICY');
  const preparations={type:'r2-native-preparations-fragment',...header,scope:'native37',subjects:entries,first_prepared_at:Math.min(...entries.map(e=>e.prepared_at)),last_prepared_at:Math.max(...entries.map(e=>e.prepared_at)),assembly_record_sha256:ar.sha256};
  const path=assemblyBinding.native_artifact_path;requireValue(typeof path==='string'&&Buffer.byteLength(path)<=256&&/^validation\/releases\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_.-]+\.json$/.test(path),'PATH');
  const nativeBytes=Buffer.from(canonicalCaseSubject(native));assembly.results=[{type:'r2-native',artifact:{path,sha256:sha(nativeBytes),byte_size:nativeBytes.length}}];requireValue(validR2Command(assembly),'COMMAND');
  requireValue(nativeBytes.length<=4194304&&Buffer.byteLength(canonicalCaseSubject(preparations))<=4194304&&commands.every(cmd=>Buffer.byteLength(canonicalCaseSubject(cmd))<=65536),'BUDGET');
  return {status:'structural-fragment',scope:'native37',acceptance:'pending-external-inspection',issue48Complete:false,native,preparations,commands,externalRequirements:['authenticated-originals','protected-host-read-bounds','independent-live-observer','server-denial-producers','post-r4-acceptance'],rootMergeStatus:'pending-authenticated-global-preparation-timeline'};
}
/** Backward-compatible one-shot validation of an already completed actual original. */
export function assembleNativeEvidence(input){return projectNative(input,false);}
/** Validates core facts only, with no fabricated completed assembly receipt. */
export function prepareNativeEvidence(input){return projectNative(input,true);}
/** Consumes an opaque token before reading the actual terminal original. */
export function finalizeNativeEvidence(token,input){
 const state=pendingTokens.get(token);if(!state)return incomplete('NATIVE_EVIDENCE_TOKEN');pendingTokens.delete(token);
 try{
  const {assemblyRecord}=closed(input,['assemblyRecord']),reservation=reserveOriginals([assemblyRecord]);
  requireValue(state.originalCount+1<=512&&state.originalBytes+reservation.total<=16777216,'BUDGET');
  requireValue(reservation.rows[0].id===state.assemblyBinding.record_id,'ASSEMBLY');
  const store=loadNativeOriginals(reservation.rows);
  const ar=original(store,state.assemblyBinding.record_id,fields('type version id run_id candidate_sha source_tree_sha256 environment_id composition_sha256 input_manifest_sha256 started_at ended_at observed_at exit_code observer_id'),'native-assembly-original');
  return completeProjection(state,ar);
 }catch(error){return incomplete(/^NATIVE_EVIDENCE_[A-Z_]+$/.test(error?.message)?error.message:'NATIVE_EVIDENCE_INCOMPLETE');}
}
/** Memory abandonment only; never cleanup/rollback of external effects. */
export function discardNativeEvidence(token){return pendingTokens.delete(token);}
