import {captureJ1PrecommandContext} from './r3-precommand-capture';
import type {J1PrecommandSink} from './r3-precommand-context';
/** Private fixture composition only. No import from production entrypoints or live authority. */
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {env} from 'cloudflare:workers';
import {decisionFixture,descriptor} from './decision-policy';
import {setup} from './persisted-decision';
import {human} from './settings';
import {PROOF_A,claimIdentity} from './claims';
import {createDecisionCommands} from '../../src/approvals/commands-source';
import {executeCommand,type CommandOutcome} from '../../src/workspace/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {canonicalJson,sha256,prepareBootstrap} from '../../src/config/bootstrap';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {describeError,HttpError} from '../../src/http/envelopes';
import {AuthError} from '../../src/auth/context';
import {heartbeatRunCommand} from '../../src/tasks/lease';
import {submitTaskResultCommand} from '../../src/tasks/results';
import {failTaskCommand} from '../../src/tasks/failure';
import {inspectArtifactStream} from '../../src/artifacts/stream';
import {R3_PRIVATE_TABLES,assertR3LocalObservation,type R3JourneyCase,type R3LocalJourneyObservationV1,type R3JourneyStep} from './r3-journey-observation';
import type {ApprovalDecisionRequest} from '../../src/http/dto';
type Row=Record<string,string|number|null>;
const extraTables=['recovery_jobs','recovery_chunks','probe_receipts'] as const;
const inventory=[...R3_PRIVATE_TABLES,...extraTables];
type PrivateSnapshot=Record<typeof inventory[number],Row[]>;
const q=(name:string)=>'"'+name+'"'; // Identifiers ONLY from the pinned registry, never caller strings.
const fail=(code:string):never=>{throw Error(code);};
/** Preflight all rows/bytes before materializing any secret-bearing row. Never export this value. */
export function captureR3PrivateSnapshot(storage:DurableObjectStorage):PrivateSnapshot{
 let total=0;
 for(const name of inventory){
  const table=TABLE_REGISTRY.find(t=>t.name===name);if(!table)fail('R3_PRIVATE_LAYOUT_MISMATCH');
  const columns=storage.sql.exec<{name:string;type:string;pk:number}>('PRAGMA table_info('+q(name)+')').toArray();
  if(columns.length!==table!.columns.length||columns.some((c,i)=>c.name!==table!.columns[i].name||c.type!==table!.columns[i].type||c.pk!==table!.columns[i].pk))fail('R3_PRIVATE_LAYOUT_MISMATCH');
  const size=table!.columns.map(c=>'coalesce(length(cast('+q(c.name)+' AS BLOB)),0)').join('+');
  const b=storage.sql.exec<{count:number;max_bytes:number;total_bytes:number}>('SELECT count(*) AS count,coalesce(max(bytes),0) AS max_bytes,coalesce(sum(bytes),0) AS total_bytes FROM (SELECT '+size+' AS bytes FROM '+q(name)+' LIMIT 129)').one();
  total+=b.total_bytes;if(b.count>128||b.max_bytes>65536||total>2097152)fail('R3_PRIVATE_SNAPSHOT_BUDGET');
 }
 const result={} as PrivateSnapshot;
 for(const name of inventory){const table=TABLE_REGISTRY.find(t=>t.name===name)!;
  const rows=storage.sql.exec<Row>('SELECT '+table.columns.map(c=>q(c.name)).join(',')+' FROM '+q(name)+' ORDER BY '+table.primaryKey.map(q).join(',')+' LIMIT 129').toArray();
  if(rows.length>128||rows.some(row=>Object.values(row).some(v=>v!==null&&typeof v!=='string'&&typeof v!=='number')))fail('R3_PRIVATE_SNAPSHOT_BUDGET');
  result[name]=rows;
 }
 return result;
}
export function assertR3PrivateUnchanged(before:PrivateSnapshot,after:PrivateSnapshot):void{
 // Do not use deepEqual: its assertion diff would print credentials, sessions and raw payloads.
 if(canonicalJson(before)!==canonicalJson(after))fail('R3_PRIVATE_STATE_CHANGED');
}
const safeFields:Partial<Record<typeof inventory[number],readonly string[]>>={
 tasks:['id','state','task_version','proposal_version','approval_id','active_run_id','latest_run_id','next_fence'],runs:['id','status','run_version','fence','ended_at'],
 approvals:['id','task_id','run_id','checkpoint_id','proposal_id','approval_version','proposal_version','task_version_at_request','status','created_at','expires_at','decided_at','consumed_run_id','consumed_fence'],
 decision_checkpoints:['id','task_id','run_id','created_at'],decision_proposals:['id','task_id','proposal_version','created_at'],
 decision_artifact_edges:['approval_id','role','artifact_id','generation_id','artifact_version','sha256','byte_size'],decision_notice_intents:['approval_id','reviewer_principal_id','event_id'],
 decision_lifecycle_heads:['approval_id','task_id','task_version','task_state','transition_count','last_transition_id'],decision_lifecycle_transitions:['id','approval_id','task_id','sequence','kind','before_version','after_version','before_state','after_state','run_id','created_at'],
 events:['id','sequence','type','resource_type','resource_id'],task_history:['id','task_id','event_id'],idempotency_outcomes:['operation','target','original_request_id','event_id','status'],
 artifacts:['id','artifact_version','status','sha256','byte_size','committed_generation_id'],artifact_generations:['id','artifact_id','state','sha256','byte_size'],
 recovery_jobs:['id','capture_id','operation','state'],recovery_chunks:['job_id','chunk_index','sha256','byte_size','row_count'],probe_receipts:['id'],
};
function safeProjection(snapshot:PrivateSnapshot){return Object.fromEntries(inventory.map(name=>[name,{count:snapshot[name].length,rows:snapshot[name].map(row=>Object.fromEntries((safeFields[name]??[]).filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])))}]));}
function key(name:typeof inventory[number],row:Row){return canonicalJson(TABLE_REGISTRY.find(t=>t.name===name)!.primaryKey.map(k=>row[k]));}
function changes<T extends typeof inventory[number]>(name:T,before:PrivateSnapshot,after:PrivateSnapshot){
 const b=new Map(before[name].map(r=>[key(name,r),r])),a=new Map(after[name].map(r=>[key(name,r),r]));
 return {table:name,before_count:b.size,after_count:a.size,inserted:[...a.keys()].filter(k=>!b.has(k)).length,deleted:[...b.keys()].filter(k=>!a.has(k)).length,updated:[...a.keys()].filter(k=>b.has(k)&&canonicalJson(a.get(k))!==canonicalJson(b.get(k))).length};
}
async function step(operation:string,requestId:string,mutationKey:string,before:PrivateSnapshot,after:PrivateSnapshot,response:{status:number|null;code:string|null}):Promise<R3JourneyStep>{
 const newRows=(name:typeof inventory[number])=>after[name].filter(a=>!before[name].some(b=>key(name,a)===key(name,b)));
 const domain=['request','approve','reject'].includes(operation);
 return {operation,request_id:requestId,key_sha256:await sha256(mutationKey),before_sha256:await sha256(canonicalJson(safeProjection(before))),after_sha256:await sha256(canonicalJson(safeProjection(after))),rows:R3_PRIVATE_TABLES.map(t=>changes(t,before,after)),response,event_ids:domain?newRows('events').map(r=>String(r.id)):[],outcome_ids:domain?await Promise.all(newRows('idempotency_outcomes').map(r=>sha256(key('idempotency_outcomes',r)))):[]};
}
type Initial=Awaited<ReturnType<typeof setup>>;
async function action(storage:DurableObjectStorage,steps:R3JourneyStep[],operation:string,requestId:string,mutationKey:string,run:()=>Promise<CommandOutcome<unknown>>|CommandOutcome<unknown>,expectedCode:string|null=null){
 const before=captureR3PrivateSnapshot(storage);let result:CommandOutcome<unknown>|undefined,response:{status:number;code:string|null};
 try{result=await run();response={status:result.status,code:null};}catch(error){if(!(error instanceof HttpError||error instanceof AuthError))throw error;const d=describeError(error);response={status:d.status,code:d.code};}
 if(response.code!==expectedCode)fail('R3_UNEXPECTED_COMMAND_OUTCOME');
 const after=captureR3PrivateSnapshot(storage);if(expectedCode||operation.endsWith('-replay'))assertR3PrivateUnchanged(before,after);
 steps.push(await step(operation,requestId,mutationKey,before,after,response));return result;
}
async function request(storage:DurableObjectStorage,name:string){
 const x=await setup(storage,name),commands=createDecisionCommands([descriptor]),steps:R3JourneyStep[]=[];
 const prepare=(body=x.body)=>commands.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'});
 const originalFence=Number(storage.sql.exec('SELECT fence FROM runs WHERE id=?','run_initial').one().fence);
 const first=await action(storage,steps,'request',x.execution.requestId,'decision',async()=>executeCommand(x.execution,x.identity,await prepare(),x.body));
 const originalExpiry=Number(storage.sql.exec('SELECT expires_at FROM approvals WHERE id=?','approval_a').one().expires_at);
 return {x,commands,steps,prepare,first,originalExpiry,originalFence};
}
type Requested=Awaited<ReturnType<typeof request>>;
async function decide(storage:DurableObjectStorage,r:Requested,kind:'approve'|'reject',versionsBefore=false){
 const x=r.x,identity=human(storage),ctx={...x.ctx,identity,idempotencyKey:'human_decision'},a=storage.sql.exec('SELECT * FROM approvals WHERE id=?','approval_a').one(),t=storage.sql.exec('SELECT task_version FROM tasks WHERE id=?','task_a').one();
 const body:ApprovalDecisionRequest={expected_version:Number(t.task_version),expected_approval_version:Number(a.approval_version),expected_proposal_version:Number(a.proposal_version),reason:'Synthetic immutable intent review'};
 const execution=async(input=body)=>({...x.execution,idempotencyKey:ctx.idempotencyKey,fingerprint:await fingerprintRequest('POST','/approvals/approval_a/'+kind,{},input)});
 const prepare=(input=body)=>r.commands.prepareApprovalDecision(ctx,'approval_a',kind,input);
 if(versionsBefore)for(const [field,label]of [['expected_version','task'],['expected_approval_version','approval'],['expected_proposal_version','proposal']]as const){const input={...body,[field]:body[field]+1};await action(storage,r.steps,'stale-'+label+'-denial',x.execution.requestId,ctx.idempotencyKey,async()=>executeCommand(await execution(input),identity,await prepare(input),input),'VERSION_CONFLICT');}
 const first=await action(storage,r.steps,kind,x.execution.requestId,ctx.idempotencyKey,async()=>executeCommand(await execution(),identity,await prepare(),body));
 return {identity,ctx,body,execution,prepare,first};
}
async function observation(storage:DurableObjectStorage,r:Pick<Requested,'steps'|'originalExpiry'|'originalFence'>,caseId:R3JourneyCase,sourceId:string,bucket:R2Bucket,humanPrincipal:string|null=null):Promise<R3LocalJourneyObservationV1>{
 const snapshot=captureR3PrivateSnapshot(storage),a=snapshot.approvals.find(row=>row.id==='approval_a')!,t=snapshot.tasks.find(row=>row.id==='task_a')!,run=snapshot.runs.find(row=>row.id==='run_initial')!,proposal=snapshot.decision_proposals.find(row=>row.id==='proposal_a')!;
 if(run.fence!==r.originalFence)fail('R3_ORIGINAL_FENCE_CHANGED');
 const edges=snapshot.decision_artifact_edges.filter(row=>row.approval_id==='approval_a'),artifactIds=[...new Set(edges.map(e=>String(e.artifact_id)))];if(artifactIds.length>5)fail('R3_ARTIFACT_BUDGET');
 const artifacts=[];
 for(const id of artifactIds){const e=edges.find(e=>e.artifact_id===id)!,g=snapshot.artifact_generations.find(g=>g.id===e.generation_id)!,metadata=snapshot.artifacts.find(a=>a.id===id)!;
  if(!g||!metadata||metadata.committed_generation_id!==g.id||e.byte_size!==metadata.byte_size||Number(e.byte_size)>65536)fail('R3_ARTIFACT_IDENTITY');
  const object=await bucket.get(String(g.object_key));if(!object||object.size!==e.byte_size||object.size>65536)fail('R3_ARTIFACT_IDENTITY');
  const measured=await inspectArtifactStream(object!.body,Number(e.byte_size));
  artifacts.push({id,generation_id:g.id,version:e.artifact_version,sha256:e.sha256,byte_size:e.byte_size,measured_sha256:measured.sha256,measured_byte_size:measured.byteSize,roles:edges.filter(e=>e.artifact_id===id).map(e=>e.role).sort()});
 }
 const metadata=snapshot.workspace_metadata[0],binding=JSON.parse(String(proposal.binding_json)) as {policyVersion:number;policyCanonicalJson:string;configEpoch:number;installationDigest:string};
 const config=JSON.parse(String(metadata.config_json)),policy=config.workspace_policies.find((p:{workspace_id:string})=>p.workspace_id==='ws_example').decision_policy;
 if(binding.policyVersion!==policy.policy_version||binding.policyCanonicalJson!==canonicalJson(policy))fail('R3_POLICY_IDENTITY');
 const value={format_version:1,stage:'command-source-fixture',origin:'local-workers-synthetic-fixture',acceptance_eligible:false,case_id:caseId,schema_version:19,workspace_id:'ws_example',source_id:sourceId,target_id:null,observation_sequence:1,
  provenance:{private_descriptor:true,synthetic_human_session:true,local_sqlite:true,emulated_artifact_store:true},descriptor:{action_id:descriptor.actionId,schema_version:descriptor.schemaVersion,schema_sha256:descriptor.schemaSha256,semantic_revision:descriptor.semanticRevision},policy:{version:policy.policy_version,sha256:await sha256(canonicalJson(policy)),config_epoch:binding.configEpoch,installation_sha256:binding.installationDigest},principals:{requester:{kind:'agent',principal_id:JSON.parse(String(a.requested_by_json)).principal_id},human:humanPrincipal?{kind:'human',principal_id:humanPrincipal}:null},
  decision:{task_id:t.id,approval_id:a.id,proposal_id:a.proposal_id,checkpoint_id:a.checkpoint_id,task_version:t.task_version,proposal_version:a.proposal_version,approval_version:a.approval_version,task_state:t.state,approval_status:a.status,created_at:a.created_at,expires_at:a.expires_at,original_expires_at:r.originalExpiry,decided_at:a.decided_at,consumed_run_id:a.consumed_run_id,consumed_fence:a.consumed_fence,semantic_anchor_sha256:await sha256(String(proposal.semantic_anchor_json))},runs:{original:{id:run.id,fence:run.fence,status:run.status,ended_at:run.ended_at},active_run_id:t.active_run_id},artifacts,
  reviewer_ids:JSON.parse(String(a.reviewer_ids_json)),notices:snapshot.decision_notice_intents.filter(n=>n.approval_id===a.id).map(n=>({reviewer_id:n.reviewer_principal_id,event_id:n.event_id})),steps:r.steps,history:snapshot.decision_lifecycle_transitions.filter(h=>h.approval_id===a.id).sort((a,b)=>Number(a.sequence)-Number(b.sequence)).map(h=>({sequence:h.sequence,kind:h.kind,before_version:h.before_version,after_version:h.after_version,before_state:h.before_state,after_state:h.after_state,run_id:h.run_id})),recovery:null};
 // Recovery cases add actual target facts before the final predicate invocation.
 return value as R3LocalJourneyObservationV1;
}
export interface R3JourneyOptions {onPrecommandContext:J1PrecommandSink;}
function precommandSink(options:unknown):J1PrecommandSink|undefined{
 if(options===undefined)return undefined;
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.getPrototypeOf(options)!==Object.prototype)fail('J1_PRECOMMAND_OPTIONS_INVALID');
 const d=Object.getOwnPropertyDescriptors(options),keys=Reflect.ownKeys(d);
 if(keys.length!==1||keys[0]!=='onPrecommandContext'||!Object.hasOwn(d.onPrecommandContext,'value')||typeof d.onPrecommandContext.value!=='function')fail('J1_PRECOMMAND_OPTIONS_INVALID');
 return d.onPrecommandContext.value as J1PrecommandSink;
}
export async function produceR3JourneyCase(caseId:R3JourneyCase,options?:R3JourneyOptions):Promise<R3LocalJourneyObservationV1>{
 const sink=precommandSink(options);
 if(caseId.endsWith('_restore')||caseId==='changed_chunk_continuation_denied')return recoveryCase(caseId,sink);
 const f=await decisionFixture('j1_'+caseId);
 if(sink)await sink(await captureJ1PrecommandContext(caseId,f));
 return runInDurableObject(f.stub,async(_o,s)=>{
  const r=await request(s.storage,f.name),x=r.x;
  if(caseId==='request_pause_replay'){
   const replay=await action(s.storage,r.steps,'request-replay',x.execution.requestId,'decision',async()=>executeCommand(x.execution,x.identity,await r.prepare(),x.body));if(canonicalJson(replay)!==canonicalJson(r.first))fail('R3_REPLAY_OUTCOME_CHANGED');
   const changed={...x.body,checkpoint:{...x.body.checkpoint,summary:'Changed exact intent'}};
   await action(s.storage,r.steps,'request-conflict',x.execution.requestId,'decision',async()=>executeCommand({...x.execution,fingerprint:await fingerprintRequest('POST','/request-decision',{},changed)},x.identity,await r.prepare(changed),changed),'IDEMPOTENCY_CONFLICT');
   for(const operation of ['heartbeat','submit','fail']as const){const key='paused_'+operation;
    await action(s.storage,r.steps,'paused-'+operation+'-denial',x.execution.requestId,key,()=>operation==='heartbeat'?executeCommand({...x.execution,idempotencyKey:key},x.identity,heartbeatRunCommand('run_initial',PROOF_A),{expected_run_version:2,fence:1}):operation==='submit'?executeCommand({...x.execution,idempotencyKey:key},x.identity,submitTaskResultCommand('task_a',PROOF_A),{expected_version:4,run_id:'run_initial',fence:1,result:{summary:'Not authorized',artifact_ids:[]}}):executeCommand({...x.execution,idempotencyKey:key},x.identity,failTaskCommand('task_a',PROOF_A),{expected_version:4,run_id:'run_initial',fence:1,reason:'Not authorized',outcome_unknown:false}),'STALE_RUN');
   }
  }else{
   const kind=caseId==='human_approve_replay_revoked'?'approve':'reject',d=await decide(s.storage,r,kind,kind==='approve');
   const replay=await action(s.storage,r.steps,kind+'-replay',x.execution.requestId,d.ctx.idempotencyKey,async()=>executeCommand(await d.execution(),d.identity,await d.prepare(),d.body));if(canonicalJson(replay)!==canonicalJson(d.first))fail('R3_REPLAY_OUTCOME_CHANGED');
   if(kind==='approve'){
    // Explicit test control. No-write comparison starts AFTER revocation.
    s.storage.sql.exec('UPDATE sessions SET revoked_at=? WHERE id=?',x.now,d.identity.kind==='human'?d.identity.sessionId:'');
    await action(s.storage,r.steps,'revoked-session-denial',x.execution.requestId,d.ctx.idempotencyKey,async()=>executeCommand(await d.execution(),d.identity,await d.prepare(),d.body),'UNAUTHENTICATED');
   }else{const changed={...d.body,reason:'Changed exact reason'};await action(s.storage,r.steps,'reject-conflict',x.execution.requestId,d.ctx.idempotencyKey,async()=>executeCommand(await d.execution(changed),d.identity,await d.prepare(changed),changed),'IDEMPOTENCY_CONFLICT');}
  }
  const value=await observation(s.storage,r,caseId,f.name,x.ctx.bucket!,caseId==='request_pause_replay'?null:'human_operator');assertR3LocalObservation(value);return value;
 });
}


import {captureCurrentFixture,restoreCurrentFixture,withCurrentRecoveryWorkspace,targetArtifactBucket,type CurrentRestoreFixture} from '../recovery/current-restore-fixture';
import {fixtureIntegrity,recoveryContext} from './recovery-fixture';
import {signRecord} from '../../src/recovery/manifest';
import {canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import {beginRestore,writeRestoreChunk,advanceVerify} from '../../src/recovery/restore';
import type {CurrentLedger,LedgerAnchor,RecoveryJobProgress,RecoveryContext} from '../../src/recovery/protocol';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {requireRuntimeProof} from '../../src/auth/runtime-proof';
/** Compose signed decision fixture material BEFORE target preparation; no grant edits in SQL. */
async function recoveryFixture(name:string):Promise<CurrentRestoreFixture>{
 const source=await decisionFixture(name+'_source'),targetName=name+'_target',raw=structuredClone(source.raw);
 raw.config.config_epoch=2;raw.config.workspace_catalog[0].object_name=targetName;raw.bundle.config_epoch=2;
 raw.config.static_credential_refs.find(c=>c.credential_id==='credential_research_2')!.enabled=false;
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const targetInput=await prepareBootstrap(raw.config,raw.bundle,'ws_example');
 const ledger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_target',authority_epoch:2,config:targetInput.config,verification_bundle:targetInput.bundle,installation_digest:targetInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const anchor:LedgerAnchor={authorityEpoch:2,sha256:await digestBytes(canonicalBytes(ledger))};
 return {source:source.stub,target:env.WORKSPACE.getByName(targetName),sourceName:source.name,targetName,captureId:'capture_'+name,sourceInput:source.input,targetInput,ledger,anchor,resolver:{generation:1,anchor:{...anchor},calls:0}};
}
const snapshotAt=(f:CurrentRestoreFixture,lane:'source'|'target')=>withCurrentRecoveryWorkspace(f,lane,w=>captureR3PrivateSnapshot(w.storage));
/** Aggregate capture/restore diagnostic: correlation names its last actual persisted operation, not a fictional HTTP request. */
async function aggregateStep(f:CurrentRestoreFixture,lane:'source'|'target',steps:R3JourneyStep[],label:string,before:PrivateSnapshot){
 const after=await snapshotAt(f,lane);
 const last=await withCurrentRecoveryWorkspace(f,lane,w=>w.storage.sql.exec<Row>("SELECT original_request_id,key,status FROM idempotency_outcomes WHERE operation LIKE 'operator.recovery.%' ORDER BY rowid DESC LIMIT 1").one());
 steps.push(await step(label,String(last.original_request_id),String(last.key),before,after,{status:Number(last.status),code:null}));
}
function immutableDecisionRows(snapshot:PrivateSnapshot){
 const names=['approvals','decision_checkpoints','decision_proposals','decision_artifact_edges','decision_notice_intents','decision_lifecycle_heads','decision_lifecycle_transitions']as const;
 return {...Object.fromEntries(names.map(n=>[n,snapshot[n]])),task:snapshot.tasks.filter(r=>r.id==='task_a'),run:snapshot.runs.filter(r=>r.id==='run_initial')};
}
function safeDecisionProjection(snapshot:PrivateSnapshot){const safe=safeProjection(snapshot);return Object.fromEntries(['tasks','runs','approvals','decision_checkpoints','decision_proposals','decision_artifact_edges','decision_notice_intents','decision_lifecycle_heads','decision_lifecycle_transitions'].map(n=>[n,safe[n]]));}
async function recoveryCase(caseId:R3JourneyCase,sink?:J1PrecommandSink):Promise<R3LocalJourneyObservationV1>{
 const f=await recoveryFixture('j1_'+caseId),rejected=caseId==='rejected_command_history_restore';
 if(sink)await sink(await captureJ1PrecommandContext(caseId,{stub:f.source,name:f.sourceName,input:f.sourceInput},{name:f.targetName,input:f.targetInput}));
 const original=await runInDurableObject(f.source,async(_o,s)=>{
  const r=await request(s.storage,f.sourceName);if(rejected)await decide(s.storage,r,'reject');
  const obs=await observation(s.storage,r,caseId,f.sourceName,r.x.ctx.bucket!,rejected?'human_operator':null);
  return {obs,oldNative:r.x.identity,oldHuman:human(s.storage),now:r.x.now};
 });
 const before=await snapshotAt(f,'source'),steps=original.obs.steps;
 const capture=await captureCurrentFixture(f,{evict:true});
 if(capture.chunks.length>128||capture.chunks.some(c=>c.bytes.byteLength>1048576))fail('R3_RECOVERY_BUDGET');
 await aggregateStep(f,'source',steps,'capture',before);
 let restored:RecoveryJobProgress;
 if(caseId==='changed_chunk_continuation_denied'){
  const empty=await snapshotAt(f,'target');
  restored=await withCurrentRecoveryWorkspace(f,'target',async w=>beginRestore(w,await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'j1_begin_restore'}),capture.manifest,f.ledger));
  await aggregateStep(f,'target',steps,'begin-restore',empty);
  const first=capture.chunks[0],metadata={index:first.metadata.index,sha256:first.metadata.sha256,byte_size:first.metadata.byte_size};
  let originalContext:RecoveryContext|undefined;
  const beforeWrite=await snapshotAt(f,'target');
  restored=await withCurrentRecoveryWorkspace(f,'target',async w=>{originalContext=await recoveryContext(w,'write-chunk',metadata,f.captureId,{anchor:f.anchor,operationId:'j1_first_chunk'});return writeRestoreChunk(w,originalContext,metadata,new Uint8Array(first.bytes));});
  if(!originalContext)fail('R3_MISSING_RECOVERY_CONTEXT');
  await aggregateStep(f,'target',steps,'chunk-write',beforeWrite);
  const context=originalContext!;
  // Preserve the actual original operation/context across eviction; no prepared decision receipt crosses it.
  await evictDurableObject(f.target);
  const beforeReplay=await snapshotAt(f,'target');
  const replay=await withCurrentRecoveryWorkspace(f,'target',w=>writeRestoreChunk(w,context,metadata,new Uint8Array(first.bytes)));
  if(canonicalJson(replay)!==canonicalJson(restored))fail('R3_RECOVERY_REPLAY_CHANGED');
  const afterReplay=await snapshotAt(f,'target');assertR3PrivateUnchanged(beforeReplay,afterReplay);
  const storedReplay=afterReplay.idempotency_outcomes.find(row=>row.operation==='operator.recovery.write-chunk'&&row.key===context.operationId);
  if(!storedReplay||canonicalJson(JSON.parse(String(storedReplay.outcome_json)))!==canonicalJson(replay))fail('R3_RECOVERY_REPLAY_NOT_JOINED');
  steps.push(await step('chunk-replay',context.requestId,context.operationId,beforeReplay,afterReplay,{status:Number(storedReplay!.status),code:null}));
  const changed=new Uint8Array(first.bytes.slice(0));changed[changed.length-1]^=1;
  let denied=false;
  try{await withCurrentRecoveryWorkspace(f,'target',w=>writeRestoreChunk(w,context,metadata,changed));}catch(error){if(!(error instanceof Error)||error.message!=='RECOVERY_CHUNK_MISMATCH')throw error;denied=true;}
  if(!denied)fail('R3_CHANGED_CHUNK_NOT_DENIED');
  const afterDenial=await snapshotAt(f,'target');assertR3PrivateUnchanged(afterReplay,afterDenial);
  steps.push(await step('changed-chunk-denial',context.requestId,context.operationId,afterReplay,afterDenial,{status:null,code:'RECOVERY_CHUNK_MISMATCH'}));
  await evictDurableObject(f.target);
  for(const chunk of capture.chunks.slice(1)){
   const m={index:chunk.metadata.index,sha256:chunk.metadata.sha256,byte_size:chunk.metadata.byte_size};
   restored=await withCurrentRecoveryWorkspace(f,'target',async w=>writeRestoreChunk(w,await recoveryContext(w,'write-chunk',m,f.captureId,{anchor:f.anchor,operationId:'j1_continue_'+m.index}),m,new Uint8Array(chunk.bytes)));
  }
  for(let i=0;i<500&&restored.state==='running';i++){
   restored=await withCurrentRecoveryWorkspace(f,'target',async w=>advanceVerify(w,await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'j1_verify_'+i}),capture.manifest));
   if(restored.state==='running')await evictDurableObject(f.target);
  }
  if(restored.state!=='complete'||restored.job_id!==replay.job_id)fail('R3_RECOVERY_CONTINUATION_FAILED');
  await aggregateStep(f,'target',steps,'continue-restore',afterDenial);
 }else{
  const empty=await snapshotAt(f,'target');restored=await restoreCurrentFixture(f,capture,{evict:true});await aggregateStep(f,'target',steps,'restore',empty);
 }
 const after=await snapshotAt(f,'target');
 if(after.runtimes.some(r=>r.revoked_at===null||r.status==='online')||after.sessions.some(r=>r.revoked_at===null)||after.maintenance_state[0].state!=='restored')fail('R3_OLD_AUTHORITY_NOT_INVALIDATED');
 if(canonicalJson(immutableDecisionRows(before))!==canonicalJson(immutableDecisionRows(after)))fail('R3_RESTORED_DECISION_CHANGED');
 await withCurrentRecoveryWorkspace(f,'target',async w=>{
  const requestId='j1_restored_authority_check';
  await action(w.storage,steps,'old-runtime-denial',requestId,'old_runtime',()=>withTransaction(w.storage,tx=>{const actor=resolveActor(tx,original.oldNative,Date.now());requireRuntimeProof(tx,{actor,nowMs:Date.now(),requestId,idempotencyKey:'old_runtime'},'runtime_a',PROOF_A);return {status:200,data:null};}),'UNAUTHENTICATED');
  await action(w.storage,steps,'old-session-denial',requestId,'old_session',()=>withTransaction(w.storage,tx=>{resolveActor(tx,original.oldHuman,Date.now());return {status:200,data:null};}),'UNAUTHENTICATED');
 });
 const final=await withCurrentRecoveryWorkspace(f,'target',w=>observation(w.storage,{steps,originalExpiry:original.obs.decision.original_expires_at,originalFence:original.obs.runs.original.fence},caseId,f.sourceName,targetArtifactBucket(),rejected?'human_operator':null));
 final.target_id=f.targetName;
 const artifactsBefore=await sha256(canonicalJson(original.obs.artifacts)),artifactsAfter=await sha256(canonicalJson(final.artifacts));
 final.recovery={capture_id:capture.manifest.capture_id,source_job_id:capture.progress.job_id,target_job_id:restored.job_id,operation_id:String(after.idempotency_outcomes.filter(r=>String(r.operation).startsWith('operator.recovery.')).at(-1)!.key),manifest_sha256:await digestBytes(canonicalBytes(capture.manifest)),schema_version:19,checkpoint_sha256:await digestBytes(canonicalBytes(capture.manifest.checkpoint)),chunks:capture.manifest.database.chunks.map(c=>({index:c.index,sha256:c.sha256,byte_size:c.byte_size})),source_epoch:capture.manifest.checkpoint.authority_epoch,target_epoch:Number(after.workspace_metadata[0].config_epoch),before_projection_sha256:await sha256(canonicalJson(safeDecisionProjection(before))),after_projection_sha256:await sha256(canonicalJson(safeDecisionProjection(after))),before_artifacts_sha256:artifactsBefore,after_artifacts_sha256:artifactsAfter,maintenance_phase:String(after.maintenance_state[0].state),old_runtime_denial:steps.find(s=>s.operation==='old-runtime-denial')!.response.code!,old_session_denial:steps.find(s=>s.operation==='old-session-denial')!.response.code!,continued_job_id:restored.job_id};
 assertR3LocalObservation(final);return final;
}
