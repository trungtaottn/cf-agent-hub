/** Fixed synthetic setup only; no native CLI process or installed authority. */
import {fixture} from '../environment';
import {prepareBootstrap,canonicalJson,sha256} from '../../../src/config/bootstrap';
import {clientOperations} from '../../../src/http/generated/client-operations';
import type {Task,TaskCommandResult,RuntimeIssue} from '../../../src/http/dto';
export async function prepareObserverFixture(name:string,bearer:string){
 const raw=await fixture(name);
 raw.config.static_credential_refs[0].scopes=['workspace:read','agents:read','tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:claim','tasks:execute','runtimes:manage'];
 raw.config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_reviewer',display_name:'Synthetic reviewer'});
 raw.config.workspace_policies[0].notification_destinations=[];
 raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:1,task_retry_limit:0,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
 raw.bundle.credentials[0].token_sha256=await sha256(bearer);raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 return {...raw,input:await prepareBootstrap(raw.config,raw.bundle,'ws_example')};
}
export async function seedObserverFixture(stub:{fetch(request:Request):Promise<Response>},bearer:string){
 let requests=0;
 async function call<T>(op:keyof typeof clientOperations,body:unknown,ids:Record<string,string>={},proof?:string):Promise<T>{
  const spec=clientOperations[op];let path=spec.path.replace('{workspace_id}','ws_example');for(const[k,v]of Object.entries(ids))path=path.replace('{'+k+'}',v);
  const response=await stub.fetch(new Request('https://hub.example.invalid'+path,{method:spec.method,headers:{authorization:'Bearer '+bearer,'content-type':'application/json','idempotency-key':'observer_seed_'+(++requests),...(proof?{'x-runtime-token':proof}:{})},body:JSON.stringify(body)}));
  return await readObserverFixtureResponse(response,spec.status) as T;
 }
 const backlog=await call<Task>('createTask',{title:'Observer backlog source fixture',description:'Synthetic prior setup'});
 const running=await call<Task>('createTask',{title:'Observer active source fixture',description:'Synthetic prior setup'});
 const runtime=await call<RuntimeIssue>('createRuntime',{label:'Observer source runtime'});
 const ready=await call<TaskCommandResult>('readyTask',{expected_version:running.task_version},{task_id:running.id});
 const claimed=await call<TaskCommandResult>('claimTask',{expected_version:ready.task.task_version,runtime_instance_id:runtime.runtime.id},{task_id:running.id},runtime.runtime_token!);
 if(!claimed.run||!runtime.runtime_token)throw Error('LOCAL_OBSERVER_FIXTURE_REJECTED');
 return {taskId:backlog.id,runId:claimed.run.id,setupRequests:requests};
}
export {operator} from '../environment';
export {canonicalJson,sha256} from '../../../src/config/bootstrap';

/** Own the response through bounded parsing and observed cleanup, including failure. */
export async function readObserverFixtureResponse(response:Response,expectedStatus:number):Promise<unknown>{
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  if(response.status!==expectedStatus||!response.body)throw Error('LOCAL_OBSERVER_FIXTURE_REJECTED');
  reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  for(;;){const value=await reader.read();if(value.done)break;size+=value.value.byteLength;if(size>65536)throw Error('LOCAL_OBSERVER_FIXTURE_REJECTED');chunks.push(value.value);}
  const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}
  return (JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes)) as {data:unknown}).data;
 }finally{
  if(reader){try{await reader.cancel();}finally{reader.releaseLock();}}
  else if(response.body)await response.body.cancel();
 }
}
