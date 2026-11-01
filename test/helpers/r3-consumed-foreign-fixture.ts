/** Private command-created foreign workspace for the fixed local J2 isolation case. */
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from './environment';
import {owned} from './settings';
import {artifactBucket,stage,bytes} from './artifacts';
import {descriptor,proposal} from './decision-policy';
import {canonicalJson,sha256,prepareBootstrap} from '../../src/config/bootstrap';
import {createRuntimeCommand} from '../../src/runtimes/commands';
import {createTaskCommand,readyTaskCommand} from '../../src/tasks/commands';
import {claimTaskCommand} from '../../src/tasks/claim';
import {createDecisionCommands} from '../../src/approvals/commands-source';
import {executeCommand,type CommandExecutionContext} from '../../src/workspace/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {uploadArtifactContent,commitArtifact,type ArtifactOperationContext} from '../../src/artifacts/content';
import type {VerifiedIdentity} from '../../src/workspace/context';
import type {TaskRequestDecisionRequest} from '../../src/http/dto';
const FOREIGN_PROOF='f'.repeat(64);
/** Clone before hashing; original source signed material is never mutated. */
export async function foreignSource(sourceRaw:Awaited<ReturnType<typeof fixture>>,name:string){
 const raw=structuredClone(sourceRaw),workspaceId='ws_other';
 raw.config.workspace_catalog=[{workspace_id:workspaceId,object_name:name}];
 for(const key of ['human_grants','static_participants','static_credential_refs','workspace_policies'] as const)for(const row of raw.config[key])row.workspace_id=workspaceId;
 raw.config.authentication.allowed_origins=['https://other.example.invalid'];raw.config.authentication.redirect_uris=[{workspace_id:workspaceId,redirect_uri:'https://other.example.invalid/v2/workspaces/ws_other/auth/callback'}];
 for(const c of raw.bundle.credentials){c.workspace_id=workspaceId;c.token_sha256=await sha256('synthetic_foreign_'+c.credential_id);}
 for(const c of raw.bundle.retired_credentials)c.workspace_id=workspaceId;
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const input=await prepareBootstrap(raw.config,raw.bundle,workspaceId),stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration({...operator(),workspaceId},input);
 const created=await runInDurableObject(stub,async(_o,{storage})=>{
  const now=Date.now(),grant=input.config.human_grants.find(h=>h.principal_id==='human_operator')!;
  // Explicit local synthetic session only; authority grants came from the installed config above.
  storage.sql.exec('INSERT INTO sessions (id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,revoked_at,auth_epoch) VALUES (?,?,?,?,?,?,?,?,?,NULL,1)','j2_foreign_session',workspaceId,grant.principal_id,'synthetic_foreign_session_digest','synthetic_foreign_csrf',grant.issuer,grant.subject,now,now+600000);
  const human:VerifiedIdentity={kind:'human',workspaceId,issuer:grant.issuer,subject:grant.subject,sessionId:'j2_foreign_session'},native:VerifiedIdentity={kind:'agent',workspaceId,credentialId:'credential_research_1',tokenDigest:input.bundle.credentials.find(c=>c.credential_id==='credential_research_1')!.token_sha256};
  const workspace={...owned(storage,name),workspaceId},context:ArtifactOperationContext={workspace,identity:native,requestId:'j2_foreign',idempotencyKey:'j2_foreign',admission:{authorityEpoch:input.config.config_epoch,maintenanceGeneration:0},runtimeId:'runtime_foreign',proofHash:FOREIGN_PROOF,bucket:artifactBucket()};
  const execution=async(key:string,body:unknown):Promise<CommandExecutionContext>=>({workspace,requestId:'request_'+key,idempotencyKey:key,fingerprint:await fingerprintRequest('POST','/source/'+key,{},body),admissionEpoch:context.admission.authorityEpoch,admissionGeneration:context.admission.maintenanceGeneration});
  const enroll={label:'Actual foreign local runtime'};executeCommand(await execution('foreign_enroll',enroll),native,createRuntimeCommand({runtimeId:'runtime_foreign',proofSha256:FOREIGN_PROOF}),enroll);
  const create={title:'Private foreign fixture task',description:''};executeCommand(await execution('foreign_create',create),human,createTaskCommand('task_foreign'),create);
  const ready={expected_version:1};executeCommand(await execution('foreign_ready',ready),human,readyTaskCommand('task_foreign'),ready);
  const claim={expected_version:2,runtime_instance_id:'runtime_foreign'};executeCommand(await execution('foreign_claim',claim),native,claimTaskCommand('task_foreign','run_foreign',FOREIGN_PROOF),claim);
  const content=JSON.stringify({task_id:'task_foreign',task_version:3}),hash=await sha256(content);await stage(context,'input_foreign',{task_id:'task_foreign',media_type:'application/json',byte_size:new TextEncoder().encode(content).length,sha256:hash});
  await uploadArtifactContent({...context,idempotencyKey:'foreign_upload'},'input_foreign',bytes(content),'foreign_upload');await commitArtifact({...context,idempotencyKey:'foreign_commit'},'input_foreign',{expected_artifact_version:2});
  const body:TaskRequestDecisionRequest={expected_version:3,run_id:'run_foreign',fence:1,checkpoint:{summary:'Private foreign checkpoint',artifact_ids:['input_foreign']},proposal:{...proposal(hash),scope:{project_id:null,resource_ids:['task_foreign']},inputs:{artifact_id:'input_foreign',sha256:hash}}};
  const command=await createDecisionCommands([descriptor]).prepareRequestTaskDecision({...context,idempotencyKey:'foreign_decision'},'task_foreign',body,FOREIGN_PROOF,{approvalId:'approval_foreign',checkpointId:'checkpoint_foreign',proposalId:'proposal_foreign'});executeCommand(await execution('foreign_decision',body),native,command,body);return {body,native,human};
 });
 return {stub,input,name,workspaceId,...created};
}
