/** Synthetic trusted test composition only; never imported by deployment or runtime entrypoints. */
import {env} from 'cloudflare:workers';
import {fixture,operator} from './environment';
import {canonicalJson,sha256,prepareBootstrap} from '../../src/config/bootstrap';
import {claimSetup,claimIdentity} from './claims';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import type {DecisionPolicy} from '../../src/approvals/contracts';
import type {Proposal} from '../../src/http/dto';
export const syntheticSchema={type:'object',additionalProperties:false,required:['task_id','task_version'],properties:{task_id:{type:'string'},task_version:{type:'integer',minimum:1}}};
export const schemaSha256=await sha256(canonicalJson(syntheticSchema));
export const descriptor=Object.freeze({
 actionId:'synthetic.task-review',schemaVersion:1,schemaSha256,semanticRevision:'synthetic-task-review@2',resourceKinds:Object.freeze(['task']),
 actorScopes:Object.freeze(['tasks:read','tasks:execute','artifacts:read']),reviewerScopes:Object.freeze(['tasks:read','artifacts:read']),
 extractInputTargets(value:import('../../src/approvals/contracts').ReadonlyDecisionJson){const v=value as {task_id:string;task_version:number};return [{kind:'task',id:v.task_id,version:v.task_version}];},
 validateInput(value:unknown):boolean{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='task_id,task_version'&&typeof (value as {task_id:unknown}).task_id==='string'&&Number.isSafeInteger((value as {task_version:unknown}).task_version)&&Number((value as {task_version:unknown}).task_version)>0;},
});
export const syntheticPolicy:DecisionPolicy={policy_version:3,expiry_seconds:120,expiry_batch_limit:2,actions:[{action_id:descriptor.actionId,schema_version:descriptor.schemaVersion,schema_sha256:schemaSha256,reviewer_ids:['human_operator','human_reviewer'],resource_kinds:['task']}]};
export const proposal=(hash:string):Proposal=>({summary:'Synthetic only',action:descriptor.actionId,scope:{project_id:null,resource_ids:['task_a']},artifact_ids:[],inputs:{artifact_id:'input_a',sha256:hash}});
export async function decisionFixture(name:string,policy:DecisionPolicy|null=syntheticPolicy,reviewerCount=2){
 const raw=await fixture(name);
 raw.config.human_grants[0].scopes=[...raw.config.human_grants[0].scopes,'tasks:read','tasks:create','tasks:edit','tasks:schedule','artifacts:read','approvals:read','approvals:decide','credentials:manage'];
 raw.config.human_grants.push({...raw.config.human_grants[0],principal_id:'human_reviewer',subject:'synthetic-reviewer-subject'});
 for(let index=2;index<reviewerCount;index++)raw.config.human_grants.push({...raw.config.human_grants[0],principal_id:'human_reviewer_'+index,subject:'synthetic-reviewer-'+index});
 const credential={...raw.config.static_credential_refs[0],scopes:['workspace:read','events:read','tasks:read','tasks:claim','tasks:execute','runtimes:manage','artifacts:read','artifacts:write'] as typeof raw.config.static_credential_refs[0]['scopes']};
 raw.config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_other',display_name:'Synthetic other'});
 raw.config.static_credential_refs=[credential,{...credential,credential_id:'credential_research_2'},{...credential,credential_id:'credential_other',agent_id:'agent_other'}];
 raw.bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_research_2',token_sha256:'2'.repeat(64)},{workspace_id:'ws_example',credential_id:'credential_other',token_sha256:'3'.repeat(64)});
 raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:2,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research','agent_other']}],replay_safety_rules:[]};
 if(policy!==null)Object.assign(raw.config.workspace_policies[0],{decision_policy:policy});
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),input);return {stub,name,input,raw};
}
export function decisionActor(storage:DurableObjectStorage,nowMs=Date.now()){
 return withTransaction(storage,tx=>resolveActor(tx,claimIdentity(storage),nowMs));
}
export async function testLookup(){
 // The production entrypoint never exposes registry injection; only this test composition imports the internal source.
 const {createPolicyRequirementsLookup}=await import('../../src/approvals/policy-source');
 return createPolicyRequirementsLookup(Object.freeze([descriptor]));
}
export {claimSetup};

export async function testInputVerifier(){const {createProposalInputVerifier}=await import('../../src/approvals/input-binding-source');return createProposalInputVerifier([descriptor]);}
