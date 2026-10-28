import {it,expect} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {isolationOperations,recordIsolationEvidence,type IsolationLane} from './r2-isolation-matrix';
import {isolationHttpFixture,prepareIsolationOperation,createIsolationTask,putIsolationProfile,narrowAuthority,foreignText,visibleText,type IsolationHttpFixture,type Input} from './r2-isolation-http';
import {clientOperations,type EnabledOperationId} from '../../src/http/generated/client-operations';
import {validateError} from '../../src/http/generated/auth-validators.js';
import {isolationTokens} from './r2-isolation';
import {sha256} from '../../src/config/bootstrap';
import {env} from 'cloudflare:workers';
import entry from '../../src/index';
import spec from '../../spec/openapi.json';
import {login,request as authRequest} from './auth';
import {oidcCallbackRequest} from './r1-acceptance';
export async function assertDenied(response:Response,status:number|readonly number[],secrets:readonly string[]=[]){
 const text=await response.text();if(typeof status==='number')expect(response.status,text).toBe(status);else expect(status,text).toContain(response.status);
 const value=JSON.parse(text);expect(validateError(value),text).toBe(true);expect(Object.keys(value)).toEqual(['error']);
 for(const secret of secrets)expect(text).not.toContain(secret);expect(value).not.toHaveProperty('page');return value;
}
for(const row of isolationOperations.filter(x=>!x.lanes.includes('public')))for(const lane of ['human','native'] as const)if(!row.lanes.includes(lane))it(row.operation+' / forbidden '+lane+' lane / no partial effects',async()=>{
 const f=await isolationHttpFixture(('forbidden_'+row.operation+'_'+lane).toLowerCase()),prepared=await prepareIsolationOperation(f,row.operation,row.lanes[0]),input={...prepared.input};
 if(lane==='human')delete input.proof;else if(clientOperations[row.operation].runtimeProof)input.proof=f.runtimes.reader.runtime_token;
 const before=await f.snapshot(),other=await f.snapshot('b');
 const expected=['getAuthSession','logoutAuth'].includes(row.operation)?401:row.operation==='claimTask'||row.operation==='failTask'||row.operation==='submitTaskResult'||row.operation==='heartbeatRun'||row.operation==='heartbeatRuntime'?401:403;
 await assertDenied(await f.send(row.operation,lane,input),expected);expect((await f.snapshot()).digest).toBe(before.digest);expect((await f.snapshot('b')).digest).toBe(other.digest);recordIsolationEvidence(row.operation,lane,'forbidden');
},30_000);

async function foreignGraph(f:IsolationHttpFixture){
 await f.ensureB();await putIsolationProfile(f,'b');
 const task=await createIsolationTask(f,'b'),agent=await f.data('createAgent','human',{body:{display_name:foreignText,description:foreignText,work_role_ids:[]}},'b');
 const credential=await f.data('createCredential','human',{body:{agent_id:agent.id,label:foreignText,scopes:['tasks:read'],project_ids:null,expires_at:new Date(Date.now()+600000).toISOString()}},'b');
 const runtime=await f.data('createRuntime','native',{body:{label:foreignText}},'b');
 await f.data('readyTask','human',{path:{task_id:task.id},body:{expected_version:1}},'b');
 const claim=await f.data('claimTask','native',{path:{task_id:task.id},body:{expected_version:2,runtime_instance_id:runtime.runtime.id},proof:runtime.runtime_token},'b');
 const message=await f.data('createMessage','human',{body:{recipient_agent_ids:['agent_research'],body:foreignText,refs:[],artifact_ids:[]}},'b');
 const artifact=await f.data('stageArtifact','human',{body:{task_id:null,run_id:null,filename:'foreign-private.txt',media_type:'text/plain',byte_size:foreignText.length,sha256:await sha256(foreignText)}},'b');
 const upload=await f.data('uploadArtifactContent','human',{path:{artifact_id:artifact.id},bytes:new TextEncoder().encode(foreignText)},'b');
 await f.data('commitArtifact','human',{path:{artifact_id:artifact.id},body:{expected_artifact_version:upload.artifact_version}},'b');
 const plan=await f.data('previewCatalogChange','human',{body:{expected_profile_revision:2,kind:'project',id:'foreign_project',operation:'archive',replacement_id:null,reason:'Foreign private plan'}},'b');
 const imported=await f.data('previewImport','human',{body:{source_namespace:'foreign_source',source_revision:'revision1',rows:[{external_id:'foreign_import_row',title:foreignText,description:foreignText,project_id:null,work_role_id:null,source_updated_at:null,source_state:null,source_ref:null}]}},'b');
 return {task,agent,credential:credential.credential,runtime:runtime.runtime,run:claim.run,message,artifact,plan,imported};
}
it.each(['human','native'] as const)('valid %s proof cannot access real foreign path or embedded resources',async lane=>{
 const f=await isolationHttpFixture('foreign_graph_'+lane),g=await foreignGraph(f),own=await createIsolationTask(f),ids=[foreignText,...Object.values(g).map(x=>x.id),g.message.thread_id];
 const proof=lane==='native'?f.runtimes.reader.runtime_token:undefined;
 const rows:{operation:EnabledOperationId;input:Input;status:number|readonly number[]}[]=[
  ...(['getTask','patchTask','readyTask','cancelTask','requeueTask','listTaskResults'] as const).map(operation=>({operation,input:{path:{task_id:g.task.id},...(['getTask','listTaskResults'].includes(operation)?{}:{body:operation==='patchTask'?{expected_version:1,title:'Changed'}:operation==='readyTask'?{expected_version:1}:{expected_version:1,reason:'Explicit'}})},status:404})),
  {operation:'acceptTaskResult',input:{path:{task_id:g.task.id},body:{expected_version:3,reason:'Foreign review'}},status:404},
  {operation:'createTask',input:{body:{title:'Foreign catalog',description:'',project_id:'foreign_project'}},status:404},
  {operation:'patchTask',input:{path:{task_id:own.id},body:{expected_version:1,assigned_agent_id:g.agent.id}},status:404},
  {operation:'getRun',input:{path:{run_id:g.run.id}},status:404},
  {operation:'getAgent',input:{path:{agent_id:g.agent.id}},status:404},
  {operation:'getThread',input:{path:{thread_id:g.message.thread_id}},status:404},
  {operation:'getArtifact',input:{path:{artifact_id:g.artifact.id}},status:404},
  {operation:'downloadArtifactContent',input:{path:{artifact_id:g.artifact.id}},status:404},
  {operation:'commitArtifact',input:{path:{artifact_id:g.artifact.id},body:{expected_artifact_version:3},proof},status:404},
  {operation:'uploadArtifactContent',input:{path:{artifact_id:g.artifact.id},bytes:new TextEncoder().encode('attempt'),proof},status:404},
  {operation:'createTask',input:{body:{title:'Own workspace request',description:'',assigned_agent_id:g.agent.id}},status:404},
  {operation:'stageArtifact',input:{body:{task_id:g.task.id,run_id:null,filename:'own.txt',media_type:'text/plain',byte_size:0,sha256:await sha256('')},proof},status:404},
  {operation:'stageArtifact',input:{body:{task_id:own.id,run_id:g.run.id,filename:'own.txt',media_type:'text/plain',byte_size:0,sha256:await sha256('')},proof},status:lane==='human'?401:404},
  ...(['message','task','artifact'] as const).map(kind=>({operation:'createMessage' as const,input:{body:{recipient_agent_ids:['agent_research'],body:'Inert message',refs:[{kind,id:kind==='message'?g.message.id:kind==='task'?g.task.id:g.artifact.id}],artifact_ids:[]}},status:404})),
  {operation:'createMessage',input:{body:{recipient_agent_ids:['agent_research'],body:'Inert',refs:[],artifact_ids:[g.artifact.id]}},status:404},
  {operation:'createMessage',input:{body:{recipient_agent_ids:[g.agent.id],body:'Inert',refs:[],artifact_ids:[]}},status:404},
 ];
 if(lane==='human')rows.push(
  {operation:'patchAgent',input:{path:{agent_id:g.agent.id},body:{expected_agent_version:1,description:'Changed'}},status:404},
  {operation:'archiveAgent',input:{path:{agent_id:g.agent.id},body:{expected_agent_version:1,reason:'Archive'}},status:404},
  {operation:'createCredential',input:{body:{agent_id:g.agent.id,label:'Own request',scopes:['tasks:read'],project_ids:null,expires_at:new Date(Date.now()+600000).toISOString()}},status:404},
  {operation:'revokeCredential',input:{path:{credential_id:g.credential.id},body:{expected_credential_version:1,reason:'Revoke'}},status:404},
  {operation:'applyCatalogChange',input:{body:{preview_id:g.plan.id,expected_profile_revision:1}},status:404},
  {operation:'getImport',input:{path:{import_id:g.imported.id}},status:404},
  {operation:'applyImport',input:{path:{import_id:g.imported.id},body:{expected_import_version:1,preview_sha256:g.imported.preview_sha256,accept_rejected_rows:false}},status:404});
 else rows.push(
  {operation:'claimTask',input:{path:{task_id:g.task.id},body:{expected_version:3,runtime_instance_id:f.runtimes.reader.runtime.id},proof},status:404},
  ...(['submitTaskResult','failTask'] as const).map(operation=>({operation,input:{path:{task_id:own.id},body:{expected_version:1,run_id:g.run.id,fence:g.run.fence,...(operation==='submitTaskResult'?{result:{summary:'Foreign run',artifact_ids:[]}}:{reason:'Foreign run',outcome_unknown:false})},proof},status:401})),
  {operation:'heartbeatRuntime',input:{path:{runtime_instance_id:g.runtime.id},body:{expected_runtime_version:1},proof},status:401},
  {operation:'heartbeatRun',input:{path:{run_id:g.run.id},body:{expected_run_version:1,fence:1},proof},status:401},
  {operation:'claimTask',input:{path:{task_id:own.id},body:{expected_version:1,runtime_instance_id:g.runtime.id},proof},status:401},
  {operation:'ackMessages',input:{body:{message_ids:[g.message.id]}},status:404});
 const before=await f.snapshot(),other=await f.snapshot('b');
 for(const row of rows){const response=await f.send(row.operation,lane,{key:crypto.randomUUID(),...row.input});expect(response.status,row.operation+' '+JSON.stringify(row.input.path??{})).toBe(row.status);await assertDenied(response,row.status,ids);expect((await f.snapshot()).digest,row.operation).toBe(before.digest);expect((await f.snapshot('b')).digest,row.operation).toBe(other.digest);}
 for(const operation of ['listTasks','listAgents','listArtifacts','listEvents','searchWorkspace'] as const){const response=await f.send(operation,lane,operation==='searchWorkspace'?{query:{q:'PRIVATE'}}:{});expect(response.status).toBe(200);const text=await response.text();for(const hidden of ids)expect(text).not.toContain(hidden);const value=JSON.parse(text);if(operation==='searchWorkspace')expect(value).toMatchObject({data:[],page:{has_more:false,next_cursor:null}});}
 const collection=await f.send(lane==='human'?'listCredentials':'getInbox',lane);expect(collection.status).toBe(200);const collectionText=await collection.text();for(const hidden of ids)expect(collectionText).not.toContain(hidden);
 recordIsolationEvidence('resources',lane,'foreign-graph');
},30_000);

for(const lane of ['human','native'] as const)for(const change of ['revoke','expire'] as const)it(lane+' '+change+' survives eviction for reads, cursor continuation and successful replay',async()=>{
 const f=await isolationHttpFixture('current_'+lane+'_'+change),first=await createIsolationTask(f);await createIsolationTask(f);
 const created=await f.send('createTask',lane,{key:'durable-same-request',body:{title:visibleText,description:'Replay boundary'}});expect(created.status).toBe(201);await created.arrayBuffer();
 const page=await f.send('listTasks',lane,{query:{limit:1}}),body=await page.json() as {page:{next_cursor:string}};expect(page.status).toBe(200);expect(typeof body.page.next_cursor).toBe('string');
 const decoded=atob(body.page.next_cursor.replaceAll('-','+').replaceAll('_','/'));expect(decoded).not.toContain(first.id);expect(decoded).not.toContain(visibleText);
 await narrowAuthority(f,lane,change);await evictDurableObject(f.a.stub);const before=await f.snapshot();
 for(const [operation,input] of [['getTask',{path:{task_id:first.id}}],['listTasks',{query:{limit:1,cursor:body.page.next_cursor}}],['createTask',{key:'durable-same-request',body:{title:visibleText,description:'Replay boundary'}}]] as [EnabledOperationId,Input][]){await assertDenied(await f.send(operation,lane,input),401,[first.id,visibleText]);expect((await f.snapshot()).digest).toBe(before.digest);}
 recordIsolationEvidence('authority',lane,change+'-after-eviction');
},30_000);

it('null unrestricted, empty no projects, and separate credential ceilings never union',async()=>{
 const f=await isolationHttpFixture('credential_ceiling_matrix');await putIsolationProfile(f);const task=await createIsolationTask(f,'a','project_a');
 const unrestricted=await f.send('getTask','native',{path:{task_id:task.id}});expect(unrestricted.status).toBe(200);await unrestricted.arrayBuffer();
 await f.setGrant(['tasks:read'],[]);await assertDenied(await f.send('getTask','native',{path:{task_id:task.id}}),403,[task.id]);
 const splitToken='K'.repeat(42)+'A',splitHash=await sha256(splitToken);
 const split=await isolationHttpFixture('split_ceiling_matrix',{nativeScopes:['messages:read','messages:send','runtimes:manage'],configure:raw=>{const base=raw.config.static_credential_refs[0];raw.config.static_credential_refs.push({...base,credential_id:'credential_split',scopes:['tasks:read'],project_ids:['project_a']});raw.bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_split',token_sha256:splitHash});}});
 await putIsolationProfile(split);const splitTask=await createIsolationTask(split,'a','project_a'),before=await split.snapshot();
 await assertDenied(await split.send('getTask','native',{path:{task_id:splitTask.id}}),403,[splitTask.id]);
 await assertDenied(await split.send('createMessage','human',{body:{recipient_agent_ids:['agent_research'],body:'Must not union grants',refs:[{kind:'task',id:splitTask.id}],artifact_ids:[]}}),404,[splitTask.id]);
 expect((await split.snapshot()).digest).toBe(before.digest);
 const allowed=await split.send('getTask','native',{path:{task_id:splitTask.id},token:splitToken});expect(allowed.status).toBe(200);await allowed.arrayBuffer();
 await split.setGrant(['tasks:read'],[],'credential_split');await assertDenied(await split.send('getTask','native',{path:{task_id:splitTask.id},token:splitToken}),403,[splitTask.id]);recordIsolationEvidence('grants','native','no-union');
},30_000);

it('idempotency key namespaces distinguish principal and exact target without global deduplication',async()=>{
 const f=await isolationHttpFixture('namespace_matrix');
 const request={key:'identical-key',body:{title:visibleText,description:'Exact payload'}};
 const human=await f.data('createTask','human',request),native=await f.data('createTask','native',request);expect(human.id).not.toBe(native.id);
 for(const id of [human.id,native.id]){const patch={key:'shared-patch-key',path:{task_id:id},body:{expected_version:1,title:'Exact patch'}};expect((await f.send('patchTask','human',patch)).status).toBe(200);const replay=await f.send('patchTask','human',patch);expect(replay.status).toBe(200);expect((await replay.json() as {data:{task_version:number}}).data.task_version).toBe(2);}
 const before=await f.snapshot();await assertDenied(await f.send('createTask','human',{...request,body:{title:'Changed intent',description:''}}),409);expect((await f.snapshot()).digest).toBe(before.digest);
 await runInDurableObject(f.a.stub,(_o,{storage})=>{expect(storage.sql.exec("SELECT COUNT(*) n FROM idempotency_outcomes WHERE key='identical-key'").one().n).toBe(2);expect(storage.sql.exec("SELECT COUNT(DISTINCT target) n FROM idempotency_outcomes WHERE key='shared-patch-key'").one().n).toBe(2);});recordIsolationEvidence('idempotency','human','namespace');
});

const unavailable=Object.entries(spec.paths).flatMap(([path,item])=>Object.entries(item).flatMap(([method,value])=>{const operation=(value as {operationId?:string}).operationId;return operation&&['requestTaskDecision','listApprovals','getApproval','approveApproval','rejectApproval'].includes(operation)?[{path,method:method.toUpperCase(),operation}]:[];}));
for(const route of unavailable)for(const lane of ['human','native'] as const)it(route.operation+' / '+lane+' / unavailable without fallback',async()=>{
 const f=await isolationHttpFixture(('closed_'+route.operation+'_'+lane).toLowerCase()),before=await f.snapshot(),path=route.path.replace('{workspace_id}','ws_example').replace(/\{[^}]+\}/g,'hidden_reference');
 const headers:Record<string,string>=lane==='human'?{cookie:f.sessionCookie,origin:f.a.origin,'x-csrf-token':f.csrf}:{authorization:'Bearer '+f.a.token};
 const response=await f.http(new Request(f.a.origin+path,{method:route.method,headers:{...headers,'content-type':'application/json','idempotency-key':'closed-route'},...(['GET','HEAD'].includes(route.method)?{}:{body:'{}'})}));
 await assertDenied(response,404,['hidden_reference']);expect((await f.snapshot()).digest).toBe(before.digest);recordIsolationEvidence(route.operation,lane,'unavailable');
});
it('unknown R4 adapter and recovery paths have no product-router fallback',async()=>{
 const f=await isolationHttpFixture('closed_recovery_adapter'),before=await f.snapshot();
 for(const path of ['mcp','a2a','teams','connectors','recovery','recovery:capture'])for(const lane of ['human','native'] as const){const response=await f.http(new Request(f.a.origin+'/v2/workspaces/ws_example/'+path,{method:'POST',headers:lane==='native'?{authorization:'Bearer '+f.a.token}:{cookie:f.sessionCookie},body:'{}'}));await assertDenied(response,404);}
 expect((await f.snapshot()).digest).toBe(before.digest);recordIsolationEvidence('routing','public','no-fallback');
});
it('missing or aliased product artifact binding is unavailable before effects',async()=>{
 const f=await isolationHttpFixture('unbound_artifacts'),input={body:{task_id:null,run_id:null,filename:'closed.txt',media_type:'text/plain',byte_size:0,sha256:await sha256('')},proof:f.runtimes.reader.runtime_token};const before=await f.snapshot();
 for(const binding of [undefined,env.RECOVERY_BUCKET]){const response=await entry.fetch(f.make('stageArtifact','native',input),{...f.bindings,ARTIFACT_BUCKET:binding} as Env);await assertDenied(response,404);}
 expect((await f.snapshot()).digest).toBe(before.digest);
});
for(const operation of ['stageArtifact','listArtifacts','getArtifact','downloadArtifactContent','uploadArtifactContent','commitArtifact'] as const)for(const lane of ['human','native'] as const)it(operation+' / '+lane+' / no trusted artifact binding means no route',async()=>{
 const f=await isolationHttpFixture(('unbound_'+operation+'_'+lane).toLowerCase()),prepared=await prepareIsolationOperation(f,operation,lane),before=await f.snapshot();
 for(const binding of [undefined,env.RECOVERY_BUCKET]){await assertDenied(await entry.fetch(f.make(operation,lane,prepared.input),{...f.bindings,ARTIFACT_BUCKET:binding} as Env),404);recordIsolationEvidence(operation,lane,binding===undefined?'missing-binding':'aliased-binding');}
 expect((await f.snapshot()).digest).toBe(before.digest);
});
for(const lane of ['human','native'] as const)it(lane+' task admission without execution policy is closed without inventing default policy',async()=>{
 const f=await isolationHttpFixture('unconfigured_policy_'+lane,{configure:raw=>{delete raw.config.workspace_policies[0].execution_policy;}}),before=await f.snapshot();
 await assertDenied(await f.send('createTask',lane,{body:{title:'No execution policy',description:''}}),503);expect((await f.snapshot()).digest).toBe(before.digest);recordIsolationEvidence('createTask',lane,'missing-policy');
});
for(const lane of ['human','native'] as const)it(lane+' maintenance barrier denies protected read and mutation without fallback',async()=>{
 const f=await isolationHttpFixture('maintenance_gate_'+lane),task=await createIsolationTask(f);
 await runInDurableObject(f.a.stub,(_o,{storage})=>{storage.sql.exec("UPDATE maintenance_state SET state='capturing',barrier_id='synthetic_barrier',capture_id='synthetic_capture',generation=generation+1");storage.sql.exec("UPDATE workspace_metadata SET admission_state='maintenance'");});
 const before=await f.snapshot();
 for(const [operation,input] of [['getTask',{path:{task_id:task.id}}],['createTask',{body:{title:'Closed',description:''}}],['getWorkspace',{}]] as [EnabledOperationId,Input][]){await assertDenied(await f.send(operation,lane,input),401);expect((await f.snapshot()).digest).toBe(before.digest);}
 recordIsolationEvidence('workspace',lane,'maintenance');
});
it('browser callback is bound to login workspace and public liveness exposes no workspace data',async()=>{
 const f=await isolationHttpFixture('protocol_boundaries');
 const request=await oidcCallbackRequest({http:f.http},f.a,f.b);const beforeA=await f.snapshot(),beforeB=await f.snapshot('b');
 await assertDenied(await f.http(request),401);expect((await f.snapshot()).digest).toBe(beforeA.digest);expect((await f.snapshot('b')).digest).toBe(beforeB.digest);
 const response=await f.http(new Request(f.a.origin+'/health/live'));expect(response.status).toBe(200);const text=await response.text();expect(text).not.toContain('ws_example');expect(text).not.toContain('human_operator');expect(text).not.toContain(foreignText);recordIsolationEvidence('auth','public','callback-workspace');
});

it('catalog remap requires current task-edit scope for both preview and apply',async()=>{
 const f=await isolationHttpFixture('catalog_remap_scope');await putIsolationProfile(f);await createIsolationTask(f,'a','project_a');
 const body={expected_profile_revision:2,kind:'project',id:'project_a',operation:'remap',replacement_id:'project_b',reason:'Controlled remap'},plan=await f.data('previewCatalogChange','human',{body});
 await runInDurableObject(f.a.stub,(_o,{storage})=>{const row=storage.sql.exec<{scopes_json:string}>('SELECT scopes_json FROM human_grants').one();storage.sql.exec('UPDATE human_grants SET scopes_json=?',JSON.stringify((JSON.parse(row.scopes_json) as string[]).filter(scope=>scope!=='tasks:edit')));});
 const before=await f.snapshot();for(const [operation,input]of [['previewCatalogChange',{body}],['applyCatalogChange',{body:{preview_id:plan.id,expected_profile_revision:2}}]] as [EnabledOperationId,Input][]){await assertDenied(await f.send(operation,'human',input),403);expect((await f.snapshot()).digest).toBe(before.digest);}
 recordIsolationEvidence('catalog','human','remap-scope');
});
it('result and independent acceptance retain exact actor, event and outcome receipts without replay duplicates',async()=>{
 const f=await isolationHttpFixture('result_receipts'),prepared=await prepareIsolationOperation(f,'submitTaskResult','native'),submitted=await f.data('submitTaskResult','native',{...prepared.input,key:'submit-receipt'}),taskId=submitted.task.id,runId=submitted.run.id;
 const accepted=await f.data('acceptTaskResult','native',{path:{task_id:taskId},body:{expected_version:4,reason:'Independent receipt'},token:isolationTokens.other,key:'accept-receipt'});expect(accepted.task.state).toBe('done');
 await runInDurableObject(f.a.stub,(_o,{storage})=>{
  const result=storage.sql.exec('SELECT * FROM task_results WHERE task_id=?',taskId).one();expect(result).toMatchObject({run_id:runId,submitted_principal_id:'agent_research',submitted_agent_id:'agent_research'});
  expect(storage.sql.exec('SELECT * FROM task_acceptances WHERE task_id=?',taskId).toArray()).toEqual([expect.objectContaining({result_id:result.id,run_id:runId,reviewer_principal_id:'agent_other',reviewer_agent_id:'agent_other'})]);
  for(const [key,type,principal]of [['submit-receipt','task.result_submitted','agent_research'],['accept-receipt','task.result_accepted','agent_other']]){
   const outcome=storage.sql.exec('SELECT * FROM idempotency_outcomes WHERE key=?',key).one();expect(outcome.principal_id).toBe(principal);
   const event=storage.sql.exec<{type:string;resource_id:string;actor_json:string}>('SELECT * FROM events WHERE id=?',outcome.event_id).one();expect(event).toMatchObject({type,resource_id:taskId});expect(JSON.parse(event.actor_json)).toMatchObject({principal_id:principal});
   expect(storage.sql.exec('SELECT * FROM task_history WHERE event_id=?',outcome.event_id).toArray()).toHaveLength(1);
  }
 });
 const before=await f.snapshot();expect(await f.data('submitTaskResult','native',{...prepared.input,key:'submit-receipt'})).toEqual(submitted);expect(await f.data('acceptTaskResult','native',{path:{task_id:taskId},body:{expected_version:4,reason:'Independent receipt'},token:isolationTokens.other,key:'accept-receipt'})).toEqual(accepted);expect((await f.snapshot()).digest).toBe(before.digest);recordIsolationEvidence('receipts','native','result-acceptance');
});

it('signed same-workspace second human cannot read or apply another owners import preview',async()=>{
 const f=await isolationHttpFixture('import_other_owner',{configure:raw=>{raw.config.human_grants.push({...structuredClone(raw.config.human_grants[0]),principal_id:'human_second',subject:'ungranted-subject'});}}),prepared=await prepareIsolationOperation(f,'applyImport','human');
 const second=await login(f.a.stub,'ungranted');expect(second.response.status).toBe(302);await second.response.arrayBuffer();
 const session=await f.a.stub.fetch(authRequest('session','GET',undefined,second.cookie));expect(session.status).toBe(200);const data=(await session.json() as {data:{actor:{principal_id:string};csrf_token:string}}).data;expect(data.actor.principal_id).toBe('human_second');
 const headers={cookie:second.cookie,'x-csrf-token':data.csrf_token},before=await f.snapshot();
 for(const operation of ['getImport','applyImport'] as const){await assertDenied(await f.send(operation,'human',{...prepared.input,...(operation==='getImport'?{body:undefined}:{}),headers}),404,[prepared.input.path!.import_id]);expect((await f.snapshot()).digest).toBe(before.digest);}
 recordIsolationEvidence('imports','human','same-workspace-other-owner');
});
it('valid runtime for own run cannot mutate a different real foreign task target',async()=>{
 const f=await isolationHttpFixture('foreign_task_own_run'),foreign=await createIsolationTask(f,'b'),prepared=await prepareIsolationOperation(f,'submitTaskResult','native'),body=prepared.input.body as {expected_version:number;run_id:string;fence:number};const before=await f.snapshot(),other=await f.snapshot('b');
 for(const operation of ['submitTaskResult','failTask'] as const){const input={...prepared.input,path:{task_id:foreign.id},body:operation==='submitTaskResult'?prepared.input.body:{expected_version:body.expected_version,run_id:body.run_id,fence:body.fence,reason:'Mismatched task',outcome_unknown:false}};await assertDenied(await f.send(operation,'native',input),403,[foreign.id,foreignText]);expect((await f.snapshot()).digest).toBe(before.digest);expect((await f.snapshot('b')).digest).toBe(other.digest);}
 recordIsolationEvidence('tasks','native','foreign-task-own-run');
});
