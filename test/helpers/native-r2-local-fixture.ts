/** Synthetic local Worker/SQLite fixture only; no native subprocess or deployment authority. */
import {createHash} from 'node:crypto';
import type {DeploymentConfig} from '../../src/config/deployment';
import {clientOperations} from '../../src/http/generated/client-operations';
import type {Task,TaskCommandResult,RuntimeIssue,Runtime,Artifact} from '../../src/http/dto';
const reject=():never=>{throw Error('LOCAL_NATIVE_FIXTURE_REJECTED');};
function requireValue(ok:unknown):asserts ok{if(!ok)reject();}
const ACTOR='agent_research',REVIEWER='agent_reviewer',WORKSPACE='ws_example',ORIGIN='https://hub.example.invalid';
export function configureLocalNativeFixture(config:DeploymentConfig):void{
 const credential=config.static_credential_refs[0],policy=config.workspace_policies[0];
 requireValue(credential?.credential_id==='credential_research_1'&&credential.agent_id===ACTOR&&policy?.workspace_id===WORKSPACE);
 credential.scopes=['workspace:read','tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:claim','tasks:execute','tasks:review','runtimes:manage','artifacts:read','artifacts:write'];
 config.static_credential_refs=[credential,{...structuredClone(credential),credential_id:'credential_reviewer_1',agent_id:REVIEWER}];
 config.static_participants=config.static_participants.filter(p=>p.workspace_id!==WORKSPACE||p.agent_id===ACTOR);
 config.static_participants.push({workspace_id:WORKSPACE,agent_id:REVIEWER,display_name:'Synthetic independent reviewer'});
 policy.notification_destinations=[];
 policy.execution_policy={policy_version:1,agent_wip_limit:2,task_retry_limit:0,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:[ACTOR,REVIEWER]}],replay_safety_rules:[]};
}
export interface LocalNativeRoundSummary {round:1|2;freshState:true;journeyDone:true;selfReviewDenied:true;wrongRuntimeProofDenied:true;configurationDisabled:true;selectedStateUnchanged:true;httpRequests:number;sqlStatements:number;responseBytes:number;sqlBytes:number;}
interface LocalWorker {fetch(url:string,init?:RequestInit):Promise<Response>;}
interface LocalStorage {exec(query:string,...bindings:(string|number|null)[]):Promise<Record<string,unknown>[]>;}
export interface LocalNativeFixtureInput {worker:LocalWorker;storage:LocalStorage;tokens:{submitter:string;reviewer:string};disable:()=>Promise<void>;track:<T>(promise:Promise<T>)=>Promise<T>;signal:AbortSignal;round:1|2;}
type Row=Record<string,string|number|null>;
type Columns=Record<string,'text'|'nullable'|'integer'>;
const projections:Record<string,Columns>={
 tasks:{id:'text',workspace_id:'text',state:'text',task_version:'integer',active_run_id:'nullable',latest_run_id:'nullable',current_result_id:'nullable'},
 runs:{id:'text',workspace_id:'text',task_id:'text',agent_id:'text',runtime_instance_id:'text',status:'text',run_version:'integer',fence:'integer'},
 task_results:{id:'text',workspace_id:'text',task_id:'text',run_id:'text',submitted_principal_id:'text',submitted_agent_id:'nullable'},
 task_acceptances:{id:'text',workspace_id:'text',task_id:'text',result_id:'text',run_id:'text',reviewer_principal_id:'text',reviewer_agent_id:'nullable'},
 artifacts:{id:'text',workspace_id:'text',task_id:'nullable',run_id:'nullable',status:'text',artifact_version:'integer',sha256:'text',byte_size:'integer'},
 runtimes:{id:'text',workspace_id:'text',agent_id:'text',runtime_version:'integer',status:'text'}
};
const digest=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
/** All SQL is source literal/allowlisted. Host owns pending operations and harness teardown. */
export async function runLocalNativeFixture(input:LocalNativeFixtureInput):Promise<LocalNativeRoundSummary>{
 let httpRequests=0,sqlStatements=0,responseBytes=0,sqlBytes=0,serial=0,action='setup';let httpStatus:number|undefined,expectedHttpStatus:number|undefined;
 const check=()=>{requireValue(!input.signal.aborted);};
 const operation=async<T>(work:(signal:AbortSignal)=>Promise<T>):Promise<T>=>{
  check();const local=new AbortController(),signal=AbortSignal.any([input.signal,local.signal]);let timer:ReturnType<typeof setTimeout>|undefined,abortListener:()=>void=()=>{};
  try{
   const actual=input.track(Promise.resolve().then(()=>work(signal)));
   const aborted=new Promise<never>((_,fail)=>{abortListener=()=>fail(Error());signal.addEventListener('abort',abortListener,{once:true});if(signal.aborted)abortListener();timer=setTimeout(()=>local.abort(),10000);});
   const value=await Promise.race([actual,aborted]);check();return value;
  }finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abortListener);}
 };
 const query=async(table:string,columns:Columns,where='',bindings:(string|number|null)[]=[],order='id'):Promise<Row[]>=>{
  action='sql:'+table;httpStatus=expectedHttpStatus=undefined;check();requireValue(sqlStatements<128);sqlStatements++;
  // SQL truncates variable-width cells before crossing the Worker bridge; reject truncation.
  const select=Object.entries(columns).map(([key,kind])=>kind==='integer'?key:`substr(${key},1,257) AS ${key}`).join(',');
  const rows=await operation(()=>input.storage.exec(`SELECT ${select} FROM ${table}${where} ORDER BY ${order} LIMIT 129`,...bindings));
  requireValue(Array.isArray(rows)&&rows.length<=128);const expected=Object.keys(columns).sort().join(',');
  for(const row of rows){requireValue(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).sort().join(',')===expected);for(const [key,kind] of Object.entries(columns)){const v=row[key];requireValue(kind==='integer'?Number.isSafeInteger(v)&&Number(v)>=0:kind==='nullable'&&v===null||typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=256);}}
  const bytes=Buffer.byteLength(JSON.stringify(rows));requireValue(bytes<=65536&&sqlBytes+bytes<=2097152);sqlBytes+=bytes;return rows as Row[];
 };
 const snapshot=async()=>{const result:Record<string,Row[]>={};for(const [table,columns] of Object.entries(projections)){const rows=await query(table,columns);for(const row of rows)requireValue(row.workspace_id===WORKSPACE);result[table]=rows;}return result;};
 const readResponse=async(response:Response,signal:AbortSignal)=>{
  requireValue(response.body);const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0,cancelled=false;
  const cancel=()=>{if(!cancelled){cancelled=true;try{void input.track(reader.cancel()).catch(()=>{});}catch{/* tracked host will reject unresolved cleanup; no raw exception disclosure */}}};
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  try{for(;;){requireValue(!signal.aborted);const {value,done}=await reader.read();requireValue(!signal.aborted);if(done)break;requireValue(value.length>0);size+=value.length;requireValue(size<=262144&&responseBytes+size<=2097152);parts.push(value);}responseBytes+=size;const bytes=Buffer.concat(parts);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{cancel();reject();}finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
 };
 type Op=keyof typeof clientOperations;
 const call=async<T>(op:Op,body?:unknown,path:Record<string,string>={},actor:'submitter'|'reviewer'='submitter',proof?:string,denied?:{status:number;code:string},binary=false):Promise<T>=>{
  action='http:'+op;httpStatus=undefined;expectedHttpStatus=undefined;check();requireValue(httpRequests<32);httpRequests++;const meta=clientOperations[op];expectedHttpStatus=denied?.status??meta.status;let route=meta.path.replace('{workspace_id}',WORKSPACE);for(const [key,value]of Object.entries(path))route=route.replace('{'+key+'}',encodeURIComponent(value));requireValue(!route.includes('{'));
  const payload=body===undefined?undefined:binary?body as Uint8Array<ArrayBuffer>:JSON.stringify(body);requireValue(payload===undefined||Buffer.byteLength(payload)<=65536);
  const headers:Record<string,string>={authorization:'Bearer '+input.tokens[actor],accept:'application/json'};if(meta.idempotency)headers['idempotency-key']='local_'+input.round+'_'+(++serial);if(proof)headers['x-runtime-token']=proof;if(payload!==undefined)headers['content-type']=binary?'application/octet-stream':'application/json';
  return operation(async signal=>{const response=await input.worker.fetch(ORIGIN+route,{method:meta.method,headers,...(payload===undefined?{}:{body:payload}),redirect:'manual',signal});if(Number.isInteger(response.status)&&response.status>=100&&response.status<=599)httpStatus=response.status;const value=await readResponse(response,signal);if(denied){requireValue(response.status===denied.status&&value?.error?.code===denied.code);return undefined as T;}requireValue(response.status===meta.status&&meta.validateResponse?.(value));return value.data as T;});
 };
 try{
  requireValue(input.round===1||input.round===2);requireValue(typeof input.tokens.submitter==='string'&&typeof input.tokens.reviewer==='string'&&/^[A-Za-z0-9_-]{43}$/.test(input.tokens.submitter)&&/^[A-Za-z0-9_-]{43}$/.test(input.tokens.reviewer)&&input.tokens.submitter!==input.tokens.reviewer);
  const initial=await snapshot();requireValue(Object.values(initial).every(rows=>rows.length===0));
  const enrolled=await call<RuntimeIssue>('createRuntime',{label:'Local submitter'}),reviewer=await call<RuntimeIssue>('createRuntime',{label:'Local reviewer'},{},'reviewer');
  requireValue(enrolled.runtime.agent_id===ACTOR&&reviewer.runtime.agent_id===REVIEWER&&enrolled.runtime.id!==reviewer.runtime.id&&typeof enrolled.runtime_token==='string'&&typeof reviewer.runtime_token==='string');
  let runtime:Runtime=enrolled.runtime;const proof=enrolled.runtime_token;
  let task=await call<Task>('createTask',{title:'Local fixture work',description:'Synthetic source-only work'});requireValue(task.workspace_id===WORKSPACE&&task.state==='backlog'&&task.task_version===1);
  let result=await call<TaskCommandResult>('readyTask',{expected_version:task.task_version},{task_id:task.id});requireValue(result.task.id===task.id&&result.task.state==='ready'&&result.task.task_version===2);task=result.task;
  result=await call<TaskCommandResult>('claimTask',{expected_version:task.task_version,runtime_instance_id:runtime.id},{task_id:task.id},'submitter',proof);requireValue(result.run&&result.task.id===task.id&&result.task.state==='doing'&&result.run.task_id===task.id&&result.run.runtime_instance_id===runtime.id&&result.run.agent_id===ACTOR&&result.run.fence===1);task=result.task;const run=result.run!;
  const bytes=new TextEncoder().encode('local synthetic artifact');let artifact=await call<Artifact>('stageArtifact',{task_id:task.id,run_id:run.id,filename:'local.txt',media_type:'text/plain',byte_size:bytes.length,sha256:digest(bytes)},{},'submitter',proof);
  requireValue(artifact.task_id===task.id&&artifact.run_id===run.id&&artifact.status==='staged'&&artifact.artifact_version===1);
  const artifactId=artifact.id;artifact=await call<Artifact>('uploadArtifactContent',bytes,{artifact_id:artifactId},'submitter',proof,undefined,true);requireValue(artifact.id===artifactId&&artifact.status==='uploaded'&&artifact.artifact_version===2);
  artifact=await call<Artifact>('commitArtifact',{expected_artifact_version:artifact.artifact_version},{artifact_id:artifactId},'submitter',proof);requireValue(artifact.id===artifactId&&artifact.status==='committed'&&artifact.artifact_version===3&&artifact.sha256===digest(bytes)&&artifact.byte_size===bytes.length);
  result=await call<TaskCommandResult>('submitTaskResult',{expected_version:task.task_version,run_id:run.id,fence:run.fence,result:{summary:'Local completed work',artifact_ids:[artifactId]}},{task_id:task.id},'submitter',proof);task=result.task;requireValue(task.state==='review'&&task.result?.run_id===run.id&&task.result.submitted_by.principal_id===ACTOR&&task.result.submitted_by.agent_id===ACTOR);
  const beforeSelf=await snapshot();await call('acceptTaskResult',{expected_version:task.task_version,reason:'Self review must fail'},{task_id:task.id},'submitter',undefined,{status:403,code:'FORBIDDEN'});requireValue(digest(JSON.stringify(await snapshot()))===digest(JSON.stringify(beforeSelf)));
  result=await call<TaskCommandResult>('acceptTaskResult',{expected_version:task.task_version,reason:'Independent local review'},{task_id:task.id},'reviewer');requireValue(result.task.id===task.id&&result.task.state==='done'&&result.task.latest_run_id===run.id&&result.task.result?.run_id===run.id&&result.task.result.submitted_by.principal_id===ACTOR);
  const accepted=await snapshot(),acceptance=accepted.task_acceptances,submitted=accepted.task_results;requireValue(acceptance.length===1&&submitted.length===1&&accepted.tasks.length===1&&accepted.tasks[0].state==='done');
  requireValue(submitted[0].task_id===task.id&&submitted[0].run_id===run.id&&submitted[0].submitted_principal_id===ACTOR&&submitted[0].submitted_agent_id===ACTOR&&acceptance[0].task_id===task.id&&acceptance[0].result_id===submitted[0].id&&acceptance[0].run_id===run.id&&acceptance[0].reviewer_principal_id===REVIEWER&&acceptance[0].reviewer_agent_id===REVIEWER);
  requireValue(accepted.tasks[0].id===task.id&&accepted.tasks[0].latest_run_id===run.id&&accepted.tasks[0].current_result_id===submitted[0].id);
  requireValue(accepted.runs.length===1&&accepted.runs[0].id===run.id&&accepted.runs[0].task_id===task.id&&accepted.runs[0].agent_id===ACTOR&&accepted.runs[0].runtime_instance_id===runtime.id&&accepted.runs[0].status==='submitted'&&accepted.runs[0].fence===run.fence);
  requireValue(accepted.artifacts.length===1&&accepted.artifacts[0].id===artifactId&&accepted.artifacts[0].task_id===task.id&&accepted.artifacts[0].run_id===run.id&&accepted.artifacts[0].status==='committed'&&accepted.artifacts[0].sha256===digest(bytes)&&accepted.artifacts[0].byte_size===bytes.length);
  runtime=await call<Runtime>('heartbeatRuntime',{expected_runtime_version:runtime.runtime_version},{runtime_instance_id:runtime.id},'submitter',proof);requireValue(runtime.id===enrolled.runtime.id&&runtime.agent_id===ACTOR&&runtime.runtime_version===enrolled.runtime.runtime_version+1);const beforeWrong=await snapshot();
  await call('heartbeatRuntime',{expected_runtime_version:reviewer.runtime.runtime_version},{runtime_instance_id:reviewer.runtime.id},'submitter',proof,{status:401,code:'UNAUTHENTICATED'});requireValue(digest(JSON.stringify(await snapshot()))===digest(JSON.stringify(beforeWrong)));
  const own=await call<Runtime>('heartbeatRuntime',{expected_runtime_version:runtime.runtime_version},{runtime_instance_id:runtime.id},'submitter',proof);requireValue(own.id===runtime.id&&own.runtime_version===runtime.runtime_version+1);
  await call('getWorkspace');
  const credentialColumns:Columns={credential_id:'text',enabled:'integer',credential_version:'integer'},beforeDisable=await query('native_credentials',credentialColumns,' WHERE workspace_id=? AND credential_id=?',[WORKSPACE,'credential_research_1'],'credential_id');requireValue(beforeDisable.length===1&&beforeDisable[0].enabled===1);
  action='control:configuration-disable';httpStatus=expectedHttpStatus=undefined;await operation(()=>input.disable());
  const disabled=await query('native_credentials',credentialColumns,' WHERE workspace_id=? AND credential_id=?',[WORKSPACE,'credential_research_1'],'credential_id');requireValue(disabled.length===1&&disabled[0].enabled===0&&Number(beforeDisable[0].credential_version)<Number.MAX_SAFE_INTEGER&&disabled[0].credential_version===Number(beforeDisable[0].credential_version)+1);
  const epoch=await query('workspace_metadata',{workspace_id:'text',config_epoch:'integer'},' WHERE workspace_id=?',[WORKSPACE],'workspace_id');requireValue(epoch.length===1&&epoch[0].config_epoch===2);
  await call('getWorkspace',undefined,{},'submitter',undefined,{status:401,code:'UNAUTHENTICATED'});check();
  return {round:input.round,freshState:true,journeyDone:true,selfReviewDenied:true,wrongRuntimeProofDenied:true,configurationDisabled:true,selectedStateUnchanged:true,httpRequests,sqlStatements,responseBytes,sqlBytes};
 }catch{const error=Error('LOCAL_NATIVE_FIXTURE_REJECTED');Object.defineProperty(error,'action',{value:action,enumerable:false});if(httpStatus!==undefined)Object.defineProperty(error,'httpStatus',{value:httpStatus,enumerable:false});if(expectedHttpStatus!==undefined)Object.defineProperty(error,'expectedHttpStatus',{value:expectedHttpStatus,enumerable:false});throw error;}
}
