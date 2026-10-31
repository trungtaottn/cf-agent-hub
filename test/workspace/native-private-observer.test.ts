import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import {systemClock,systemEntropy} from '../../src/workspace/context';
import {clientOperations} from '../../src/http/generated/client-operations';
import type {Task,TaskCommandResult,RuntimeIssue} from '../../src/http/dto';
import {createSourceObserverRegistry} from '../helpers/native-observer/registry';
import {createPrivateNativeObserver,readPrivateObserverCapture} from '../helpers/native-observer/adapter';
const bearer='A'.repeat(43),workspaceId='ws_example';
async function configured(name:string,step:string){
 const raw=await fixture(name);
 raw.config.static_credential_refs[0].scopes=['workspace:read','agents:read','tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:claim','tasks:execute','runtimes:manage'];
 raw.config.static_participants.push({workspace_id:workspaceId,agent_id:'agent_reviewer',display_name:'Synthetic reviewer'});
 raw.config.workspace_policies[0].notification_destinations=[];
 raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:1,task_retry_limit:0,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
 raw.bundle.credentials[0].token_sha256=await sha256(bearer);
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const input=await prepareBootstrap(raw.config,raw.bundle,workspaceId),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),input);
 let serial=0;
 async function call<T>(op:keyof typeof clientOperations,body:unknown,ids:Record<string,string>={},proof?:string):Promise<T>{
  const spec=clientOperations[op];let path=spec.path.replace('{workspace_id}',workspaceId);for(const [key,value]of Object.entries(ids))path=path.replace('{'+key+'}',value);
  const response=await stub.fetch(new Request('https://hub.example.invalid'+path,{method:spec.method,headers:{authorization:'Bearer '+bearer,'content-type':'application/json','idempotency-key':'observer_fixture_'+(++serial),...(proof?{'x-runtime-token':proof}:{})},body:JSON.stringify(body)}));
  expect(response.status).toBe(spec.status);const result=await response.json() as {data:T};return result.data;
 }
 let target:string|null=step==='getAgent'?'agent_reviewer':null;
 if(step==='getTask'||step==='getRun'){
  const task=await call<Task>('createTask',{title:'Observer source task',description:'Prior independent setup'});target=task.id;
  if(step==='getRun'){
   const runtime=await call<RuntimeIssue>('createRuntime',{label:'Observer source runtime'});
   const ready=await call<TaskCommandResult>('readyTask',{expected_version:task.task_version},{task_id:task.id});
   const claimed=await call<TaskCommandResult>('claimTask',{expected_version:ready.task.task_version,runtime_instance_id:runtime.runtime.id},{task_id:task.id},runtime.runtime_token!);
   expect(claimed.run).not.toBeNull();target=claimed.run!.id;
  }
 }
 const generation=await runInDurableObject(stub,(_instance,state)=>state.storage.sql.exec<{generation:number}>('SELECT generation FROM maintenance_state WHERE id=1').one().generation);
 const binding={step_id:'success/'+step,invocation_id:'invocation_source',prepared_request_sha256:await sha256(canonicalJson({step,target})),credential_handle:'source_credential',workspace_id:workspaceId,object_name:name,credential_id:'credential_research_1',agent_id:'agent_research',bearer,expected_epoch:1,maintenance_generation:generation,config_digest:raw.bundle.config_digest,installation_digest:input.installationDigest,candidate_sha:'a'.repeat(40),target_id:target};
 return {stub,binding,target};
}
for(const[step,count]of Object.entries({getWorkspace:78,getConfiguration:90,getProfile:80,listAgents:91,getAgent:90,getTask:81,getRun:93}))it('real private source observer '+step,async()=>{
 const name='private_observer_'+step.toLowerCase(),{stub,binding,target}=await configured(name,step);
 const result=await runInDurableObject(stub,async(_instance,state)=>{
  const registry=createSourceObserverRegistry({run_id:'run_source',entries:[binding]});
  const observer=createPrivateNativeObserver({workspace:{storage:state.storage,workspaceId,objectName:name,secrets:{},clock:systemClock,entropy:systemEntropy},registry});
  try{
   const observation=await observer.observe({run_id:'run_source',step_id:binding.step_id,invocation_id:binding.invocation_id,prepared_request_sha256:binding.prepared_request_sha256,credential_handle:binding.credential_handle});
   const capture=readPrivateObserverCapture(observation.capture);
   expect(()=>readPrivateObserverCapture(observation.capture)).toThrow('NATIVE_PRIVATE_OBSERVER_REJECTED');
   expect(Object.isFrozen(observation.subject.fence)).toBe(true);
   expect(capture.originals.every(r=>Object.keys(r).sort().join(',')==='byteSize,bytes,selector,sha256,transaction')).toBe(true);
   const projectionText=new TextDecoder().decode(capture.projection.bytes);
   expect(await sha256(projectionText)).toBe(capture.projection.sha256);
   expect(capture.projection.byteSize).toBe(capture.projection.bytes.byteLength);
   expect(projectionText).not.toContain(bearer);
   expect(projectionText).not.toContain('token_sha256');
   expect(projectionText).not.toContain('bundle_json');
   expect(capture.originals).toHaveLength(24);expect(capture.originals.every(r=>r.byteSize<=16384)).toBe(true);
   for(const original of capture.originals)expect(await sha256(new TextDecoder().decode(original.bytes))).toBe(original.sha256);
   expect(JSON.stringify(observation)).not.toContain(bearer);
   return {scope:observation.scope,installedAuthority:observation.installedAuthority,native_conformance:observation.native_conformance,resourceIds:observation.resourceIds,counts:observation.counts};
  }finally{await observer.close();}
 });
 expect(result.scope).toBe('source-observer');expect(result.installedAuthority).toBe(false);expect(result.native_conformance).toBe(false);
 expect(result.counts.transactions).toBe(3);expect(result.counts.totalQueries).toBe(count);
 if(step==='getAgent')expect(result.resourceIds).toEqual(['agent:'+target]);
 else if(step==='getTask')expect(result.resourceIds).toEqual(['task:'+target]);
 else if(step==='getRun')expect(result.resourceIds).toEqual(['run:'+target]);
 else if(step==='listAgents')expect(result.resourceIds).toEqual(['agent:agent_research','agent:agent_reviewer']);
 else expect(result.resourceIds).toEqual(['workspace:'+workspaceId]);
});
it('a source registry cannot authenticate a wrong bearer',async()=>{
 const name='private_observer_wrong_bearer',{stub,binding}=await configured(name,'getWorkspace');
 await runInDurableObject(stub,async(_instance,state)=>{
  const registry=createSourceObserverRegistry({run_id:'run_source',entries:[{...binding,bearer:'B'.repeat(42)+'A'}]});
  const observer=createPrivateNativeObserver({workspace:{storage:state.storage,workspaceId,objectName:name,secrets:{},clock:systemClock,entropy:systemEntropy},registry});
  try{await expect(observer.observe({run_id:'run_source',step_id:binding.step_id,invocation_id:binding.invocation_id,prepared_request_sha256:binding.prepared_request_sha256,credential_handle:binding.credential_handle})).rejects.toThrow('NATIVE_PRIVATE_OBSERVER_REJECTED');}finally{await observer.close();}
 });
});

// Deliberately mismatched source bindings: these are not native conformance controls.
for(const mismatch of ['epoch','generation','config','installation','object'] as const)it('rejects source binding mismatch '+mismatch,async()=>{
 const name='private_observer_mismatch_'+mismatch,{stub,binding}=await configured(name,'getWorkspace');
 const bad={...binding,...(mismatch==='epoch'?{expected_epoch:2}:mismatch==='generation'?{maintenance_generation:binding.maintenance_generation+1}:mismatch==='config'?{config_digest:'f'.repeat(64)}:mismatch==='installation'?{installation_digest:'f'.repeat(64)}:{object_name:'different_source_object'})};
 await runInDurableObject(stub,async(_instance,state)=>{
  const registry=createSourceObserverRegistry({run_id:'run_source',entries:[bad]});
  const observer=createPrivateNativeObserver({workspace:{storage:state.storage,workspaceId,objectName:name,secrets:{},clock:systemClock,entropy:systemEntropy},registry});
  const request={run_id:'run_source',step_id:bad.step_id,invocation_id:bad.invocation_id,prepared_request_sha256:bad.prepared_request_sha256,credential_handle:bad.credential_handle};
  try{
   await expect(observer.observe(request)).rejects.toThrow('NATIVE_PRIVATE_OBSERVER_REJECTED');
   expect(observer.snapshot().poisoned).toBe(true);
   expect(()=>observer.observe(request)).toThrow('NATIVE_PRIVATE_OBSERVER_REJECTED');
  }finally{await observer.close();}
 });
});
it('closed observer performs no observation and rejects copied capture handles',async()=>{
 const name='private_observer_closed',{stub,binding}=await configured(name,'getWorkspace');
 await runInDurableObject(stub,async(_instance,state)=>{
  const registry=createSourceObserverRegistry({run_id:'run_source',entries:[binding]});
  const observer=createPrivateNativeObserver({workspace:{storage:state.storage,workspaceId,objectName:name,secrets:{},clock:systemClock,entropy:systemEntropy},registry});
  await observer.close();
  expect(()=>observer.observe({})).toThrow('NATIVE_PRIVATE_OBSERVER_REJECTED');
  expect(observer.snapshot().attempts).toBe(0);
  expect(()=>readPrivateObserverCapture(Object.freeze({scope:'private-source-observer-capture'}))).toThrow('NATIVE_PRIVATE_OBSERVER_REJECTED');
 });
});

for(const mode of ['concurrent','close_pending'] as const)it('pending observer '+mode+' fails closed',async()=>{
 const name='private_observer_'+mode,{stub,binding}=await configured(name,'getWorkspace');
 await runInDurableObject(stub,async(_instance,state)=>{
  const registry=createSourceObserverRegistry({run_id:'run_source',entries:[binding]});
  const observer=createPrivateNativeObserver({workspace:{storage:state.storage,workspaceId,objectName:name,secrets:{},clock:systemClock,entropy:systemEntropy},registry});
  const request={run_id:'run_source',step_id:binding.step_id,invocation_id:binding.invocation_id,prepared_request_sha256:binding.prepared_request_sha256,credential_handle:binding.credential_handle};
  const pending=observer.observe(request);
  const rejected=expect(pending).rejects.toThrow('NATIVE_PRIVATE_OBSERVER_REJECTED');
  if(mode==='concurrent')expect(()=>observer.observe(request)).toThrow('NATIVE_PRIVATE_OBSERVER_REJECTED');
  await observer.close();await rejected;
  expect(observer.snapshot().pending).toBe(false);expect(observer.snapshot().closed).toBe(true);
 });
});
