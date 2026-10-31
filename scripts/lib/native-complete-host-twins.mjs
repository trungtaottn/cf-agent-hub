/** Signed source-core composition, not protected custody or recorder acceptance.
 * The fixed factory must privately bind actual controller capture facts. */
import {createHash,randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {dirname} from 'node:path';
import {canonicalCaseSubject as canonical} from './r2-case-policy.mjs';
import {selectNativeExecutionProfile} from './native-execution-profile.mjs';
import {createCompleteNativeRunContext} from './native-r2-session.mjs';
import {loadNativeOriginals,nativeSourceInventoryDigest} from './native-r2-evidence.mjs';
import {verifyCompleteInstallationStatement} from './native-complete-installation.mjs';
import {validateCompletePreparation} from './native-complete-preparation.mjs';
import {verifyCompleteOriginal,completeOriginalCap} from './native-complete-original-wire.mjs';
import {validateCompletePolicy,completePolicyDigest,snapshotCompleteValue as snapshot,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
import {completeClientFields as fields} from './native-complete-client-proof.mjs';
const fail=()=>{throw Error('NATIVE_COMPLETE_HOST_TWIN_REJECTED');},check=v=>{if(!v)fail();};
const hash=b=>createHash('sha256').update(b).digest('hex'),sha=v=>hash(canonical(v));
const integer=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0),id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const keys=text=>text.split(' ');
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function byteCopy(value,max){ // Validate bytes without trusting overridden properties.
 const proto=Object.getPrototypeOf(Uint8Array.prototype),len=Object.getOwnPropertyDescriptor(proto,'byteLength').get,backing=Object.getOwnPropertyDescriptor(proto,'buffer').get;
 check(value&&!types.isProxy(value)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(value)));const n=len.call(value);check(n>0&&n<=max&&Object.getPrototypeOf(backing.call(value))===ArrayBuffer.prototype&&Reflect.ownKeys(value).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));return Buffer.from(value);
}
// Preserve the existing inventory contract (2,048 rows / 4 MiB) rather than
// accidentally imposing the smaller complete wire snapshot node limit.
function captureContext(input){
 const c=fields(input,keys('run_id environment_id config_epoch observer_id source_inventory')),rows=c.source_inventory;
 check(Array.isArray(rows)&&!types.isProxy(rows)&&Object.getPrototypeOf(rows)===Array.prototype);
 const ds=Object.getOwnPropertyDescriptors(rows),n=ds.length?.value;check(integer(n)&&n>0&&n<=2048&&Reflect.ownKeys(ds).length===n+1);
 const inventory=[];for(let i=0;i<n;i++){const d=ds[i];check(d?.enumerable&&Object.hasOwn(d,'value'));inventory.push(snapshot(fields(d.value,keys('path sha256 byte_size mode')),1024));}
 nativeSourceInventoryDigest(inventory);
 const {source_inventory,...rest}=c;return freeze({...snapshot(rest,4096),source_inventory:inventory});
}
const scoped=Object.freeze({scope:'source-core-composed',installedAuthority:false,native_conformance:false});
export function createSourceCompleteHostTwinOwner(input){
 const a=fields(input,keys('config context policy trustAnchorBytes installationBytes hostSha256')),selected=selectNativeExecutionProfile(a.config),config=selected.config;check(config.version===2&&digest(a.hostSha256));
 const context=captureContext(a.context),runContext=createCompleteNativeRunContext(config,context.run_id),started=Date.now();check(integer(started)&&integer(context.config_epoch)&&id(context.observer_id)&&id(context.environment_id));
 const deadline=started+config.budgets.duration_ms,anchorBytes=byteCopy(a.trustAnchorBytes,4096),descriptorBytes=byteCopy(a.installationBytes,16384);
 const subjects={candidate_sha:config.candidate_sha,candidate_tree_sha:config.candidate_tree_sha,composition_sha256:config.composition_sha256,cli_sha256:config.build.sha256,host_sha256:a.hostSha256,config_sha256:selected.configSha256,scenario_sha256:selected.scenarioSha256,source_inventory_sha256:nativeSourceInventoryDigest(context.source_inventory),target_origin:config.origin,primary_workspace:config.workspaces.primary,foreign_workspace:config.workspaces.foreign,profile:config.profile,fixture_sha256:config.fixture_sha256,family_ledger_sha256:config.family_ledger_sha256};
 const installation=verifyCompleteInstallationStatement({anchorBytes,descriptorBytes,subjects,now:started,operationalMs:config.budgets.duration_ms}),policy=validateCompletePolicy(a.policy,{context:runContext,now:started,operationalMs:config.budgets.duration_ms});
 check(installation.descriptorSha256===policy.descriptor_sha256&&installation.payload.service_id===policy.service_id&&installation.payload.environment_id===context.environment_id&&installation.payload.expires_at>=policy.expires_at&&policy.source_inventory_sha256===subjects.source_inventory_sha256&&policy.actors_sha256===sha({actors:config.actors,fixture_stores:config.fixture_stores})&&policy.workspaces_sha256===sha(config.workspaces)&&policy.fixture_stores_sha256===sha(config.fixture_stores));
 const publicKeyDer=Buffer.from(installation.payload.service_key_spki_base64,'base64'),policyHash=completePolicyDigest(policy),handles=new WeakMap(),pairs=new Map(),serviceIds=new Set(),serviceHashes=new Set(),localIds=new Set(),localHashes=new Set(),seenSlots=new Set();let active=null,poisoned=false,lastTime=started,totalWire=0,attemptedWire=null;
 const current=()=>{const now=Date.now();check(integer(now)&&now>=lastTime&&now<deadline&&now<policy.expires_at);verifyCompleteInstallationStatement({anchorBytes,descriptorBytes,subjects,now,operationalMs:Math.max(1,deadline-now)});lastTime=now;return now;};
 const guarded=fn=>{try{check(!poisoned);return fn();}catch{poisoned=true;fail();}};
 function facts(value,disable){
  const f=snapshot(fields(value,keys('kind step_id case_id sequence started_at context preparation related'))),step=selected.scenario.steps.find(s=>s.id===f.step_id);check(step&&integer(f.started_at)&&integer(f.sequence)&&f.sequence>0);
  fields(f.context,keys('run_id candidate_sha source_tree_sha256 environment_id composition_sha256 config_sha256 scenario_sha256 authority_record_sha256 observer_id config_epoch'));
  const shared={run_id:context.run_id,candidate_sha:config.candidate_sha,source_tree_sha256:subjects.source_inventory_sha256,environment_id:context.environment_id,composition_sha256:config.composition_sha256,config_sha256:selected.configSha256,scenario_sha256:selected.scenarioSha256,authority_record_sha256:config.authority_record_sha256,observer_id:context.observer_id,config_epoch:context.config_epoch};check(canonical(f.context)===canonical(shared));
  if(disable){check(f.kind==='disable'&&f.step_id==='control/revoke-submitter'&&f.case_id===null&&f.preparation===null);fields(f.related,keys('positive_record_id positive_record_sha256 positive_observed_at positive_sequence workspace_id principal_id agent_id credential_id credential_version credential_slot_sha256 authority_epoch grant_sha256'));const positive=pairs.get('prepare/revoke-own-positive');check(positive&&f.related.positive_record_id===positive.local.id&&f.related.positive_record_sha256===positive.local.sha256&&f.related.positive_observed_at===positive.localValue.observed_at&&f.related.positive_sequence===positive.localValue.sequence&&f.sequence>f.related.positive_sequence&&f.started_at>=f.related.positive_observed_at);}
  else{check(f.kind===(step.caseId?'case':'auxiliary')&&(!!step.caseId||['prepare/fail-create','prepare/revoke-own-positive'].includes(step.id))&&f.case_id===(step.caseId??null));fields(f.preparation,keys('record_id record_sha256 subject_sha256 prepared_at subject'));check(id(f.preparation.record_id)&&digest(f.preparation.record_sha256)&&f.preparation.subject_sha256===sha(f.preparation.subject)&&integer(f.preparation.prepared_at)&&f.preparation.prepared_at<=f.started_at);}
  return {f,step};
 }
 function expected(value,f,disable,final,completePreparation){
  const e=freeze(snapshot(value,4096));completeOriginalCap(e);check(e.profile===config.profile&&e.service_id===policy.service_id&&e.instance_id===policy.instance_id&&e.run_id===context.run_id&&e.descriptor_sha256===policy.descriptor_sha256&&e.policy_sha256===policyHash&&e.slot.kind===(disable?'control':'process')&&e.slot.id===f.step_id&&e.family===(disable?'disable-acknowledgment':'independent-observation')&&e.producer_id==='native-complete-'+e.slot.kind);
  const coverage=policy.coverage.find(r=>r.id===f.step_id&&r.kind===e.slot.kind);check(coverage?.supported&&coverage.producer_id===e.producer_id);
  if(!disable)check(e.preparation_sha256===sha(completePreparation)&&e.invocation_id===final.value.invocationId&&e.invocation_id===completePreparation.invocation_id);else check(e.invocation_id===null&&e.preparation_sha256===sha(completePreparation));
  check(!serviceIds.has(e.record_id)&&!serviceHashes.has(e.sha256));return e;
 }
 function bind(value,disable){return guarded(()=>{
  current();check(active===null&&pairs.size<40);const v=fields(value,disable?keys('captureFacts completePreparation expected'):keys('captureFacts completePreparation nativePreparationRecord processRecords processPreparedId processSpawnedId processFinalId expected')),{f,step}=facts(v.captureFacts,disable);check(!seenSlots.has(f.step_id));const completePreparation=validateCompletePreparation(v.completePreparation,{kind:disable?'control':'process',id:f.step_id},config.profile);let final=null,lineage=null;
  if(!disable){const native=loadNativeOriginals([v.nativePreparationRecord]).get(f.preparation.record_id);check(native&&native.sha256===f.preparation.record_sha256&&native.value.type==='native-case-preparation-original'&&native.value.version===1&&native.value.step_id===f.step_id&&native.value.case_id===f.case_id&&native.value.prepared_at===f.preparation.prepared_at&&canonical(native.value.subject)===canonical(f.preparation.subject)&&canonical(completePreparation.subject)===canonical(native.value.subject));for(const k of ['run_id','candidate_sha','source_tree_sha256','environment_id','composition_sha256','config_sha256','scenario_sha256','authority_record_sha256'])check(native.value[k]===f.context[k]);check(Array.isArray(v.processRecords)&&!types.isProxy(v.processRecords)&&v.processRecords.length===3);const store=loadNativeOriginals(v.processRecords),ids=[v.processPreparedId,v.processSpawnedId,v.processFinalId];check(ids.every(id)&&new Set(ids).size===3&&ids.every(x=>store.has(x))&&[...store.values()].every(r=>r.byte_size<=8192));const [prepared,spawned,last]=ids.map(x=>store.get(x));final=last;const p=prepared.value,s=spawned.value,l=last.value;check(native.value.invocation_commitment_sha256===p.invocationSha256&&completePreparation.invocation_commitment_sha256===p.invocationSha256);
   const bound={config_sha256:selected.configSha256,candidate_sha:config.candidate_sha,candidate_tree_sha:config.candidate_tree_sha,composition_sha256:config.composition_sha256,node_sha256:config.node.sha256,build_sha256:config.build.sha256,authority_record_sha256:config.authority_record_sha256,scenario_sha256:selected.scenarioSha256,actors_sha256:policy.actors_sha256,workspaces_sha256:policy.workspaces_sha256};
   check([p,s,l].every(x=>x.version===1&&x.invocationId===l.invocationId&&x.retryAllowed===false&&canonical(x.subjects)===canonical(bound))&&/^inv_[a-z0-9]{1,64}$/.test(l.invocationId));
   check(p.status==='prepared'&&s.status==='spawned'&&l.status==='terminal'&&l.reason==='exit'&&l.closeObserved===true&&l.exitCode===step.expectedExit&&l.signal===null&&!l.truncated&&integer(l.endedAt)&&integer(l.startedAt)&&l.startedAt<=l.endedAt&&f.started_at<=l.endedAt);
   for(const [ref,row,suffix] of [[s.prepared,prepared,'prepared'],[l.prepared,prepared,'prepared'],[l.spawned,spawned,'spawned']]){fields(ref,keys('name sha256 byteSize'));check(ref.name===l.invocationId+'.'+suffix+'.json'&&ref.sha256===row.sha256&&ref.byteSize===row.byte_size);}
   lineage={preparation_record_id:f.preparation.record_id,preparation_sha256:f.preparation.record_sha256,process_prepared_record_id:v.processPreparedId,process_prepared_sha256:prepared.sha256,process_spawned_record_id:v.processSpawnedId,process_spawned_sha256:spawned.sha256,process_final_record_id:v.processFinalId,process_final_sha256:last.sha256,invocation_id:l.invocationId};
   if(['case/settled-no-send','case/restart-no-send'].includes(step.id)){const prior=pairs.get(step.id==='case/settled-no-send'?'prepare/fail-create':'case/lost-response-retained');check(prior&&canonical(f.related)===canonical(prior.lineage));}
  }
  if(disable){const positive=pairs.get('prepare/revoke-own-positive'),ref=completePreparation.payload.positive_observation_ref;check(positive&&ref.record_id===positive.service.record_id&&ref.sha256===positive.service.sha256&&ref.byte_size===positive.service.byte_size);}
  const e=expected(v.expected,f,disable,final,completePreparation),token=Object.freeze(Object.create(null));handles.set(token,{f,step,e,final,disable,completePreparation,lineage,readStarted:false,reading:false,localRead:null});active=token;seenSlots.add(f.step_id);return token;
 });}
 const journalSteps=new Set(['case/settled-no-send','case/lost-response-retained','case/restart-no-send']);
 async function readLocal(token,value,kind){
  let pending,ownsRead=false;
  try{
   check(!poisoned);current();pending=handles.get(token);check(pending&&active===token&&!pending.disable&&!pending.readStarted);pending.readStarted=true;pending.reading=true;ownsRead=true;
   const input=snapshot(fields(value,kind==='artifact'?['refs']:['expected']));
   const {f,step,completePreparation:p,final}=pending,actor=config.actors.find(a=>a.id===step.actor);check(actor&&step.fixture!=='server-foreign-workspace');
   // Fixed compiled source only, never a caller-selected module or reader callback.
   const readers=await import('../../dist/native-host/complete-host-observation.mjs');current();check(!poisoned&&active===token&&handles.get(token)===pending);
   if(kind==='artifact'){
    check(['uploadArtifactContent','downloadArtifactContent'].includes(step.operation));const refs=fields(input.refs,step.refKeys);check(sha(refs)===p.refs_sha256&&refs.state_directory===actor.state_directory&&refs.origin===config.origin&&refs.workspace===p.subject.workspace_id);
    if(step.operation==='uploadArtifactContent'){check(refs.content_id===p.artifact.content_id);pending.localRead=await readers.observeCompleteUploadSource({stateDirectory:actor.state_directory,contentId:refs.content_id,expectedSha256:p.artifact.sha256,expectedBytes:p.artifact.byte_size});check(pending.localRead.content_id===p.artifact.content_id&&pending.localRead.retained_record_sha256===p.artifact.retained_record_sha256);}
    else{check(dirname(refs.output_file)===config.fixture_directory&&p.artifact.artifact_id===refs[step.resourceKey]&&p.artifact.destination_descriptor_sha256===sha({type:'native-complete-download-destination',version:1,run_id:context.run_id,step_id:'success/downloadArtifactContent',artifact_id:p.artifact.artifact_id,fixture_directory:config.fixture_directory,output_file:refs.output_file}));pending.localRead=readers.observeCompleteDownloadTarget({fixtureDirectory:config.fixture_directory,destination:refs.output_file,expectedSha256:p.artifact.sha256,expectedBytes:p.artifact.byte_size});}
   }else{
    check(kind==='journal'&&journalSteps.has(step.id));const expected=fields(input.expected,keys('intent_id request principal key state')),j=p.journal;
    check(expected.state===(step.id==='case/lost-response-retained'?'within-window':step.id==='case/settled-no-send'?'settled':'reconciliation-required')&&typeof expected.key==='string'&&hash(expected.key)===j.key_sha256&&j.key_sha256===p.subject.key_sha256);
    check(sha(expected.request)===(step.id==='case/lost-response-retained'?j.semantic_request_sha256:j.expected_request_sha256));let original=final.value.invocationId;
    if(step.id!=='case/lost-response-retained'){
     const prior=pairs.get(step.id==='case/restart-no-send'?'case/lost-response-retained':'prepare/fail-create');check(prior&&canonical(prior.f.preparation.subject)===canonical(f.preparation.subject)&&prior.final.value.endedAt<=f.preparation.prepared_at);original=prior.final.value.invocationId;
     check(j.original_invocation_id===original&&j.intent_id===expected.intent_id&&j.expected_principal_sha256===sha(expected.principal));if(step.id==='case/restart-no-send')check(prior.localValue.journal.intent_id===expected.intent_id);
    }
    const readContext={run_id:context.run_id,step_id:step.id,invocation_id:final.value.invocationId,original_invocation_id:original,config_sha256:selected.configSha256,scenario_sha256:selected.scenarioSha256,authority_record_sha256:config.authority_record_sha256,process_final_sha256:final.sha256,prepared_subject_sha256:f.preparation.subject_sha256};
    pending.localRead=await readers.observeCompleteHostJournal({stateDirectory:actor.state_directory,expected,context:readContext,subject:p.subject,storeBinding:p.store_binding});
   }
   current();check(!poisoned&&active===token&&handles.get(token)===pending);pending.reading=false;return Object.freeze({...scoped,status:'local-read-bound'});
  }catch{poisoned=true;if(ownsRead)pending.reading=false;fail();}
 }
 function receiveSigned(token,wire){return guarded(()=>{
  const pending=handles.get(token);handles.delete(token);check(pending&&active===token&&!pending.reading);active=null;const {f,e,final,disable,step}=pending;
  current();const source=byteCopy(wire,16000);attemptedWire=source;check(totalWire+source.length<=603360);totalWire+=source.length;
  const verified=verifyCompleteOriginal({expected:e,wire:source,publicKeyDer}),serviceValue=snapshot(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(verified.bytes)),9960);check(canonical(serviceValue)===verified.bytes.toString('utf8'));
  const local=snapshot(serviceValue,9960);check(local.version===1&&local.step_id===f.step_id&&local.run_id===context.run_id&&local.config_sha256===selected.configSha256&&local.scenario_sha256===selected.scenarioSha256&&local.authority_record_sha256===config.authority_record_sha256&&integer(local.observed_at));
  if(disable){const positive=pairs.get('prepare/revoke-own-positive');check(local.type==='native-revocation-disable-original'&&positive&&local.positive_observation_sha256===positive.service.sha256&&local.sequence===f.sequence);local.positive_observation_sha256=positive.local.sha256;}
  else{
   check(local.type===(step.id==='prepare/revoke-own-positive'?'native-revocation-positive-original':step.id==='prepare/fail-create'?'native-auxiliary-create-observation':'native-independent-observation')&&local.invocation_id===e.invocation_id&&local.preparation_sha256===e.preparation_sha256&&local.process_final_sha256===final.sha256);
   local.preparation_sha256=f.preparation.record_sha256;
   if(step.caseId)check(local.case_id===step.caseId);if(step.id==='prepare/revoke-own-positive')check(local.sequence===f.sequence);else check(local.subject_sha256===f.preparation.subject_sha256&&local.observer_id===context.observer_id);
   if(step.id==='case/revoked-after-disable'){const positive=pairs.get('prepare/revoke-own-positive'),disabled=pairs.get('control/revoke-submitter');check(positive&&disabled&&local.revocation&&local.revocation.positive_observation_record_id===positive.service.record_id&&local.revocation.disable_control_record_id===disabled.service.record_id&&f.related?.positive_record_id===positive.local.id&&f.related?.disable_record_id===disabled.local.id);local.revocation.positive_observation_record_id=positive.local.id;local.revocation.disable_control_record_id=disabled.local.id;}
  }
  if(!disable&&journalSteps.has(step.id)){
   const read=pending.localRead;check(local.journal===null&&read?.type==='native-journal-source-observation'&&read.retained_key_sha256===f.preparation.subject.key_sha256);
   local.journal={intent_id:read.intent_id,record_sha256:read.journal_entry_sha256,state:read.state,original_invocation_id:read.original_invocation_id,request_sha256:f.preparation.subject.request_sha256,key_sha256:read.retained_key_sha256};
  }
  if(!disable&&['uploadArtifactContent','downloadArtifactContent'].includes(step.operation)){
   const read=pending.localRead,a=fields(local.artifact,keys('source_sha256 source_bytes target_sha256 target_bytes'));check(read?.scope==='protected-local-artifact-read');
   const localSide=step.operation==='uploadArtifactContent'?'source':'target',remote=localSide==='source'?'target':'source';check(a[localSide+'_sha256']===null&&a[localSide+'_bytes']===null&&a[remote+'_sha256']===read.sha256&&a[remote+'_bytes']===read.byte_size);a[localSide+'_sha256']=read.sha256;a[localSide+'_bytes']=read.byte_size;local.artifact=a;
  }
  // Host time is captured only after authenticated bytes and causal joins validate.
  const observed=current();check(observed>=f.started_at&&observed>=(disable?f.related.positive_observed_at:final.value.endedAt));local.observed_at=observed;
  const bytes=Buffer.from(canonical(local)),record={id:'host_'+randomUUID().replaceAll('-',''),sha256:hash(bytes),bytes};check(bytes.length<=65536&&!localIds.has(record.id)&&!localHashes.has(record.sha256));
  serviceIds.add(e.record_id);serviceHashes.add(e.sha256);localIds.add(record.id);localHashes.add(record.sha256);
  const pair={service:e,local:{id:record.id,sha256:record.sha256,byte_size:bytes.length},localValue:freeze(local),wire:source,f,final,lineage:pending.lineage};pairs.set(f.step_id,pair);attemptedWire=null;
  return {...scoped,record,signedRecord:{id:e.record_id,sha256:hash(source),bytes:Buffer.from(source)},serviceMetadata:e};
 });}
 return Object.freeze({...scoped,bindHostCapture:value=>bind(value,false),bindHostDisable:value=>bind(value,true),receiveSigned,readHostJournal:(token,value)=>readLocal(token,value,'journal'),readHostArtifact:(token,value)=>readLocal(token,value,'artifact'),
  readFailedCapture:()=>poisoned&&attemptedWire?{scope:'failed-source-capture',sha256:hash(attemptedWire),bytes:Buffer.from(attemptedWire)}:null,
  readSignedTwins:()=>[...pairs].map(([step_id,p])=>({step_id,service:p.service,local:{...p.local},wire:Buffer.from(p.wire)})),
  snapshot:()=>Object.freeze({...scoped,poisoned,pending:active!==null,pairs:pairs.size,signedBytes:totalWire})});
}
