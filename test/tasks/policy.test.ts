import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
const policy={policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
it('execution policy is installed through canonical digest-bound bootstrap',async()=>{
 const raw=await fixture('task-policy-canonical');Object.assign(raw.config.workspace_policies[0],{execution_policy:policy});raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName('task-policy-canonical');await stub.reconcileConfiguration(operator(),input);
 await runInDurableObject(stub,(_o,state)=>{const installed=JSON.parse(state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one().config_json);expect(installed.workspace_policies[0].execution_policy).toEqual(policy);});
});
import {human} from '../helpers/settings';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {assertTaskEligible,assertTaskReferences,installedExecutionPolicy} from '../../src/config/execution-policy';
import {neutralProfile} from '../../src/config/profile';
import type {Task} from '../../src/http/dto';
import type {CommandContext} from '../../src/workspace/context';
const task:Task={id:'task_policy',workspace_id:'ws_example',title:'Policy test',description:'',state:'backlog',task_version:1,proposal_version:0,project_id:null,work_role_id:null,assigned_agent_id:null,active_run_id:null,latest_run_id:null,approval_id:null,result:null,retry_count:0,retry_limit:2,flags:[],created_at:new Date(1).toISOString(),updated_at:new Date(1).toISOString()};
async function preparedPolicy(name:string,options:{missing?:boolean;split?:boolean;project?:boolean}={}){
 const raw=await fixture(name);raw.config.static_credential_refs[0].scopes=['tasks:claim','tasks:execute'];raw.config.static_credential_refs[0].project_ids=null;
 raw.config.human_grants[0].scopes=['tasks:read','tasks:schedule','tasks:create','tasks:edit'];raw.config.human_grants[0].project_ids=null;
 if(options.split){raw.config.static_credential_refs[0].scopes=['tasks:claim'];raw.config.static_credential_refs.push({...raw.config.static_credential_refs[0],credential_id:'credential_execute',scopes:['tasks:execute']});raw.bundle.credentials.push({...raw.bundle.credentials[0],credential_id:'credential_execute',token_sha256:'2'.repeat(64)});}
 const current={...policy,eligibility_rules:[{...policy.eligibility_rules[0],project_id:options.project?'project_a':null}],replay_safety_rules:[{id:'safe_rule',project_id:options.project?'project_a':null,work_role_id:null,classification:'replay_safe' as const,evidence_ref:'urn:reviewed:synthetic'}]};
 if(!options.missing)raw.config.workspace_policies[0].execution_policy=current;
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),input);return {stub,input};
}
function ctx(storage:DurableObjectStorage):CommandContext{const identity=human(storage);return withTransaction(storage,tx=>({actor:resolveActor(tx,identity,Date.now()),nowMs:Date.now(),requestId:'policy_request',idempotencyKey:'policy_key'}));}
it('installed exact policy produces evidence without using work role labels as authority',async()=>{
 const {stub}=await preparedPolicy('policy-evidence');await runInDurableObject(stub,(_o,state)=>{const c=ctx(state.storage);withTransaction(state.storage,tx=>{
 expect(installedExecutionPolicy(tx,c.actor).task_retry_limit).toBe(2);expect(assertTaskEligible(tx,c,task,null)).toEqual({policyVersion:1,replaySafetyRuleId:'safe_rule'});
 expect(assertTaskEligible(tx,c,{...task,assigned_agent_id:'agent_research'},'agent_research')).toEqual({policyVersion:1,replaySafetyRuleId:'safe_rule'});
 expect(()=>assertTaskEligible(tx,c,{...task,assigned_agent_id:'agent_research'},'other')).toThrow();
 for(const flag of ['outcome_unknown','retry_exhausted'] as const)expect(()=>assertTaskEligible(tx,c,{...task,flags:[flag]},null)).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
 tx.exec("UPDATE static_agents SET status='archived' WHERE agent_id='agent_research'");expect(()=>assertTaskEligible(tx,c,task,null)).toThrow();
 });});
});
it('missing installed policy denies scheduling and no credential union grants eligibility',async()=>{
 const missing=await preparedPolicy('policy-missing',{missing:true});await runInDurableObject(missing.stub,(_o,state)=>{const c=ctx(state.storage);withTransaction(state.storage,tx=>expect(()=>installedExecutionPolicy(tx,c.actor)).toThrowError(expect.objectContaining({code:'DEPENDENCY_UNAVAILABLE'})));});
 const split=await preparedPolicy('policy-split',{split:true});await runInDurableObject(split.stub,(_o,state)=>{const c=ctx(state.storage);withTransaction(state.storage,tx=>expect(()=>assertTaskEligible(tx,c,task,null)).toThrowError(expect.objectContaining({code:'FORBIDDEN'})));});
});
it('project null empty exact matching, active references and current credential revocation fail closed',async()=>{
 const {stub}=await preparedPolicy('policy-projects',{project:true});await runInDurableObject(stub,(_o,state)=>{const c=ctx(state.storage);withTransaction(state.storage,tx=>{
 tx.exec('INSERT INTO profiles(workspace_id,version,document_json,updated_at,updated_by) VALUES(?,1,?,?,?)',[c.actor.workspaceId,JSON.stringify({...neutralProfile,projects:[{id:'project_a',display_name:'Synthetic',description:'',archived:false}],work_roles:[{id:'role_a',display_name:'Synthetic role',description:'',archived:false}]}),c.nowMs,c.actor.principalId]);
 const projected={...task,project_id:'project_a'};
 expect(assertTaskEligible(tx,c,projected,null)).toEqual({policyVersion:1,replaySafetyRuleId:'safe_rule'});
 expect(()=>assertTaskEligible(tx,c,task,null)).toThrow();expect(()=>assertTaskEligible(tx,c,{...projected,work_role_id:'role_a'},null)).toThrow();
 expect(()=>assertTaskReferences(tx,{...c.actor,projectIds:[]},projected)).toThrow();expect(()=>assertTaskReferences(tx,{...c.actor,projectIds:['project_a']},task)).toThrow();
 expect(()=>assertTaskReferences(tx,c.actor,{...projected,workspace_id:'foreign'})).toThrow();expect(()=>assertTaskReferences(tx,c.actor,{...projected,project_id:'missing'})).toThrow();
 tx.exec("UPDATE native_credentials SET project_ids_json='[]'");expect(()=>assertTaskEligible(tx,c,projected,null)).toThrow();
 tx.exec('UPDATE native_credentials SET project_ids_json=?',[JSON.stringify(['project_a'])]);expect(assertTaskEligible(tx,c,projected,null).policyVersion).toBe(1);
 tx.exec('UPDATE native_credentials SET revoked_at=?',[c.nowMs]);expect(()=>assertTaskEligible(tx,c,projected,null)).toThrow();
 });});
});
it('changed execution policy requires an advancing signed configuration epoch',async()=>{
 const {stub,input}=await preparedPolicy('policy-epoch');const changed=structuredClone(input.config);changed.workspace_policies[0].execution_policy!.task_retry_limit=3;
 const bundle=structuredClone(input.bundle);bundle.config_digest=await sha256(canonicalJson(changed));const sameEpoch=await prepareBootstrap(changed,bundle,'ws_example');
 await runInDurableObject(stub,async(object,state)=>{await expect(object.reconcileConfiguration(operator(1,input.installationDigest),sameEpoch)).rejects.toThrow('EPOCH_CONFLICT');expect(JSON.parse(state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one().config_json).workspace_policies[0].execution_policy.task_retry_limit).toBe(2);});
 changed.config_epoch=2;bundle.config_epoch=2;bundle.config_digest=await sha256(canonicalJson(changed));const advanced=await prepareBootstrap(changed,bundle,'ws_example');await stub.reconcileConfiguration(operator(1,input.installationDigest),advanced);
 await runInDurableObject(stub,(_o,state)=>{expect(JSON.parse(state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one().config_json).workspace_policies[0].execution_policy.task_retry_limit).toBe(3);});
});
