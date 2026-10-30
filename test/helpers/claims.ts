import {env} from 'cloudflare:workers';
import {fixture,operator} from './environment';
import {human,owned} from './settings';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {enrollRuntime} from '../../src/runtimes/commands';
import {createTask,readyTask} from '../../src/tasks/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import type {CommandContext,VerifiedIdentity} from '../../src/workspace/context';
import type {DeploymentConfig} from '../../src/config/deployment';
import type {TaskCreateRequest} from '../../src/http/dto';
export const PROOF_A='a'.repeat(64),PROOF_B='b'.repeat(64),PROOF_ROTATED='c'.repeat(64),PROOF_OTHER='d'.repeat(64);
export async function claimFixture(name:string,options:{wip?:number;replaySafe?:boolean;policy?:boolean;scopes?:DeploymentConfig['static_credential_refs'][number]['scopes'];projects?:string[]|null}={}){
 const raw=await fixture(name);
 const humanScopes:DeploymentConfig['human_grants'][number]['scopes']=[...raw.config.human_grants[0].scopes,'tasks:read','tasks:create','tasks:edit','tasks:schedule','artifacts:read','agents:manage','credentials:manage'];
 raw.config.human_grants[0].scopes=[...new Set(humanScopes)];
 const scopes:DeploymentConfig['static_credential_refs'][number]['scopes']=options.scopes??['workspace:read','events:read','tasks:read','tasks:claim','tasks:execute','runtimes:manage'];
 const credential={...raw.config.static_credential_refs[0],scopes,project_ids:options.projects===undefined?null:options.projects};
 raw.config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_other',display_name:'Other synthetic agent'});
 raw.config.static_credential_refs=[credential,{...credential,credential_id:'credential_research_2'},{...credential,credential_id:'credential_other',agent_id:'agent_other'}];
 raw.bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_research_2',token_sha256:'2'.repeat(64)},{workspace_id:'ws_example',credential_id:'credential_other',token_sha256:'3'.repeat(64)});
 if(options.policy!==false)raw.config.workspace_policies[0].execution_policy={policy_version:7,agent_wip_limit:options.wip??1,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research','agent_other']},{project_id:'project_a',work_role_id:'role_a',eligible_agent_ids:['agent_research','agent_other']}],replay_safety_rules:options.replaySafe?[{id:'synthetic_safe',project_id:null,work_role_id:null,classification:'replay_safe',evidence_ref:'urn:synthetic:preexecution-evidence'}]:[]};
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),input);return {stub,name,input,raw};
}
export function claimIdentity(storage:DurableObjectStorage,credentialId='credential_research_1'):VerifiedIdentity{
 const tokenDigest=storage.sql.exec<{token_sha256:string}>('SELECT token_sha256 FROM native_credentials WHERE credential_id=?',credentialId).one().token_sha256;
 return {kind:'agent',workspaceId:'ws_example',credentialId,tokenDigest};
}
export function claimActorContext(storage:DurableObjectStorage,nowMs=Date.now(),credentialId='credential_research_1'):CommandContext{
 const identity=claimIdentity(storage,credentialId);return withTransaction(storage,tx=>({actor:resolveActor(tx,identity,nowMs),nowMs,requestId:'request_claim_fixture',idempotencyKey:'claim_fixture'}));
}
/** Enrollment and Ready setup use real domain helpers; no fixture grants are broadened in SQL. */
export function claimSetup(storage:DurableObjectStorage,now=Date.now(),task:Partial<TaskCreateRequest>={}){
 const identity=claimIdentity(storage),humanIdentity=human(storage);
 withTransaction(storage,tx=>{
  for(const [credentialId,runtimeId,proof] of [['credential_research_1','runtime_a',PROOF_A],['credential_research_1','runtime_b',PROOF_B],['credential_research_2','runtime_rotated',PROOF_ROTATED],['credential_other','runtime_other',PROOF_OTHER]]){
   const ctx={actor:resolveActor(tx,claimIdentity(storage,credentialId),now),nowMs:now,requestId:'fixture_enroll',idempotencyKey:'fixture_enroll'};
   enrollRuntime(tx,ctx,{label:'Synthetic runtime'},{runtimeId,proofSha256:proof});
  }
  const ctx={actor:resolveActor(tx,humanIdentity,now),nowMs:now,requestId:'fixture_task',idempotencyKey:'fixture_task'};
  for(const id of ['task_a','task_b']){createTask(tx,{...ctx,taskId:id},{title:'Synthetic claim task',description:'',...task});readyTask(tx,ctx,id,{expected_version:1});}
 });
 return {now,identity,body:{expected_version:2,runtime_instance_id:'runtime_a'}};
}
export async function claimContext(storage:DurableObjectStorage,name:string,body:unknown,key:string,now=Date.now(),taskId='task_a'){
 return {workspace:{...owned(storage,name),clock:{nowMs:()=>now}},requestId:'request_'+key,idempotencyKey:key,fingerprint:await fingerprintRequest('POST','/v2/workspaces/ws_example/tasks/'+taskId+':claim',{},body),admissionGeneration:storage.sql.exec<{generation:number}>('SELECT generation FROM maintenance_state WHERE id=1').one().generation,admissionEpoch:storage.sql.exec<{config_epoch:number}>('SELECT config_epoch FROM workspace_metadata').one().config_epoch};
}
export function claimSnapshot(storage:DurableObjectStorage){return Object.fromEntries(['tasks','runs','events','task_history','idempotency_outcomes','scheduler_state','outbox'].map(table=>[table,storage.sql.exec('SELECT * FROM '+table+' ORDER BY rowid').toArray()]));}
