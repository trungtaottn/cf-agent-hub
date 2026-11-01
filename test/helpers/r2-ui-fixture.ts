/** Node-only isolated browser-fixture setup. Never imported by production code. */
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import type {DeploymentConfig} from '../../src/config/deployment';
import type {Task,TaskCommandResult,RuntimeIssue,Artifact,TaskResult,Run,ObservationCurrentBinding,ObservationView} from '../../src/http/dto';

export const r2FixtureTitles={review:'Review evidence <img src=x onerror="window.fixtureInjected=1">',history:'Requeued retained result',doing:'Active execution observation',done:'Independently accepted result',cancelled:'Cancelled retained task'};
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function configureR2UiFixture(config:DeploymentConfig,observations=false):void{
 const owner=config.human_grants[0]!;
 owner.scopes=[...new Set([...owner.scopes,'tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:cancel','tasks:review','agents:read','artifacts:read','artifacts:write'] as DeploymentConfig['human_grants'][number]['scopes'])];
 config.human_grants.push({...structuredClone(owner),principal_id:'human_tasks_only',subject:'tasks-only-subject',scopes:['workspace:read','tasks:read']});
 config.static_credential_refs[0]!.scopes=['workspace:read','tasks:read','tasks:claim','tasks:execute','runtimes:manage','messages:read','artifacts:read','artifacts:write'];
 const policy=config.workspace_policies[0]!;
 policy.notification_destinations=[];
 policy.execution_policy={policy_version:1,agent_wip_limit:10,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
 if(observations){
  config.static_credential_refs[0]!.scopes.push('events:read');
  config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_factory_second',display_name:'Second synthetic observation participant'});
  config.static_credential_refs.push({...structuredClone(config.static_credential_refs[0]!),credential_id:'credential_factory_second',agent_id:'agent_factory_second'});
  policy.execution_policy.eligibility_rules[0]!.eligible_agent_ids.push('agent_factory_second');
  policy.observation_pilot={enabled:true,repository_id:'repository_fixture',adapter_id:'synthetic-adapter',adapter_version:'1',supported_events:['read-observed','write-observed'],slots:[{agent_id:'agent_research',checkout_slot_id:'checkout_first'},{agent_id:'agent_factory_second',checkout_slot_id:'checkout_second'}]};
 }

}
interface FixtureStorage {exec(query:string,...bindings:(string|number|null)[]):Promise<Record<string,unknown>[]>;}
interface FixtureWorker {fetch(url:string,init?:RequestInit):Promise<Response>;}
/** Normalize only our trusted Miniflare fixture response, without buffering or exporting session state. */
export function normalizeFixturePreviewResponse(response:Response):Response {
 return new globalThis.Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
export async function seedR2UiFixture(options:{worker:FixtureWorker;storage:FixtureStorage;origin:string;issuer:string;csrfSecret:string;nativeToken:string;secondNativeToken?:string}){
 const {worker,storage,origin,issuer,csrfSecret,nativeToken}=options,base=origin+'/v2/workspaces/ws_example';
 const now=Date.now(),sessionId='session_r2_fixture_seed',sessionToken=randomBytes(32).toString('base64url'),expires=now+3600000;
 const csrf=createHmac('sha256',csrfSecret).update(JSON.stringify(['cfhub-csrf-v1','ws_example',sessionId,expires])).digest('base64url');
 // Only this new isolated fixture's synthetic session is issued directly. Grants
 // came through verified configuration; all task/run/result/artifact state below
 // is produced by the actual public HTTP/domain command path, not DTO-shaped SQL.
 await storage.exec('INSERT INTO sessions(id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,auth_epoch) VALUES(?,?,?,?,?,?,?,?,?,1)',sessionId,'ws_example','human_operator',digest(sessionToken),digest(csrf),issuer,'synthetic-subject',now,expires);
 let serial=0,proof:string|undefined,secondProof:string|undefined;
 async function call<T>(path:string,method='GET',body?:unknown,lane:'human'|'agent'|'second'='human',binary=false):Promise<{data:T;page?:{next_cursor:string|null;has_more:boolean}}>{
  const headers:Record<string,string>={accept:'application/json',origin};
  if(lane==='human'){headers.cookie='cfhub_session='+sessionToken;if(method!=='GET')headers['x-csrf-token']=csrf;}
  else{headers.authorization='Bearer '+(lane==='second'?options.secondNativeToken:nativeToken);const selectedProof=lane==='second'?secondProof:proof;if(selectedProof&&method!=='GET')headers['x-runtime-token']=selectedProof;}
  if(method!=='GET'){headers['idempotency-key']='fixture_r2_'+(++serial);headers['content-type']=binary?'application/octet-stream':'application/json';}
  const response=await worker.fetch(base+path,{method,headers,...(body===undefined?{}:{body:binary?body as BodyInit:JSON.stringify(body)})});
  const value=await response.json() as {data:T;page?:{next_cursor:string|null;has_more:boolean};error?:{code:string}};
  if(!response.ok)throw Error('R2_FIXTURE_HTTP_'+method+'_'+path.split('?')[0]+'_'+response.status+'_'+(value.error?.code??'INVALID_RESPONSE'));
  return value;
 }
 const create=async(title:string)=>(await call<Task>('/tasks','POST',{title,description:'Persisted synthetic R2 browser fixture. No production authority.'})).data;
 const ready=async(task:Task)=>(await call<TaskCommandResult>('/tasks/'+task.id+':ready','POST',{expected_version:task.task_version})).data.task;
 const claim=async(task:Task)=>(await call<TaskCommandResult>('/tasks/'+task.id+':claim','POST',{expected_version:task.task_version,runtime_instance_id:runtime.id},'agent')).data;
 const submitted=async(task:Task,run:NonNullable<TaskCommandResult['run']>,summary:string,artifactIds:string[]=[]) => (await call<TaskCommandResult>('/tasks/'+task.id+':submit-result','POST',{expected_version:task.task_version,run_id:run.id,fence:run.fence,result:{summary,artifact_ids:artifactIds}},'agent')).data.task;
 const reason=async(task:Task,action:'requeue'|'cancel'|'accept-result')=>(await call<TaskCommandResult>('/tasks/'+task.id+':'+action,'POST',{expected_version:task.task_version,reason:'Synthetic browser fixture '+action})).data.task;
 const enrollment=(await call<RuntimeIssue>('/runtimes','POST',{label:'Synthetic browser fixture runtime'},'agent')).data;
 assert.equal(enrollment.revealed,true);assert.equal(typeof enrollment.runtime_token,'string');proof=enrollment.runtime_token!;const runtime=enrollment.runtime;
 const backlog:Task[]=[];for(let i=1;i<=23;i++)backlog.push(await create('Backlog item '+String(i).padStart(2,'0')));
 let history=await ready(await create(r2FixtureTitles.history));const historyClaim=await claim(history);
 history=await submitted(historyClaim.task,historyClaim.run!,'Prior submitted result retained after requeue');history=await reason(history,'requeue');
 assert.equal(history.result,null);assert.equal(history.latest_run_id,historyClaim.run!.id);
 let review=await ready(await create(r2FixtureTitles.review));const priorClaim=await claim(review);
 review=await submitted(priorClaim.task,priorClaim.run!,'Older retained review result');review=await reason(review,'requeue');
 const currentClaim=await claim(review),bytes=new TextEncoder().encode('Synthetic committed evidence.\n');
 let artifact=(await call<Artifact>('/artifacts','POST',{task_id:currentClaim.task.id,run_id:currentClaim.run!.id,filename:'<svg onload="window.fixtureInjected=2">.txt',media_type:'text/plain',byte_size:bytes.byteLength,sha256:digest(bytes)},'agent')).data;
 artifact=(await call<Artifact>('/artifacts/'+artifact.id+'/content','PUT',bytes,'agent',true)).data;
 artifact=(await call<Artifact>('/artifacts/'+artifact.id+':commit','POST',{expected_artifact_version:artifact.artifact_version},'agent')).data;
 assert.equal(artifact.status,'committed');review=await submitted(currentClaim.task,currentClaim.run!,'Current submitted result',[artifact.id]);
 let done=await ready(await create(r2FixtureTitles.done));const doneClaim=await claim(done);done=await submitted(doneClaim.task,doneClaim.run!,'Independent review evidence');done=await reason(done,'accept-result');
 const cancelled=await reason(await create(r2FixtureTitles.cancelled),'cancel');
 const doing=(await claim(await ready(await create(r2FixtureTitles.doing)))).task;
 // Waiting intentionally has no fabricated row: R3 has no implemented producer.
 const facts={backlogFirst:backlog[0]!,history,review,done,cancelled,doing,artifact};
 async function assertPersisted():Promise<void>{
  const list=await call<Task[]>('/tasks?state=backlog&limit=20');assert.equal(list.data.length,20);assert.equal(list.page?.has_more,true);
  const second=await call<Task[]>('/tasks?state=backlog&limit=20&cursor='+encodeURIComponent(list.page!.next_cursor!));assert.equal(second.data.length,3);assert.equal(second.page?.has_more,false);
  const historical=await call<TaskResult[]>('/tasks/'+history.id+'/results?limit=20');assert.equal(historical.data.length,1);assert.equal(historical.data[0]!.run_id,history.latest_run_id);
  const retained=await call<Task>('/tasks/'+history.id);assert.equal(retained.data.result,null);
  const current=await call<Task>('/tasks/'+review.id);assert.equal(current.data.result?.artifact_ids[0],artifact.id);
  const metadata=await call<Artifact>('/artifacts/'+artifact.id);assert.equal(metadata.data.filename,artifact.filename);assert.equal(metadata.data.status,'committed');
  assert.equal((await call<Task[]>('/tasks?state=waiting&limit=20')).data.length,0);
  assert.equal((await call<Task>('/tasks/'+cancelled.id)).data.state,'cancelled');
 }
 let observationControls:Record<string,()=>Promise<unknown>>={};
 let assertObservations:()=>Promise<void>=async()=>{throw Error('OBSERVATION_FIXTURE_NOT_CONFIGURED');},assertReplacement=assertObservations;
 if(options.secondNativeToken){
  const secondEnrollment=(await call<RuntimeIssue>('/runtimes','POST',{label:'Second synthetic observation runtime'},'second')).data;
  assert.equal(secondEnrollment.revealed,true);secondProof=secondEnrollment.runtime_token!;
  let second=await ready(await create('Second reported task'));
  const secondClaim=(await call<TaskCommandResult>('/tasks/'+second.id+':claim','POST',{expected_version:second.task_version,runtime_instance_id:secondEnrollment.runtime.id},'second')).data;second=secondClaim.task;
  const firstRun=(await call<Run>('/runs/'+doing.active_run_id)).data,secondRun=secondClaim.run!;
  const establish=async(target:Task,run:Run,lane:'agent'|'second')=>(await call<ObservationCurrentBinding>('/tasks/'+target.id+'/observations:establish','POST',{run_id:run.id,fence:run.fence,adapter_id:'synthetic-adapter',adapter_version:'1'},lane)).data;
  let firstBinding=await establish(doing,firstRun,'agent'),firstSequence=0;
  const secondBinding=await establish(second,secondRun,'second');
  const append=async(target:Task,run:Run,binding:ObservationCurrentBinding,start:number,count:number,lane:'agent'|'second',replacement=false)=>{
   const records=Array.from({length:count},(_,index)=>({observed_at:new Date().toISOString(),relative_path:replacement?'src/replacement.ts':(start+index)%16===1?'src/shared.ts':'src/reported-'+(start+index)+'.ts',activity:lane==='second'?'read-observed':'write-observed',source_oid:null,label:'Synthetic reported activity — not test execution'}));
   await call('/tasks/'+target.id+'/observation-sessions/'+binding.session_id+'/records','POST',{run_id:run.id,fence:run.fence,first_sequence:start,records},lane);
  };
  await append(doing,firstRun,firstBinding,1,32,'agent');await append(doing,firstRun,firstBinding,33,32,'agent');firstSequence=64;await append(second,secondRun,secondBinding,1,1,'second');
  const read=async(target:Task,query='')=>call<ObservationView>('/tasks/'+target.id+'/observations?limit=50'+query);
  assertObservations=async()=>{
   const first=await read(doing),other=await read(second);assert.equal(first.data.binding?.agent_id,'agent_research');assert.equal(other.data.binding?.agent_id,'agent_factory_second');assert.equal(first.data.binding?.checkout_slot_id,'checkout_first');assert.equal(other.data.binding?.checkout_slot_id,'checkout_second');assert.equal(first.data.records.length,50);assert.equal(first.page?.has_more,true);assert.equal(first.data.coverage?.completeness,'unknown');
   const next=await read(doing,'&cursor='+encodeURIComponent(first.page!.next_cursor!)+'&expected_session_id='+encodeURIComponent(first.data.binding!.session_id));assert.equal(next.data.records.length,14);assert.equal(next.data.records[0]!.sequence,51);assert.equal(next.page?.has_more,false);
  };
  observationControls={
   'factory-observations-replace':async()=>{
    const response=(await call<{new_session_id:string;new_epoch:number}>('/tasks/'+doing.id+'/observation-sessions:replace','POST',{run_id:firstRun.id,fence:firstRun.fence,expected_session_id:firstBinding.session_id,expected_high_water:firstSequence,replacement_request_id:'00000000-0000-4000-8000-000000000001',reason:'coverage_loss'},'agent')).data;
    firstBinding={...firstBinding,session_id:response.new_session_id,session_epoch:response.new_epoch};firstSequence=1;await append(doing,firstRun,firstBinding,1,1,'agent',true);
   },
   'factory-observations-clear':async()=>{await storage.exec('DELETE FROM observation_records WHERE session_id IN (SELECT session_id FROM observation_slots WHERE task_id=?)',doing.id);await storage.exec('DELETE FROM observation_slots WHERE task_id=?',doing.id);const absent=await read(doing,'&expected_session_id='+encodeURIComponent(firstBinding.session_id));assert.equal(absent.data.status,'no_retained_data');},
   'factory-observations-successor':async()=>{const prior=firstBinding.session_id;firstBinding=await establish(doing,firstRun,'agent');assert.notEqual(firstBinding.session_id,prior);firstSequence=1;await append(doing,firstRun,firstBinding,1,1,'agent',true);},
   'factory-observations-truncate':async()=>{while(firstSequence<300){const count=Math.min(32,300-firstSequence);await append(doing,firstRun,firstBinding,firstSequence+1,count,'agent');firstSequence+=count;}const retained=await read(doing);assert.equal(retained.data.truncated,true);assert.equal(retained.data.retained_range!.last_sequence-retained.data.retained_range!.first_sequence+1,256);},
   // Isolated visibility-change fixture, not a production authority mutation route.
   'factory-observations-hide-captured':async()=>{await storage.exec("UPDATE tasks SET project_id='project_visible' WHERE id=?",doing.id);await storage.exec("UPDATE human_grants SET project_ids_json='[\"project_visible\"]' WHERE principal_id='human_operator'");assert.equal((await call<Task>('/tasks/'+doing.id)).data.project_id,'project_visible');assert.equal((await read(doing,'&expected_session_id='+encodeURIComponent(firstBinding.session_id))).data.status,'no_retained_data');},
   'factory-observations-deny-task':async()=>{await storage.exec("UPDATE human_grants SET project_ids_json='[]' WHERE principal_id='human_operator'");},
   'factory-observations-end-run':async()=>{await submitted(doing,firstRun,'Reported work submitted; observations are not execution witnesses');const retained=await read(doing);assert.equal(retained.data.status,'retained');assert.equal((await call<Task>('/tasks/'+doing.id)).data.active_run_id,null);},
   'factory-observations-snapshot':async()=>({firstTaskId:doing.id,secondTaskId:second.id})
  };
  assertReplacement=async()=>{const current=await read(doing);assert.equal(current.data.binding?.session_id,firstBinding.session_id);assert.equal(current.data.records[0]?.reported.relative_path,'src/replacement.ts');assert.equal(current.data.coverage?.reported_loss,true);assert.equal(current.data.truncated,false,'Replacement reports coverage loss separately from current-session retention truncation');};
  await assertObservations();
 }
 await assertPersisted();
 return {observationControl:async(action:string)=>{const run=observationControls[action];if(!run)throw Error('UNKNOWN_OBSERVATION_FIXTURE_CONTROL');return run();},assertObservations,assertReplacement,
facts,assertPersisted,seedRetainedWaiting:async()=>{
  // Read-only retained-state fixture, NOT an implemented approval transition.
  await storage.exec("UPDATE tasks SET state='waiting',title='Seeded retained Waiting — approval unavailable',task_version=task_version+1 WHERE id=?",backlog.at(-1)!.id);
 },readForPreview:async(path:string,options:{signal:AbortSignal})=>{
  if(!path.startsWith('/')||path.startsWith('//')||path.includes('\\')||path.length>4096||new URL(path,origin).origin!==origin)throw Error('PREVIEW_PATH_REJECTED');
  return normalizeFixturePreviewResponse(await worker.fetch(origin+path,{method:'GET',redirect:'manual',headers:{cookie:'cfhub_session='+sessionToken},signal:options.signal}));
 },advanceBacklog:async()=>ready(backlog[0]!),revokeHumans:async()=>{await storage.exec("UPDATE sessions SET revoked_at=? WHERE workspace_id='ws_example' AND revoked_at IS NULL",Date.now());}};
}
