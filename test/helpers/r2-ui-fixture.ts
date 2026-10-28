/** Node-only isolated browser-fixture setup. Never imported by production code. */
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import type {DeploymentConfig} from '../../src/config/deployment';
import type {Task,TaskCommandResult,RuntimeIssue,Artifact,TaskResult} from '../../src/http/dto';

export const r2FixtureTitles={review:'Review evidence <img src=x onerror="window.fixtureInjected=1">',history:'Requeued retained result',doing:'Active execution observation',done:'Independently accepted result',cancelled:'Cancelled retained task'};
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function configureR2UiFixture(config:DeploymentConfig):void{
 const owner=config.human_grants[0]!;
 owner.scopes=[...new Set([...owner.scopes,'tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:cancel','tasks:review','artifacts:read','artifacts:write'] as DeploymentConfig['human_grants'][number]['scopes'])];
 config.human_grants.push({...structuredClone(owner),principal_id:'human_tasks_only',subject:'tasks-only-subject',scopes:['workspace:read','tasks:read']});
 config.static_credential_refs[0]!.scopes=['workspace:read','tasks:read','tasks:claim','tasks:execute','runtimes:manage','artifacts:read','artifacts:write'];
 const policy=config.workspace_policies[0]!;
 policy.notification_destinations=[];
 policy.execution_policy={policy_version:1,agent_wip_limit:10,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
}
interface FixtureStorage {exec(query:string,...bindings:(string|number|null)[]):Promise<Record<string,unknown>[]>;}
interface FixtureWorker {fetch(url:string,init?:RequestInit):Promise<Response>;}
export async function seedR2UiFixture(options:{worker:FixtureWorker;storage:FixtureStorage;origin:string;issuer:string;csrfSecret:string;nativeToken:string}){
 const {worker,storage,origin,issuer,csrfSecret,nativeToken}=options,base=origin+'/v2/workspaces/ws_example';
 const now=Date.now(),sessionId='session_r2_fixture_seed',sessionToken=randomBytes(32).toString('base64url'),expires=now+3600000;
 const csrf=createHmac('sha256',csrfSecret).update(JSON.stringify(['cfhub-csrf-v1','ws_example',sessionId,expires])).digest('base64url');
 // Only this new isolated fixture's synthetic session is issued directly. Grants
 // came through verified configuration; all task/run/result/artifact state below
 // is produced by the actual public HTTP/domain command path, not DTO-shaped SQL.
 await storage.exec('INSERT INTO sessions(id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,auth_epoch) VALUES(?,?,?,?,?,?,?,?,?,1)',sessionId,'ws_example','human_operator',digest(sessionToken),digest(csrf),issuer,'synthetic-subject',now,expires);
 let serial=0,proof:string|undefined;
 async function call<T>(path:string,method='GET',body?:unknown,lane:'human'|'agent'='human',binary=false):Promise<{data:T;page?:{next_cursor:string|null;has_more:boolean}}>{
  const headers:Record<string,string>={accept:'application/json',origin};
  if(lane==='human'){headers.cookie='cfhub_session='+sessionToken;if(method!=='GET')headers['x-csrf-token']=csrf;}
  else{headers.authorization='Bearer '+nativeToken;if(proof&&method!=='GET')headers['x-runtime-token']=proof;}
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
 await assertPersisted();
 return {facts,assertPersisted,advanceBacklog:async()=>ready(backlog[0]!),revokeHumans:async()=>{await storage.exec("UPDATE sessions SET revoked_at=? WHERE workspace_id='ws_example' AND revoked_at IS NULL",Date.now());}};
}
