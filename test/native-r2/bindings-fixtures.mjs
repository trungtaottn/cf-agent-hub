/** Synthetic transcript fixtures; no process, protected store or host authority. */
import {createHash} from 'node:crypto';
import {getNativeScenario} from '../../scripts/lib/native-r2-scenario.mjs';
export const steps=getNativeScenario().steps;
export const hash=x=>createHash('sha256').update(x).digest('hex');
const now='2026-10-29T00:00:00.000Z',later='2026-10-29T00:01:00.000Z';
const actor={kind:'agent',principal_id:'agent-a',agent_id:'agent-a'};
export const control=id=>({stepId:id,status:'observed',recordSha256:'a'.repeat(64),configSha256:'b'.repeat(64),scenarioSha256:'c'.repeat(64),authorityRecordSha256:'d'.repeat(64),usage:{commands:0,mutations:0,artifact_bytes:0,output_bytes:0}});
export function references(step,state){const refs={};const known={actor_slot:step.actor,fixture:step.fixture,state_directory:'/private/'+step.actor,origin:'https://isolated.example.test',workspace:step.id.includes('wrong-workspace')||step.id==='probe/server-foreign-workspace'?'workspace-b':'workspace-a',input_file:'/private/input.json',source_file:'/private/source.bin',output_file:'/private/output.bin',idempotency_key:'key-'+step.id.replaceAll('/','-'),main_task_id:state.tasks.main?.id,fail_task_id:state.tasks.fail?.id,cancel_task_id:state.tasks.cancel?.id,requeue_task_id:state.tasks.requeue?.id,main_run_id:state.runs.main?.id,main_runtime_id:state.runtimes.submitter?.id,main_artifact_id:state.artifact?.id,content_id:state.content?.id,reviewer_agent_id:'agent-b',wrong_runtime_id:'runtime-other'};for(const k of step.refKeys)refs[k]=known[k]??'external-'+k;return refs;}
export function output(step,s){const op=step.operation,f=step.fixture;if(step.expectedExit!==0)return {stdout:'',stderr:'Outcome requires reconciliation; retain the original intent. No automatic retry.\n'};
 if(step.id==='prepare/retain-artifact')return {stdout:'',stderr:'Local: '+JSON.stringify({id:'content-main',state:'ready',byteSize:3,sha256:hash('abc'),references:0})+'\n'};
 let d={};const old=s.tasks[f];
 if(op==='createRuntime')d={runtime:{id:'runtime-'+step.id.replaceAll('/','-'),workspace_id:'workspace-a',agent_id:step.actor==='reviewer'?'agent-b':'agent-a',runtime_version:1,label:'conformance',status:'online',last_seen_at:now,presence_expires_at:later,created_at:now},runtime_token:null,revealed:false};
 else if(op==='heartbeatRuntime')d={...s.runtimes[step.actor],runtime_version:s.runtimes[step.actor].runtime_version+1};
 else if(op==='createTask')d={id:'task-'+f,workspace_id:'workspace-a',title:'Conformance',description:'Synthetic fixture',state:'backlog',task_version:1,proposal_version:0,project_id:null,work_role_id:null,assigned_agent_id:null,active_run_id:null,latest_run_id:null,approval_id:null,result:null,retry_count:0,retry_limit:0,flags:[],created_at:now,updated_at:now};
 else if(op==='getTask')d=old;
 else if(op==='patchTask')d={...old,task_version:old.task_version+1,title:'Patched'};
 else if(['readyTask','claimTask','submitTaskResult','acceptTaskResult','failTask','cancelTask','requeueTask'].includes(op)){
  const task={...old,task_version:old.task_version+1},states={readyTask:'ready',claimTask:'doing',submitTaskResult:'review',acceptTaskResult:'done',failTask:'backlog',cancelTask:'cancelled',requeueTask:'ready'};task.state=states[op];let run=null;
  if(op==='claimTask'){run={id:'run-'+f,workspace_id:'workspace-a',task_id:task.id,agent_id:'agent-a',runtime_instance_id:s.runtimes.submitter.id,status:'active',run_version:1,fence:1,lease_expires_at:later,started_at:now,ended_at:null};task.active_run_id=task.latest_run_id=run.id;}
  if(op==='submitTaskResult'||op==='failTask'){run={...s.runs[f],status:op==='submitTaskResult'?'submitted':'failed',run_version:s.runs[f].run_version+1,ended_at:later};task.active_run_id=null;if(op==='submitTaskResult')task.result={summary:'Done',artifact_ids:[s.artifact.id],run_id:run.id,submitted_by:actor,submitted_at:later};else task.flags=['outcome_unknown'];}
  d={task,run,approval:null};
 }
 else if(op==='getRun')d=s.runs.main;
 else if(op==='heartbeatRun')d={...s.runs.main,run_version:s.runs.main.run_version+1};
 else if(op==='stageArtifact')d={id:'artifact-main',workspace_id:'workspace-a',task_id:s.tasks.main.id,run_id:s.runs.main.id,owner:actor,artifact_version:1,filename:'artifact.txt',media_type:'text/plain',byte_size:s.content.byteSize,sha256:s.content.sha256,status:'staged',created_at:now,committed_at:null,expires_at:later};
 else if(op==='uploadArtifactContent')d={...s.artifact,artifact_version:s.artifact.artifact_version+1,status:'uploaded'};
 else if(op==='commitArtifact')d={...s.artifact,artifact_version:s.artifact.artifact_version+1,status:'committed',committed_at:later,expires_at:null};
 else if(op==='getArtifact'||op==='downloadArtifactContent')d=s.artifact;
 else if(op==='listArtifacts')d=[s.artifact];
 else if(op==='listTaskResults')d=[s.submitted];
 return {stdout:JSON.stringify({data:d,request_id:'request-fixture',...(['listArtifacts','listTaskResults'].includes(op)?{page:{next_cursor:null,has_more:false}}:{})})+'\n',stderr:''};
}
export function carrier(step,s,index){const raw=output(step,s),stdout=Buffer.from(raw.stdout),stderr=Buffer.from(raw.stderr),invocationId='inv_'+index;const ref=kind=>({name:invocationId+'.'+kind+'.json',sha256:hash(kind+index),byteSize:20});return {invocationId,exitCode:step.expectedExit,stdout,stderr,maxOutputBytes:1048576,custody:{prepared:ref('prepared'),spawned:ref('spawned'),final:ref('final'),transcripts:Object.fromEntries(Object.entries({stdout,stderr}).map(([name,b])=>[name,{name:invocationId+'.'+name,sha256:hash(b),byteSize:b.length,complete:true}]))}};}
export function replaceData(c,change){const envelope=JSON.parse(c.stdout);change(envelope);c.stdout=Buffer.from(JSON.stringify(envelope)+'\n');c.custody.transcripts.stdout.sha256=hash(c.stdout);c.custody.transcripts.stdout.byteSize=c.stdout.length;return c;}
export function advance(r,until=null,mutate=null){for(let i=r.readSummary().completedSteps;i<steps.length;i++){const step=steps[i],state=r.readSummary().bindings;if(step.id===until)return {step,state,index:i};const token=r.prepare(step.id,step.kind==='control'?null:references(step,state));if(step.kind==='control')r.completeControl(token,control(step.id));else{const c=carrier(step,state,i);mutate?.(step,c);r.completeProcess(token,c);}}return r.readSummary();}
