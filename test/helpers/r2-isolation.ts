import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import entry from '../../src/index';
import {fixture,operator} from './environment';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import {login,request as authRequest} from './auth';
import type {Scope} from '../../src/http/dto';
export const isolationProjectCases={unrestricted:null,none:[],allowed:['project_a'],foreign:['project_b']} as const;
/** Real unavailable capability, not a synthetic authorization/feature-toggle bypass. */
export const isolationDisabledFeature={feature:'approvals',path:'approvals',method:'GET'} as const;
export const isolationTokens={reader:'A'.repeat(43),other:'B'.repeat(42)+'A',searchOnly:'C'.repeat(42)+'A',foreign:'Q'.repeat(43)};
/** Two independently installed mapped DOs; all HTTP callers use real bearer/session verification. */
export async function r2IsolationFixture(name:string,options:{human?:boolean;configure?:(input:Awaited<ReturnType<typeof fixture>>)=>void}={}){
 const raw=await fixture(name),config=raw.config,bundle=raw.bundle;
 const read=['workspace:read','search:read','tasks:read','messages:read','messages:send','artifacts:read','runtimes:manage'] as const;
 config.human_grants[0].scopes=[...new Set([...config.human_grants[0].scopes,...read.filter(scope=>scope!=='runtimes:manage'),'tasks:create','tasks:edit','tasks:schedule'] as typeof config.human_grants[0]['scopes'])];
 config.workspace_policies[0].notification_destinations=[];
 options.configure?.(raw);
 const base=config.static_credential_refs[0];base.scopes=[...read];
 config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_other',display_name:'Other synthetic participant'});
 config.static_credential_refs.push({...base,credential_id:'credential_other',agent_id:'agent_other'},{...base,credential_id:'credential_search_only',scopes:['search:read']});
 bundle.credentials[0].token_sha256=await sha256(isolationTokens.reader);
 bundle.credentials.push({...bundle.credentials[0],credential_id:'credential_other',token_sha256:await sha256(isolationTokens.other)},{...bundle.credentials[0],credential_id:'credential_search_only',token_sha256:await sha256(isolationTokens.searchOnly)});
 config.workspace_catalog.push({workspace_id:'ws_other',object_name:name+'_other'});
 for(const key of ['human_grants','static_participants','static_credential_refs','workspace_policies'] as const){const list=config[key] as Array<{workspace_id:string}>;list.push(...list.filter(x=>x.workspace_id==='ws_example').map(x=>({...structuredClone(x),workspace_id:'ws_other'})));}
 config.authentication.allowed_origins.push('https://other.example.invalid');config.authentication.redirect_uris.push({workspace_id:'ws_other',redirect_uri:'https://other.example.invalid/v2/workspaces/ws_other/auth/callback'});
 for(const credential of bundle.credentials.slice())bundle.credentials.push({...credential,workspace_id:'ws_other',token_sha256:await sha256(credential.credential_id==='credential_research_1'?isolationTokens.foreign:credential.credential_id==='credential_other'?'D'.repeat(42)+'A':'E'.repeat(42)+'A')});
 bundle.config_digest=await sha256(canonicalJson(config));
 const a={token:isolationTokens.reader,id:'ws_example',name,origin:'https://hub.example.invalid',stub:env.WORKSPACE.getByName(name)};
 const b={token:isolationTokens.foreign,id:'ws_other',name:name+'_other',origin:'https://other.example.invalid',stub:env.WORKSPACE.getByName(name+'_other')};
 for(const target of [a,b])await target.stub.reconcileConfiguration({...operator(),workspaceId:target.id},await prepareBootstrap(config,bundle,target.id));
 const bindings={...env,DEPLOYMENT_CONFIG:JSON.stringify(config)} as Env;
 let sessionCookie='',csrf='';
 if(options.human!==false){const session=await login(a.stub);if(session.response.status!==302)throw Error('synthetic signed login failed');await session.response.arrayBuffer();sessionCookie=session.cookie;const auth=await a.stub.fetch(authRequest('session','GET',undefined,sessionCookie));csrf=(await auth.json() as {data:{csrf_token:string}}).data.csrf_token;}
 const request=(path:string,options:{target?:typeof a;token?:string;human?:boolean;method?:string;body?:unknown;headers?:Record<string,string>}={})=>{
  const target=options.target??a,method=options.method??'GET';return new Request(target.origin+'/v2/workspaces/'+target.id+'/'+path,{method,headers:{...(options.human?{cookie:sessionCookie,origin:target.origin,'x-csrf-token':csrf}:{authorization:'Bearer '+(options.token??isolationTokens.reader)}),...(options.body===undefined?{}:{'content-type':'application/json','idempotency-key':crypto.randomUUID()}),...options.headers},...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});
 };
 const send=(...args:Parameters<typeof request>)=>entry.fetch(request(...args),bindings);
 const runtime=async(token:string,label:string)=>{const response=await send('runtimes',{token,method:'POST',body:{label}});if(response.status!==201)throw Error('synthetic runtime failed '+response.status);return (await response.json() as {data:{runtime:{id:string};runtime_token:string}}).data;};
 const runtimes={reader:await runtime(isolationTokens.reader,'Reader runtime'),other:await runtime(isolationTokens.other,'Other runtime')};
 const setGrant=async(scopes:readonly Scope[],projects:string[]|null=null,credential='credential_research_1')=>runInDurableObject(a.stub,(_o,state)=>{state.storage.sql.exec('UPDATE native_credentials SET scopes_json=?,project_ids_json=? WHERE credential_id=?',JSON.stringify(scopes),JSON.stringify(projects),credential);});
 const revokeOwner=()=>runInDurableObject(a.stub,(_o,state)=>{state.storage.sql.exec("UPDATE static_agents SET status='archived' WHERE agent_id='agent_research'");});
 return {a,b,raw,bindings,request,send,setGrant,revokeOwner,runtimes,sessionCookie,csrf};
}
export function seedSearchTask(s:DurableObjectStorage,id:string,createdAt:number,options:{workspace?:string;project?:string|null;title?:string;description?:string;state?:'backlog'|'cancelled'}={}){
 s.sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,project_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES(?,?,?,?,?,1,0,?,0,2,'[]',?,?)",id,options.workspace??'ws_example',options.title??'needle '+id,options.description??'',options.state??'backlog',options.project===undefined?'project_a':options.project,createdAt,createdAt);
}
export function seedSearchMessage(s:DurableObjectStorage,id:string,createdAt:number,options:{workspace?:string;body?:string;participant?:string;refs?:unknown[]}={}){
 const workspace=options.workspace??'ws_example',thread='thread_'+id,participant=options.participant??'agent_research';
 s.sql.exec("INSERT INTO threads VALUES(?,?,?,?)",thread,workspace,'Synthetic thread',createdAt);
 s.sql.exec("INSERT INTO thread_participants(thread_id,participant_kind,participant_id) VALUES(?,'agent',?)",thread,participant);
 s.sql.exec("INSERT INTO messages VALUES(?,?,?,'agent',?,?,?, ?,?)",id,workspace,thread,participant,participant,options.body??'needle '+id,JSON.stringify(options.refs??[]),createdAt);
}
export function seedSearchArtifact(s:DurableObjectStorage,id:string,createdAt:number,options:{workspace?:string;filename?:string;taskId?:string;committed?:boolean}={}){
 const ws=options.workspace??'ws_example',task=options.taskId??null,sha='a'.repeat(64),generation='generation_'+id;
 s.sql.exec("INSERT INTO artifacts(id,workspace_id,task_id,owner_kind,owner_principal_id,owner_agent_id,authority_epoch,artifact_version,filename,media_type,byte_size,sha256,status,created_at,expires_at) VALUES(?,?,?,'agent','agent_research','agent_research',1,1,?,'text/plain',5,?,'staged',?,?)",id,ws,task,options.filename??'needle '+id,sha,createdAt,createdAt+900000);
 if(options.committed===false)return;
 s.sql.exec("INSERT INTO artifact_generations(id,workspace_id,artifact_id,object_key,expected_sha256,expected_byte_size,observed_sha256,observed_byte_size,state,admission_epoch,admission_generation,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,5,?,5,'committed',1,0,?,?,?)",generation,ws,id,'synthetic_object_'+id,sha,sha,createdAt+900000,createdAt,createdAt);
 s.sql.exec("UPDATE artifacts SET status='committed',committed_at=?,expires_at=NULL,committed_generation_id=? WHERE id=?",createdAt,generation,id);
 if(task)s.sql.exec("INSERT INTO artifact_associations VALUES(?,?,'task',?)",ws,id,task);
}
