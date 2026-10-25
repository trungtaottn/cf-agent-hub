import {expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import worker from '../../src/index';
import {fixture,operator} from './environment';
import {control,cookie} from './auth';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import {neutralProfile} from '../../src/config/profile';
import * as validators from '../../src/http/generated/auth-validators.js';
import {MUTATION_COUNTS,routeExpectation} from '../../scripts/lib/release-policy.mjs';

type Row=Record<string,unknown>;
type Stub=DurableObjectStub<import('../../src/index').WorkspaceDO>;
export interface Target {id:string;name:string;origin:string;stub:Stub;token:string;}
export interface SqlSnapshot {schema:Row[];tables:Record<string,Row[]>;keys:Record<string,string[]>;digest:string;}
export interface AcceptanceFixture {
 a:Target;b:Target;http:(request:Request)=>Promise<Response>;
 sessionCookie:string;csrf:string;threadId:string;messageId:string;
}
const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
const endpoint:Record<string,[string,string]>={
 getWorkspace:['GET',''],createMessage:['POST','/messages'],getInbox:['GET','/inbox'],getThread:['GET','/threads/'],ackMessages:['POST','/messages:ack'],listEvents:['GET','/events'],
 startAuth:['POST','/auth/start'],getAuthSession:['GET','/auth/session'],logoutAuth:['POST','/auth/logout'],callbackAuth:['GET','/auth/callback'],
 getConfiguration:['GET','/configuration'],getProfile:['GET','/profile'],putProfile:['PUT','/profile'],previewProfile:['POST','/profile:preview'],exportProfile:['GET','/profile:export'],
 getPreferences:['GET','/preferences'],putPreferences:['PUT','/preferences'],getOperations:['GET','/operations'],getReadiness:['GET','/readiness'],getLiveness:['GET','/health/live']
};
export function apiRequest(target:Target,path:string,method='GET',body?:unknown,headers:Record<string,string>={}):Request {
 const url=target.origin+(path==='/health/live'?path:'/v2/workspaces/'+target.id+path);
 return new Request(url,{method,redirect:'manual',headers:{origin:target.origin,...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
export async function sqlSnapshot(target:Target):Promise<SqlSnapshot>{
 const data=await runInDurableObject(target.stub,(_instance,state)=>{
  const schema=state.storage.sql.exec<Record<string,SqlStorageValue>>("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").toArray();
  const tables:Record<string,Row[]>={},keys:Record<string,string[]>={};
  for(const entry of schema.filter(x=>x.type==='table')){
   const name=String(entry.name);
   tables[name]=state.storage.sql.exec<Record<string,SqlStorageValue>>('SELECT * FROM '+quote(name)).toArray().sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)));
   keys[name]=name==='sqlite_sequence'?['name']:state.storage.sql.exec<{name:string;pk:number}>('PRAGMA table_info('+quote(name)+')').toArray().filter(x=>x.pk>0).sort((a,b)=>a.pk-b.pk).map(x=>x.name);
  }
  return {schema,tables,keys};
 });
 return {...data,digest:await sha256(canonicalJson(data))};
}
export async function beginOidc(f:Pick<AcceptanceFixture,'http'>,target:Target){
 const response=await f.http(apiRequest(target,'/auth/start','POST',{return_path:'/overview'}));
 expect(response.status,'OIDC fixture start must use the actual route').toBe(200);
 const value=await response.json() as {data:{authorization_url:string}};
 expect(validators.validateAuthStartData(value.data)).toBe(true);
 const loginCookie=cookie(response);expect(loginCookie.startsWith('cfhub_login=')).toBe(true);
 return {authorizationUrl:value.data.authorization_url,loginCookie};
}
export async function oidcCallbackRequest(f:Pick<AcceptanceFixture,'http'>,source:Target,target=source,mode='normal',previousCookie=''){
 const attempt=await beginOidc(f,source);
 const issued=await control('issue',{authorization_url:attempt.authorizationUrl,mode,now:Date.now()});
 expect(issued.status).toBe(200);const {code}=await issued.json() as {code:string};
 const state=new URL(attempt.authorizationUrl).searchParams.get('state')!;
 return apiRequest(target,'/auth/callback?'+new URLSearchParams({code,state}),'GET',undefined,{cookie:[attempt.loginCookie,previousCookie].filter(Boolean).join('; ')});
}
export async function acceptanceFixture(name:string):Promise<AcceptanceFixture>{
 const raw=await fixture(name),config=raw.config,bundle=raw.bundle;
 config.workspace_policies[0].notification_destinations=[];
 config.workspace_catalog.push({workspace_id:'ws_other',object_name:name+'_other'});
 for(const key of ['human_grants','static_participants','static_credential_refs','workspace_policies'] as const){
  const list=config[key] as Array<{workspace_id:string}>;
  list.push(...list.filter(x=>x.workspace_id==='ws_example').map(x=>({...structuredClone(x),workspace_id:'ws_other'})));
 }
 const otherOrigin='https://other.example.invalid';config.authentication.allowed_origins.push(otherOrigin);
 config.authentication.redirect_uris.push({workspace_id:'ws_other',redirect_uri:otherOrigin+'/v2/workspaces/ws_other/auth/callback'});
 bundle.credentials[0].token_sha256=await sha256('A'.repeat(43));
 bundle.credentials.push({...bundle.credentials[0],workspace_id:'ws_other',token_sha256:await sha256('Q'.repeat(43))});
 bundle.config_digest=await sha256(canonicalJson(config));
 const a:Target={id:'ws_example',name,origin:'https://hub.example.invalid',stub:env.WORKSPACE.getByName(name),token:'A'.repeat(43)};
 const b:Target={id:'ws_other',name:name+'_other',origin:otherOrigin,stub:env.WORKSPACE.getByName(name+'_other'),token:'Q'.repeat(43)};
 for(const target of [a,b])await target.stub.reconcileConfiguration({...operator(),workspaceId:target.id},await prepareBootstrap(config,bundle,target.id));
 const configured={...env,DEPLOYMENT_CONFIG:JSON.stringify(config)} as unknown as Parameters<typeof worker.fetch>[1];
 const http=(request:Request)=>worker.fetch(request,configured);
 const signed=await http(await oidcCallbackRequest({http},a));expect(signed.status,'OIDC fixture must complete real signed provider flow').toBe(302);
 const sessionCookie=cookie(signed,'cfhub_session');expect(sessionCookie.startsWith('cfhub_session=')).toBe(true);
 const session=await http(apiRequest(a,'/auth/session','GET',undefined,{cookie:sessionCookie}));expect(session.status).toBe(200);
 const auth=await session.json() as {data:{csrf_token:string}};expect(validators.validateAuthSession(auth.data)).toBe(true);
 const seeded=await http(apiRequest(a,'/messages','POST',{recipient_agent_ids:['agent_research'],body:'R1 acceptance seed',refs:[],artifact_ids:[]},{cookie:sessionCookie,'x-csrf-token':auth.data.csrf_token,'idempotency-key':'acceptance_seed'}));
 expect(seeded.status,'seed must be actual atomic HTTP message acceptance').toBe(201);
 const message=await seeded.json() as {data:{id:string;thread_id:string}};expect(validators.validateMessage(message.data)).toBe(true);
 for(const target of [a,b])await runInDurableObject(target.stub,(_o,state)=>{state.storage.sql.exec('INSERT OR IGNORE INTO scheduler_state (id,dirty,generation) VALUES (1,0,0)');expect(state.storage.sql.exec('SELECT dirty FROM scheduler_state WHERE id=1').one().dirty).toBe(0);expect(state.storage.sql.exec('SELECT count(*) AS n FROM outbox').one().n).toBe(0);});
 return {a,b,http,sessionCookie,csrf:auth.data.csrf_token,threadId:message.data.thread_id,messageId:message.data.id};
}
export async function prepareCell(f:AcceptanceFixture,operation:string,lane:string):Promise<{request:Request;target:Target}>{
 const target=lane==='wrong_workspace'?f.b:f.a;
 if(lane==='expired_session')await runInDurableObject(f.a.stub,(_o,state)=>{
  const now=Date.now();state.storage.sql.exec('UPDATE sessions SET created_at=?,expires_at=?',now-60000,now-1);
 });
 if(lane==='ungranted_human'&&operation!=='callbackAuth')await runInDurableObject(f.a.stub,(_o,state)=>state.storage.sql.exec('UPDATE human_grants SET enabled=0'));
 if(lane==='revoked_native')await runInDurableObject(f.a.stub,(_o,state)=>state.storage.sql.exec('UPDATE native_credentials SET enabled=0'));
 if(operation==='callbackAuth'){
  if(lane==='valid_human'||lane==='expired_session')return {target,request:await oidcCallbackRequest(f,f.a,f.a,'normal',f.sessionCookie)};
  if(lane==='ungranted_human')return {target,request:await oidcCallbackRequest(f,f.a,f.a,'ungranted')};
  if(lane==='wrong_workspace')return {target,request:await oidcCallbackRequest(f,f.a,f.b)};
 }
 const [method,suffix]=endpoint[operation];let path=suffix;
 let body:unknown;
 if(operation==='getThread')path+=encodeURIComponent(f.threadId);
 if(operation==='createMessage')body={thread_id:f.threadId,recipient_agent_ids:['agent_research'],body:'R1 acceptance matrix',refs:[],artifact_ids:[]};
 if(operation==='ackMessages')body={message_ids:[f.messageId]};
 if(operation==='startAuth')body={return_path:'/overview'};
 if(operation==='logoutAuth')body={};
 if(operation==='putProfile'||operation==='previewProfile')body={expected_profile_revision:1,profile:{...structuredClone(neutralProfile),display_name:'R1 acceptance profile'}};
 if(operation==='putPreferences')body={expected_preferences_revision:0,preferences:{contract_revision:'0.1',theme:'dark',density:'compact',default_view:'overview'}};
 const headers:Record<string,string>={'idempotency-key':'acceptance_matrix','x-csrf-token':f.csrf};
 if(['valid_native','revoked_native','conflicting_lanes'].includes(lane))headers.authorization='Bearer '+f.a.token;
 if(!['valid_native','revoked_native'].includes(lane))headers.cookie=f.sessionCookie;
 if(operation==='startAuth'&&lane==='wrong_workspace')headers.origin=f.a.origin;
 if(operation==='callbackAuth')path+='?'+new URLSearchParams({code:'synthetic_unused_code',state:'A'.repeat(43)});
 return {target,request:apiRequest(target,path,method,body,headers)};
}

function rowKey(row:Row,keys:string[]){return canonicalJson(keys.length?keys.map(key=>row[key]):row);}
export function changedRows(before:SqlSnapshot,after:SqlSnapshot,table:string){
 const keys=before.keys[table]??after.keys[table]??[];
 const old=new Map((before.tables[table]??[]).map(row=>[rowKey(row,keys),row]));
 const fresh=new Map((after.tables[table]??[]).map(row=>[rowKey(row,keys),row]));
 return {inserted:[...fresh].filter(([key])=>!old.has(key)).map(([,row])=>row),deleted:[...old].filter(([key])=>!fresh.has(key)).map(([,row])=>row),updated:[...fresh].filter(([key,row])=>old.has(key)&&canonicalJson(old.get(key))!==canonicalJson(row)).map(([key,row])=>({before:old.get(key)!,after:row}))};
}
/** Observe actual row transitions. Never copy expected counters into observations. */
export function mutationCounts(before:SqlSnapshot,after:SqlSnapshot,target:Target):Record<string,number>{
 const counts=Object.fromEntries(MUTATION_COUNTS.map(key=>[key,0])) as Record<string,number>;
 if(canonicalJson(before.schema)!==canonicalJson(after.schema))counts.unexpected_changes++;
 const inserts:Record<string,string>={login_attempts:'login_attempts_inserted',sessions:'sessions_inserted',messages:'messages_inserted',threads:'threads_inserted',thread_participants:'participants_inserted',inbox:'inbox_inserted',events:'events_inserted',idempotency_outcomes:'outcomes_inserted',outbox:'outbox_inserted'};
 const fields=(a:Row,b:Row)=>Object.keys({...a,...b}).filter(key=>canonicalJson(a[key])!==canonicalJson(b[key]));
 for(const table of new Set([...Object.keys(before.tables),...Object.keys(after.tables)])){
  const delta=changedRows(before,after,table);counts.unexpected_changes+=delta.deleted.length;
  for(const row of [...delta.inserted,...delta.updated.map(x=>x.after)])if('workspace_id'in row&&row.workspace_id!==target.id)counts.unexpected_changes++;
  for(const row of delta.inserted){
   if(inserts[table])counts[inserts[table]]++;
   else if(table==='profiles'||table==='preferences'){counts[table==='profiles'?'profile_revisions':'preference_revisions']++;if(row.version!==2&&table==='profiles'||row.version!==1&&table==='preferences')counts.unexpected_changes++;}
   else counts.unexpected_changes++;
   if(table==='sessions'&&(row.revoked_at!==null||row.principal_id!=='human_operator'||row.auth_epoch!==1))counts.unexpected_changes++;
  }
  for(const change of delta.updated){
   const a=change.before,b=change.after,changed=fields(a,b);let allowed:string[]=[];
   if(table==='sessions'&&a.revoked_at===null&&typeof b.revoked_at==='number'){counts.sessions_revoked++;allowed=['revoked_at'];}
   if(table==='login_attempts'&&a.consumed_at===null&&typeof b.consumed_at==='number'&&b.pkce_verifier===''&&b.nonce===''){counts.login_attempts_consumed++;allowed=['consumed_at','pkce_verifier','nonce'];}
   if(table==='inbox'&&a.acknowledged_at===null&&typeof b.acknowledged_at==='number'){counts.inbox_acknowledged++;allowed=['acknowledged_at'];}
   if(table==='profiles'||table==='preferences'){
    counts[table==='profiles'?'profile_revisions':'preference_revisions']++;
    if(Number(b.version)!==Number(a.version)+1)counts.unexpected_changes++;
    allowed=table==='profiles'?['version','document_json','updated_at','updated_by']:['version','document_json','updated_at'];
   }
   if(table==='outbox')counts.delivery_attempts_started+=Math.max(0,Number(b.attempts)-Number(a.attempts));
   // The AUTOINCREMENT high-water advances only for the observed accepted event.
   if(table==='sqlite_sequence'&&a.name==='events'&&b.name==='events'&&Number(b.seq)-Number(a.seq)===counts.events_inserted)allowed=['seq'];
   if(!allowed.length||changed.some(key=>!allowed.includes(key)))counts.unexpected_changes++;
  }
 }
 return counts;
}
export async function assertResponse(response:Response,operation:string,lane:string,f:AcceptanceFixture,target:Target):Promise<unknown>{
 const expected=routeExpectation(operation,lane)!;
 expect(response.status,operation+' / '+lane+' exact policy HTTP outcome').toBe(expected.status);
 expect(response.headers.get('cache-control')).toBe('no-store');
 if(expected.status===302){
  expect(response.headers.get('location')).toBe('/overview');
  const issued=response.headers.getSetCookie().find(value=>value.startsWith('cfhub_session='));
  expect(issued).toBeDefined();for(const flag of ['Secure','HttpOnly','SameSite=Lax','Path=/'])expect(issued?.includes(flag)).toBe(true);
  return null;
 }
 expect(response.headers.get('content-type')).toContain('application/json');
 const value=await response.json() as Record<string,unknown>;
 if(expected.status>=400){
  expect(validators.validateError(value)).toBe(true);expect((value.error as Row).code).toBe(expected.error_code);
  expect('data'in value).toBe(false);
  expect(response.headers.getSetCookie().some(x=>/^cfhub_session=[^;]/.test(x))).toBe(false);
  return value;
 }
 if(operation==='getLiveness'){expect(validators.validateLiveness(value)).toBe(true);expect(value).toEqual({status:'alive'});return value;}
 expect(Object.keys(value).sort()).toEqual(['getInbox','getThread','listEvents'].includes(operation)?['data','page','request_id']:['data','request_id']);
 expect(typeof value.request_id).toBe('string');expect(String(value.request_id).length).toBeGreaterThan(0);
 const data=value.data as Row;
 const validate:Record<string,(value:unknown)=>boolean>={getWorkspace:validators.validateWorkspace,startAuth:validators.validateAuthStartData,getAuthSession:validators.validateAuthSession,logoutAuth:validators.validateAuthLogoutData,getConfiguration:validators.validateConfiguration,getProfile:validators.validateProfileData,putProfile:validators.validateProfileData,previewProfile:validators.validateProfilePreview,exportProfile:validators.validateProfileExport,getPreferences:validators.validatePreferencesData,putPreferences:validators.validatePreferencesData,getOperations:validators.validateOperations,getReadiness:validators.validateReadiness,createMessage:validators.validateMessage};
 if(validate[operation])expect(validate[operation](data),'canonical '+operation+' DTO').toBe(true);
 if(['getInbox','getThread','listEvents'].includes(operation)){
  expect(Array.isArray(data)).toBe(true);
  for(const row of data as unknown as Row[]){expect((operation==='listEvents'?validators.validateEvent:validators.validateMessage)(row)).toBe(true);expect(row.workspace_id).toBe(target.id);if(operation==='getThread')expect(row.thread_id).toBe(f.threadId);}
  expect(value.page).toEqual({next_cursor:null,has_more:false});
 }
 const expectedActor=lane==='valid_native'?{kind:'agent',principal_id:'agent_research',agent_id:'agent_research'}:{kind:'human',principal_id:'human_operator',agent_id:null};
 if(operation==='getWorkspace'){expect(data.id).toBe(target.id);expect(data.actor).toEqual(expectedActor);}
 if(operation==='createMessage'){expect(data.workspace_id).toBe(target.id);expect(data.thread_id).toBe(f.threadId);expect(data.sender).toEqual(expectedActor);expect(data.recipient_agent_ids).toEqual(['agent_research']);expect(data.body).toBe('R1 acceptance matrix');}
 if(operation==='getAuthSession')expect((data.actor as Row).principal_id).toBe('human_operator');
 if(operation==='getOperations'||operation==='getConfiguration')expect(data.config_epoch).toBe(1);
 if(operation==='putProfile')expect(data.profile_revision).toBe(2);
 if(operation==='putPreferences')expect(data.preferences_revision).toBe(1);
 if(operation==='ackMessages'){expect(Object.keys(data).sort()).toEqual(['acknowledged_ids','already_acknowledged_ids']);expect(data).toEqual({acknowledged_ids:[f.messageId],already_acknowledged_ids:[]});}
 return data;
}
