/** Closed local-synthetic diagnostic values. Shape/digests never authenticate a producer. */
import {canonicalJson,sha256} from '../../src/config/bootstrap';
import {validateEvent} from '../../src/http/generated/auth-validators.js';
import {R3_PRIVATE_TABLES} from './r3-journey-observation';
export const R3_CONSUMED_CASES=['fresh_runtime_native_review_done','approved_cancel_before_claim','approved_credential_revoke_before_claim','consumed_failure_held','consumed_lease_expiry_held','consumed_active_restore_resume_held','done_history_restore_resume','two_workspace_decision_claim_denial'] as const;
export type R3ConsumedCase=typeof R3_CONSUMED_CASES[number];
export const R3_CONSUMED_TABLES=[...R3_PRIVATE_TABLES,'recovery_jobs','recovery_chunks','probe_receipts'] as const;
type Check<T>=(value:unknown)=>T;
type Parsed<T extends Record<string,Check<unknown>>>={[K in keyof T]:ReturnType<T[K]>};
function bad():never{throw Error('R3_CONSUMED_OBSERVATION_INVALID');}
const utf8=new TextEncoder();
function obj<T extends Record<string,Check<unknown>>>(shape:T):Check<Parsed<T>>{return v=>{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)bad();
 const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d),wanted=Object.keys(shape);
 if(keys.length!==wanted.length||keys.some(k=>typeof k!=='string'||!Object.hasOwn(shape,k)||!Object.hasOwn(d[k],'value')))bad();
 const out:Record<string,unknown>={};for(const k of wanted)out[k]=shape[k](d[k].value);return out as Parsed<T>;
};}
const lit=<T extends string|number|boolean|null>(x:T):Check<T>=>v=>v===x?x:bad();
const en=<T extends string>(xs:readonly T[]):Check<T>=>v=>typeof v==='string'&&xs.includes(v as T)?v as T:bad();
const num=(min=0,max=Number.MAX_SAFE_INTEGER):Check<number>=>v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max?v:bad();
const id:Check<string>=v=>typeof v==='string'&&v.length>0&&v.length<=128&&utf8.encode(v).length<=128?v:bad();
const hash:Check<string>=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:bad();
const nil=<T>(c:Check<T>):Check<T|null>=>v=>v===null?null:c(v);
const arr=<T>(c:Check<T>,max:number,min=0):Check<T[]>=>v=>{if(!Array.isArray(v)||v.length<min||v.length>max)bad();const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==v.length+1)bad();const out:T[]=[];for(let i=0;i<v.length;i++){const p=d[String(i)];if(!p||!Object.hasOwn(p,'value'))bad();out.push(c(p.value));}return out;};
const unique=(xs:unknown[])=>new Set(xs).size===xs.length;
export const consumedRowLimit=(table:typeof R3_CONSUMED_TABLES[number])=>table==='idempotency_outcomes'?160:128;
const rowShape=obj({table:en(R3_CONSUMED_TABLES),before_count:num(0,160),after_count:num(0,160),inserted:num(0,160),updated:num(0,160),deleted:num(0,160)});
const row:Check<ReturnType<typeof rowShape>>=v=>{const r=rowShape(v);if([r.before_count,r.after_count,r.inserted,r.updated,r.deleted].some(n=>n>consumedRowLimit(r.table)))bad();return r;};
const stepSchema=obj({operation:id,kind:en(['domain','read','system','control','aggregate']as const),request_id:nil(id),key_sha256:nil(hash),status:nil(num(100,599)),code:nil(id),before_sha256:hash,after_sha256:hash,rows:arr(row,R3_CONSUMED_TABLES.length,R3_CONSUMED_TABLES.length),event_ids:arr(id,3),outcome_ids:arr(id,3)});
const actor=obj({operation:id,kind:en(['agent','human','system']as const),principal_id:id});
const history=obj({sequence:num(1,8),kind:en(['request','approve','claim','submit','accept','cancel','failure','lease_expiry']as const),before_version:num(1),after_version:num(2),before_state:en(['doing','waiting','ready','review']as const),after_state:en(['waiting','ready','doing','review','done','cancelled']as const),run_id:nil(id),created_at:num()});
const recoverySchema=obj({capture_id:id,source_job_id:id,target_job_id:id,manifest_sha256:hash,chunk_count:num(1,128),retirement_sha256:hash,probe_sha256:hash,cutover_sha256:hash,resume_sha256:hash,source_epoch:num(1),target_epoch:num(2),source_decision_sha256:hash,target_decision_sha256:hash,source_artifacts_sha256:hash,target_artifacts_sha256:hash,retirement_id:id,probe_id:id,cutover_id:id,resume_id:id,resume_operation_id:id,pending_admission_key_sha256:hash,resume_old_generation:num(),resume_new_generation:num(1),source_state:lit('retired'),target_state:lit('open'),target_admission:lit('installed'),current_native_principal:lit('agent_research'),old_runtime_code:lit('UNAUTHENTICATED'),old_session_code:lit('UNAUTHENTICATED'),restore_audit:nil(obj({event_id:id,occurred_at:num(),actor_principal:lit('system:recovery'),run_id:id,fence:num(1),task_version:num(1),head_version:num(1),head_state:lit('doing'),provenance:lit('completed-restore-expiry')}))});
const isolationSchema=obj({source_workspace:id,target_workspace:id,source_before_sha256:hash,source_after_sha256:hash,target_before_sha256:hash,target_after_sha256:hash,denials:arr(obj({operation:id,code:en(['UNAUTHENTICATED','INVALID_REQUEST','NOT_FOUND','FORBIDDEN']as const),status:num(400,404)}),6,6)});
const schema=obj({format_version:lit(1),stage:lit('consumed-command-source-fixture'),origin:lit('local-workers-synthetic-fixture'),acceptance_eligible:lit(false),case_id:en(R3_CONSUMED_CASES),workspace_id:id,schema_version:lit(19),
 configured_principals:obj({requester:lit('agent_research'),human:lit('human_operator'),reviewer:lit('agent_other')}),observed_actors:arr(actor,20,3),
 descriptor:obj({action_id:lit('synthetic.task-review'),schema_version:lit(1),schema_sha256:hash,semantic_revision:lit('synthetic-task-review@2')}),policy:obj({version:lit(3),sha256:hash,config_epoch:num(1),installation_sha256:hash}),
 human_decision:obj({principal_id:lit('human_operator'),event_id:id,event_sequence:num(1),decided_at:num(),inspection_sha256:hash,inspection_byte_size:num(0,65536)}),
 task:obj({id:id,state:en(['ready','waiting','backlog','done','cancelled']as const),version:num(1),approval_id:nil(id),active_run_id:lit(null),flags:arr(en(['outcome_unknown','retry_exhausted']as const),2),retry_count:lit(0)}),
 approval:obj({id:id,proposal_id:id,checkpoint_id:id,status:en(['approved','invalidated']as const),version:num(2,3),proposal_version:lit(1),created_at:num(),decided_at:num(),expires_at:num(),original_expires_at:num(),decision_sha256:hash,original_decision_sha256:hash,consumed_run_id:nil(id),consumed_fence:nil(num(1))}),
 initial_run:obj({id:id,runtime_id:id,fence:num(1),status:lit('paused'),ended_at:num()}),new_runtime:obj({id:id,principal_id:lit('agent_research'),created_at:num(),event_id:id,event_sequence:num(1)}),
 consumed_run:nil(obj({id:id,runtime_id:id,fence:num(1),status:en(['submitted','failed','expired']as const),started_at:num(),lease_expires_at:num(),ended_at:num()})),run_count:num(1,2),
 artifacts:arr(obj({id:id,generation_id:id,version:num(1),sha256:hash,byte_size:num(0,65536),measured_sha256:hash,measured_byte_size:num(0,65536),roles:arr(en(['checkpoint','input','result']as const),3,1)}),3,1),
 result:nil(obj({id:id,run_id:id,submitted_principal_id:lit('agent_research'),submitted_agent_id:lit('agent_research'),artifact_ids:arr(id,3,1),summary_sha256:hash})),
 acceptance:nil(obj({id:id,result_id:id,run_id:id,reviewer_principal_id:lit('agent_other'),reviewer_agent_id:lit('agent_other'),task_version:num(1)})),
 history:arr(history,8,2),steps:arr(stepSchema,32,1),recovery:nil(recoverySchema),isolation:nil(isolationSchema),
});
export type R3ConsumedJourneyObservationV1=ReturnType<typeof schema>;
export type R3ConsumedStep=ReturnType<typeof stepSchema>;
export const R3_CONSUMED_SOURCE_QUERIES=['human-read','reviewer-read','current-native-read'] as const;
export const R3_CONSUMED_NO_REQUEST=['human-read','reviewer-read','current-native-read','expire','expire-replay','foreign-approval-denial','old-session-denial','captured-expiry-denial','captured-cleanup-denial'] as const;
const prefix=['request','human-read','human-download','approve','enroll'];
const happy=['claim','claim-replay','wrong-proof-denial','submit','self-accept-denial','reviewer-read','reviewer-download','accept','accept-replay'];
const resume=['retire','resume-no-probe-denial','probe','resume','resume-replay','current-native-read','old-runtime-denial','old-session-denial'];
export const R3_CONSUMED_STEPS:Record<R3ConsumedCase,readonly string[]>={
 fresh_runtime_native_review_done:[...prefix,...happy],approved_cancel_before_claim:[...prefix,'cancel','cancel-replay','cancelled-claim-denial'],approved_credential_revoke_before_claim:[...prefix,'revoke','revoked-claim-denial','revoked-request-replay-denial'],
 consumed_failure_held:[...prefix,'claim','fail','fail-replay','held-claim-denial','paused-heartbeat-denial'],consumed_lease_expiry_held:[...prefix,'claim','expire','expire-replay','expired-heartbeat-denial','expired-submit-denial','held-claim-denial'],
 consumed_active_restore_resume_held:[...prefix,'claim','capture','captured-heartbeat-denial','captured-cleanup-denial','captured-expiry-denial','restore',...resume,'target-enroll','restored-held-claim-denial'],
 done_history_restore_resume:[...prefix,...happy,'capture','restore',...resume,'restored-reviewer-download','restored-accept-replay'],
 two_workspace_decision_claim_denial:[...prefix,'foreign-request-denial','foreign-human-denial','foreign-claim-denial','foreign-command-denial','foreign-artifact-denial','foreign-approval-denial'],
};
export function consumedStepKind(operation:string):R3ConsumedStep['kind']{
 if(!Object.values(R3_CONSUMED_STEPS).some(steps=>steps.includes(operation)))bad();
 if(['capture','restore'].includes(operation))return 'aggregate';
 if(['retire','resume-no-probe-denial','probe','resume','resume-replay'].includes(operation))return 'control';
 if(['expire','expire-replay','captured-cleanup-denial','captured-expiry-denial'].includes(operation))return 'system';
 if(['human-read','human-download','reviewer-read','reviewer-download','current-native-read','old-runtime-denial','old-session-denial','restored-reviewer-download','foreign-artifact-denial','foreign-approval-denial'].includes(operation))return 'read';
 return 'domain';
}
const expectedDenials:Record<string,readonly [number|null,string]>={
 'wrong-proof-denial':[401,'UNAUTHENTICATED'],'self-accept-denial':[403,'FORBIDDEN'],'cancelled-claim-denial':[409,'INVALID_STATE'],'revoked-claim-denial':[401,'UNAUTHENTICATED'],'revoked-request-replay-denial':[401,'UNAUTHENTICATED'],'held-claim-denial':[503,'DEPENDENCY_UNAVAILABLE'],'paused-heartbeat-denial':[409,'STALE_RUN'],'expired-heartbeat-denial':[409,'STALE_RUN'],'expired-submit-denial':[409,'STALE_RUN'],
 'captured-heartbeat-denial':[503,'DEPENDENCY_UNAVAILABLE'],'captured-cleanup-denial':[401,'UNAUTHENTICATED'],'captured-expiry-denial':[null,'ADMISSION_CLOSED'],'resume-no-probe-denial':[null,'RECOVERY_PROBE_REQUIRED'],'old-runtime-denial':[401,'UNAUTHENTICATED'],'old-session-denial':[401,'UNAUTHENTICATED'],'restored-held-claim-denial':[503,'DEPENDENCY_UNAVAILABLE'],
 'foreign-request-denial':[401,'UNAUTHENTICATED'],'foreign-human-denial':[401,'UNAUTHENTICATED'],'foreign-claim-denial':[401,'UNAUTHENTICATED'],'foreign-command-denial':[400,'INVALID_REQUEST'],'foreign-artifact-denial':[404,'NOT_FOUND'],'foreign-approval-denial':[404,'NOT_FOUND'],
};
function exactDelta(step:R3ConsumedStep,inserts:Record<string,number>,updates:readonly string[]|Record<string,number>,events=1,outcomes=1,schedulerAllowed=true){
 if(step.event_ids.length!==events||step.outcome_ids.length!==outcomes||step.before_sha256===step.after_sha256)bad();
 for(const r of step.rows){const count=Array.isArray(updates)?(updates.includes(r.table)?1:0):((updates as Record<string,number>)[r.table]??0);if(r.inserted!==(inserts[r.table]??0)||r.deleted!==0||(r.table==='scheduler_state'&&count===0&&schedulerAllowed?r.updated>1:r.updated!==count))bad();}
}
/** Local consistency only: a self-consistent submitted record is still not authenticated evidence. */
export function assertR3ConsumedObservation(value:unknown):asserts value is R3ConsumedJourneyObservationV1{
 const x=schema(value),a=x.approval,t=x.task,run=x.consumed_run;
 const done=x.case_id==='fresh_runtime_native_review_done'||x.case_id==='done_history_restore_resume',cancel=x.case_id==='approved_cancel_before_claim',held=['consumed_failure_held','consumed_lease_expiry_held','consumed_active_restore_resume_held'].includes(x.case_id),restored=x.case_id==='consumed_active_restore_resume_held';
 if(x.steps.map(s=>s.operation).join(',')!==R3_CONSUMED_STEPS[x.case_id].join(',')||!unique(x.observed_actors.map(o=>o.operation)))bad();
 if(x.steps.find(s=>s.operation==='approve')!.event_ids[0]!==x.human_decision.event_id||x.steps.find(s=>s.operation==='enroll')!.event_ids[0]!==x.new_runtime.event_id)bad();
 if(a.expires_at!==a.original_expires_at||a.decided_at<a.created_at||a.decided_at>=a.expires_at||a.decision_sha256!==a.original_decision_sha256||x.initial_run.ended_at!==a.created_at||x.human_decision.decided_at!==a.decided_at)bad();
 if(x.new_runtime.id===x.initial_run.runtime_id||x.new_runtime.created_at<a.decided_at||x.new_runtime.event_sequence<=x.human_decision.event_sequence)bad();
 if(a.status!==(cancel?'invalidated':'approved')||a.version!==(cancel?3:2)||t.approval_id!==(cancel?null:a.id)||t.state!==(done?'done':cancel?'cancelled':held?restored?'backlog':'waiting':'ready')||t.version!==(done?8:cancel?6:held?7:5))bad();
 if(held?(t.flags.length!==1||t.flags[0]!=='outcome_unknown'):t.flags.length!==0)bad();
 if(done||held){if(!run||a.consumed_run_id!==run.id||a.consumed_fence!==run.fence||run.id===x.initial_run.id||run.runtime_id!==x.new_runtime.id||run.fence!==x.initial_run.fence+1||run.started_at<a.decided_at||run.started_at>=a.expires_at||run.lease_expires_at<=run.started_at||run.ended_at<run.started_at||x.run_count!==2||run.status!==(done?'submitted':x.case_id==='consumed_failure_held'?'failed':'expired'))bad();}
 if(run&&(x.case_id==='consumed_lease_expiry_held'?run.ended_at<run.lease_expires_at:!restored&&run.ended_at>=run.lease_expires_at))bad();
 if(!(done||held)&&(run!==null||a.consumed_run_id!==null||a.consumed_fence!==null||x.run_count!==1))bad();
 const kinds=['request','approve',...(done?['claim','submit','accept']:held?['claim',...(restored?[]:[x.case_id==='consumed_failure_held'?'failure':'lease_expiry'])]:cancel?['cancel']:[])];
 if(x.history.map(h=>h.kind).join(',')!==kinds.join(','))bad();
 const transitions:Record<string,readonly [string,string]>={request:['doing','waiting'],approve:['waiting','ready'],claim:['ready','doing'],submit:['doing','review'],accept:['review','done'],cancel:['ready','cancelled'],failure:['doing','waiting'],lease_expiry:['doing','waiting']};
 for(let i=0;i<x.history.length;i++){const h=x.history[i];if(h.sequence!==i+1||h.before_version!==i+3||h.after_version!==i+4||h.before_state!==transitions[h.kind][0]||h.after_state!==transitions[h.kind][1]||h.run_id!==(i===0?x.initial_run.id:i===1||h.kind==='cancel'?null:run?.id)||h.created_at<(i?x.history[i-1].created_at:a.created_at))bad();}
 if(run&&!restored&&x.history.find(h=>['submit','failure','lease_expiry'].includes(h.kind))?.created_at!==run.ended_at)bad();
 if(x.history[0].created_at!==a.created_at||x.history[1].created_at!==a.decided_at||run&&x.history[2].created_at!==run.started_at)bad();
 if(!unique(x.artifacts.map(a=>a.id))||!unique(x.artifacts.map(a=>a.generation_id)))bad();
 for(const p of x.artifacts)if(!unique(p.roles)||p.sha256!==p.measured_sha256||p.byte_size!==p.measured_byte_size)bad();
 const input=x.artifacts.find(p=>p.roles.includes('input'));if(!input||!x.artifacts.some(p=>p.roles.includes('checkpoint'))||input.sha256!==x.human_decision.inspection_sha256||input.byte_size!==x.human_decision.inspection_byte_size)bad();
 if(done){if(!x.result||!x.acceptance||x.result.run_id!==run!.id||x.acceptance.result_id!==x.result.id||x.acceptance.run_id!==run!.id||x.acceptance.task_version!==t.version||!unique(x.result.artifact_ids)||x.result.artifact_ids.some(id=>!x.artifacts.some(p=>p.id===id&&p.roles.includes('result'))))bad();}
 else if(x.result!==null||x.acceptance!==null)bad();
 const observed:Record<string,readonly [string,string]>={request:['agent','agent_research'],approve:['human','human_operator'],enroll:['agent','agent_research'],...(done||held?{claim:['agent','agent_research']as const}:{}),...(done?{submit:['agent','agent_research']as const,accept:['agent','agent_other']as const}:{}),...(cancel?{cancel:['human','human_operator']as const}:{}),...(x.case_id==='approved_credential_revoke_before_claim'?{revoke:['human','human_operator']as const}:{}),...(x.case_id==='consumed_failure_held'?{fail:['agent','agent_research']as const}:{}),...(restored?{'target-enroll':['agent','agent_research']as const}:{}),...(x.case_id==='consumed_lease_expiry_held'?{expire:['system','system:lease-expiry']as const}:{})};
 if(x.observed_actors.length!==Object.keys(observed).length||x.observed_actors.some(o=>!observed[o.operation]||o.kind!==observed[o.operation][0]||o.principal_id!==observed[o.operation][1]))bad();
 const one={decision_lifecycle_transitions:1,events:1,task_history:1,idempotency_outcomes:1};
 for(const s of x.steps){
  if(s.kind!==consumedStepKind(s.operation))bad();
  if(R3_CONSUMED_NO_REQUEST.some(op=>op===s.operation)&&(s.request_id!==null||s.key_sha256!==null))bad();
  if(['expire','expire-replay'].includes(s.operation)&&(s.status!==null||s.code!==null))bad();
  if(!unique(s.rows.map(r=>r.table))||!unique(s.event_ids)||!unique(s.outcome_ids))bad();for(const r of s.rows)if(r.after_count!==r.before_count+r.inserted-r.deleted||r.deleted>r.before_count||r.updated>r.before_count)bad();
  const denial=expectedDenials[s.operation];if(denial&&(s.status!==denial[0]||s.code!==denial[1]))bad();
  const noWrite=(!!denial&&s.operation!=='resume-no-probe-denial')||s.operation.endsWith('-replay')||s.kind==='read';
  if(noWrite&&(s.before_sha256!==s.after_sha256||s.rows.some(r=>r.inserted||r.updated||r.deleted)||s.event_ids.length||s.outcome_ids.length))bad();
  if(!denial&&s.kind!=='system'&&(s.status!==(R3_CONSUMED_SOURCE_QUERIES.some(op=>op===s.operation)?null:s.operation==='enroll'||s.operation==='target-enroll'?201:200)||s.code!==null))bad();
  if(s.operation==='resume-no-probe-denial')exactDelta(s,{idempotency_outcomes:1},[],0,1,false);
  if(s.operation==='retire')exactDelta(s,{idempotency_outcomes:2},['workspace_metadata','maintenance_state'],0,2,false);
  if(s.operation==='probe')exactDelta(s,{idempotency_outcomes:2,probe_receipts:1},[],0,2,false);
  if(s.operation==='resume'){const scheduler=s.rows.find(r=>r.table==='scheduler_state')!;if(scheduler.before_count!==0||scheduler.after_count!==1)bad();exactDelta(s,{idempotency_outcomes:1,scheduler_state:1},{workspace_metadata:1,maintenance_state:1,idempotency_outcomes:1},0,1,false);}
  if(s.kind==='aggregate'){
   if(!x.recovery||s.before_sha256===s.after_sha256||s.request_id===null||s.key_sha256===null||s.outcome_ids.length!==1||s.rows.find(r=>r.table==='recovery_jobs')!.inserted!==1||s.rows.find(r=>r.table==='recovery_chunks')!.inserted!==x.recovery.chunk_count)bad();
   if(s.operation==='capture'&&(s.event_ids.length!==0||s.rows.some(r=>!['workspace_metadata','maintenance_state','scheduler_state','recovery_jobs','recovery_chunks','idempotency_outcomes'].includes(r.table)&&(r.inserted||r.updated||r.deleted))))bad();
  }
  if(s.operation==='request')exactDelta(s,{...one,approvals:1,decision_checkpoints:1,decision_proposals:1,decision_artifact_edges:2,decision_notice_intents:2,decision_lifecycle_heads:1},['tasks','runs']);
  if(s.operation==='approve')exactDelta(s,one,['tasks','approvals','decision_lifecycle_heads']);
  if(s.operation==='enroll'||s.operation==='target-enroll')exactDelta(s,{runtimes:1,events:1,idempotency_outcomes:1},[]);
  if(s.operation==='claim')exactDelta(s,{...one,runs:1},['tasks','approvals','decision_lifecycle_heads']);
  if(s.operation==='submit')exactDelta(s,{...one,task_results:1,result_artifacts:x.result!.artifact_ids.length,artifact_associations:x.result!.artifact_ids.length},['tasks','runs','decision_lifecycle_heads']);
  if(s.operation==='accept')exactDelta(s,{...one,task_acceptances:1},['tasks','decision_lifecycle_heads']);
  if(s.operation==='cancel')exactDelta(s,one,['tasks','approvals','decision_lifecycle_heads']);
  if(s.operation==='revoke')exactDelta(s,{events:1,idempotency_outcomes:1},{native_credentials:1,runtimes:3});
  if(s.operation==='fail')exactDelta(s,one,['tasks','runs','decision_lifecycle_heads']);
  if(s.operation==='expire')exactDelta(s,{decision_lifecycle_transitions:1,events:1,task_history:1},['tasks','runs','decision_lifecycle_heads'],1,0);
 }
 const r=x.recovery;if(restored||x.case_id==='done_history_restore_resume'){
  if(!r||r.target_epoch<=r.source_epoch||r.source_decision_sha256!==r.target_decision_sha256||r.source_artifacts_sha256!==r.target_artifacts_sha256||r.resume_new_generation!==r.resume_old_generation+1||r.source_job_id===r.target_job_id||x.steps.find(s=>s.operation==='resume-no-probe-denial')!.key_sha256!==r.pending_admission_key_sha256||x.steps.find(s=>s.operation==='resume')!.key_sha256!==r.pending_admission_key_sha256)bad();
  if(restored?(!r.restore_audit||r.restore_audit.occurred_at!==run!.ended_at||x.steps.find(s=>s.operation==='restore')!.event_ids.join(',')!==r.restore_audit.event_id||r.restore_audit.run_id!==run!.id||r.restore_audit.fence!==run!.fence||r.restore_audit.task_version!==t.version||r.restore_audit.head_version!==x.history.at(-1)!.after_version||t.version!==r.restore_audit.head_version+1):r.restore_audit!==null)bad();
 }else if(r!==null)bad();
 if(x.case_id==='two_workspace_decision_claim_denial'){const z=x.isolation;if(!z||z.source_workspace!==x.workspace_id||z.source_workspace===z.target_workspace||z.source_before_sha256!==z.source_after_sha256||z.target_before_sha256!==z.target_after_sha256||z.denials.map(d=>d.operation).join(',')!==R3_CONSUMED_STEPS[x.case_id].slice(-6).join(',')||z.denials.some(d=>!expectedDenials[d.operation]||d.status!==expectedDenials[d.operation][0]||d.code!==expectedDenials[d.operation][1]))bad();}
 else if(x.isolation!==null)bad();
}
export async function encodeR3ConsumedObservation(value:unknown):Promise<{bytes:Uint8Array;sha256:string}>{const parsed=schema(value);assertR3ConsumedObservation(parsed);const text=canonicalJson(parsed),bytes=utf8.encode(text);if(bytes.byteLength>262144)bad();return {bytes,sha256:await sha256(text)};}

/** Public Event projection excludes the internal creation receipt binding, but never accepts one. */
export function projectR3RecoveryEvent(row:Record<string,string|number|null>){
 const {actor_json,occurred_at,creation_binding,...fields}=row;
 if(creation_binding!==null||typeof actor_json!=='string'||new TextEncoder().encode(actor_json).byteLength>65536||typeof occurred_at!=='number'||!Number.isSafeInteger(occurred_at)||occurred_at<0||occurred_at>8640000000000000)bad();
 let actor:unknown;try{actor=JSON.parse(actor_json);}catch{bad();}
 const event={...fields,actor,occurred_at:new Date(occurred_at).toISOString()};if(!validateEvent(event))bad();return event;
}
