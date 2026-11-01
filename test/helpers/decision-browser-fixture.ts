/** Node-only isolated fixture. No production imports this module. */
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import type {DeploymentConfig} from '../../src/config/deployment';
import type {Task,TaskCommandResult,RuntimeIssue,Artifact,TaskRequestDecisionRequest} from '../../src/http/dto';
import {parseExactJson} from '../../src/approvals/exact-json';
import {descriptor,schemaSha256} from './decision-browser-composition';
export const decisionEffectTables=Object.freeze(['decision_checkpoints','decision_proposals','approvals','decision_artifact_edges','decision_lifecycle_heads','decision_lifecycle_transitions','decision_notice_intents','tasks','runs','task_history','events','outbox','idempotency_outcomes']);
const actions=Object.freeze(['reset','drop-next-decision','hold-next-content','release-content','revoke-decide','revoke-artifacts','restore-grants','read-state']);
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export async function boundedFixtureBytes(body:ReadableStream<Uint8Array>|null,limit:number):Promise<Uint8Array>{
 if(!body)throw Error('FIXTURE_BODY_REQUIRED');
 const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0,timedOut=false,timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});reject(Error('FIXTURE_BODY_TIMEOUT'));},5000);});
 try{for(;;){const part=await Promise.race([reader.read(),deadline]);if(timedOut)throw Error('FIXTURE_BODY_TIMEOUT');if(part.done)break;size+=part.value.byteLength;if(size>limit)throw Error('FIXTURE_BODY_LIMIT');chunks.push(part.value);}const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}return bytes;}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function parseDecisionFixtureControl(request:Request):Promise<string>{
 if(request.method!=='POST'||request.headers.get('origin')!=='https://hub.fixture.example.invalid')throw Error('FIXTURE_CONTROL_FORBIDDEN');
 const value=parseExactJson(await boundedFixtureBytes(request.body,1024),{maxBytes:1024,maxDepth:2,maxNodes:4});
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join(',')!=='action'||!actions.includes((value as {action:string}).action))throw Error('FIXTURE_CONTROL_INVALID');
 return (value as {action:string}).action;
}
export function configureDecisionBrowserFixture(config:DeploymentConfig):void{
 const owner=config.human_grants[0]!;
 owner.scopes=[...new Set([...owner.scopes,'tasks:read','tasks:create','tasks:schedule','artifacts:read','approvals:read','approvals:decide'] as typeof owner.scopes)];
 config.human_grants.push({...structuredClone(owner),principal_id:'human_readonly',subject:'readonly-subject',scopes:['workspace:read','tasks:read','artifacts:read','approvals:read']},{...structuredClone(owner),principal_id:'human_unassigned',subject:'unassigned-subject'});
 config.static_credential_refs[0]!.scopes=['workspace:read','tasks:read','tasks:claim','tasks:execute','runtimes:manage','artifacts:read','artifacts:write'];
 const policy=config.workspace_policies[0]!;policy.notification_destinations=[];
 policy.execution_policy={policy_version:1,agent_wip_limit:10,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
 policy.decision_policy={policy_version:3,expiry_seconds:600,expiry_batch_limit:2,actions:[{action_id:descriptor.actionId,schema_version:descriptor.schemaVersion,schema_sha256:schemaSha256,reviewer_ids:['human_operator'],resource_kinds:['task']}]};
}
export interface FixtureStorage{exec(query:string,...bindings:(string|number|null)[]):Promise<Record<string,unknown>[]>;}
export interface FixtureWorker{fetch(url:string,init?:RequestInit):Promise<Response>;}
export async function decisionEffectSnapshot(storage:FixtureStorage){
 const result:Record<string,string[]>={};for(const table of decisionEffectTables)result[table]=(await storage.exec('SELECT * FROM '+table)).map(row=>JSON.stringify(row)).sort();return result;
}
export async function seedDecisionBrowserFixture(options:{worker:FixtureWorker;storage:FixtureStorage;origin:string;issuer:string;csrfSecret:string;nativeToken:string;normal?:boolean}){
 const {worker,storage,origin,issuer,csrfSecret,nativeToken}=options,base=origin+'/v2/workspaces/ws_example';
 const now=Date.now(),id='decision_seed_'+randomBytes(8).toString('hex'),token=randomBytes(32).toString('base64url'),expires=now+3600000;
 const csrf=createHmac('sha256',csrfSecret).update(JSON.stringify(['cfhub-csrf-v1','ws_example',id,expires])).digest('base64url');
 // Setup-only synthetic session. Browser mutations MUST use actual OIDC login.
 await storage.exec('INSERT INTO sessions(id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,auth_epoch) VALUES(?,?,?,?,?,?,?,?,?,1)',id,'ws_example','human_operator',digest(token),digest(csrf),issuer,'synthetic-subject',now,expires);
 let serial=0,proof='';
 async function request(path:string,method='GET',body?:unknown,native=false,binary=false){
  const headers:Record<string,string>={accept:'application/json',origin};
  if(native){headers.authorization='Bearer '+nativeToken;if(proof&&method!=='GET')headers['x-runtime-token']=proof;}else{headers.cookie='cfhub_session='+token;if(method!=='GET')headers['x-csrf-token']=csrf;}
  if(method!=='GET'){headers['idempotency-key']=id+'_'+(++serial);headers['content-type']=binary?'application/octet-stream':'application/json';}
  return worker.fetch(base+path,{method,headers,signal:AbortSignal.timeout(10000),...(body===undefined?{}:{body:binary?body as BodyInit:JSON.stringify(body)})});
 }
 async function call<T>(path:string,method='GET',body?:unknown,native=false,binary=false):Promise<T>{
  const response=await request(path,method,body,native,binary);const value=JSON.parse(new TextDecoder().decode(await boundedFixtureBytes(response.body,1048576))) as {data:T;error?:{code:string}};
  if(!response.ok)throw Error('DECISION_SEED_HTTP_'+method+'_'+response.status+'_'+(value.error?.code??'INVALID'));return value.data;
 }
 const workspace=await call<{effective_scopes:string[]}>('');for(const scope of ['approvals:read','approvals:decide','tasks:read','artifacts:read'])assert.ok(workspace.effective_scopes.includes(scope));
 const runtime=await call<RuntimeIssue>('/runtimes','POST',{label:'Private synthetic decision runtime'},true);assert.equal(runtime.revealed,true);assert.ok(runtime.runtime_token);proof=runtime.runtime_token;
 const cases:Record<string,{taskId:string;approvalId:string;artifactId:string;sha256:string}>={};
 for(const name of options.normal?['unavailable']:['approve','reject','unknown','denied']){
  let task=await call<Task>('/tasks','POST',{title:'Private synthetic decision '+name,description:'Test composition only. No product action enabled.'});
  task=(await call<TaskCommandResult>('/tasks/'+task.id+':ready','POST',{expected_version:task.task_version})).task;
  const claimed=await call<TaskCommandResult>('/tasks/'+task.id+':claim','POST',{expected_version:task.task_version,runtime_instance_id:runtime.runtime.id},true);task=claimed.task;assert.ok(claimed.run);
  const bytes=new TextEncoder().encode(JSON.stringify({task_id:task.id,task_version:task.task_version})),hash=digest(bytes);
  let artifact=await call<Artifact>('/artifacts','POST',{task_id:task.id,run_id:claimed.run.id,filename:'private-decision.json',media_type:'application/json',byte_size:bytes.length,sha256:hash},true);
  artifact=await call<Artifact>('/artifacts/'+artifact.id+'/content','PUT',bytes,true,true);
  artifact=await call<Artifact>('/artifacts/'+artifact.id+':commit','POST',{expected_artifact_version:artifact.artifact_version},true);
  assert.equal(artifact.status,'committed');assert.equal(artifact.sha256,hash);
  const content=await request('/artifacts/'+artifact.id+'/content');assert.equal(content.status,200);assert.deepEqual(await boundedFixtureBytes(content.body,1024),bytes);
  const body:TaskRequestDecisionRequest={expected_version:task.task_version,run_id:claimed.run.id,fence:claimed.run.fence,checkpoint:{summary:'Immutable private checkpoint '+name,artifact_ids:[artifact.id]},proposal:{summary:'Private synthetic proposal '+name,action:descriptor.actionId,scope:{project_id:null,resource_ids:[task.id]},artifact_ids:[],inputs:{artifact_id:artifact.id,sha256:hash}}};
  if(options.normal){const before=await decisionEffectSnapshot(storage),response=await request('/tasks/'+task.id+':request-decision','POST',body,true);assert.equal(response.status,503);const value=await response.json() as {error:{code:string}};assert.equal(value.error.code,'DEPENDENCY_UNAVAILABLE');assert.deepEqual(await decisionEffectSnapshot(storage),before);continue;}
  const result=await call<TaskCommandResult>('/tasks/'+task.id+':request-decision','POST',body,true);assert.equal(result.task.state,'waiting');assert.equal(result.task.task_version,task.task_version+1);assert.ok(result.task.approval_id);assert.equal(result.run?.status,'paused');assert.equal(result.task.active_run_id,null);
  const approval=await storage.exec('SELECT status,task_id FROM approvals WHERE id=?',result.task.approval_id);assert.deepEqual(approval.map(row=>[row.status,row.task_id]),[['pending',task.id]]);
  for(const table of ['decision_lifecycle_heads','decision_lifecycle_transitions','decision_notice_intents'])assert.equal((await storage.exec('SELECT * FROM '+table+' WHERE approval_id=?',result.task.approval_id)).length,1);
  const anchors=await storage.exec('SELECT checkpoint_id,proposal_id FROM approvals WHERE id=?',result.task.approval_id);assert.equal(anchors.length,1);
  assert.equal((await storage.exec('SELECT id FROM decision_checkpoints WHERE id=?',String(anchors[0]!.checkpoint_id))).length,1);assert.equal((await storage.exec('SELECT id FROM decision_proposals WHERE id=?',String(anchors[0]!.proposal_id))).length,1);
  const edges=await storage.exec('SELECT artifact_id,sha256 FROM decision_artifact_edges WHERE approval_id=?',result.task.approval_id);assert.equal(edges.length,2);assert.ok(edges.every(edge=>edge.artifact_id===artifact.id&&edge.sha256===hash));
  assert.equal((await storage.exec("SELECT id FROM task_history WHERE task_id=? AND kind='task.decision_requested'",task.id)).length,1);assert.equal((await storage.exec("SELECT id FROM events WHERE resource_id=? AND type='task.decision_requested'",task.id)).length,1);
  cases[name]={taskId:task.id,approvalId:result.task.approval_id,artifactId:artifact.id,sha256:hash};
 }
 // Setup credentials never reach controls or Playwright state.
 await storage.exec('DELETE FROM sessions WHERE id=?',id);proof='';
 return {cases};
}
export class DecisionBrowserProbe {
 receipts: {approvalId:string;action:string;bodySha256:string;keySha256:string;status:number;dropped:boolean}[]=[];
 #epoch=0;get generation(){return this.#epoch;}
 #drop=false;#hold=false;#release:(()=>void)|null=null;
 armDrop(){this.#drop=true;}
 armContent(){if(this.#hold||this.#release)throw Error('FIXTURE_CONTENT_ALREADY_HELD');this.#hold=true;}
 releaseContent(){this.#hold=false;this.#release?.();this.#release=null;}
 reset(){this.#epoch++;this.#drop=false;this.releaseContent();this.receipts=[];}
 async observe(request:Request,response:Response,verify:(approvalId:string,action:string)=>Promise<void>,generation=this.#epoch){
  if(generation!==this.#epoch)return response;
  const path=new URL(request.url).pathname,match=/^\/v2\/workspaces\/ws_example\/approvals\/([A-Za-z0-9_-]{1,128}):(approve|reject)$/.exec(path);
  if(match&&request.method==='POST'){
   if(this.receipts.length>=32)throw Error('FIXTURE_RECEIPT_LIMIT');
   const body=request.body?await boundedFixtureBytes(request.body,65536):new Uint8Array();if(generation!==this.#epoch){body.fill(0);return response;}const dropped=this.#drop&&response.ok;
   this.receipts.push({approvalId:match[1]!,action:match[2]!,bodySha256:digest(body),keySha256:digest(request.headers.get('idempotency-key')??''),status:response.status,dropped});body.fill(0);
   if(dropped){this.#drop=false;await boundedFixtureBytes(response.body,1048576);await verify(match[1]!,match[2]!);throw Error('FIXTURE_DROP_COMMITTED_RESPONSE');}
  }
  if(this.#hold&&request.method==='GET'&&/^\/v2\/workspaces\/ws_example\/artifacts\/[A-Za-z0-9_-]{1,128}\/content$/.test(path)){
   this.#hold=false;let timer:ReturnType<typeof setTimeout>|undefined,release:(()=>void)|undefined;
   try{await new Promise<void>((resolve,reject)=>{release=resolve;this.#release=resolve;timer=setTimeout(()=>{if(this.#release===release)this.#release=null;reject(Error('FIXTURE_CONTENT_HOLD_TIMEOUT'));},5000);});}catch(error){void response.body?.cancel().catch(()=>{});throw error;}finally{clearTimeout(timer);if(this.#release===release)this.#release=null;}
  }
  return response;
 }
}
