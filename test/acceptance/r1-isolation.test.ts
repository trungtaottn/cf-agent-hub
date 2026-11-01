import {decisionRequest} from '../helpers/decision-boundary';
import {it,expect,beforeEach} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import spec from '../../spec/openapi.json';
import {control} from '../helpers/auth';
import {acceptanceFixture,apiRequest,sqlSnapshot} from '../helpers/r1-acceptance';
import {validateError,validateMessage,validateMessageCreationReconciliationResponse,validateObservationEstablishRequest,validateObservationBatchRequest,validateObservationReplaceRequest} from '../../src/http/generated/auth-validators.js';

beforeEach(async()=>{await control('reset');});
const unavailable=Object.entries(spec.paths).flatMap(([path,item])=>Object.entries(item).flatMap(([method,value])=>{
 const op=value as {operationId?:string;'x-r1-available'?:boolean};
 return op.operationId&&op['x-r1-available']!==true?[{path,method:method.toUpperCase(),operation:op.operationId}]:[];
}));
// These #25–37 operations now exist, but recognition does not grant old R1 callers authority.
const identityOperations=new Set(['listAgents','createAgent','getAgent','patchAgent','archiveAgent','listCredentials','createCredential','revokeCredential','createRuntime','heartbeatRuntime']);
const taskOperations=new Set(['listTasks','createTask','getTask','patchTask','readyTask','listTaskResults','claimTask','failTask','cancelTask','requeueTask','getRun','heartbeatRun','submitTaskResult','acceptTaskResult']);
const catalogOperations=new Set(['previewCatalogChange','applyCatalogChange']);
const artifactOperations=new Set(['listArtifacts','getArtifact','downloadArtifactContent','stageArtifact','uploadArtifactContent','commitArtifact']);
const importOperations=new Set(['previewImport','applyImport','getImport']);
const availableOperations=new Set([...identityOperations,...taskOperations,...catalogOperations,...artifactOperations,...importOperations,'searchWorkspace','requestTaskDecision','listApprovals','getApproval']);
const identityBody:Record<string,unknown>={requestTaskDecision:decisionRequest('unavailable_fixture'),previewImport:{source_namespace:'source_denied',source_revision:'revision1',rows:[]},applyImport:{expected_import_version:1,preview_sha256:'0'.repeat(64),accept_rejected_rows:false},submitTaskResult:{expected_version:1,run_id:'unavailable_run',fence:1,result:{summary:'Denied',artifact_ids:[]}},acceptTaskResult:{expected_version:1,reason:'Denied'},stageArtifact:{task_id:null,run_id:null,filename:'denied.txt',media_type:'text/plain',byte_size:0,sha256:'0'.repeat(64)},commitArtifact:{expected_artifact_version:1},claimTask:{expected_version:1,runtime_instance_id:'unavailable_runtime'},failTask:{expected_version:1,run_id:'unavailable_run',fence:1,reason:'Denied',outcome_unknown:true},cancelTask:{expected_version:1,reason:'Denied'},requeueTask:{expected_version:1,reason:'Denied'},heartbeatRun:{expected_run_version:1,fence:1},previewCatalogChange:{expected_profile_revision:1,kind:'project',id:'project_a',operation:'archive',replacement_id:null,reason:'Denied'},applyCatalogChange:{preview_id:'plan_denied',expected_profile_revision:1},createTask:{title:'Denied synthetic task',description:''},patchTask:{expected_version:1,title:'Denied'},readyTask:{expected_version:1},createRuntime:{label:'Denied runtime'},heartbeatRuntime:{expected_runtime_version:1},createAgent:{display_name:'Denied synthetic',description:'',work_role_ids:[]},patchAgent:{expected_agent_version:1,description:'Denied'},archiveAgent:{expected_agent_version:1,reason:'Denied'},createCredential:{agent_id:'agent_research',label:'Denied',scopes:['messages:read'],project_ids:null,expires_at:new Date(Date.now()+3600000).toISOString()},revokeCredential:{expected_credential_version:1,reason:'Denied'}};
// Source-installed observations are a distinct disabled-pilot boundary, not unimplemented404
// or a new grant for the unchanged canonical R1 configuration.
const observationOperations=new Set(['establishObservationSession','appendObservationBatch','replaceObservationSession','getObservationOwnerStatus','listTaskObservations']);
const observationSessionId='obs_'+'a'.repeat(48);
const observationBodies:Record<string,{body:unknown;validate:(value:unknown)=>boolean}>={
 establishObservationSession:{body:{run_id:'unavailable_run',fence:1,adapter_id:'synthetic_adapter',adapter_version:'1'},validate:validateObservationEstablishRequest},
 appendObservationBatch:{body:{run_id:'unavailable_run',fence:1,first_sequence:1,records:[{observed_at:'2026-11-01T00:00:00Z',relative_path:'src/synthetic.ts',activity:'read-observed',source_oid:null}]},validate:validateObservationBatchRequest},
 replaceObservationSession:{body:{run_id:'unavailable_run',fence:1,expected_session_id:observationSessionId,expected_high_water:0,replacement_request_id:'00000000-0000-4000-8000-000000000001',reason:'coverage_loss'},validate:validateObservationReplaceRequest},
};
const recoveryOperations=new Set(['reconcileMessageCreation','reconcileTaskCreation','prepareMessageCreation','prepareTaskCreation']);
for(const route of unavailable.filter(route=>!recoveryOperations.has(route.operation)))it((observationOperations.has(route.operation)?'disabled observation pilot ':availableOperations.has(route.operation)?'ungranted operation ':'unavailable ')+route.operation+' has no R1 mutation surface',async()=>{
 const f=await acceptanceFixture(('r1_unavailable_'+route.operation).toLowerCase());
 const path=route.path.replace('/v2/workspaces/{workspace_id}','').replace('{session_id}',observationSessionId).replace(/\{[^}]+\}/g,'unavailable_fixture')+(route.operation==='searchWorkspace'?'?q=needle':'');
 // Keep the old canonical R1 grant/config unchanged. A real scoped target makes
 // 403 prove lack of authority rather than merely a nonexistent resource.
 if(taskOperations.has(route.operation))await runInDurableObject(f.a.stub,(_o,state)=>{state.storage.sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,retry_count,retry_limit,flags_json,created_at,updated_at) SELECT 'unavailable_fixture',workspace_id,'Existing synthetic task','','backlog',1,0,0,0,'[]',1,1 FROM workspace_metadata WHERE id=1");});
 // Catalog reuses R1 profile:edit; explicitly narrow it to test denial, never widen authority.
 if(catalogOperations.has(route.operation))await runInDurableObject(f.a.stub,(_o,state)=>{const rows=state.storage.sql.exec<{principal_id:string;scopes_json:string}>('SELECT principal_id,scopes_json FROM human_grants').toArray();for(const row of rows)state.storage.sql.exec('UPDATE human_grants SET scopes_json=? WHERE principal_id=?',JSON.stringify((JSON.parse(row.scopes_json) as string[]).filter(scope=>scope!=='profile:edit')),row.principal_id);});
 const beforeA=await sqlSnapshot(f.a),beforeB=await sqlSnapshot(f.b);
 const observationBody=observationBodies[route.operation];
 if(observationOperations.has(route.operation)){
  // No optional mapping or new authority is installed merely to make denial pass.
  for(const snapshot of [beforeA,beforeB]){
   const config=JSON.parse(String(snapshot.tables.workspace_metadata[0]!.config_json)) as {workspace_policies:Array<Record<string,unknown>>};
   expect(config.workspace_policies.every(policy=>!Object.hasOwn(policy,'observation_pilot'))).toBe(true);
  }
  if(observationBody)expect(observationBody.validate(observationBody.body),'disabled-pilot requests remain valid closed operation inputs').toBe(true);
 }

 const response=await f.http(apiRequest(f.a,path,route.method,['GET','HEAD'].includes(route.method)?undefined:observationBody?.body??identityBody[route.operation]??{},{cookie:f.sessionCookie,'x-csrf-token':f.csrf,'idempotency-key':'unavailable',...(route.operation==='uploadArtifactContent'?{'content-type':'application/octet-stream'}:{}),...(['heartbeatRuntime','claimTask','failTask','heartbeatRun','submitTaskResult','requestTaskDecision'].includes(route.operation)?{'x-runtime-token':btoa('x'.repeat(32)).replace(/=+$/,'')}:{})}));
 // Fail verifies current run proof before resource disclosure; unchanged R1 humans have none.
 const deniedStatus=route.operation==='failTask'?401:403;
 const expectedStatus=observationOperations.has(route.operation)?503:availableOperations.has(route.operation)?deniedStatus:404;
 const expectedCode=observationOperations.has(route.operation)?'DEPENDENCY_UNAVAILABLE':availableOperations.has(route.operation)?deniedStatus===401?'UNAUTHENTICATED':'FORBIDDEN':'NOT_FOUND';
 expect(response.status,'exact unavailable, disabled-pilot or ungranted boundary must fail without effects').toBe(expectedStatus);
 const value=await response.json() as {error:{code:string}};expect(validateError(value)).toBe(true);expect(value.error.code).toBe(expectedCode);expect('data'in value).toBe(false);
 expect((await sqlSnapshot(f.a)).digest).toBe(beforeA.digest);expect((await sqlSnapshot(f.b)).digest).toBe(beforeB.digest);
},30_000);

it('wrong workspace cannot reuse human or native authority and cannot expose foreign resources',async()=>{
 const f=await acceptanceFixture('r1_isolation_distinct_authority');
 const beforeA=await sqlSnapshot(f.a),beforeB=await sqlSnapshot(f.b);
 for(const headers of [{cookie:f.sessionCookie},{authorization:'Bearer '+f.a.token}] as Record<string,string>[]){
  const response=await f.http(apiRequest(f.b,'/events','GET',undefined,headers));
  expect(response.status).toBe(401);const value=await response.json() as {error:{code:string}};expect(validateError(value)).toBe(true);expect(value.error.code).toBe('UNAUTHENTICATED');expect('data'in value).toBe(false);
 }
 // A valid B credential proves the route exists and returns no A records.
 const own=await f.http(apiRequest(f.b,'/inbox','GET',undefined,{authorization:'Bearer '+f.b.token}));expect(own.status).toBe(200);
 const page=await own.json() as {data:unknown[]};expect(page.data).toEqual([]);
 const foreign=await f.http(apiRequest(f.b,'/threads/'+encodeURIComponent(f.threadId),'GET',undefined,{authorization:'Bearer '+f.b.token}));
 expect(foreign.status).toBe(404);expect(validateError(await foreign.json())).toBe(true);
 expect((await sqlSnapshot(f.a)).digest).toBe(beforeA.digest);expect((await sqlSnapshot(f.b)).digest).toBe(beforeB.digest);
 const ownThread=await f.http(apiRequest(f.a,'/threads/'+encodeURIComponent(f.threadId),'GET',undefined,{authorization:'Bearer '+f.a.token}));expect(ownThread.status).toBe(200);
 for(const row of (await ownThread.json() as {data:unknown[]}).data){expect(validateMessage(row)).toBe(true);expect((row as {workspace_id:string}).workspace_id).toBe(f.a.id);}
});

for(const mismatch of ['human_grant_epoch','native_credential_epoch','schema_version'] as const)it(mismatch+' fails closed without modifying authority or domain state',async()=>{
 const f=await acceptanceFixture('r1_isolation_'+mismatch);
 await runInDurableObject(f.a.stub,(_o,state)=>{
  if(mismatch==='human_grant_epoch')state.storage.sql.exec('UPDATE human_grants SET config_epoch=config_epoch+1');
  else if(mismatch==='native_credential_epoch')state.storage.sql.exec('UPDATE native_credentials SET config_epoch=config_epoch+1');
  else state.storage.sql.exec('INSERT INTO schema_migrations (version,applied_at) SELECT MAX(version)+1,? FROM schema_migrations',Date.now());
 });
 const before=await sqlSnapshot(f.a),other=await sqlSnapshot(f.b);
 const headers:Record<string,string>=mismatch==='native_credential_epoch'?{authorization:'Bearer '+f.a.token}:{cookie:f.sessionCookie,'x-csrf-token':f.csrf};headers['idempotency-key']='epoch_mismatch';
 const response=await f.http(apiRequest(f.a,'/messages','POST',{thread_id:f.threadId,recipient_agent_ids:['agent_research'],body:'Must never be accepted',refs:[],artifact_ids:[]},headers));
 if(mismatch==='schema_version')expect([401,503]).toContain(response.status);else expect(response.status).toBe(401);
 const value=await response.json() as {error:{code:string}};expect(validateError(value)).toBe(true);
 expect(['UNAUTHENTICATED','DEPENDENCY_UNAVAILABLE']).toContain(value.error.code);expect('data'in value).toBe(false);
 expect((await sqlSnapshot(f.a)).digest).toBe(before.digest);expect((await sqlSnapshot(f.b)).digest).toBe(other.digest);
});

// R3 recovery is a read of original admission, not a new R1 creation grant.
// Only these exact reviewed routes leave the generic unavailable-operation matrix.
for(const [operation,path] of [['reconcileMessageCreation','/messages:reconcile'],['reconcileTaskCreation','/tasks:reconcile']] as const)it(operation+' preserves current R1 authority and browser-only read isolation',async()=>{
 expect(unavailable.filter(route=>route.operation===operation)).toEqual([{path:'/v2/workspaces/{workspace_id}'+path,method:'POST',operation}]);
 const f=await acceptanceFixture(('r1_recovery_'+operation).toLowerCase());
 const body=operation==='reconcileMessageCreation'?{thread_id:f.threadId,recipient_agent_ids:['agent_research'],body:'Unsubmitted R1 recovery',refs:[],artifact_ids:[]}:{title:'Unsubmitted R1 recovery',description:''};
 const beforeA=await sqlSnapshot(f.a),beforeB=await sqlSnapshot(f.b);
 const headers={cookie:f.sessionCookie,'x-csrf-token':f.csrf,'idempotency-key':'r1_unsubmitted_recovery'};
 const lanes=[
  {name:'current human',target:f.a,headers,status:operation==='reconcileMessageCreation'?200:403,code:'FORBIDDEN'},
  {name:'missing CSRF',target:f.a,headers:{...headers,'x-csrf-token':''},status:403,code:'FORBIDDEN'},
  {name:'native bearer',target:f.a,headers:{authorization:'Bearer '+f.a.token,'idempotency-key':headers['idempotency-key']},status:400,code:'INVALID_REQUEST'},
  {name:'conflicting lanes',target:f.a,headers:{...headers,authorization:'Bearer '+f.a.token},status:400,code:'INVALID_REQUEST'},
  {name:'foreign workspace',target:f.b,headers,status:401,code:'UNAUTHENTICATED'},
 ];
 for(const lane of lanes){
  const response=await f.http(apiRequest(lane.target,path,'POST',body,lane.headers as Record<string,string>));
  expect(response.status,lane.name).toBe(lane.status);const value=await response.json() as {data?:unknown;error?:{code:string}};
  if(lane.status===200){expect(validateMessageCreationReconciliationResponse(value)).toBe(true);expect(value.data).toEqual({status:'unknown'});}
  else{expect(validateError(value)).toBe(true);expect(value.error?.code).toBe(lane.code);expect('data'in value).toBe(false);}
  expect((await sqlSnapshot(f.a)).digest,lane.name+' cannot mutate original workspace').toBe(beforeA.digest);
  expect((await sqlSnapshot(f.b)).digest,lane.name+' cannot mutate foreign workspace').toBe(beforeB.digest);
 }
},30_000);

// Preparation recognizes only existing creation authority; it never adds a domain grant.
for(const [operation,path] of [['prepareMessageCreation','/messages:prepare'],['prepareTaskCreation','/tasks:prepare']] as const)it(operation+' preserves exact R1 creation authority and isolates pending identity',async()=>{
 expect(unavailable.filter(route=>route.operation===operation)).toEqual([{path:'/v2/workspaces/{workspace_id}'+path,method:'POST',operation}]);
 const f=await acceptanceFixture(('r1_preparation_'+operation).toLowerCase());
 const body=operation==='prepareMessageCreation'?{thread_id:f.threadId,recipient_agent_ids:['agent_research'],body:'Unsubmitted R1 preparation',refs:[],artifact_ids:[]}:{title:'Unsubmitted R1 preparation',description:''};
 const headers={cookie:f.sessionCookie,'x-csrf-token':f.csrf,'idempotency-key':'r1_unsubmitted_preparation'};
 const beforeA=await sqlSnapshot(f.a),beforeB=await sqlSnapshot(f.b);
 const lanes=[
  {name:'missing CSRF',target:f.a,headers:{...headers,'x-csrf-token':''},status:403,code:'FORBIDDEN'},
  {name:'native bearer',target:f.a,headers:{authorization:'Bearer '+f.a.token,'idempotency-key':headers['idempotency-key']},status:400,code:'INVALID_REQUEST'},
  {name:'conflicting lanes',target:f.a,headers:{...headers,authorization:'Bearer '+f.a.token},status:400,code:'INVALID_REQUEST'},
  {name:'foreign workspace',target:f.b,headers,status:401,code:'UNAUTHENTICATED'},
 ];
 for(const lane of lanes){
  const response=await f.http(apiRequest(lane.target,path,'POST',body,lane.headers as Record<string,string>));
  expect(response.status,lane.name).toBe(lane.status);const value=await response.json() as {error:{code:string}};
  expect(validateError(value)).toBe(true);expect(value.error.code).toBe(lane.code);
  expect((await sqlSnapshot(f.a)).digest,lane.name+' cannot mutate original workspace').toBe(beforeA.digest);
  expect((await sqlSnapshot(f.b)).digest,lane.name+' cannot mutate foreign workspace').toBe(beforeB.digest);
 }
 const response=await f.http(apiRequest(f.a,path,'POST',body,headers));
 const value=await response.json() as {data?:{admission_id:string;expires_at:string};error?:{code:string}};
 if(operation==='prepareTaskCreation'){
  expect(response.status).toBe(403);expect(validateError(value)).toBe(true);expect(value.error?.code).toBe('FORBIDDEN');expect((await sqlSnapshot(f.a)).digest).toBe(beforeA.digest);
 }else{
  expect(response.status).toBe(200);expect(value.data?.admission_id).toMatch(/^event_[a-f0-9]{48}$/);expect(Number.isFinite(Date.parse(value.data!.expires_at))).toBe(true);
  const after=await sqlSnapshot(f.a);expect(after.schema).toEqual(beforeA.schema);expect(after.keys).toEqual(beforeA.keys);
  for(const [table,rows] of Object.entries(beforeA.tables))if(table!=='creation_admissions')expect(after.tables[table],table+' cannot change during preparation').toEqual(rows);
  expect(after.tables.creation_admissions).toHaveLength(beforeA.tables.creation_admissions.length+1);
  const replay=await f.http(apiRequest(f.a,path,'POST',body,headers));expect(replay.status).toBe(200);expect((await replay.json() as {data:unknown}).data).toEqual(value.data);expect((await sqlSnapshot(f.a)).digest).toBe(after.digest);
 }
 expect((await sqlSnapshot(f.b)).digest).toBe(beforeB.digest);
},30_000);
