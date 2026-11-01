/** Test-only local consistency. Neither these labels nor a digest authenticate a producer. */
import {canonicalJson,sha256} from '../../src/config/bootstrap';
export const R3_JOURNEY_CASES=['request_pause_replay','human_approve_replay_revoked','human_reject_replay','pending_command_history_restore','rejected_command_history_restore','changed_chunk_continuation_denied'] as const;
export type R3JourneyCase=typeof R3_JOURNEY_CASES[number];
export const R3_PRIVATE_TABLES=['tasks','runs','approvals','decision_checkpoints','decision_proposals','decision_artifact_edges','decision_notice_intents','decision_lifecycle_heads','decision_lifecycle_transitions','events','task_history','idempotency_outcomes','task_results','task_acceptances','scheduler_state','workspace_metadata','maintenance_state','human_grants','static_agents','native_credentials','sessions','login_attempts','runtimes','creation_admissions','artifacts','artifact_generations','artifact_associations','artifact_inventory_state','result_artifacts','outbox'] as const;
const encoder=new TextEncoder();
const bad=():never=>{throw Error('R3_LOCAL_OBSERVATION_INVALID');};
type Check<T>=(value:unknown)=>T;
type Parsed<T extends Record<string,Check<unknown>>>={[K in keyof T]:ReturnType<T[K]>};
function object<T extends Record<string,Check<unknown>>>(shape:T):Check<Parsed<T>>{return value=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)bad();
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Object.keys(descriptors),expected=Object.keys(shape);
 if(Reflect.ownKeys(descriptors).length!==keys.length)bad();
 if(keys.length!==expected.length||keys.some(k=>!Object.hasOwn(shape,k)||!Object.hasOwn(descriptors[k],'value')))bad();
 const result:Record<string,unknown>={};for(const key of expected)result[key]=shape[key](descriptors[key].value);return result as Parsed<T>;
};}
const literal=<T extends string|number|boolean|null>(expected:T):Check<T>=>value=>value===expected?expected:bad();
const oneOf=<T extends string>(values:readonly T[]):Check<T>=>value=>typeof value==='string'&&values.includes(value as T)?value as T:bad();
const integer=(min=0,max=Number.MAX_SAFE_INTEGER):Check<number>=>v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max?v:bad();
const text:Check<string>=v=>typeof v==='string'&&v.length>0&&v.length<=128&&encoder.encode(v).length<=128?v:bad();
const hash:Check<string>=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:bad();
const nullable=<T>(check:Check<T>):Check<T|null>=>v=>v===null?null:check(v);
const array=<T>(check:Check<T>,max:number,min=0):Check<T[]>=>v=>{
 if(!Array.isArray(v)||v.length<min||v.length>max)return bad();
 const descriptors=Object.getOwnPropertyDescriptors(v);
 if(Reflect.ownKeys(descriptors).length!==v.length+1)bad();
 const out:T[]=[];for(let i=0;i<v.length;i++){const d=descriptors[String(i)];if(!d||!Object.hasOwn(d,'value'))bad();out.push(check(d.value));}return out;
};
const unique=(values:readonly unknown[])=>new Set(values).size===values.length;
const rowSchema=object({table:oneOf(R3_PRIVATE_TABLES),before_count:integer(0,128),after_count:integer(0,128),inserted:integer(0,128),updated:integer(0,128),deleted:integer(0,128)});
const stepSchema=object({operation:text,request_id:text,key_sha256:hash,before_sha256:hash,after_sha256:hash,rows:array(rowSchema,R3_PRIVATE_TABLES.length,R3_PRIVATE_TABLES.length),response:object({status:nullable(integer(100,599)),code:nullable(text)}),event_ids:array(text,2),outcome_ids:array(text,2)});
const historySchema=object({sequence:integer(1),kind:oneOf(['request','approve','reject'] as const),before_version:integer(1),after_version:integer(2),before_state:oneOf(['doing','waiting'] as const),after_state:oneOf(['waiting','ready','backlog'] as const),run_id:nullable(text)});
const recoverySchema=object({capture_id:text,source_job_id:text,target_job_id:text,operation_id:text,manifest_sha256:hash,schema_version:literal(19),checkpoint_sha256:hash,chunks:array(object({index:integer(0,127),sha256:hash,byte_size:integer(1,2097152)}),128,1),source_epoch:integer(1),target_epoch:integer(2),before_projection_sha256:hash,after_projection_sha256:hash,before_artifacts_sha256:hash,after_artifacts_sha256:hash,maintenance_phase:text,old_runtime_denial:text,old_session_denial:text,continued_job_id:text});
const observationSchema=object({
 format_version:literal(1),stage:literal('command-source-fixture'),origin:literal('local-workers-synthetic-fixture'),acceptance_eligible:literal(false),case_id:oneOf(R3_JOURNEY_CASES),schema_version:literal(19),workspace_id:text,source_id:text,target_id:nullable(text),observation_sequence:integer(1),
 provenance:object({private_descriptor:literal(true),synthetic_human_session:literal(true),local_sqlite:literal(true),emulated_artifact_store:literal(true)}),
 descriptor:object({action_id:literal('synthetic.task-review'),schema_version:literal(1),schema_sha256:hash,semantic_revision:literal('synthetic-task-review@2')}),policy:object({version:literal(3),sha256:hash,config_epoch:integer(1),installation_sha256:hash}),
 principals:object({requester:object({kind:literal('agent'),principal_id:text}),human:nullable(object({kind:literal('human'),principal_id:text}))}),
 decision:object({task_id:text,approval_id:text,proposal_id:text,checkpoint_id:text,task_version:integer(1),proposal_version:integer(1),approval_version:integer(1),task_state:oneOf(['waiting','ready','backlog'] as const),approval_status:oneOf(['pending','approved','rejected'] as const),created_at:integer(),expires_at:integer(),original_expires_at:integer(),decided_at:nullable(integer()),consumed_run_id:nullable(text),consumed_fence:nullable(integer(1)),semantic_anchor_sha256:hash}),
 runs:object({original:object({id:text,fence:integer(1),status:literal('paused'),ended_at:integer()}),active_run_id:literal(null)}),
 artifacts:array(object({id:text,generation_id:text,version:integer(1),sha256:hash,byte_size:integer(0,65536),measured_sha256:hash,measured_byte_size:integer(0,65536),roles:array(oneOf(['checkpoint','input','proposal'] as const),3,1)}),5,1),
 reviewer_ids:array(text,2,2),notices:array(object({reviewer_id:text,event_id:text}),2,2),steps:array(stepSchema,16,1),history:array(historySchema,32,1),recovery:nullable(recoverySchema),
});
export type R3LocalJourneyObservationV1=ReturnType<typeof observationSchema>;
export type R3JourneyStep=ReturnType<typeof stepSchema>;
export const R3_CASE_STEPS:Record<R3JourneyCase,readonly string[]>={
 request_pause_replay:['request','request-replay','request-conflict','paused-heartbeat-denial','paused-submit-denial','paused-fail-denial'],
 human_approve_replay_revoked:['request','stale-task-denial','stale-approval-denial','stale-proposal-denial','approve','approve-replay','revoked-session-denial'],
 human_reject_replay:['request','reject','reject-replay','reject-conflict'],
 pending_command_history_restore:['request','capture','restore','old-runtime-denial','old-session-denial'],
 rejected_command_history_restore:['request','reject','capture','restore','old-runtime-denial','old-session-denial'],
 changed_chunk_continuation_denied:['request','capture','begin-restore','chunk-write','chunk-replay','changed-chunk-denial','continue-restore','old-runtime-denial','old-session-denial'],
};
/** Pure predicate validation cannot establish that supplied facts happened. */
export function assertR3LocalObservation(value:unknown):asserts value is R3LocalJourneyObservationV1{
 const x=observationSchema(value),d=x.decision;
 if(x.runs.original.ended_at!==d.created_at||d.decided_at!==null&&(d.decided_at<d.created_at||d.decided_at>=d.original_expires_at))bad();
 if(d.consumed_run_id!==null||d.consumed_fence!==null||d.expires_at!==d.original_expires_at||d.expires_at<=d.created_at)bad();
 if(!unique(x.artifacts.map(a=>a.id))||!unique(x.artifacts.map(a=>a.generation_id)))bad();
 for(const a of x.artifacts)if(!unique(a.roles)||a.sha256!==a.measured_sha256||a.byte_size!==a.measured_byte_size)bad();
 if(!x.artifacts.some(a=>a.roles.includes('input'))||!x.artifacts.some(a=>a.roles.includes('checkpoint')))bad();
 if([...x.reviewer_ids].sort().join(',')!=='human_operator,human_reviewer'||!unique(x.notices.map(n=>n.reviewer_id))||x.notices.some(n=>!x.reviewer_ids.includes(n.reviewer_id)))bad();
 if(x.steps.map(s=>s.operation).join(',')!==R3_CASE_STEPS[x.case_id].join(','))bad();
 const request=x.steps[0];if(request.response.status!==200||request.response.code!==null||request.event_ids.length!==1||request.outcome_ids.length!==1||x.notices.some(n=>n.event_id!==request.event_ids[0]))bad();
 const requestInserts:Record<string,number>={approvals:1,decision_checkpoints:1,decision_proposals:1,decision_artifact_edges:2,decision_notice_intents:2,decision_lifecycle_heads:1,decision_lifecycle_transitions:1,events:1,task_history:1,idempotency_outcomes:1};
 for(const row of request.rows){
  if(row.inserted!==(requestInserts[row.table]??0)||row.deleted!==0)bad();
  if(['tasks','runs'].includes(row.table)?row.updated!==1:row.table!=='scheduler_state'&&row.updated!==0)bad();
 }
 if(request.before_sha256===request.after_sha256)bad();
 for(const s of x.steps){
  if(s.operation==='changed-chunk-denial'&&(s.response.status!==null||s.response.code!=='RECOVERY_CHUNK_MISMATCH'))bad();
  if(!unique(s.rows.map(r=>r.table))||!unique(s.event_ids)||!unique(s.outcome_ids))bad();
  for(const r of s.rows)if(r.after_count!==r.before_count+r.inserted-r.deleted||r.deleted>r.before_count||r.updated>r.before_count)bad();
  if(s.operation.endsWith('-replay')||s.operation.endsWith('-denial')||s.operation.endsWith('-conflict')){
   if(s.before_sha256!==s.after_sha256||s.rows.some(r=>r.inserted||r.updated||r.deleted)||s.event_ids.length||s.outcome_ids.length)bad();
   if(s.operation.endsWith('-replay')?(s.response.status!==200||s.response.code!==null):(s.response.status===null?(s.operation!=='changed-chunk-denial'||s.response.code!=='RECOVERY_CHUNK_MISMATCH'):(s.response.status<400||s.response.code===null)))bad();
  }
 }
 const humanKind=x.case_id==='human_approve_replay_revoked'?'approve':(['human_reject_replay','rejected_command_history_restore'].includes(x.case_id)?'reject':null);
 if(humanKind){
  const step=x.steps.find(s=>s.operation===humanKind)!;
  if(step.response.status!==200||step.response.code!==null||step.event_ids.length!==1||step.outcome_ids.length!==1||step.before_sha256===step.after_sha256)bad();
  for(const row of step.rows){
   const inserted=['decision_lifecycle_transitions','events','task_history','idempotency_outcomes'].includes(row.table)?1:0;
   if(row.inserted!==inserted||row.deleted!==0)bad();
   if(['tasks','approvals','decision_lifecycle_heads'].includes(row.table)?row.updated!==1:row.table!=='scheduler_state'&&row.updated!==0)bad();
  }
 }
 if(x.history.length!==(humanKind?2:1))bad();
 for(let i=0;i<x.history.length;i++){
  const h=x.history[i];if(h.sequence!==i+1||h.after_version!==h.before_version+1)bad();
  if(i===0?(h.kind!=='request'||h.before_state!=='doing'||h.after_state!=='waiting'||h.run_id!==x.runs.original.id):(h.kind!==humanKind||h.before_version!==x.history[i-1].after_version||h.before_state!=='waiting'||h.after_state!==(humanKind==='approve'?'ready':'backlog')))bad();
 }
 const last=x.history.at(-1)!;
 if(d.task_version!==last.after_version||d.task_state!==last.after_state||d.proposal_version!==1||d.approval_version!==(humanKind?2:1)||d.approval_status!==(humanKind==='approve'?'approved':humanKind==='reject'?'rejected':'pending'))bad();
 if(humanKind?(!x.principals.human||x.principals.human.principal_id===x.principals.requester.principal_id||!x.reviewer_ids.includes(x.principals.human.principal_id)||d.decided_at===null):(x.principals.human!==null||d.decided_at!==null))bad();
 const isRecovery=x.case_id.endsWith('_restore')||x.case_id==='changed_chunk_continuation_denied';
 if(isRecovery){const r=x.recovery;if(!r||!x.target_id||x.target_id===x.source_id||r.target_epoch<=r.source_epoch||r.before_projection_sha256!==r.after_projection_sha256||r.before_artifacts_sha256!==r.after_artifacts_sha256||r.continued_job_id!==r.target_job_id||r.chunks.some((c,i)=>c.index!==i))bad();}
 else if(x.recovery!==null||x.target_id!==null)bad();
}
export async function encodeR3LocalObservation(value:unknown):Promise<{bytes:Uint8Array;sha256:string}>{
 const parsed=observationSchema(value);assertR3LocalObservation(parsed);const encoded=canonicalJson(parsed),bytes=encoder.encode(encoded);if(bytes.byteLength>262144)bad();return {bytes,sha256:await sha256(encoded)};
}
