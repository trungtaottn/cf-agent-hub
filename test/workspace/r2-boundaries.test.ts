import {decisionRequest,approvalDecision,decisionError,decisionEffects} from '../helpers/decision-boundary';
import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {prepareBootstrap,sha256} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {projectEvent} from '../../src/audit/events';
import entry from '../../src/index';
import type {VerifiedIdentity} from '../../src/workspace/context';
async function setup(name:string){
 const raw=await fixture(name),digest=await sha256('A'.repeat(43));raw.bundle.credentials[0].token_sha256=digest;
 const stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),await prepareBootstrap(raw.config,raw.bundle,'ws_example'));
 const identity:VerifiedIdentity={kind:'agent',workspaceId:'ws_example',credentialId:'credential_research_1',tokenDigest:digest};
 return {stub,identity,config:raw.config};
}
it('unknown_event_resource_and_missing_producer_deny_even_with_permissive_hook',async()=>{
 const {stub,identity}=await setup('r2-unknown-event');
 await runInDurableObject(stub,(_o,state)=>withTransaction(state.storage,tx=>{
  const actor=resolveActor(tx,identity,Date.now());
  for(const [type,resource] of [['unknown.event','message'],['task.created','task'],['message.accepted','task'],['constructor','message'],['unknown.event','unrecognized'],['import.unknown','import'],['import.previewed','task'],['task.created','import']]){
   tx.exec('INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,resource_version,thread_id,request_id,occurred_at,summary) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[type+resource,'ws_example',type,JSON.stringify({kind:'agent',principal_id:actor.principalId,agent_id:actor.agentId}),resource,'hidden',null,null,'request',Date.now(),'Hidden summary']);
   expect(projectEvent(tx,actor,type+resource,Date.now(),()=>true)).toBeNull();
  }
 }));
});
it('recognized decision routes enforce unchanged R1 grants while unimplemented routes remain404',async()=>{
 const {stub,config}=await setup('r2-unavailable');
 const bindings={...env,DEPLOYMENT_CONFIG:JSON.stringify(config),WORKSPACE:{getByName:()=>stub}} as unknown as Env;
 const snapshot=()=>runInDurableObject(stub,(_o,state)=>decisionEffects(state.storage)),before=await snapshot();
 const probes=[
  {path:'tasks/task_a:request-decision',method:'POST',body:decisionRequest('task_a'),status:403,code:'FORBIDDEN'},
  {path:'approvals',method:'GET',body:undefined,status:403,code:'FORBIDDEN'},
  {path:'approvals',method:'POST',body:{},status:404,code:'NOT_FOUND'},
  {path:'approvals/approval_a:approve',method:'POST',body:approvalDecision(),status:403,code:'FORBIDDEN'},
  {path:'teams',method:'POST',body:{},status:404,code:'NOT_FOUND'},
 ];
 for(const probe of probes){
  const request=()=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/'+probe.path,{method:probe.method,headers:{authorization:'Bearer '+'A'.repeat(43),'x-runtime-token':'B'.repeat(42)+'A','content-type':'application/json','idempotency-key':'boundary'},...(probe.body===undefined?{}:{body:JSON.stringify(probe.body)})});
  await decisionError(await entry.fetch(request(),bindings),probe.status,probe.code);await decisionError(await stub.fetch(request()),probe.status,probe.code);
 }
 expect(await snapshot()).toEqual(before);
});
