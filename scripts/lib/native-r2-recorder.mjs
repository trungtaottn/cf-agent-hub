/** Actual in-process phase capture, not an authentication or durability service. */
import {createHash,randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import Ajv from 'ajv';
import {caseSchemas,CASE_OPERATIONS,canonicalCaseSubject} from './r2-case-policy.mjs';
import {validateNativeConfig} from './native-r2-config.mjs';
import {nativeConfigDigest} from './native-r2-admission.mjs';
import {getNativeScenario,buildNativeInvocation} from './native-r2-scenario.mjs';
import {nativeSourceInventoryDigest,loadNativeOriginals} from './native-r2-evidence.mjs';
import {planNativeOriginalReads} from './native-r2-original-reader.mjs';
import {validateNativeObservation} from './native-r2-observation.mjs';
const ajv=new Ajv({strict:true,allErrors:false,inlineRefs:false});ajv.addSchema(caseSchemas);const validSubject=ajv.compile({$ref:caseSchemas.$id+'#/$defs/prepared_subject'});
const hash=b=>createHash('sha256').update(b).digest('hex'),canonical=canonicalCaseSubject,sha=v=>hash(canonical(v));
const reject=()=>{throw Error('NATIVE_RECORDER_REJECTED');};
function closed(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype)reject();const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!Object.hasOwn(d,k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))reject();return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
function snapshot(v,depth=0){if(depth>32)reject();if(v===null||typeof v==='boolean')return v;if(typeof v==='string'){if(v.length>65536)reject();return v;}if(typeof v==='number'){if(!Number.isSafeInteger(v))reject();return v;}if(Array.isArray(v)){if(v.length>4096)reject();const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==v.length+1)reject();return Array.from({length:v.length},(_,i)=>{if(!d[i]||!Object.hasOwn(d[i],'value'))reject();return snapshot(d[i].value,depth+1);});}const keys=Reflect.ownKeys(v??{});if(keys.some(k=>typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)))reject();return Object.fromEntries(Object.entries(closed(v,keys)).map(([k,x])=>[k,snapshot(x,depth+1)]));}
const frozen=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v);}return v;};
const eq=(a,b)=>canonical(a)===canonical(b),ID=/^[A-Za-z0-9_-]{1,128}$/,HASH=/^[a-f0-9]{64}$/;
const fields=s=>s.split(' ');
const typedPrototype=Object.getPrototypeOf(Uint8Array.prototype),byteLength=Object.getOwnPropertyDescriptor(typedPrototype,'byteLength').get,backing=Object.getOwnPropertyDescriptor(typedPrototype,'buffer').get;
function originalRows(value,reserve,verify=()=>{}){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length!==4)reject();
 const ds=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(ds).length!==5)reject();
 const rows=Array.from({length:4},(_,i)=>{if(!ds[i]||!Object.hasOwn(ds[i],'value'))reject();return closed(ds[i].value,['id','sha256','bytes']);});let sum=0;
 for(const row of rows){const b=row.bytes;if(!ID.test(row.id)||!HASH.test(row.sha256)||!(b instanceof Uint8Array)||![Uint8Array.prototype,Buffer.prototype].includes(Object.getPrototypeOf(b))||Object.getPrototypeOf(backing.call(b))!==ArrayBuffer.prototype||Reflect.ownKeys(b).some(k=>typeof k!=='string'||!/^\d+$/.test(k)))reject();const n=byteLength.call(b);if(n<1||n>65536)reject();sum+=n;}
 verify(rows);reserve(rows.length,sum);
 return rows.map(r=>({id:r.id,sha256:r.sha256,bytes:Buffer.from(Uint8Array.prototype.slice.call(r.bytes))}));
}
export function createNativeCaseRecorder(input){
 const raw=closed(input,['config','context']),config=validateNativeConfig(snapshot(raw.config)),ctx=snapshot(closed(raw.context,['run_id','environment_id','config_epoch','observer_id','source_inventory']));
 if(!ID.test(ctx.run_id)||!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(ctx.environment_id)||!ID.test(ctx.observer_id)||!Number.isSafeInteger(ctx.config_epoch)||ctx.config_epoch<0)reject();
 const scenario=getNativeScenario(),steps=new Map(scenario.steps.filter(s=>s.caseId||['prepare/fail-create','prepare/revoke-own-positive'].includes(s.id)).map(s=>[s.id,s]));
 const shared={run_id:ctx.run_id,candidate_sha:config.candidate_sha,source_tree_sha256:nativeSourceInventoryDigest(ctx.source_inventory),environment_id:ctx.environment_id,composition_sha256:config.composition_sha256,config_sha256:nativeConfigDigest(config),scenario_sha256:sha(scenario),authority_record_sha256:config.authority_record_sha256};
 const processSubjects={config_sha256:shared.config_sha256,candidate_sha:config.candidate_sha,candidate_tree_sha:config.candidate_tree_sha,composition_sha256:config.composition_sha256,node_sha256:config.node.sha256,build_sha256:config.build.sha256,authority_record_sha256:config.authority_record_sha256,scenario_sha256:shared.scenario_sha256,actors_sha256:sha({actors:config.actors,fixture_stores:config.fixture_stores}),workspaces_sha256:sha(config.workspaces)};
 const records=new Map(),prepared=new Map(),handles=new WeakMap(),usedProcesses=new Set();let total=0,lastTime=0,recordSlots=0;
 const now=()=>{const t=Date.now();if(!Number.isSafeInteger(t)||t<lastTime)reject();lastTime=t;return t;};
 const reserve=(count,bytes)=>{if(recordSlots+count>512||!Number.isSafeInteger(bytes)||bytes<0||total+bytes>16777216)reject();total+=bytes;recordSlots+=count;};
 const emit=(id,value)=>{if(!ID.test(id)||records.has(id))reject();const bytes=Buffer.from(canonical(value));if(bytes.length>65536)reject();reserve(1,bytes.length);const r={id,sha256:hash(bytes),bytes};records.set(id,r);return r;};
 const configRecord=emit('config_'+randomUUID().replaceAll('-',''),config);
 const publicContext=frozen({...ctx,candidate_sha:config.candidate_sha,candidate_git_tree_sha:config.candidate_tree_sha,composition_sha256:config.composition_sha256,config_sha256:shared.config_sha256,scenario_sha256:shared.scenario_sha256,authority_record_sha256:config.authority_record_sha256,node_sha256:config.node.sha256,executable_sha256:config.build.sha256,actors_sha256:processSubjects.actors_sha256,workspaces_sha256:processSubjects.workspaces_sha256,workspace_id:config.workspaces.primary,config_record_id:configRecord.id});
 const api={durability:'memory-only',acceptance:'pending-external-inspection',issue48Complete:false};
 Object.defineProperties(api,{
  readProtectedContext:{value:()=>structuredClone(publicContext)},
  readProtectedRecords:{value:()=>[...records.values()].map(r=>({...r,bytes:Buffer.from(r.bytes)}))},
  remainingBytes:{value:()=>16777216-total},
  prepare:{value:(stepId,value)=>{
   if(prepared.has(stepId)||!steps.has(stepId))reject();const step=steps.get(stepId),p=snapshot(closed(value,['subject','record_source_id','refs'])),actor=config.actors.find(a=>a.id===step.actor),s=p.subject;
   if(!validSubject(s)||!ID.test(p.record_source_id)||!actor||s.actor_kind!=='native'||s.foreign_runs!==null||s.principal_id!==actor.principal_id||s.agent_id!==actor.agent_id||s.workspace_id!==config.workspaces.primary||s.authority_epoch!==ctx.config_epoch||typeof s.credential_id!=='string'||p.refs.state_directory!==actor.state_directory||p.refs.origin!==config.origin||p.refs.workspace!==config.workspaces.primary)reject();
   const operation=step.operation??'createTask',meta=CASE_OPERATIONS[operation];
   if(!meta||(!meta.idempotency&&s.key_sha256!==null)||(meta.idempotency&&!HASH.test(s.key_sha256))||(!meta.runtimeProof&&s.proof_sha256!==null)||(meta.runtimeProof&&(!HASH.test(s.proof_sha256)||typeof s.runtime_id!=='string')))reject();
   if(['getTask','patchTask','readyTask','cancelTask','requeueTask','claimTask','submitTaskResult','acceptTaskResult','failTask','listTaskResults'].includes(operation)&&typeof s.task_id!=='string')reject();
   if(['getRun','heartbeatRun','submitTaskResult','acceptTaskResult','failTask'].includes(operation)&&typeof s.run_id!=='string')reject();
   if(step.resourceKey?.endsWith('task_id')&&p.refs[step.resourceKey]!==s.task_id||step.resourceKey?.endsWith('run_id')&&p.refs[step.resourceKey]!==s.run_id||step.resourceKey?.endsWith('runtime_id')&&p.refs[step.resourceKey]!==s.runtime_id)reject();
   const invocation=frozen({nodeSha256:config.node.sha256,entrySha256:config.build.sha256,args:buildNativeInvocation(stepId,p.refs),cwd:dirname(config.build.path),env:{TZ:'UTC',LANG:'C.UTF-8'}});
   const original={type:'native-case-preparation-original',version:1,...shared,case_id:step.caseId,step_id:stepId,prepared_at:now(),subject:s,invocation_commitment_sha256:sha(invocation),record_source_id:p.record_source_id};
   const record=emit('prep_'+randomUUID().replaceAll('-',''),original);prepared.set(stepId,{step,original,record,invocation,state:'prepared'});
   const result={prepared:true,stepId,recordId:record.id,sha256:record.sha256};Object.defineProperty(result,'readInvocation',{value:()=>frozen(structuredClone(invocation))});return Object.freeze(result);
  }},
  begin:{value:stepId=>{const p=prepared.get(stepId);if(!p||p.state!=='prepared'||!p.step.caseId)reject();p.state='started';p.startedAt=now();const token=Object.freeze({});handles.set(token,p);return token;}},
  reserveProcessRead:{value:(token,invocationId,custody)=>{
   const p=handles.get(token);if(!p||p.state!=='started'||p.readReservation)reject();
   const plan=planNativeOriginalReads(invocationId,custody,16777216-total);reserve(3,plan.totalBytes);
   p.readReservation={invocationId,plan};return frozen({invocationId,custody:Object.fromEntries(plan.entries.map(({kind,name,sha256,byteSize})=>[kind,{name,sha256,byteSize}])),totalBytes:plan.totalBytes});
  }},
  finish:{value:(token,value)=>{
   const p=handles.get(token);if(!p||p.state!=='started')reject();p.state='consumed';handles.delete(token);
   const v=closed(value,['records','processPreparedId','processSpawnedId','processFinalId','observerId','genericObservation','cost']);
   const reservation=p.readReservation;
   const retainedRows=originalRows(v.records,(count,bytes)=>reserve(count-(reservation?3:0),bytes-(reservation?.plan.totalBytes??0)),rows=>{
    if(!reservation)return;
    const ids={prepared:v.processPreparedId,spawned:v.processSpawnedId,final:v.processFinalId};
    if(new Set(Object.values(ids)).size!==3)reject();
    for(const expected of reservation.plan.entries){const row=rows.find(r=>r.id===ids[expected.kind]);if(!row||row.sha256!==expected.sha256||byteLength.call(row.bytes)!==expected.byteSize)reject();}
   }),loaded=loadNativeOriginals(retainedRows);
   for(const id of loaded.keys())if(records.has(id))reject();
   const get=id=>{if(!ID.test(id)||!loaded.has(id))reject();return loaded.get(id);},pr=get(v.processPreparedId),sp=get(v.processSpawnedId),fr=get(v.processFinalId),ob=get(v.observerId),f=fr.value,o=ob.value;
   const pv=closed(pr.value,fields('version status invocationId subjects invocationSha256 timeoutMs maxOutputBytes preparedAt retryAllowed'));
   closed(sp.value,fields('version status invocationId subjects prepared identity spawnedAt retryAllowed'));
   closed(f,fields('version invocationId subjects status reason startedAt endedAt closeObserved exitCode signal observedBytes retainedBytes truncated prepared spawned transcripts retryAllowed effectOutcome descendants'));
   const inv=f.invocationId;if(reservation&&reservation.invocationId!==inv)reject();if(!/^inv_[a-z0-9]{1,64}$/.test(inv)||usedProcesses.has(inv)||pv.invocationId!==inv||sp.value.invocationId!==inv||pv.invocationSha256!==p.original.invocation_commitment_sha256)reject();
   for(const r of [pv,sp.value,f])if(r.version!==1||r.retryAllowed!==false||!eq(r.subjects,processSubjects))reject();
   const ref=(v,r,suffix)=>{const a=closed(v,['name','sha256','byteSize']);if(a.name!==inv+suffix||a.sha256!==r.sha256||a.byteSize!==r.byte_size)reject();};ref(sp.value.prepared,pr,'.prepared.json');ref(f.prepared,pr,'.prepared.json');ref(f.spawned,sp,'.spawned.json');
   if(pv.status!=='prepared'||sp.value.status!=='spawned'||f.status!=='terminal'||f.reason!=='exit'||f.closeObserved!==true||f.signal!==null||f.truncated!==false||f.exitCode!==p.step.expectedExit||f.effectOutcome!=='unknown'||f.descendants!=='unverified')reject();
   if(!Number.isSafeInteger(pv.timeoutMs)||pv.timeoutMs<1||pv.timeoutMs>300000||!Number.isSafeInteger(pv.maxOutputBytes)||pv.maxOutputBytes<1||pv.maxOutputBytes>1048576)reject();
   closed(f.transcripts,['stdout','stderr']);let transcriptBytes=0;for(const stream of ['stdout','stderr']){const t=closed(f.transcripts[stream],['name','sha256','byteSize','complete']);if(t.name!==inv+'.'+stream||!HASH.test(t.sha256)||!Number.isSafeInteger(t.byteSize)||t.byteSize<0||t.complete!==true||t.byteSize===0&&t.sha256!==hash(''))reject();transcriptBytes+=t.byteSize;}
   if(transcriptBytes>pv.maxOutputBytes||f.observedBytes!==transcriptBytes||f.retainedBytes!==transcriptBytes)reject();
   closed(o,fields('type version run_id case_id step_id invocation_id observed_at config_sha256 scenario_sha256 authority_record_sha256 process_final_sha256 preparation_sha256 subject_sha256 observer_id binding projection transport resources artifact journal revocation'));
   if(o.type!=='native-independent-observation'||o.version!==1||o.run_id!==ctx.run_id||o.case_id!==p.step.caseId||o.step_id!==p.step.id||o.invocation_id!==inv||o.process_final_sha256!==fr.sha256||o.preparation_sha256!==p.record.sha256||o.subject_sha256!==sha(p.original.subject)||o.observer_id!==ctx.observer_id)reject();
   for(const key of ['config_sha256','scenario_sha256','authority_record_sha256'])if(o[key]!==shared[key])reject();
   const binding=closed(o.binding,fields('workspace_id principal_id agent_id credential_id runtime_id config_epoch grant_sha256 proof_sha256'));for(const key of ['workspace_id','principal_id','agent_id','credential_id','runtime_id','grant_sha256','proof_sha256'])if(binding[key]!==p.original.subject[key])reject();if(binding.config_epoch!==ctx.config_epoch)reject();
   const projection=closed(o.projection,fields('record_sha256 stdout_sha256 stderr_sha256 stdout_bytes stderr_bytes schema_error_codes foreign_identifier_hashes secret_match_hashes runtime_token_output_count'));
   for(const stream of ['stdout','stderr'])if(projection[stream+'_sha256']!==f.transcripts[stream].sha256||projection[stream+'_bytes']!==f.transcripts[stream].byteSize)reject();
   const expected={stepId:p.step.id,invocationId:inv,processExit:f.exitCode,executableSha256:config.build.sha256,requestCount:p.step.expectedRequests,httpStatus:p.step.expectedStatus??null,configSha256:shared.config_sha256,scenarioSha256:shared.scenario_sha256,authorityRecordSha256:shared.authority_record_sha256,principalId:binding.principal_id,agentId:binding.agent_id,workspaceId:binding.workspace_id,processRecordSha256:fr.sha256};
   if(!validateNativeObservation(v.genericObservation,expected,v.cost)||v.genericObservation.recordSha256!==ob.sha256)reject();
   const requests=o.transport?.requests??o.transport?.attempted_requests;if(!Array.isArray(requests)||requests.length!==expected.requestCount||(expected.httpStatus===null?o.transport.client_response!==null:requests.at(-1)?.status!==expected.httpStatus))reject();
   const end=now();for(const time of [pv.preparedAt,sp.value.spawnedAt,f.startedAt,f.endedAt,o.observed_at])if(!Number.isSafeInteger(time))reject();if(!(p.original.prepared_at<=p.startedAt&&p.startedAt<=pv.preparedAt&&pv.preparedAt<=f.startedAt&&f.startedAt<=sp.value.spawnedAt&&sp.value.spawnedAt<=f.endedAt&&f.endedAt<=o.observed_at&&o.observed_at<=end))reject();
   for(const row of retainedRows)records.set(row.id,{id:row.id,sha256:row.sha256,bytes:Buffer.from(row.bytes)});usedProcesses.add(inv);
   const h={type:'native-case-harness-original',version:1,...shared,id:'case_'+randomUUID().replaceAll('-',''),step_id:p.step.id,case_id:p.step.caseId,subject_sha256:sha(p.original.subject),preparation_sha256:p.record.sha256,process_final_sha256:fr.sha256,observer_sha256:ob.sha256,started_at:p.startedAt,ended_at:end,exit_code:0};const record=emit(h.id,h);
   return Object.freeze({status:'controller-checks-complete',stepId:p.step.id,recordId:record.id,sha256:record.sha256,typedCaseStatus:'pending-full-assembler',durability:'memory-only'});
  }}
 });return Object.freeze(api);
}
