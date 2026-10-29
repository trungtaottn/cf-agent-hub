import {parseNativeCliOutput} from './native-cli-output.mjs';
/** Fixed source consistency only: not authenticated host or consumed request-body custody. */
import {PROCESS_LIMITS} from './native-r2-process.mjs';
import {createHash} from 'node:crypto';
import {canonicalCaseSubject} from './r2-case-policy.mjs';
import * as validators from '../../src/http/generated/auth-validators.js';
import {getNativeScenario,buildNativeInvocation} from './native-r2-scenario.mjs';
const fail=()=>{throw Error('NATIVE_BINDING_REJECTED');},hash=v=>createHash('sha256').update(v).digest('hex');
const ID=/^[A-Za-z0-9_-]{1,128}$/,SHA=/^[a-f0-9]{64}$/,eq=(a,b)=>canonicalCaseSubject(a)===canonicalCaseSubject(b);
function closed(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!Object.hasOwn(ds,k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))fail();return Object.fromEntries(keys.map(k=>[k,ds[k].value]));}
function refsCopy(v,step){const x=closed(v,step.refKeys);if(Object.values(x).some(y=>typeof y!=='string'))fail();buildNativeInvocation(step.id,x);return x;}
function detachedBody(value){
 let nodes=0,bytes=0;
 const charge=n=>{bytes+=n;if(bytes>65536)fail();};
 function copy(v,depth=0){
  if(++nodes>65536||depth>64)fail();
  if(v===null||typeof v==='boolean'){charge(v===null||v===true?4:5);return v;}
  if(typeof v==='string'){if(v.length>65536)fail();charge(Buffer.byteLength(JSON.stringify(v),'utf8'));return v;}
  if(typeof v==='number'){if(!Number.isFinite(v))fail();charge(Buffer.byteLength(JSON.stringify(v),'utf8'));return v;}
  if(Array.isArray(v)){
   if(Object.getPrototypeOf(v)!==Array.prototype||v.length>65536)fail();
   const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==v.length+1)fail();charge(2+Math.max(0,v.length-1));
   return Array.from({length:v.length},(_,i)=>{if(!ds[i]||!Object.hasOwn(ds[i],'value')||!ds[i].enumerable)fail();return copy(ds[i].value,depth+1);});
  }
  if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail();
  const keys=Reflect.ownKeys(v);if(keys.length>65536||keys.some(k=>typeof k!=='string'||k.length>65536))fail();
  charge(2+Math.max(0,keys.length-1));
  return Object.fromEntries(Object.entries(closed(v,keys)).map(([k,x])=>{charge(Buffer.byteLength(JSON.stringify(k),'utf8')+1);return [k,copy(x,depth+1)];}));
 }
 return copy(value);
}
const byteProto=Object.getPrototypeOf(Uint8Array.prototype),lengthOf=Object.getOwnPropertyDescriptor(byteProto,'byteLength').get,backingOf=Object.getOwnPropertyDescriptor(byteProto,'buffer').get;
function byteLength(v){if(!(v instanceof Uint8Array)||![Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(v))||Object.getPrototypeOf(backingOf.call(v))!==ArrayBuffer.prototype||lengthOf.call(v)>1048576||Reflect.ownKeys(v).some(k=>typeof k!=='string'||!/^\d+$/.test(k)))fail();return lengthOf.call(v);}

const isId=v=>typeof v==='string'&&ID.test(v),isSha=v=>typeof v==='string'&&SHA.test(v);
const taskFixtures=new Set(['main','fail','cancel','requeue']);
export function createNativeBindingRegistry(input){
 const raw=closed(input,['workspaceId','submitter','reviewer']),actors={};if(!isId(raw.workspaceId))fail();
 for(const slot of ['submitter','reviewer']){actors[slot]=closed(raw[slot],['principalId','agentId']);const a=actors[slot];if(!isId(a.principalId)||!isId(a.agentId)||a.principalId!==a.agentId)fail();}
 if(actors.submitter.principalId===actors.reviewer.principalId||actors.submitter.agentId===actors.reviewer.agentId)fail();
 const workspace=raw.workspaceId,scenario=getNativeScenario(),tokens=new WeakMap(),used=new Set(),allocatedRuntimeIds=new Set(),FINISHING=Object.freeze({});let inputAdmissions=[],active=null,poisoned=false,index=0,state={tasks:{},runs:{},runtimes:{},content:null,artifact:null,submitted:null,message:null,messageInboxObserved:false,messageAcknowledged:false,messageThreadObserved:false},completed=[],provenance=[];
 const guarded=fn=>{try{if(poisoned)fail();return fn();}catch(e){poisoned=true;throw e;}};
 const same=(a,b)=>{if(a!==b)fail();},increment=(a,b)=>{if(!Number.isSafeInteger(b)||b>=Number.MAX_SAFE_INTEGER||a!==b+1)fail();};
 function checkRefs(step,r){
  const bindings={main_task_id:state.tasks.main?.id,fail_task_id:state.tasks.fail?.id,cancel_task_id:state.tasks.cancel?.id,requeue_task_id:state.tasks.requeue?.id,main_run_id:state.runs.main?.id,main_artifact_id:state.artifact?.id,main_runtime_id:state.runtimes.submitter?.id,reviewer_agent_id:actors.reviewer.agentId,content_id:state.content?.id,thread_id:state.message?.thread_id};
  for(const [key,value] of Object.entries(bindings))if(Object.hasOwn(r,key)){if(!value)fail();same(r[key],value);}
  if(step.id==='probe/wrong-runtime'){if(!state.runtimes.submitter||r.wrong_runtime_id===state.runtimes.submitter.id)fail();}
 }
 const bodyNames={createTask:'TaskCreateRequest',patchTask:'TaskPatchRequest',readyTask:'TaskVersionRequest',claimTask:'TaskClaimRequest',submitTaskResult:'TaskSubmitResultRequest',acceptTaskResult:'TaskReasonRequest',failTask:'TaskFailRequest',cancelTask:'TaskReasonRequest',requeueTask:'TaskReasonRequest',createRuntime:'RuntimeCreateRequest',heartbeatRuntime:'RuntimeHeartbeatRequest',heartbeatRun:'RunHeartbeatRequest',stageArtifact:'ArtifactStageRequest',commitArtifact:'ArtifactCommitRequest',createMessage:'MessageCreateRequest',ackMessages:'MessageAckRequest'};
 // Pure structural API: only the controller's reader can establish byte origin.
 function checkInput(step,value){
  if(!step.refKeys.includes('input_file')){if(value!==null)fail();return null;}
  const v=closed(value,['sha256','byteSize','body']);
  if(!isSha(v.sha256)||!Number.isSafeInteger(v.byteSize)||v.byteSize<1||v.byteSize>65536)fail();
  // Descriptor-only detached JSON pre-admission; CLI still applies final byte rules.
  const b=detachedBody(v.body),name=bodyNames[step.operation];
  if(!name||!validators['validate'+name](b))fail();
  const op=step.operation,t=state.tasks[step.fixture],run=state.runs[step.fixture];
  if(['patchTask','readyTask','claimTask','submitTaskResult','acceptTaskResult','failTask','cancelTask','requeueTask'].includes(op)){if(!t)fail();same(b.expected_version,t.task_version);}
  if(op==='claimTask')same(b.runtime_instance_id,state.runtimes[step.actor]?.id);
  if(op==='submitTaskResult'||op==='failTask'){if(!run)fail();same(b.run_id,run.id);same(b.fence,run.fence);if(op==='failTask')same(b.outcome_unknown,true);else if(!state.artifact||!eq(b.result.artifact_ids,[state.artifact.id]))fail();}
  if(op==='heartbeatRun'){if(!state.runs.main)fail();same(b.expected_run_version,state.runs.main.run_version);same(b.fence,state.runs.main.fence);}
  if(op==='heartbeatRuntime'&&step.id!=='probe/wrong-runtime'){if(!state.runtimes[step.actor])fail();same(b.expected_runtime_version,state.runtimes[step.actor].runtime_version);}
  if(op==='stageArtifact'){if(!state.tasks.main||!state.runs.main||!state.content)fail();same(b.task_id,state.tasks.main.id);same(b.run_id,state.runs.main.id);same(b.byte_size,state.content.byteSize);same(b.sha256,state.content.sha256);}
  if(op==='commitArtifact'){if(!state.artifact)fail();same(b.expected_artifact_version,state.artifact.artifact_version);}
  if(op==='createMessage'){if(!state.tasks.main||!eq(b.recipient_agent_ids,[actors.reviewer.agentId])||!eq(b.refs,[{kind:'task',id:state.tasks.main.id}])||!eq(b.artifact_ids,[])||(b.thread_id!==undefined&&b.thread_id!==null))fail();}
  if(op==='ackMessages'&&(!state.message||!eq(b.message_ids,[state.message.id])))fail();
  return Object.freeze({stepId:step.id,sha256:v.sha256,byteSize:v.byteSize,status:'structurally-admitted'});
 }
 function planRequestInput(stepId){return guarded(()=>{
  if(active||index>=scenario.steps.length)fail();const step=scenario.steps[index];
  if(stepId!==step.id||step.kind==='control'||step.dependsOn.some(id=>!completed.includes(id)))fail();
  if(!step.refKeys.includes('input_file'))return null;
  const task=state.tasks[step.fixture],run=state.runs[step.fixture];let body;
  switch(step.operation){
   case 'createRuntime':body={label:'Native scenario '+step.actor};break;
   case 'createTask':body={title:'Native scenario '+step.fixture,description:'Synthetic isolated conformance fixture'};break;
   case 'patchTask':body={expected_version:task?.task_version,title:'Native scenario patched'};break;
   case 'readyTask':body={expected_version:task?.task_version};break;
   case 'acceptTaskResult':case 'cancelTask':case 'requeueTask':body={expected_version:task?.task_version,reason:'Native scenario '+step.operation};break;
   case 'claimTask':body={expected_version:task?.task_version,runtime_instance_id:state.runtimes[step.actor]?.id};break;
   case 'submitTaskResult':body={expected_version:task?.task_version,run_id:run?.id,fence:run?.fence,result:{summary:'Native scenario completed work',artifact_ids:[state.artifact?.id]}};break;
   case 'failTask':body={expected_version:task?.task_version,run_id:run?.id,fence:run?.fence,reason:'Native scenario uncertain external outcome',outcome_unknown:true};break;
   case 'heartbeatRun':body={expected_run_version:state.runs.main?.run_version,fence:state.runs.main?.fence};break;
   case 'heartbeatRuntime':body={expected_runtime_version:step.id==='probe/wrong-runtime'?1:state.runtimes[step.actor]?.runtime_version};break;
   case 'stageArtifact':body={task_id:state.tasks.main?.id,run_id:state.runs.main?.id,filename:'native-scenario.txt',media_type:'text/plain',byte_size:state.content?.byteSize,sha256:state.content?.sha256};break;
   case 'commitArtifact':body={expected_artifact_version:state.artifact?.artifact_version};break;
   case 'createMessage':body={recipient_agent_ids:[actors.reviewer.agentId],body:'Review the linked native scenario task',refs:[{kind:'task',id:state.tasks.main?.id}],artifact_ids:[]};break;
   case 'ackMessages':body={message_ids:[state.message?.id]};break;
   default:fail();
  }
  body=detachedBody(body);const json=canonicalCaseSubject(body),sha256=hash(json),byteSize=Buffer.byteLength(json);
  checkInput(step,{body,sha256,byteSize});
  const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
  return freeze({body,json,sha256,byteSize});
 });}
 function parseOutput(step,stdout,stderr){return parseNativeCliOutput({stepId:step.id,stdout,stderr,mode:'legacy-lineage'}).parsed;}
 function reduce(step,parsed,next){
  if(step.expectedExit!==0)return;
  const op=step.operation,fixture=step.fixture,actor=actors[step.actor];
  if(step.id==='prepare/retain-artifact'){next.content=parsed;return;}
  if(op==='createRuntime'){
   same(parsed.workspace_id,workspace);same(parsed.agent_id,actor.agentId);same(parsed.runtime_version,1);same(parsed.status,'online');if(allocatedRuntimeIds.has(parsed.id))fail();next.runtimes[step.actor]=parsed;return;
  }
  if(op==='heartbeatRuntime'){
   const d=parsed.data,old=next.runtimes[step.actor];if(!old)fail();for(const k of ['id','workspace_id','agent_id'])same(d[k],old[k]);same(d.status,'online');increment(d.runtime_version,old.runtime_version);next.runtimes[step.actor]=d;return;
  }
  if(['getRun','heartbeatRun'].includes(op)){
   const d=parsed.data,old=next.runs.main;if(!old)fail();for(const k of ['id','workspace_id','task_id','agent_id','runtime_instance_id','fence','status','ended_at','started_at'])same(d[k],old[k]);if(op==='heartbeatRun')increment(d.run_version,old.run_version);else same(d.run_version,old.run_version);next.runs.main=d;return;
  }
  if(taskFixtures.has(fixture)&&['createTask','getTask','patchTask','readyTask','claimTask','submitTaskResult','acceptTaskResult','failTask','cancelTask','requeueTask'].includes(op)){
   const direct=['createTask','getTask','patchTask'].includes(op),d=direct?parsed.data:parsed.data.task,old=next.tasks[fixture],run=direct?null:parsed.data.run;
   same(d.workspace_id,workspace);same(d.approval_id,null);if(!['submitTaskResult','acceptTaskResult'].includes(op))same(d.result,null);if(!direct)same(parsed.data.approval,null);
   if(op==='createTask'){if(old||Object.values(next.tasks).some(t=>t.id===d.id))fail();same(d.state,'backlog');same(d.task_version,1);same(d.active_run_id,null);same(d.latest_run_id,null);same(d.result,null);next.tasks[fixture]=d;return;}
   if(!old)fail();same(d.id,old.id);if(op==='getTask'){same(d.task_version,old.task_version);same(d.state,old.state);}else increment(d.task_version,old.task_version);if(['getTask','patchTask'].includes(op))for(const k of ['active_run_id','latest_run_id','approval_id','result'])if(!eq(d[k],old[k]))fail();
   const states={patchTask:'backlog',readyTask:'ready',claimTask:'doing',submitTaskResult:'review',acceptTaskResult:'done',failTask:'backlog',cancelTask:'cancelled',requeueTask:'ready'};if(states[op])same(d.state,states[op]);
   if(op==='claimTask'){
    if(!run||Object.values(next.runs).some(r=>r.id===run.id))fail();for(const [k,v] of Object.entries({workspace_id:workspace,task_id:d.id,agent_id:actor.agentId,runtime_instance_id:next.runtimes[step.actor]?.id,status:'active',run_version:1,ended_at:null}))same(run[k],v);same(d.active_run_id,run.id);same(d.latest_run_id,run.id);same(run.fence,1);next.runs[fixture]=run;
   }else if(['submitTaskResult','failTask'].includes(op)){
    const previous=next.runs[fixture];if(!previous||!run)fail();for(const k of ['id','workspace_id','task_id','agent_id','runtime_instance_id','fence','started_at'])same(run[k],previous[k]);increment(run.run_version,previous.run_version);same(run.status,op==='submitTaskResult'?'submitted':'failed');if(run.ended_at===null)fail();same(d.active_run_id,null);same(d.latest_run_id,run.id);next.runs[fixture]=run;
    if(op==='submitTaskResult'){if(!next.artifact||next.artifact.status!=='committed'||!d.result)fail();same(d.result.run_id,run.id);same(d.result.submitted_by.kind,'agent');same(d.result.submitted_by.principal_id,actors.submitter.principalId);same(d.result.submitted_by.agent_id,actors.submitter.agentId);if(!eq(d.result.artifact_ids,[next.artifact.id]))fail();next.submitted=d.result;}else if(!d.flags.includes('outcome_unknown'))fail();
   }else if(op==='acceptTaskResult'){if(!next.submitted||!eq(d.result,next.submitted))fail();same(d.latest_run_id,next.submitted.run_id);same(d.active_run_id,null);same(run,null);same(actor.principalId,actors.reviewer.principalId);same(actor.agentId,actors.reviewer.agentId);}
   else if(!direct){same(run,null);same(d.active_run_id,null);same(d.latest_run_id,old.latest_run_id);same(d.result,null);}
   next.tasks[fixture]=d;return;
  }
  if(['stageArtifact','uploadArtifactContent','commitArtifact','getArtifact','downloadArtifactContent'].includes(op)){
   const d=parsed.data,old=next.artifact;if(!next.content||!next.tasks.main||!next.runs.main)fail();for(const [k,v] of Object.entries({workspace_id:workspace,task_id:next.tasks.main.id,run_id:next.runs.main.id,byte_size:next.content.byteSize,sha256:next.content.sha256}))same(d[k],v);same(d.owner.kind,'agent');same(d.owner.principal_id,actors.submitter.principalId);same(d.owner.agent_id,actors.submitter.agentId);
   if(op==='stageArtifact'){if(old)fail();same(d.status,'staged');same(d.artifact_version,1);same(d.committed_at,null);if(d.expires_at===null)fail();}else{if(!old)fail();for(const k of ['id','filename','media_type','created_at'])same(d[k],old[k]);if(op==='uploadArtifactContent'||op==='commitArtifact'){increment(d.artifact_version,old.artifact_version);same(d.status,op==='uploadArtifactContent'?'uploaded':'committed');if(op==='uploadArtifactContent'){same(d.committed_at,null);same(d.expires_at,old.expires_at);}else{if(d.committed_at===null)fail();same(d.expires_at,null);}}else{same(d.artifact_version,old.artifact_version);same(d.status,old.status);same(d.committed_at,old.committed_at);same(d.expires_at,old.expires_at);}}next.artifact=d;return;
  }
  if(op==='createMessage'){
   const d=parsed.data;if(next.message||!next.tasks.main)fail();
   same(d.workspace_id,workspace);same(d.sender.kind,'agent');same(d.sender.principal_id,actors.submitter.principalId);same(d.sender.agent_id,actors.submitter.agentId);
   if(!eq(d.recipient_agent_ids,[actors.reviewer.agentId])||!eq(d.refs,[{kind:'task',id:next.tasks.main.id}])||!eq(d.artifact_ids,[]))fail();
   same(d.acknowledged_at,null);next.message=d;return;
  }
  if(op==='getInbox'||op==='getThread'){
   const message=next.message;if(!message||op==='getThread'&&!next.messageAcknowledged)fail();const ids=new Set();let found=null;
   for(const d of parsed.data){
    same(d.workspace_id,workspace);if(ids.has(d.id))fail();ids.add(d.id);
    if(op==='getInbox'){if(!d.recipient_agent_ids.includes(actors.reviewer.agentId))fail();same(d.acknowledged_at,null);}
    else same(d.thread_id,message.thread_id);
    if(d.id===message.id)found=d;
   }
   // A bounded page without the dependency is incomplete, even if more pages exist.
   // Never manufacture extra reads outside the admitted scenario budget.
   if(!found)fail();
   if(op==='getInbox'){if(!eq(found,message))fail();next.messageInboxObserved=true;}
   else{if(found.acknowledged_at===null||!eq({...found,acknowledged_at:null},message))fail();next.messageThreadObserved=true;}
   return;
  }
  if(op==='ackMessages'){
   if(!next.message||!next.messageInboxObserved||next.messageAcknowledged||!eq(parsed.data.acknowledged_ids,[next.message.id])||!eq(parsed.data.already_acknowledged_ids,[]))fail();
   next.messageAcknowledged=true;return;
  }
  if(op==='listArtifacts'||op==='listTaskResults'){
   const expected=op==='listArtifacts'?next.artifact:next.submitted;if(!expected)fail();const found=parsed.data.find(x=>op==='listArtifacts'?x.id===expected.id:eq(x,expected));if(found&&!eq(found,expected))fail();if(!parsed.page.has_more&&!found)fail();
  }
 }
 function process(value,step){
  const v=closed(value,['invocationId','exitCode','stdout','stderr','custody','maxOutputBytes']);if(typeof v.invocationId!=='string'||!/^inv_[a-z0-9]{1,64}$/.test(v.invocationId)||used.has(v.invocationId)||v.exitCode!==step.expectedExit||!Number.isSafeInteger(v.maxOutputBytes)||v.maxOutputBytes<1||v.maxOutputBytes>1048576)fail();
  const a=byteLength(v.stdout),b=byteLength(v.stderr);if(a+b>v.maxOutputBytes)fail();const stdout=Buffer.from(Uint8Array.prototype.slice.call(v.stdout)),stderr=Buffer.from(Uint8Array.prototype.slice.call(v.stderr));
  const c=closed(v.custody,['prepared','spawned','final','transcripts']),t=closed(c.transcripts,['stdout','stderr']);
  for(const kind of ['prepared','spawned','final']){const r=closed(c[kind],['name','sha256','byteSize']);if(r.name!==v.invocationId+'.'+kind+'.json'||!isSha(r.sha256)||!Number.isSafeInteger(r.byteSize)||r.byteSize<1||r.byteSize>PROCESS_LIMITS.receiptBytes)fail();c[kind]=r;}
  for(const stream of ['stdout','stderr']){const r=closed(t[stream],['name','sha256','byteSize','complete']),bytes=stream==='stdout'?stdout:stderr;if(r.name!==v.invocationId+'.'+stream||r.complete!==true||r.byteSize!==bytes.length||r.sha256!==hash(bytes))fail();t[stream]=r;}
  return {invocationId:v.invocationId,parsed:parseOutput(step,stdout,stderr),provenance:{stepId:step.id,invocationId:v.invocationId,finalSha256:c.final.sha256,stdoutSha256:t.stdout.sha256,stderrSha256:t.stderr.sha256}};
 }
 function finish(token,mode,body){return guarded(()=>{if(active!==token||!tokens.has(token))fail();const p=tokens.get(token);if(p.step.kind==='control'?(mode!=='control'):(mode!=='process'))fail();tokens.delete(token);active=FINISHING;try{const next=structuredClone(state);let proof;if(mode==='process'){const out=process(body,p.step);reduce(p.step,out.parsed,next);proof=out.provenance;}else{const r=closed(body,['stepId','status','recordSha256','configSha256','scenarioSha256','authorityRecordSha256','usage']),u=closed(r.usage,['commands','mutations','artifact_bytes','output_bytes']);if(r.stepId!==p.step.id||r.status!=='observed'||['recordSha256','configSha256','scenarioSha256','authorityRecordSha256'].some(k=>!isSha(r[k]))||Object.values(u).some(x=>!Number.isSafeInteger(x)||x<0))fail();proof={stepId:p.step.id,recordSha256:r.recordSha256};}if(poisoned)fail();if(mode==='process'){used.add(proof.invocationId);if(p.step.operation==='createRuntime')allocatedRuntimeIds.add(next.runtimes[p.step.actor].id);}state=next;completed.push(p.step.id);provenance.push(proof);index++;return Object.freeze({status:'source-consistent-step',stepId:p.step.id});}finally{active=null;}});}
 function prepare(stepId,refs,input,strict){return guarded(()=>{if(active||index>=scenario.steps.length)fail();active=FINISHING;try{
  const step=scenario.steps[index];if(stepId!==step.id||step.dependsOn.some(id=>!completed.includes(id)))fail();let admission=null;
  if(step.kind==='control'){if(refs!==null||strict)fail();}else{checkRefs(step,refsCopy(refs,step));if(strict)admission=checkInput(step,input);}
  if(poisoned)fail();const token=Object.freeze(Object.create(null));tokens.set(token,{step});if(admission)inputAdmissions.push(admission);active=token;return token;
 }catch(e){active=null;throw e;}});}
 return Object.freeze({planRequestInput,prepare:(stepId,refs=null)=>prepare(stepId,refs,null,false),prepareWithInput:(stepId,refs,input)=>prepare(stepId,refs,input,true),completeControl:(t,r)=>finish(t,'control',r),completeProcess:(t,r)=>finish(t,'process',r),readSummary(){return structuredClone({status:poisoned?'incomplete':index===scenario.steps.length?'source-consistent-bindings':'pending',completedSteps:index,plannedSteps:scenario.steps.length,requestBodyCustody:'pending',inputAdmissions,authenticatedHost:'pending',messageThreadBindings:state.messageThreadObserved?'source-consistent-output-lineage':'pending',issue48Complete:false,bindings:state,provenance});}});
}
