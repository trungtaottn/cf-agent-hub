/** Offline signed semantic linkage only. Parent owns installation/policy trust,
 * whole report closure and actual producer custody; no local bytes are reread. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {snapshotCompleteValue as snapshot} from './native-complete-protocol.mjs';
import {completeClientFields as fields} from './native-complete-client-proof.mjs';
import {selectNativeExecutionProfile} from './native-execution-profile.mjs';
import {loadNativeOriginals,assembleCompleteNativeEvidence} from './native-r2-evidence.mjs';
import {completeCallSchedule} from './native-complete-call-owner.mjs';
import {verifyCompleteOriginal} from './native-complete-original-wire.mjs';
const fail=()=>{throw Error('NATIVE_COMPLETE_REPORT_TWINS_REJECTED');},check=v=>{if(!v)fail();};
const hash=b=>createHash('sha256').update(b).digest('hex'),sha=v=>hash(canonical(v)),same=(a,b)=>canonical(a)===canonical(b),keys=s=>s.split(' ');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),integer=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const typed=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(typed,'byteLength').get,backing=Object.getOwnPropertyDescriptor(typed,'buffer').get;
function array(value,max){check(value&&!types.isProxy(value)&&Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype);const size=Object.getOwnPropertyDescriptor(value,'length')?.value;check(integer(size)&&size<=max);const ds=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(ds).length===size+1);return Array.from({length:size},(_,i)=>{const d=ds[i];check(d?.enumerable&&Object.hasOwn(d,'value'));return d.value;});}
function byteLength(value,max){check(value&&!types.isProxy(value)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(value)));const n=length.call(value);check(n>0&&n<=max&&Object.getPrototypeOf(backing.call(value))===ArrayBuffer.prototype&&Reflect.ownKeys(value).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));return n;}
function copyBytes(value,n){const out=new Uint8Array(n);Uint8Array.prototype.set.call(out,value);return Buffer.from(out.buffer);}
function originals(value){
 let total=0;const rows=array(value,512).map(v=>{const row=fields(v,keys('id sha256 bytes'));check(id(row.id)&&digest(row.sha256));const size=byteLength(row.bytes,65536);total+=size;check(total<=16777216);return{...row,size};});
 // Finish all reservations before copying or decoding a single original.
 const copied=rows.map(r=>({id:r.id,sha256:r.sha256,bytes:copyBytes(r.bytes,r.size)})),store=loadNativeOriginals(copied);return {store,raw:new Map(copied.map(r=>[r.id,r]))};
}
function nativeInput(value,raw){
 const v=fields(value,keys('version context record_ids caseBindings assemblyBinding'));check(v.version===2);
 const c=fields(v.context,keys('config_record_id run_id candidate_sha candidate_git_tree_sha source_inventory environment_id composition_sha256 config_sha256 scenario_sha256 authority_record_sha256 node_sha256 executable_sha256 actors_sha256 workspaces_sha256 workspace_id config_epoch observer_id'));
 const {source_inventory,...rest}=c,context=snapshot(rest,8192);context.source_inventory=array(source_inventory,2048).map(r=>snapshot(fields(r,keys('path sha256 byte_size mode')),2048));check(Buffer.byteLength(canonical(context.source_inventory))<=4194304);
 const recordIds=array(v.record_ids,512);check(recordIds.every(id)&&new Set(recordIds).size===recordIds.length&&recordIds.every(x=>raw.has(x)));
 const caseBindings=array(v.caseBindings,37).map(r=>snapshot(r,4096));check(Buffer.byteLength(canonical(caseBindings))<=131072);
 return {ids:new Set(recordIds),input:{version:2,context,records:recordIds.map(x=>raw.get(x)),caseBindings,assemblyBinding:snapshot(v.assemblyBinding,2048)}};
}
function one(rows,predicate){const found=rows.filter(predicate);check(found.length===1);return found[0];}
function failAuxiliary(o,prep,final,c,upper){
 fields(o,keys('type version run_id step_id invocation_id observed_at config_sha256 scenario_sha256 authority_record_sha256 process_final_sha256 preparation_sha256 subject_sha256 observer_id binding projection transport resources'));
 const s=prep.value.subject;check(o.type==='native-auxiliary-create-observation'&&o.version===1&&o.step_id==='prepare/fail-create'&&o.subject_sha256===sha(s)&&o.observer_id===c.observer_id&&integer(o.observed_at)&&final.value.endedAt<=o.observed_at&&o.observed_at<=upper);
 const b=fields(o.binding,keys('workspace_id principal_id agent_id credential_id runtime_id config_epoch grant_sha256 proof_sha256'));for(const k of keys('workspace_id principal_id agent_id credential_id runtime_id grant_sha256 proof_sha256'))check(b[k]===s[k]);check(b.config_epoch===s.authority_epoch);
 const p=fields(o.projection,keys('record_sha256 stdout_sha256 stderr_sha256 stdout_bytes stderr_bytes schema_error_codes foreign_identifier_hashes secret_match_hashes runtime_token_output_count'));check(digest(p.record_sha256)&&p.runtime_token_output_count===null);for(const k of keys('schema_error_codes foreign_identifier_hashes secret_match_hashes'))check(array(p[k],0).length===0);for(const stream of ['stdout','stderr'])check(p[stream+'_sha256']===final.value.transcripts[stream].sha256&&p[stream+'_bytes']===final.value.transcripts[stream].byteSize);
 const t=fields(o.transport,keys('record_sha256 requests'));check(digest(t.record_sha256));const request=fields(one(array(t.requests,1),()=>true),keys('operation request_sha256 response_record_sha256 status'));check(request.operation==='createTask'&&request.request_sha256===s.request_sha256&&digest(request.response_record_sha256)&&request.status===201);
 const resources=fields(o.resources,keys('response_ids state_ids state_record_sha256'));check(digest(resources.state_record_sha256));const a=array(resources.response_ids,64),bids=array(resources.state_ids,64);for(const rows of [a,bids])check(rows.every(x=>typeof x==='string'&&/^[\x20-\x7e]{1,128}$/.test(x))&&new Set(rows).size===rows.length);check(same([...a].sort(),[...bids].sort()));
}
export function verifyCompleteReportTwins(input){
 try{
  const v=fields(input,keys('serviceBinding publicKeyDer originals nativeInput twins')),binding=snapshot(fields(v.serviceBinding,keys('profile service_id instance_id run_id descriptor_sha256 policy_sha256')),2048);for(const k of keys('service_id instance_id run_id'))check(id(binding[k]));for(const k of keys('descriptor_sha256 policy_sha256'))check(digest(binding[k]));const publicKeyDer=copyBytes(v.publicKeyDer,byteLength(v.publicKeyDer,44));check(publicKeyDer.length===44);
  const {store,raw}=originals(v.originals),native=nativeInput(v.nativeInput,raw),c=native.input.context;check(store.has(c.config_record_id));const selected=selectNativeExecutionProfile(store.get(c.config_record_id).value);check(selected.config.version===2&&binding.profile===selected.config.profile&&binding.run_id===c.run_id);
  const fragment=assembleCompleteNativeEvidence(native.input);check(fragment.status==='structural-fragment'&&fragment.scope==='native37'&&fragment.issue48Complete===false&&fragment.native.records.length===37);
  const schedule=completeCallSchedule(binding.profile);
  const expectedSteps=selected.scenario.steps.filter(s=>s.caseId||['prepare/fail-create','prepare/revoke-own-positive','control/revoke-submitter'].includes(s.id));check(expectedSteps.length===40);
  const pairs=array(v.twins,40).map(p=>snapshot(fields(p,keys('step_id service local')),4096));check(pairs.length===40);
  const nativeRows=[...native.ids].map(id=>({id,...store.get(id)})),caseMap=new Map(native.input.caseBindings.map(b=>[b.step_id,b])),revoked=caseMap.get('case/revoked-after-disable'),settled=caseMap.get('case/settled-no-send');check(revoked&&settled);
  const prior=new Map(),requestIds=new Set(),serviceIds=new Set(),localIds=new Set(),serviceHashes=new Set(),localHashes=new Set();
  for(let index=0;index<40;index++){
   const pair=pairs[index],step=expectedSteps[index],e=pair.service,local=fields(pair.local,keys('id sha256 byte_size')),disable=step.id==='control/revoke-submitter';check(pair.step_id===step.id&&id(local.id)&&digest(local.sha256)&&integer(local.byte_size)&&local.byte_size>0&&local.byte_size<=65536&&native.ids.has(local.id));
   const issuance=one(schedule,r=>r.operation==='observe-slot'&&r.slot?.id===step.id);check(e.sequence===issuance.sequence&&!requestIds.has(e.request_id));
   const localRow=store.get(local.id);check(localRow&&localRow.sha256===local.sha256&&localRow.byte_size===local.byte_size);check(!serviceIds.has(e.record_id)&&!localIds.has(local.id)&&!serviceHashes.has(e.sha256)&&!localHashes.has(local.sha256)&&!native.ids.has(e.record_id));
   for(const k of Object.keys(binding))check(e[k]===binding[k]);check(e.slot?.kind===(disable?'control':'process')&&e.slot.id===step.id&&e.family===(disable?'disable-acknowledgment':'independent-observation')&&e.producer_id==='native-complete-'+e.slot.kind&&raw.has(e.record_id));
   const verified=verifyCompleteOriginal({expected:e,wire:raw.get(e.record_id).bytes,publicKeyDer}),source=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(verified.bytes));check(canonical(source)===verified.bytes.toString('utf8'));const translated=snapshot(source,9960),o=localRow.value;
   for(const k of keys('run_id config_sha256 scenario_sha256 authority_record_sha256'))check(o[k]===c[k]&&source[k]===c[k]);check(o.step_id===step.id&&source.step_id===step.id&&o.version===1&&source.version===1&&integer(source.observed_at)&&integer(o.observed_at));translated.observed_at=o.observed_at;
   if(disable){const positive=prior.get('prepare/revoke-own-positive');check(positive&&local.id===revoked.related_record_ids.disable_control&&o.type==='native-revocation-disable-original'&&source.positive_observation_sha256===positive.service.sha256&&o.positive_observation_sha256===positive.local.sha256&&e.invocation_id===null);translated.positive_observation_sha256=positive.local.sha256;}
   else{
    let prepId,finalId,expectedId;
    if(step.caseId){const b=caseMap.get(step.id);check(b);({preparation_record_id:prepId,process_final_record_id:finalId,observer_record_id:expectedId}=b);}
    else if(step.id==='prepare/revoke-own-positive'){const r=revoked.related_record_ids;prepId=r.positive_preparation;finalId=r.positive_final;expectedId=r.positive_observation;}
    else{const r=settled.related_record_ids;prepId=r.original_preparation;finalId=r.original_final;expectedId=one(nativeRows,r=>r.value.type==='native-auxiliary-create-observation'&&r.value.step_id===step.id).id;}
    check(local.id===expectedId);const prep=store.get(prepId),final=store.get(finalId);check(prep&&final&&native.ids.has(prepId)&&native.ids.has(finalId)&&prep.value.step_id===step.id&&o.preparation_sha256===prep.sha256&&o.process_final_sha256===final.sha256&&source.process_final_sha256===final.sha256&&source.preparation_sha256===e.preparation_sha256&&e.preparation_sha256!==prep.sha256&&source.invocation_id===final.value.invocationId&&o.invocation_id===final.value.invocationId&&e.invocation_id===final.value.invocationId);translated.preparation_sha256=prep.sha256;
    if(step.id==='prepare/fail-create')failAuxiliary(o,prep,final,c,store.get(settled.preparation_record_id).value.prepared_at);
    if(step.id==='case/revoked-after-disable'){const p=prior.get('prepare/revoke-own-positive'),d=prior.get('control/revoke-submitter');check(p&&d&&source.revocation?.positive_observation_record_id===p.service.record_id&&source.revocation.disable_control_record_id===d.service.record_id);translated.revocation.positive_observation_record_id=p.local.id;translated.revocation.disable_control_record_id=d.local.id;}
    if(['case/settled-no-send','case/lost-response-retained','case/restart-no-send'].includes(step.id)){check(source.journal===null);fields(o.journal,keys('intent_id record_sha256 state original_invocation_id request_sha256 key_sha256'));translated.journal=snapshot(o.journal,2048);}
    if(['uploadArtifactContent','downloadArtifactContent'].includes(step.operation)){const a=fields(source.artifact,keys('source_sha256 source_bytes target_sha256 target_bytes')),localSide=step.operation==='uploadArtifactContent'?'source':'target',remote=localSide==='source'?'target':'source',expected=selected.profile.artifact;check(a[localSide+'_sha256']===null&&a[localSide+'_bytes']===null&&a[remote+'_sha256']===expected.sha256&&a[remote+'_bytes']===29);for(const side of ['source','target'])check(o.artifact[side+'_sha256']===expected.sha256&&o.artifact[side+'_bytes']===29);translated.artifact[localSide+'_sha256']=o.artifact[localSide+'_sha256'];translated.artifact[localSide+'_bytes']=29;}
   }
   check(same(translated,o));requestIds.add(e.request_id);serviceIds.add(e.record_id);serviceHashes.add(e.sha256);localIds.add(local.id);localHashes.add(local.sha256);prior.set(step.id,pair);
  }
  return Object.freeze({scope:'offline-signed-twin-semantic-linkage',installedAuthority:false,native_conformance:false,issue48Complete:false,pairs:40});
 }catch{fail();}
}
