import {it,expect,beforeEach} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import spec from '../../spec/openapi.json';
import {control} from '../helpers/auth';
import {acceptanceFixture,apiRequest,sqlSnapshot} from '../helpers/r1-acceptance';
import {validateError,validateMessage} from '../../src/http/generated/auth-validators.js';

beforeEach(async()=>{await control('reset');});
const unavailable=Object.entries(spec.paths).flatMap(([path,item])=>Object.entries(item).flatMap(([method,value])=>{
 const op=value as {operationId?:string;'x-r1-available'?:boolean};
 return op.operationId&&op['x-r1-available']!==true?[{path,method:method.toUpperCase(),operation:op.operationId}]:[];
}));
// These #25/#26 operations now exist, but recognition does not grant old R1 callers authority.
const identityOperations=new Set(['listAgents','createAgent','getAgent','patchAgent','archiveAgent','listCredentials','createCredential','revokeCredential','createRuntime','heartbeatRuntime']);
const identityBody:Record<string,unknown>={createRuntime:{label:'Denied runtime'},heartbeatRuntime:{expected_runtime_version:1},createAgent:{display_name:'Denied synthetic',description:'',work_role_ids:[]},patchAgent:{expected_agent_version:1,description:'Denied'},archiveAgent:{expected_agent_version:1,reason:'Denied'},createCredential:{agent_id:'agent_research',label:'Denied',scopes:['messages:read'],project_ids:null,expires_at:new Date(Date.now()+3600000).toISOString()},revokeCredential:{expected_credential_version:1,reason:'Denied'}};
for(const route of unavailable)it((identityOperations.has(route.operation)?'ungranted identity ':'unavailable ')+route.operation+' has no R1 mutation surface',async()=>{
 const f=await acceptanceFixture(('r1_unavailable_'+route.operation).toLowerCase());
 const path=route.path.replace('/v2/workspaces/{workspace_id}','').replace(/\{[^}]+\}/g,'unavailable_fixture');
 const beforeA=await sqlSnapshot(f.a),beforeB=await sqlSnapshot(f.b);
 const response=await f.http(apiRequest(f.a,path,route.method,['GET','HEAD'].includes(route.method)?undefined:identityBody[route.operation]??{},{cookie:f.sessionCookie,'x-csrf-token':f.csrf,'idempotency-key':'unavailable',...(route.operation==='heartbeatRuntime'?{'x-runtime-token':btoa('x'.repeat(32)).replace(/=+$/,'')}:{})}));
 expect(response.status,'unavailable or ungranted route must fail without effects').toBe(identityOperations.has(route.operation)?403:404);
 const value=await response.json() as {error:{code:string}};expect(validateError(value)).toBe(true);expect(value.error.code).toBe(identityOperations.has(route.operation)?'FORBIDDEN':'NOT_FOUND');
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
