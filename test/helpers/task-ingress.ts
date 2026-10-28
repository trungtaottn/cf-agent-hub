import {env} from 'cloudflare:workers';
import {fixture,operator} from './environment';
import {login,request as authRequest} from './auth';
import {sha256,canonicalJson,prepareBootstrap} from '../../src/config/bootstrap';
import entry from '../../src/index';
export const NATIVE_TOKEN='A'.repeat(43);
export async function ingressFixture(name:string,delegation=false,review=false){
 const raw=await fixture(name);raw.config.human_grants[0].scopes=[...raw.config.human_grants[0].scopes,'tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:cancel','artifacts:read'];
 raw.config.static_credential_refs[0].scopes=['workspace:read','tasks:read','tasks:claim','tasks:execute','tasks:cancel','runtimes:manage'];raw.bundle.credentials[0].token_sha256=await sha256(NATIVE_TOKEN);
 raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
 if(review){
  raw.config.human_grants[0].scopes=[...new Set([...raw.config.human_grants[0].scopes,'tasks:review','events:read'] as const)];
  const credential=raw.config.static_credential_refs[0];credential.scopes.push('tasks:review','artifacts:read','events:read');
  raw.config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_reviewer',display_name:'Independent reviewer'});
  raw.config.static_credential_refs.push({...credential,credential_id:'credential_reviewer',agent_id:'agent_reviewer'});
  raw.bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_reviewer',token_sha256:await sha256('B'.repeat(42)+'A')});
 }
 if(delegation){raw.config.human_grants[0].scopes.push('credentials:manage');Object.assign(raw.config.human_grants[0],{delegable_native_scopes:['tasks:read','tasks:claim','tasks:execute','runtimes:manage']});}
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),input);
 const session=await login(stub);if(session.response.status!==302)throw Error('synthetic login '+session.response.status);await session.response.text();const sessionResponse=await stub.fetch(authRequest('session','GET',undefined,session.cookie));if(sessionResponse.status!==200)throw Error('synthetic session '+sessionResponse.status);const csrf=(await sessionResponse.json() as {data:{csrf_token:string}}).data.csrf_token;
 const bindings={...env,DEPLOYMENT_CONFIG:JSON.stringify(raw.config),WORKSPACE:{getByName:()=>stub}} as unknown as Env;
 const req=(path:string,method='GET',body?:unknown,key='key',proof?:string,humanLane=false)=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/'+path,{method,headers:{...(humanLane?{cookie:session.cookie,origin:'https://hub.example.invalid','x-csrf-token':csrf}:{authorization:'Bearer '+NATIVE_TOKEN}),...(proof?{'x-runtime-token':proof}:{}),...(body===undefined?{}:{'content-type':'application/json','idempotency-key':key})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const send=(...args:Parameters<typeof req>)=>entry.fetch(req(...args),bindings);
 return {stub,name,raw,input,req,send,bindings};
}
export async function ingressReady(f:Awaited<ReturnType<typeof ingressFixture>>){const create=await f.send('tasks','POST',{title:'Human-scheduled work',description:''},'create',undefined,true);if(create.status!==201)throw Error('create '+create.status);const {data:task}=await create.json() as {data:{id:string}};const ready=await f.send('tasks/'+task.id+':ready','POST',{expected_version:1},'ready',undefined,true);if(ready.status!==200)throw Error('ready '+ready.status);await ready.arrayBuffer();const enrolled=await f.send('runtimes','POST',{label:'Native runtime'},'enroll');if(enrolled.status!==201)throw Error('enroll '+enrolled.status);const {data}=await enrolled.json() as {data:{runtime:{id:string};runtime_token:string}};return {taskId:task.id,runtimeId:data.runtime.id,proof:data.runtime_token};}
