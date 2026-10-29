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
const byteProto=Object.getPrototypeOf(Uint8Array.prototype),lengthOf=Object.getOwnPropertyDescriptor(byteProto,'byteLength').get,backingOf=Object.getOwnPropertyDescriptor(byteProto,'buffer').get;
function byteLength(v){if(!(v instanceof Uint8Array)||![Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(v))||Object.getPrototypeOf(backingOf.call(v))!==ArrayBuffer.prototype||lengthOf.call(v)>1048576||Reflect.ownKeys(v).some(k=>typeof k!=='string'||!/^\d+$/.test(k)))fail();return lengthOf.call(v);}
const responseNames={createTask:'TaskResponse',getTask:'TaskResponse',patchTask:'TaskResponse',readyTask:'TaskCommandResultResponse',claimTask:'TaskCommandResultResponse',submitTaskResult:'TaskCommandResultResponse',acceptTaskResult:'TaskCommandResultResponse',failTask:'TaskCommandResultResponse',cancelTask:'TaskCommandResultResponse',requeueTask:'TaskCommandResultResponse',getRun:'RunResponse',heartbeatRun:'RunResponse',heartbeatRuntime:'RuntimeResponse',stageArtifact:'ArtifactResponse',uploadArtifactContent:'ArtifactResponse',commitArtifact:'ArtifactResponse',getArtifact:'ArtifactResponse',downloadArtifactContent:'ArtifactResponse',listArtifacts:'ArtifactListResponse',listTaskResults:'TaskResultListResponse'};
const isId=v=>typeof v==='string'&&ID.test(v),isSha=v=>typeof v==='string'&&SHA.test(v);
const taskFixtures=new Set(['main','fail','cancel','requeue']);
export function createNativeBindingRegistry(input){
 const raw=closed(input,['workspaceId','submitter','reviewer']),actors={};if(!isId(raw.workspaceId))fail();
 for(const slot of ['submitter','reviewer']){actors[slot]=closed(raw[slot],['principalId','agentId']);const a=actors[slot];if(!isId(a.principalId)||!isId(a.agentId)||a.principalId!==a.agentId)fail();}
 if(actors.submitter.principalId===actors.reviewer.principalId||actors.submitter.agentId===actors.reviewer.agentId)fail();
 const workspace=raw.workspaceId,scenario=getNativeScenario(),tokens=new WeakMap(),used=new Set(),allocatedRuntimeIds=new Set(),FINISHING=Object.freeze({});let active=null,poisoned=false,index=0,state={tasks:{},runs:{},runtimes:{},content:null,artifact:null,submitted:null},completed=[],provenance=[];
 const guarded=fn=>{try{if(poisoned)fail();return fn();}catch(e){poisoned=true;throw e;}};
 const same=(a,b)=>{if(a!==b)fail();},increment=(a,b)=>{if(!Number.isSafeInteger(b)||b>=Number.MAX_SAFE_INTEGER||a!==b+1)fail();};
 function checkRefs(step,r){
  const bindings={main_task_id:state.tasks.main?.id,fail_task_id:state.tasks.fail?.id,cancel_task_id:state.tasks.cancel?.id,requeue_task_id:state.tasks.requeue?.id,main_run_id:state.runs.main?.id,main_artifact_id:state.artifact?.id,main_runtime_id:state.runtimes.submitter?.id,reviewer_agent_id:actors.reviewer.agentId,content_id:state.content?.id};
  for(const [key,value] of Object.entries(bindings))if(Object.hasOwn(r,key)){if(!value)fail();same(r[key],value);}
  if(step.id==='probe/wrong-runtime'){if(!state.runtimes.submitter||r.wrong_runtime_id===state.runtimes.submitter.id)fail();}
 }
 function parseOutput(step,stdout,stderr){
  if(step.id==='prepare/retain-artifact'){
   if(stdout.length)fail();const text=new TextDecoder('utf-8',{fatal:true}).decode(stderr),lines=text.split('\n').filter(Boolean),local=lines.filter(x=>x.startsWith('Local: '));if(local.length!==1||lines.some(x=>!x.startsWith('Local: ')&&x!=='Local action completed.'))fail();
   const v=closed(JSON.parse(local[0].slice(7)),['id','state','byteSize','sha256','references']);if(!isId(v.id)||v.state!=='ready'||!Number.isSafeInteger(v.byteSize)||v.byteSize<1||v.byteSize>10485760||!isSha(v.sha256)||!Number.isSafeInteger(v.references)||v.references<0)fail();return v;
  }
  if(step.expectedExit!==0||(!responseNames[step.operation]&&step.operation!=='createRuntime'))return null;
  const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(stdout));
  if(step.operation==='createRuntime'){const envelope=closed(v,['data','request_id']),masked=closed(envelope.data,['runtime','runtime_token','revealed']);if(masked.runtime_token!==null||masked.revealed!==false||!validators.validateRuntimeResponse({data:masked.runtime,request_id:envelope.request_id}))fail();return masked.runtime;}
  if(!validators['validate'+responseNames[step.operation]](v))fail();return v;
 }
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
 return Object.freeze({prepare(stepId,refs=null){return guarded(()=>{if(active||index>=scenario.steps.length)fail();active=FINISHING;try{const step=scenario.steps[index];if(stepId!==step.id||step.dependsOn.some(id=>!completed.includes(id)))fail();if(step.kind==='control'){if(refs!==null)fail();}else checkRefs(step,refsCopy(refs,step));if(poisoned)fail();const token=Object.freeze(Object.create(null));tokens.set(token,{step});active=token;return token;}catch(e){active=null;throw e;}});},completeControl:(t,r)=>finish(t,'control',r),completeProcess:(t,r)=>finish(t,'process',r),readSummary(){return structuredClone({status:poisoned?'incomplete':index===scenario.steps.length?'source-consistent-bindings':'pending',completedSteps:index,plannedSteps:scenario.steps.length,requestBodyCustody:'pending',authenticatedHost:'pending',messageThreadBindings:'deferred',issue48Complete:false,bindings:state,provenance});}});
}
