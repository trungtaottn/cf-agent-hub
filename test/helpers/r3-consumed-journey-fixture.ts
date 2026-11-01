/** Fixed PRIVATE source fixture. Never imported by a deployment or action registry. */
import {env} from 'cloudflare:workers';
import {foreignSource} from './r3-consumed-foreign-fixture';
import {captureBounded,restoreBounded} from './r3-consumed-recovery-io';
import {exclusiveControls} from './r3-consumed-recovery-controls';
import {withCurrentRecoveryWorkspace,type CurrentRestoreFixture} from '../recovery/current-restore-fixture';
import {fixtureIntegrity} from './recovery-fixture';
import {signRecord} from '../../src/recovery/manifest';
import {canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import type {CurrentLedger,RecoveryWorkspace} from '../../src/recovery/protocol';
import {cleanupArtifactGenerations} from '../../src/artifacts/reconcile';
import {requireRuntimeProof} from '../../src/auth/runtime-proof';
import {isRestoreExpiryEvent} from '../../src/recovery/restore-audit';
import {captureR3ConsumedSnapshot} from './r3-consumed-private-snapshot';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from './environment';
import {descriptor,syntheticPolicy} from './decision-policy';
import {setup} from './persisted-decision';
import {human,owned} from './settings';
import {artifactBucket} from './artifacts';
import {claimIdentity,PROOF_A} from './claims';
import {assertR3PrivateUnchanged} from './r3-journey-fixture';
import {createDecisionCommands} from '../../src/approvals/commands-source';
import {createTaskClaimCommands} from '../../src/tasks/claim-source';
import {createRuntimeCommand} from '../../src/runtimes/commands';
import {submitTaskResultCommand,acceptTaskResultCommand} from '../../src/tasks/results';
import {cancelTaskCommand} from '../../src/tasks/commands';
import {failTaskCommand,expireDueRuns} from '../../src/tasks/failure';
import {heartbeatRunCommand} from '../../src/tasks/lease';
import {revokeCredentialCommand} from '../../src/auth/native-credentials';
import {executeCommand,type CommandExecutionContext} from '../../src/workspace/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {AuthError} from '../../src/auth/context';
import {HttpError} from '../../src/http/envelopes';
import {getApproval} from '../../src/approvals/queries';
import {getTask} from '../../src/tasks/repository';
import {downloadArtifactContent,type ArtifactOperationContext} from '../../src/artifacts/content';
import {inspectArtifactStream} from '../../src/artifacts/stream';
import {canonicalJson,sha256,prepareBootstrap} from '../../src/config/bootstrap';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry';
import type {ApprovalDecisionRequest,Approval,Task} from '../../src/http/dto';
import type {VerifiedIdentity} from '../../src/workspace/context';
import {R3_CONSUMED_TABLES,R3_CONSUMED_NO_REQUEST,consumedStepKind,projectR3RecoveryEvent,assertR3ConsumedObservation,type R3ConsumedCase,type R3ConsumedJourneyObservationV1,type R3ConsumedStep} from './r3-consumed-journey-observation';
type Snapshot=ReturnType<typeof captureR3ConsumedSnapshot>;
type Row=Snapshot['tasks'][number];
type Fixture=Awaited<ReturnType<typeof policyFixture>>;
// Distinct from all four actually enrolled setup proofs a/b/c/d.
const NEW_PROOF='e'.repeat(64);
function fail(code:string):never{throw Error(code);}
/** Scope recipe is fixed and installed only after the complete synthetic document is hashed. */
async function policyFixture(name:string){
 const raw=await fixture(name),nativeA=['workspace:read','events:read','tasks:read','tasks:claim','tasks:execute','tasks:review','runtimes:manage','artifacts:read','artifacts:write'] as const,nativeB=['workspace:read','tasks:read','tasks:review','runtimes:manage','artifacts:read'] as const;
 const h=raw.config.human_grants[0];h.scopes=[...new Set([...h.scopes.filter(s=>s!=='tasks:review'),'tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:cancel','artifacts:read','approvals:read','approvals:decide','credentials:manage'] as const)];h.delegable_native_scopes=[...nativeA];
 raw.config.human_grants.push({...h,principal_id:'human_reviewer',subject:'synthetic-reviewer-subject',scopes:['tasks:read','artifacts:read','approvals:read','approvals:decide'],delegable_native_scopes:[]});
 const credential={...raw.config.static_credential_refs[0],scopes:[...nativeA]};raw.config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_other',display_name:'Synthetic independent native reviewer'});
 raw.config.static_credential_refs=[credential,{...credential,credential_id:'credential_research_2'},{...credential,credential_id:'credential_other',agent_id:'agent_other',scopes:[...nativeB]}];
 raw.bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_research_2',token_sha256:'2'.repeat(64)},{workspace_id:'ws_example',credential_id:'credential_other',token_sha256:'3'.repeat(64)});
 raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:2,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
 Object.assign(raw.config.workspace_policies[0],{decision_policy:{...syntheticPolicy,expiry_seconds:600}});
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),input);return {raw,input,stub,name};
}
const safeNames=new Set(['id','principal_id','agent_id','task_id','run_id','approval_id','proposal_id','checkpoint_id','state','status','version','task_version','approval_version','proposal_version','run_version','runtime_version','fence','consumed_run_id','consumed_fence','active_run_id','latest_run_id','current_result_id','retry_count','created_at','decided_at','expires_at','ended_at','started_at','lease_expires_at','sequence','kind','before_version','after_version','before_state','after_state','event_id','original_request_id','operation','generation_id','artifact_id','artifact_version','sha256','byte_size','role','resource_kind','resource_id','reviewer_principal_id','reviewer_agent_id','result_id','submission_sequence','submitted_principal_id','submitted_agent_id','job_id','chunk_index','row_count']);
function safeSnapshot(s:Snapshot){return Object.fromEntries(R3_CONSUMED_TABLES.map(t=>[t,s[t].map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>safeNames.has(k))))]));}
const pk=(table:typeof R3_CONSUMED_TABLES[number],r:Row)=>canonicalJson(TABLE_REGISTRY.find(t=>t.name===table)!.primaryKey.map(k=>r[k]));
function delta<T extends typeof R3_CONSUMED_TABLES[number]>(table:T,b:Snapshot,a:Snapshot){const before=new Map(b[table].map(r=>[pk(table,r),r])),after=new Map(a[table].map(r=>[pk(table,r),r]));return {table,before_count:before.size,after_count:after.size,inserted:[...after.keys()].filter(k=>!before.has(k)).length,deleted:[...before.keys()].filter(k=>!after.has(k)).length,updated:[...after.keys()].filter(k=>before.has(k)&&canonicalJson(after.get(k))!==canonicalJson(before.get(k))).length};}
interface State {storage:DurableObjectStorage;fixture:Fixture;x:Awaited<ReturnType<typeof setup>>;now:number;ctx:ArtifactOperationContext;native:VerifiedIdentity;human:VerifiedIdentity;reviewer:VerifiedIdentity;steps:R3ConsumedStep[];actors:R3ConsumedJourneyObservationV1['observed_actors'];inspection:{sha256:string;byteSize:number}|null;originalExpiry:number;originalDecisionHash:string;originalFence:number;approvalEvent:{id:string;sequence:number}|null;enrollmentEvent:{id:string;sequence:number}|null;newRuntimeCreated:number;firstClaim:unknown;firstAccept:unknown;}
const bump=(s:State)=>{s.now=Math.max(s.now+1,Date.now());};
async function execution(s:State,key:string,body:unknown,path=key):Promise<CommandExecutionContext>{return {workspace:s.ctx.workspace,requestId:'j2_'+key,idempotencyKey:key,fingerprint:await fingerprintRequest('POST','/source/'+path,{},body),admissionEpoch:s.ctx.admission.authorityEpoch,admissionGeneration:s.ctx.admission.maintenanceGeneration};}
function artifactContext(s:State,identity:VerifiedIdentity,key:string):ArtifactOperationContext{return {...s.ctx,identity,idempotencyKey:key,requestId:'j2_'+key,runtimeId:identity.kind==='agent'&&identity.credentialId===(s.native as Extract<VerifiedIdentity,{kind:'agent'}>).credentialId?'runtime_new':null,proofHash:identity.kind==='agent'&&identity.credentialId===(s.native as Extract<VerifiedIdentity,{kind:'agent'}>).credentialId?NEW_PROOF:null};}
async function record(s:State,label:string,key:string,run:()=>Promise<{status:number|null;data:unknown}>|{status:number|null;data:unknown},expected:readonly [number|null,string]|null=null){
 const before=captureR3ConsumedSnapshot(s.storage);let status:number|null=null,code:string|null=null,result:unknown;
 try{const out=await run();status=out.status;result=out.data;}catch(error){if(error instanceof HttpError||error instanceof AuthError){status=error.status;code=error.code;}else if(expected?.[0]===null&&error instanceof Error&&error.message===expected[1]){status=null;code=error.message;}else throw error;}
 if(expected?(status!==expected[0]||code!==expected[1]):code!==null)fail('J2_UNEXPECTED_SOURCE_OUTCOME_'+label);
 const after=captureR3ConsumedSnapshot(s.storage),kind=consumedStepKind(label),noWrite=expected!==null||label.endsWith('-replay')||kind==='read';if(noWrite)assertR3PrivateUnchanged(before,after);
 const added=(t:typeof R3_CONSUMED_TABLES[number])=>after[t].filter(a=>!before[t].some(b=>pk(t,a)===pk(t,b)));
 const events=added('events'),outcomes=added('idempotency_outcomes');
 if(events.length>3||outcomes.length>3)fail('J2_SINGLE_STEP_BUDGET');
 s.steps.push({operation:label,kind,request_id:R3_CONSUMED_NO_REQUEST.some(op=>op===label)?null:'j2_'+key,key_sha256:R3_CONSUMED_NO_REQUEST.some(op=>op===label)?null:await sha256(key),status,code,before_sha256:await sha256(canonicalJson(safeSnapshot(before))),after_sha256:await sha256(canonicalJson(safeSnapshot(after))),rows:R3_CONSUMED_TABLES.map(t=>delta(t,before,after)),event_ids:events.map(r=>String(r.id)),outcome_ids:await Promise.all(outcomes.map(r=>sha256(pk('idempotency_outcomes',r))))});
 for(const event of events){const actor=JSON.parse(String(event.actor_json)) as {kind:'agent'|'human'|'system';principal_id:string};s.actors.push({operation:label,kind:actor.kind,principal_id:actor.principal_id});}
 return result;
}
function decisionHash(row:Row){return sha256(canonicalJson({created_at:row.created_at,expires_at:row.expires_at,decided_at:row.decided_at,decided_by_json:row.decided_by_json,decision_reason:row.decision_reason,proposal_version:row.proposal_version}));}
async function inspect(s:State,identity:VerifiedIdentity,label:'human'|'reviewer'|'restored-reviewer'){
 const expected=s.storage.sql.exec<Row>('SELECT sha256,byte_size FROM artifacts WHERE id=?','input_a').one();
 if(label!=='restored-reviewer'){
  const read=await record(s,label+'-read',label+'_read',()=>withTransaction(s.storage,tx=>{const actor=resolveActor(tx,identity,s.now);return {status:null,data:label==='human'?getApproval(tx,{actor,nowMs:s.now},'approval_a'):getTask(tx,{actor,nowMs:s.now},'task_a')};}));
  if(label==='human'){const a=read as Approval;if(a.id!=='approval_a'||a.task_id!=='task_a'||a.proposal.inputs.artifact_id!=='input_a'||a.proposal.inputs.sha256!==expected.sha256||!a.assigned_human_principal_ids.includes('human_operator'))fail('J2_HUMAN_INSPECTION_BINDING');}
  else {const task=read as Task;if(task.id!=='task_a'||task.state!=='review'||task.result?.run_id!=='run_new'||task.result.submitted_by.principal_id!=='agent_research'||!task.result.artifact_ids.includes('input_a'))fail('J2_REVIEWER_INSPECTION_BINDING');}
 }
 let measured:{sha256:string;byteSize:number}|null=null;
 await record(s,label+'-download',label+'_download',async()=>{const response=await downloadArtifactContent(artifactContext(s,identity,label+'_download'),'input_a');const size=Number(response.headers.get('content-length'));if(response.status!==200||!Number.isSafeInteger(size)||size<0||size>65536||!response.body)fail('J2_INSPECTION_BYTES');measured=await inspectArtifactStream(response.body!,size);return {status:response.status,data:null};});
 if(!measured)fail('J2_INSPECTION_MISSING');const bytes=measured as {sha256:string;byteSize:number};if(bytes.sha256!==expected.sha256||bytes.byteSize!==expected.byte_size)fail('J2_INSPECTION_DIGEST');return bytes;
}
async function approved(s:State){
 const commands=createDecisionCommands([descriptor]),x=s.x;
 await record(s,'request','decision',async()=>executeCommand(await execution(s,'decision',x.body),s.native,await commands.prepareRequestTaskDecision({...s.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'}),x.body));
 s.originalExpiry=Number(s.storage.sql.exec('SELECT expires_at FROM approvals WHERE id=?','approval_a').one().expires_at);
 s.inspection=await inspect(s,s.human,'human');bump(s);
 const approval=s.storage.sql.exec<Row>('SELECT * FROM approvals WHERE id=?','approval_a').one(),task=s.storage.sql.exec<Row>('SELECT * FROM tasks WHERE id=?','task_a').one();
 const body:ApprovalDecisionRequest={expected_version:Number(task.task_version),expected_approval_version:Number(approval.approval_version),expected_proposal_version:Number(approval.proposal_version),reason:'Synthetic H inspected the exact committed input'};
 await record(s,'approve','approve',async()=>executeCommand(await execution(s,'approve',body),s.human,await commands.prepareApprovalDecision(artifactContext(s,s.human,'approve'),'approval_a','approve',body),body));
 const event=s.storage.sql.exec<{id:string;sequence:number}>('SELECT id,sequence FROM events WHERE id=?',s.steps.at(-1)!.event_ids[0]).one();s.approvalEvent=event;s.originalDecisionHash=await decisionHash(s.storage.sql.exec<Row>('SELECT * FROM approvals WHERE id=?','approval_a').one());
 bump(s);const enrollBody={label:'Synthetic runtime enrolled after H approval'};
 await record(s,'enroll','enroll_new',async()=>executeCommand(await execution(s,'enroll_new',enrollBody),s.native,createRuntimeCommand({runtimeId:'runtime_new',proofSha256:NEW_PROOF}),enrollBody));
 s.enrollmentEvent=s.storage.sql.exec<{id:string;sequence:number}>('SELECT id,sequence FROM events WHERE id=?',s.steps.at(-1)!.event_ids[0]).one();s.newRuntimeCreated=Number(s.storage.sql.exec<Row>('SELECT created_at FROM runtimes WHERE id=?','runtime_new').one().created_at);
 if(s.enrollmentEvent.sequence<=s.approvalEvent.sequence||s.newRuntimeCreated<Number(s.storage.sql.exec<Row>('SELECT decided_at FROM approvals WHERE id=?','approval_a').one().decided_at))fail('J2_RUNTIME_NOT_POST_APPROVAL');
}
async function claim(s:State,label='claim',key='claim_new',runId='run_new',expectedVersion?:number,expected:readonly[number|null,string]|null=null){
 const body={expected_version:expectedVersion??Number(s.storage.sql.exec<Row>('SELECT task_version FROM tasks WHERE id=?','task_a').one().task_version),runtime_instance_id:'runtime_new'};
 return record(s,label,key,async()=>executeCommand(await execution(s,key,body,'claim'),s.native,await createTaskClaimCommands([descriptor]).prepareClaimTaskCommand(artifactContext(s,s.native,key),'task_a',runId,NEW_PROOF,body),body),expected);
}
async function happy(s:State){
 bump(s);s.firstClaim=await claim(s);bump(s);const replay=await claim(s,'claim-replay','claim_new','run_never_created',5);if(canonicalJson(replay)!==canonicalJson(s.firstClaim))fail('J2_CLAIM_REPLAY_CHANGED');
 const body={expected_version:6,run_id:'run_new',fence:2,result:{summary:'Synthetic consumed result for independent B review',artifact_ids:['input_a']}};
 await record(s,'wrong-proof-denial','wrong_proof',async()=>executeCommand(await execution(s,'wrong_proof',body),s.native,submitTaskResultCommand('task_a',PROOF_A),body),[401,'UNAUTHENTICATED']);
 bump(s);await record(s,'submit','submit',async()=>executeCommand(await execution(s,'submit',body),s.native,submitTaskResultCommand('task_a',NEW_PROOF),body));
 const accept={expected_version:7,reason:'Native B independently reviewed current result and bytes'};
 await record(s,'self-accept-denial','self_accept',async()=>executeCommand(await execution(s,'self_accept',accept),s.native,acceptTaskResultCommand('task_a'),accept),[403,'FORBIDDEN']);
 await inspect(s,s.reviewer,'reviewer');bump(s);s.firstAccept=await record(s,'accept','accept',async()=>executeCommand(await execution(s,'accept',accept),s.reviewer,acceptTaskResultCommand('task_a'),accept));
 const again=await record(s,'accept-replay','accept',async()=>executeCommand(await execution(s,'accept',accept),s.reviewer,acceptTaskResultCommand('task_a'),accept));if(canonicalJson(again)!==canonicalJson(s.firstAccept))fail('J2_ACCEPT_REPLAY_CHANGED');
}
async function firstFive(s:State,caseId:R3ConsumedCase){
 if(caseId==='fresh_runtime_native_review_done')return happy(s);
 if(caseId==='approved_cancel_before_claim'){
  bump(s);const body={expected_version:5,reason:'Synthetic H cancellation before approved claim'},send=async()=>executeCommand(await execution(s,'cancel',body),s.human,cancelTaskCommand('task_a'),body);
  const first=await record(s,'cancel','cancel',send),replay=await record(s,'cancel-replay','cancel',send);if(canonicalJson(first)!==canonicalJson(replay))fail('J2_CANCEL_REPLAY_CHANGED');
  await claim(s,'cancelled-claim-denial','cancelled_claim','run_forbidden',6,[409,'INVALID_STATE']);return;
 }
 if(caseId==='approved_credential_revoke_before_claim'){
  bump(s);const body={expected_credential_version:Number(s.storage.sql.exec<Row>('SELECT credential_version FROM native_credentials WHERE credential_id=?','credential_research_1').one().credential_version),reason:'Synthetic H revokes A before approved claim'};
  await record(s,'revoke','revoke',async()=>executeCommand(await execution(s,'revoke',body),s.human,revokeCredentialCommand('credential_research_1'),body));
  await claim(s,'revoked-claim-denial','revoked_claim','run_forbidden',5,[401,'UNAUTHENTICATED']);
  await record(s,'revoked-request-replay-denial','decision',async()=>executeCommand(await execution(s,'decision',s.x.body),s.native,await createDecisionCommands([descriptor]).prepareRequestTaskDecision({...s.ctx,idempotencyKey:'decision'},'task_a',s.x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'}),s.x.body),[401,'UNAUTHENTICATED']);return;
 }
 bump(s);await claim(s);
 if(caseId==='consumed_failure_held'){
  bump(s);const body={expected_version:6,run_id:'run_new',fence:2,outcome_unknown:false,reason:'Synthetic failure cannot prove no external effect'},send=async()=>executeCommand(await execution(s,'fail',body),s.native,failTaskCommand('task_a',NEW_PROOF),body);
  const first=await record(s,'fail','fail',send),replay=await record(s,'fail-replay','fail',send);if(canonicalJson(first)!==canonicalJson(replay))fail('J2_FAILURE_REPLAY_CHANGED');
  await claim(s,'held-claim-denial','held_claim','run_forbidden',7,[503,'DEPENDENCY_UNAVAILABLE']);
  await record(s,'paused-heartbeat-denial','paused_heartbeat',async()=>executeCommand(await execution(s,'paused_heartbeat',{expected_run_version:2,fence:1}),s.native,heartbeatRunCommand('run_initial',PROOF_A),{expected_run_version:2,fence:1}),[409,'STALE_RUN']);return;
 }
 if(caseId!=='consumed_lease_expiry_held')fail('J2_UNSUPPORTED_FIRST_FIVE');
 s.now=Number(s.storage.sql.exec<Row>('SELECT lease_expires_at FROM runs WHERE id=?','run_new').one().lease_expires_at);
 if(s.now>=Number(s.storage.sql.exec<Row>('SELECT presence_expires_at FROM runtimes WHERE id=?','runtime_new').one().presence_expires_at)||s.now>=s.originalExpiry)fail('J2_EXPIRY_PRECONDITION');
 const sweep=()=>withTransaction(s.storage,tx=>({status:null,data:expireDueRuns(tx,s.now,1)}));
 const expired=await record(s,'expire','lease_expiry',sweep) as {processed:number};if(expired.processed!==1)fail('J2_EXPIRY_NOT_OBSERVED');
 const repeated=await record(s,'expire-replay','lease_expiry_again',sweep) as {processed:number};if(repeated.processed!==0)fail('J2_EXPIRY_DUPLICATED');
 await record(s,'expired-heartbeat-denial','expired_heartbeat',async()=>executeCommand(await execution(s,'expired_heartbeat',{expected_run_version:2,fence:2}),s.native,heartbeatRunCommand('run_new',NEW_PROOF),{expected_run_version:2,fence:2}),[409,'STALE_RUN']);
 const body={expected_version:7,run_id:'run_new',fence:2,result:{summary:'Expired authority is not a result',artifact_ids:['input_a']}};
 await record(s,'expired-submit-denial','expired_submit',async()=>executeCommand(await execution(s,'expired_submit',body),s.native,submitTaskResultCommand('task_a',NEW_PROOF),body),[409,'STALE_RUN']);
 await claim(s,'held-claim-denial','held_claim','run_forbidden',7,[503,'DEPENDENCY_UNAVAILABLE']);
}
async function extract(s:State,caseId:R3ConsumedCase,isolation:R3ConsumedJourneyObservationV1['isolation']=null,recovery:R3ConsumedJourneyObservationV1['recovery']=null):Promise<R3ConsumedJourneyObservationV1>{
 const all=captureR3ConsumedSnapshot(s.storage),a=all.approvals.find(r=>r.id==='approval_a')!,t=all.tasks.find(r=>r.id==='task_a')!,initial=all.runs.find(r=>r.id==='run_initial')!,consumed=all.runs.find(r=>r.id==='run_new')??null,p=all.decision_proposals.find(r=>r.id==='proposal_a')!,binding=JSON.parse(String(p.binding_json));
 if(initial.fence!==s.originalFence||!s.inspection||!s.approvalEvent||!s.enrollmentEvent)fail('J2_INITIAL_IDENTITY_CHANGED');
 const inputEdges=all.decision_artifact_edges.filter(r=>r.approval_id==='approval_a'),results=all.task_results.filter(r=>r.task_id==='task_a'),acceptances=all.task_acceptances.filter(r=>r.task_id==='task_a');if(results.length>1||acceptances.length>1)fail('J2_RESULT_CARDINALITY');
 const newRuntime=all.runtimes.find(r=>r.id==='runtime_new');if(!newRuntime)fail('J2_NEW_RUNTIME_MISSING');
 const result=results[0]??null,acceptance=acceptances[0]??null,links=result?all.result_artifacts.filter(r=>r.result_id===result.id):[],ids=[...new Set([...inputEdges.map(r=>String(r.artifact_id)),...links.map(r=>String(r.artifact_id))])];if(ids.length>3)fail('J2_ARTIFACT_BUDGET');
 const artifacts=[];for(const id of ids){const artifact=all.artifacts.find(r=>r.id===id)!,g=all.artifact_generations.find(r=>r.id===artifact.committed_generation_id)!;if(!g||artifact.status!=='committed'||Number(artifact.byte_size)>65536)fail('J2_ARTIFACT_STATE');const object=await s.ctx.bucket!.get(String(g.object_key));if(!object||object.size!==artifact.byte_size||object.size>65536)fail('J2_ARTIFACT_BYTES');const bytes=await inspectArtifactStream(object!.body,Number(artifact.byte_size));artifacts.push({id,generation_id:g.id,version:artifact.artifact_version,sha256:artifact.sha256,byte_size:artifact.byte_size,measured_sha256:bytes.sha256,measured_byte_size:bytes.byteSize,roles:[...new Set([...inputEdges.filter(r=>r.artifact_id===id).map(r=>r.role),...(links.some(r=>r.artifact_id===id)?['result']:[])])].sort()});}
 const value={format_version:1,stage:'consumed-command-source-fixture',origin:'local-workers-synthetic-fixture',acceptance_eligible:false,case_id:caseId,workspace_id:'ws_example',schema_version:19,
 configured_principals:{requester:'agent_research',human:'human_operator',reviewer:'agent_other'},observed_actors:s.actors,
 descriptor:{action_id:binding.actionId,schema_version:binding.schemaVersion,schema_sha256:binding.schemaSha256,semantic_revision:binding.semanticRevision},policy:{version:binding.policyVersion,sha256:await sha256(binding.policyCanonicalJson),config_epoch:binding.configEpoch,installation_sha256:binding.installationDigest},
 human_decision:{principal_id:JSON.parse(String(a.decided_by_json)).principal_id,event_id:s.approvalEvent.id,event_sequence:s.approvalEvent.sequence,decided_at:a.decided_at,inspection_sha256:s.inspection.sha256,inspection_byte_size:s.inspection.byteSize},
 task:{id:t.id,state:t.state,version:t.task_version,approval_id:t.approval_id,active_run_id:t.active_run_id,flags:JSON.parse(String(t.flags_json)),retry_count:t.retry_count},
 approval:{id:a.id,proposal_id:a.proposal_id,checkpoint_id:a.checkpoint_id,status:a.status,version:a.approval_version,proposal_version:a.proposal_version,created_at:a.created_at,decided_at:a.decided_at,expires_at:a.expires_at,original_expires_at:s.originalExpiry,decision_sha256:await decisionHash(a),original_decision_sha256:s.originalDecisionHash,consumed_run_id:a.consumed_run_id,consumed_fence:a.consumed_fence},
 initial_run:{id:initial.id,runtime_id:initial.runtime_instance_id,fence:initial.fence,status:initial.status,ended_at:initial.ended_at},new_runtime:{id:newRuntime.id,principal_id:newRuntime.agent_id,created_at:newRuntime.created_at,event_id:s.enrollmentEvent.id,event_sequence:s.enrollmentEvent.sequence},
 consumed_run:consumed?{id:consumed.id,runtime_id:consumed.runtime_instance_id,fence:consumed.fence,status:consumed.status,started_at:consumed.started_at,lease_expires_at:consumed.lease_expires_at,ended_at:consumed.ended_at}:null,run_count:all.runs.length,artifacts,
 result:result?{id:result.id,run_id:result.run_id,submitted_principal_id:result.submitted_principal_id,submitted_agent_id:result.submitted_agent_id,artifact_ids:links.map(r=>r.artifact_id),summary_sha256:await sha256(String(result.summary))}:null,
 acceptance:acceptance?{id:acceptance.id,result_id:acceptance.result_id,run_id:acceptance.run_id,reviewer_principal_id:acceptance.reviewer_principal_id,reviewer_agent_id:acceptance.reviewer_agent_id,task_version:acceptance.task_version}:null,
 history:all.decision_lifecycle_transitions.filter(r=>r.approval_id==='approval_a').sort((a,b)=>Number(a.sequence)-Number(b.sequence)).map(h=>({sequence:h.sequence,kind:h.kind,before_version:h.before_version,after_version:h.after_version,before_state:h.before_state,after_state:h.after_state,run_id:h.run_id,created_at:h.created_at})),steps:s.steps,recovery,isolation};
 assertR3ConsumedObservation(value);return value;
}
async function state(storage:DurableObjectStorage,f:Fixture):Promise<State>{
 const x=await setup(storage,f.name),s={}as State;Object.assign(s,{storage,fixture:f,x,now:x.now,native:x.identity,human:human(storage),reviewer:claimIdentity(storage,'credential_other'),steps:[],actors:[],inspection:null,originalExpiry:0,originalDecisionHash:'',originalFence:Number(storage.sql.exec<Row>('SELECT fence FROM runs WHERE id=?','run_initial').one().fence),approvalEvent:null,enrollmentEvent:null,newRuntimeCreated:0,firstClaim:null,firstAccept:null});s.ctx={...x.ctx,workspace:{...x.ctx.workspace,clock:{nowMs:()=>s.now}}};return s;
}
export async function produceR3ConsumedJourney(caseId:R3ConsumedCase):Promise<R3ConsumedJourneyObservationV1>{
 if(caseId==='two_workspace_decision_claim_denial')return isolationCase();
 if(caseId==='consumed_active_restore_resume_held'||caseId==='done_history_restore_resume')return recoveryCase(caseId);
 const f=await policyFixture('j2_'+caseId);return runInDurableObject(f.stub,async(_o,{storage})=>{const s=await state(storage,f);await approved(s);await firstFive(s,caseId);return extract(s,caseId);});
}

async function isolationCase():Promise<R3ConsumedJourneyObservationV1>{
 const f=await policyFixture('j2_two_workspace_source'),foreign=await foreignSource(f.raw,'j2_two_workspace_target');
 // Orchestrate at the test caller, never use a source-owned I/O factory inside the other DO.
 const s=await runInDurableObject(f.stub,async(_o,{storage})=>{const value=await state(storage,f);await approved(value);return value;});
 const source=<T>(call:(s:State)=>T|Promise<T>)=>runInDurableObject(f.stub,(_o,t)=>{s.storage=t.storage;s.ctx={...s.ctx,workspace:{...owned(t.storage,f.name),clock:{nowMs:()=>s.now}},bucket:artifactBucket()};return call(s);});
 const targetContext=(storage:DurableObjectStorage,identity:VerifiedIdentity,key:string):ArtifactOperationContext=>({workspace:{...owned(storage,foreign.name),workspaceId:foreign.workspaceId,clock:{nowMs:()=>s.now}},identity,requestId:'j2_'+key,idempotencyKey:key,admission:{authorityEpoch:Number(storage.sql.exec('SELECT config_epoch FROM workspace_metadata').one().config_epoch),maintenanceGeneration:Number(storage.sql.exec('SELECT generation FROM maintenance_state WHERE id=1').one().generation)},runtimeId:'runtime_foreign',proofHash:'f'.repeat(64),bucket:artifactBucket()});
 const sourceBefore=await source(s=>captureR3ConsumedSnapshot(s.storage)),foreignBefore=await runInDurableObject(foreign.stub,(_o,t)=>captureR3ConsumedSnapshot(t.storage)),commands=createDecisionCommands([descriptor]);
 await source(s=>createTaskClaimCommands([descriptor]).prepareClaimTaskCommand(artifactContext(s,s.native,'positive_claim_preparation'),'task_a','run_not_executed',NEW_PROOF,{expected_version:5,runtime_instance_id:'runtime_new'}));
 await runInDurableObject(foreign.stub,async(_o,t)=>{
  const before=captureR3ConsumedSnapshot(t.storage),ctx=targetContext(t.storage,foreign.native,'foreign_decision');
  await commands.prepareRequestTaskDecision(ctx,'task_foreign',foreign.body,'f'.repeat(64),{approvalId:'approval_foreign',checkpointId:'checkpoint_foreign',proposalId:'proposal_foreign'});
  await commands.prepareApprovalDecision({...ctx,identity:foreign.human,idempotencyKey:'foreign_positive_decision'},'approval_foreign','approve',{expected_version:4,expected_approval_version:1,expected_proposal_version:1,reason:'Valid foreign prerequisite, not executed'});
  assertR3PrivateUnchanged(before,captureR3ConsumedSnapshot(t.storage));
 });
 const foreignAttempt=async(operation:'foreign-request-denial'|'foreign-human-denial'|'foreign-claim-denial'|'foreign-command-denial',call:(ctx:ArtifactOperationContext)=>Promise<unknown>)=>{
  const key=operation==='foreign-request-denial'?'foreign_decision':operation,before=await source(s=>captureR3ConsumedSnapshot(s.storage));
  const observed=await runInDurableObject(foreign.stub,async(_o,t)=>{
   const targetBefore=captureR3ConsumedSnapshot(t.storage),ctx=targetContext(t.storage,operation==='foreign-human-denial'?s.human:s.native,key);let status:number|null=null,code:string|null=null;
   try{await call(ctx);}catch(e){if(!(e instanceof AuthError||e instanceof HttpError))throw e;status=e.status;code=e.code;}
   assertR3PrivateUnchanged(targetBefore,captureR3ConsumedSnapshot(t.storage));
   if(status!==(operation==='foreign-command-denial'?400:401)||code!==(operation==='foreign-command-denial'?'INVALID_REQUEST':'UNAUTHENTICATED'))fail('J2_FOREIGN_OUTCOME_MISMATCH');
   return {status,code,request_id:ctx.requestId,key_sha256:await sha256(ctx.idempotencyKey)};
  });
  const after=await source(s=>captureR3ConsumedSnapshot(s.storage));assertR3PrivateUnchanged(before,after);
  s.steps.push({operation,kind:'domain',...observed,before_sha256:await sha256(canonicalJson(safeSnapshot(before))),after_sha256:await sha256(canonicalJson(safeSnapshot(after))),rows:R3_CONSUMED_TABLES.map(t=>delta(t,before,after)),event_ids:[],outcome_ids:[]});
 };
 await foreignAttempt('foreign-request-denial',ctx=>commands.prepareRequestTaskDecision(ctx,'task_foreign',foreign.body,'f'.repeat(64),{approvalId:'approval_foreign',checkpointId:'checkpoint_foreign',proposalId:'proposal_foreign'}));
 const decision={expected_version:4,expected_approval_version:1,expected_proposal_version:1,reason:'Foreign source identity must not decide'};
 await foreignAttempt('foreign-human-denial',ctx=>commands.prepareApprovalDecision(ctx,'approval_foreign','approve',decision));
 const claimBody={expected_version:5,runtime_instance_id:'runtime_new'};
 await foreignAttempt('foreign-claim-denial',ctx=>createTaskClaimCommands([descriptor]).prepareClaimTaskCommand(ctx,'task_a','run_denied',NEW_PROOF,claimBody));
 // The same-isolate test helper returns the actual prepared descriptor, not a recreated claim.
 // executeCommand must reject identity.workspaceId before invoking its source-bound closure.
 const prepared=await source(s=>commands.prepareRequestTaskDecision({...s.ctx,idempotencyKey:'decision'},'task_a',s.x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'}));
 await foreignAttempt('foreign-command-denial',async ctx=>executeCommand({workspace:ctx.workspace,requestId:ctx.requestId,idempotencyKey:ctx.idempotencyKey,fingerprint:await fingerprintRequest('POST','/source/foreign',{},s.x.body),admissionEpoch:ctx.admission.authorityEpoch,admissionGeneration:ctx.admission.maintenanceGeneration},s.native,prepared,s.x.body));
 await source(s=>record(s,'foreign-artifact-denial','foreign_artifact',async()=>{const response=await downloadArtifactContent(artifactContext(s,s.human,'foreign_artifact'),'input_foreign');await response.body?.cancel();return {status:response.status,data:null};},[404,'NOT_FOUND']));
 await source(s=>record(s,'foreign-approval-denial','foreign_approval',()=>withTransaction(s.storage,tx=>({status:null,data:getApproval(tx,{actor:resolveActor(tx,s.human,s.now),nowMs:s.now},'approval_foreign')})),[404,'NOT_FOUND']));
 const sourceAfter=await source(s=>captureR3ConsumedSnapshot(s.storage)),foreignAfter=await runInDurableObject(foreign.stub,(_o,t)=>captureR3ConsumedSnapshot(t.storage));assertR3PrivateUnchanged(sourceBefore,sourceAfter);assertR3PrivateUnchanged(foreignBefore,foreignAfter);
 const isolation:R3ConsumedJourneyObservationV1['isolation']={source_workspace:'ws_example',target_workspace:foreign.workspaceId,source_before_sha256:await sha256(canonicalJson(safeSnapshot(sourceBefore))),source_after_sha256:await sha256(canonicalJson(safeSnapshot(sourceAfter))),target_before_sha256:await sha256(canonicalJson(safeSnapshot(foreignBefore))),target_after_sha256:await sha256(canonicalJson(safeSnapshot(foreignAfter))),denials:s.steps.slice(-6).map(x=>({operation:x.operation,status:x.status!,code:x.code as 'UNAUTHENTICATED'|'INVALID_REQUEST'|'NOT_FOUND'}))};
 return source(s=>extract(s,'two_workspace_decision_claim_denial',isolation));
}

async function recoveryFixture(source:Fixture):Promise<CurrentRestoreFixture>{
 const raw=structuredClone(source.raw),targetName=source.name+'_target';raw.config.config_epoch++;raw.bundle.config_epoch=raw.config.config_epoch;raw.config.workspace_catalog[0].object_name=targetName;raw.config.static_credential_refs.find(c=>c.credential_id==='credential_research_2')!.enabled=false;
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const targetInput=await prepareBootstrap(raw.config,raw.bundle,'ws_example');
 const ledger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_target',authority_epoch:targetInput.config.config_epoch,config:targetInput.config,verification_bundle:targetInput.bundle,installation_digest:targetInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity),anchor={authorityEpoch:ledger.authority_epoch,sha256:await digestBytes(canonicalBytes(ledger))};
 return {source:source.stub,target:env.WORKSPACE.getByName(targetName),sourceName:source.name,targetName,sourceInput:source.input,targetInput,ledger,anchor,resolver:{generation:1,anchor:{...anchor},calls:0},captureId:'capture_'+source.name};
}
function immutableDecisionRows(all:Snapshot,done:boolean){
 const names=['approvals','decision_checkpoints','decision_proposals','decision_artifact_edges','decision_notice_intents','decision_lifecycle_heads','decision_lifecycle_transitions','task_results','task_acceptances','result_artifacts','artifact_associations']as const;
 return {...Object.fromEntries(names.map(n=>[n,all[n]])),initial:all.runs.filter(r=>r.id==='run_initial'),...(done?{task:all.tasks.filter(r=>r.id==='task_a'),run:all.runs.filter(r=>r.id==='run_new')}:{})};
}
async function measuredArtifactRows(s:State){
 const all=captureR3ConsumedSnapshot(s.storage),out=[];if(all.artifacts.length!==1)fail('J2_RECOVERY_ARTIFACT_COUNT');
 for(const a of all.artifacts){const g=all.artifact_generations.find(g=>g.id===a.committed_generation_id);if(!g||a.status!=='committed'||typeof a.byte_size!=='number'||!Number.isSafeInteger(a.byte_size)||a.byte_size<0||a.byte_size>65536)fail('J2_RECOVERY_ARTIFACT_BUDGET');const object=await s.ctx.bucket!.get(String(g.object_key));if(!object||object.size!==a.byte_size)fail('J2_RECOVERY_ARTIFACT_BYTES');const measured=await inspectArtifactStream(object!.body,a.byte_size);if(measured.sha256!==a.sha256)fail('J2_RECOVERY_ARTIFACT_DIGEST');out.push({id:a.id,generation_id:g.id,version:a.artifact_version,sha256:measured.sha256,byte_size:measured.byteSize});}return out;
}
async function recoveryCase(caseId:'consumed_active_restore_resume_held'|'done_history_restore_resume'):Promise<R3ConsumedJourneyObservationV1>{
 const done=caseId==='done_history_restore_resume',fixture=await policyFixture('j2_'+caseId),f=await recoveryFixture(fixture);
 const s=await runInDurableObject(f.source,async(_o,{storage})=>{const s=await state(storage,fixture);await approved(s);if(done)await happy(s);else{bump(s);await claim(s);}return s;});
 // Reconstruct all I/O-bearing contexts in their own object after each eviction/cross-object call.
 const work=<T>(lane:'source'|'target',call:(s:State,w:RecoveryWorkspace)=>T|Promise<T>)=>withCurrentRecoveryWorkspace(f,lane,w=>{s.storage=w.storage;s.ctx={workspace:{...owned(w.storage,w.objectName),clock:{nowMs:()=>s.now}},identity:s.native,requestId:'j2_recovery',idempotencyKey:'j2_recovery',admission:{authorityEpoch:Number(w.storage.sql.exec('SELECT config_epoch FROM workspace_metadata').one().config_epoch),maintenanceGeneration:Number(w.storage.sql.exec('SELECT generation FROM maintenance_state WHERE id=1').one().generation)},runtimeId:'runtime_new',proofHash:NEW_PROOF,bucket:w.artifactBucket};return call(s,w);});
 const snapshot=(lane:'source'|'target',phase:'source'|'target'|'capture'|'restore'=lane)=>withCurrentRecoveryWorkspace(f,lane,w=>captureR3ConsumedSnapshot(w.storage,phase==='capture'?'capture_source':phase==='restore'?'restore_target':lane==='source'?'source_source':'target_target'));
 const sourceBefore=await snapshot('source'),sourceDecision=canonicalJson(immutableDecisionRows(sourceBefore,done)),sourceArtifacts=await work('source',s=>measuredArtifactRows(s));
 if(!done)await work('source',s=>withTransaction(s.storage,tx=>{const actor=resolveActor(tx,s.native,s.now),run=tx.one<{status:string;lease_expires_at:number}>("SELECT status,lease_expires_at FROM runs WHERE id='run_new'")!;requireRuntimeProof(tx,{actor,nowMs:s.now,requestId:'capture_prerequisite',idempotencyKey:'capture_prerequisite'},'runtime_new',NEW_PROOF);if(run.status!=='active'||s.now>=run.lease_expires_at)fail('J2_CAPTURE_OWNER_PRECONDITION');}));
 const aggregate=async(lane:'source'|'target',label:'capture'|'restore',before:Snapshot)=>{
  const after=await snapshot(lane,label),last=await withCurrentRecoveryWorkspace(f,lane,w=>w.storage.sql.exec<Row>("SELECT * FROM idempotency_outcomes WHERE operation LIKE 'operator.recovery.%' AND operation NOT LIKE 'operator.recovery.admission.%' ORDER BY rowid DESC LIMIT 1").one());
  const auditEvents=label==='restore'?after.events.filter(e=>JSON.parse(String(e.actor_json)).principal_id==='system:recovery'):[];
  if(auditEvents.length>(done?0:1)||last.status!==200)fail('J2_RECOVERY_AGGREGATE_CORRELATION');
  s.steps.push({operation:label,kind:'aggregate',request_id:String(last.original_request_id),key_sha256:await sha256(String(last.key)),status:Number(last.status),code:null,before_sha256:await sha256(canonicalJson(safeSnapshot(before))),after_sha256:await sha256(canonicalJson(safeSnapshot(after))),rows:R3_CONSUMED_TABLES.map(t=>delta(t,before,after)),event_ids:auditEvents.map(e=>String(e.id)),outcome_ids:[await sha256(pk('idempotency_outcomes',last))]});
 };
 const capture=await captureBounded(f);await aggregate('source','capture',sourceBefore);
 if(!done){
  await work('source',s=>record(s,'captured-heartbeat-denial','captured_heartbeat',async()=>executeCommand(await execution(s,'captured_heartbeat',{expected_run_version:1,fence:2}),s.native,heartbeatRunCommand('run_new',NEW_PROOF),{expected_run_version:1,fence:2}),[503,'DEPENDENCY_UNAVAILABLE']));
  await work('source',s=>record(s,'captured-cleanup-denial','captured_cleanup',async()=>({status:null,data:await cleanupArtifactGenerations({workspace:s.ctx.workspace,bucket:s.ctx.bucket!,admission:s.ctx.admission},1)}),[401,'UNAUTHENTICATED']));
  await work('source',s=>record(s,'captured-expiry-denial','captured_expiry',()=>withTransaction(s.storage,tx=>({status:null,data:expireDueRuns(tx,s.now,1)})),[null,'ADMISSION_CLOSED']));
 }
 const targetBefore=await snapshot('target'),restored=await restoreBounded(f,capture);await aggregate('target','restore',targetBefore);if(!restored.receipt)fail('J2_RESTORE_RECEIPT_MISSING');
 const controls=await exclusiveControls(f,restored.receipt.id);
 for(const c of controls.observations){const added=c.after.idempotency_outcomes.filter(a=>!c.before.idempotency_outcomes.some(b=>pk('idempotency_outcomes',a)===pk('idempotency_outcomes',b)));s.steps.push({operation:c.operation,kind:'control',request_id:c.context.requestId,key_sha256:await sha256(c.context.operationId),status:c.status,code:c.code,before_sha256:await sha256(canonicalJson(safeSnapshot(c.before))),after_sha256:await sha256(canonicalJson(safeSnapshot(c.after))),rows:R3_CONSUMED_TABLES.map(t=>delta(t,c.before,c.after)),event_ids:[],outcome_ids:await Promise.all(added.map(r=>sha256(pk('idempotency_outcomes',r))))});}
 s.now=Date.now();
 await work('target',s=>{
  const all=captureR3ConsumedSnapshot(s.storage),runtime=all.runtimes.find(r=>r.id==='runtime_new'),session=all.sessions.find(r=>s.human.kind==='human'&&r.id===s.human.sessionId);
  if(all.maintenance_state[0].state!=='open'||all.workspace_metadata[0].admission_state!=='installed'||!runtime||runtime.authority_epoch!==f.sourceInput.config.config_epoch||runtime.status!=='expired'||runtime.revoked_at===null||!session||session.revoked_at===null)fail('J2_RESUMED_AUTHORITY_PRECONDITION');
 });
 await work('target',s=>record(s,'current-native-read','current_native',()=>withTransaction(s.storage,tx=>{const actor=resolveActor(tx,s.native,s.now);if(actor.principalId!=='agent_research')fail('J2_CURRENT_NATIVE_IDENTITY');return {status:null,data:null};})));
 await work('target',s=>record(s,'old-runtime-denial','old_runtime',()=>withTransaction(s.storage,tx=>({status:null,data:requireRuntimeProof(tx,{actor:resolveActor(tx,s.native,s.now),nowMs:s.now,requestId:'j2_old_runtime',idempotencyKey:'old_runtime'},'runtime_new',NEW_PROOF)})),[401,'UNAUTHENTICATED']));
 await work('target',s=>record(s,'old-session-denial','old_session',()=>withTransaction(s.storage,tx=>({status:null,data:resolveActor(tx,s.human,s.now)})),[401,'UNAUTHENTICATED']));
 let restoreAudit:NonNullable<R3ConsumedJourneyObservationV1['recovery']>['restore_audit']=null;
 if(!done){
  restoreAudit=await work('target',s=>withTransaction(s.storage,tx=>{
   const rows=tx.all<Row>("SELECT * FROM events WHERE type='task.expired' AND json_extract(actor_json,'$.principal_id')='system:recovery' LIMIT 2");if(rows.length!==1)fail('J2_RESTORE_AUDIT_MISSING');const occurred_at=rows[0].occurred_at,event=projectR3RecoveryEvent(rows[0]);if(!isRestoreExpiryEvent(tx,event))fail('J2_RESTORE_AUDIT_INCOMPLETE');const head=tx.one<Row>("SELECT * FROM decision_lifecycle_heads WHERE approval_id='approval_a'")!,run=tx.one<Row>("SELECT * FROM runs WHERE id='run_new'")!;if(run.ended_at!==occurred_at||head.task_state!=='doing')fail('J2_RESTORE_LINEAGE');return {event_id:event.id,occurred_at:Number(occurred_at),actor_principal:'system:recovery' as const,run_id:event.run_id!,fence:event.fence!,task_version:event.task_version!,head_version:Number(head.task_version),head_state:'doing' as const,provenance:'completed-restore-expiry' as const};
  }));
  const targetProof=await sha256('synthetic_target_j2_runtime_proof'),body={label:'New target runtime after genuine local resume'};
  await work('target',s=>record(s,'target-enroll','target_enroll',async()=>executeCommand(await execution(s,'target_enroll',body),s.native,createRuntimeCommand({runtimeId:'runtime_target',proofSha256:targetProof}),body)));
  await work('target',s=>{if(s.now>=s.originalExpiry)fail('J2_RESTORED_HELD_LIFETIME_PRECONDITION');const body={expected_version:7,runtime_instance_id:'runtime_target'};return record(s,'restored-held-claim-denial','restored_held',async()=>executeCommand(await execution(s,'restored_held',body),s.native,await createTaskClaimCommands([descriptor]).prepareClaimTaskCommand({workspace:s.ctx.workspace,identity:s.native,bucket:s.ctx.bucket,admission:s.ctx.admission,idempotencyKey:'restored_held',requestId:'j2_restored_held'},'task_a','run_restored_denied',targetProof,body),body),[503,'DEPENDENCY_UNAVAILABLE']);});
 }else{
  await work('target',s=>inspect(s,s.reviewer,'restored-reviewer'));
  await work('target',async s=>{const body={expected_version:7,reason:'Native B independently reviewed current result and bytes'},out=await record(s,'restored-accept-replay','accept',async()=>executeCommand(await execution(s,'accept',body),s.reviewer,acceptTaskResultCommand('task_a'),body));if(canonicalJson(out)!==canonicalJson(s.firstAccept))fail('J2_RESTORED_ACCEPTANCE_CHANGED');});
 }
 const targetAfter=await snapshot('target'),targetDecision=canonicalJson(immutableDecisionRows(targetAfter,done)),targetArtifacts=await work('target',s=>measuredArtifactRows(s));if(sourceDecision!==targetDecision||canonicalJson(sourceArtifacts)!==canonicalJson(targetArtifacts))fail('J2_RESTORED_IMMUTABLE_FACTS_CHANGED');
 const recovery:NonNullable<R3ConsumedJourneyObservationV1['recovery']>={capture_id:f.captureId,source_job_id:capture.progress.job_id,target_job_id:restored.job_id,manifest_sha256:await digestBytes(canonicalBytes(capture.manifest)),chunk_count:capture.manifest.database.chunks.length,retirement_sha256:await digestBytes(canonicalBytes(controls.retirement)),probe_sha256:await digestBytes(canonicalBytes(controls.probe)),cutover_sha256:await digestBytes(canonicalBytes(controls.cutover)),resume_sha256:await digestBytes(canonicalBytes(controls.resumed)),source_epoch:f.sourceInput.config.config_epoch,target_epoch:f.targetInput.config.config_epoch,source_decision_sha256:await sha256(sourceDecision),target_decision_sha256:await sha256(targetDecision),source_artifacts_sha256:await sha256(canonicalJson(sourceArtifacts)),target_artifacts_sha256:await sha256(canonicalJson(targetArtifacts)),retirement_id:controls.retirement.id,probe_id:controls.probe.id,cutover_id:controls.cutover.id,resume_id:controls.resumed.id,resume_operation_id:'j2_resume',pending_admission_key_sha256:controls.pendingKeySha256,resume_old_generation:controls.resumed.old_generation,resume_new_generation:controls.resumed.new_generation,source_state:'retired',target_state:'open',target_admission:'installed',current_native_principal:'agent_research',old_runtime_code:'UNAUTHENTICATED',old_session_code:'UNAUTHENTICATED',restore_audit:restoreAudit};
 return work('target',s=>extract(s,caseId,null,recovery));
}
