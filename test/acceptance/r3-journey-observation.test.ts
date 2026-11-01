/** Unit inputs only: these hand-authored records are NEVER runtime evidence. */
import {it,expect} from 'vitest';
import {existsSync} from 'node:fs';
const url=new URL('../helpers/r3-journey-observation.ts',import.meta.url);
const implementation:Record<string,any>=existsSync(url)?await import(/* @vite-ignore */url.href):{};
const hash='a'.repeat(64);
const tables=['tasks','runs','approvals','decision_checkpoints','decision_proposals','decision_artifact_edges','decision_notice_intents','decision_lifecycle_heads','decision_lifecycle_transitions','events','task_history','idempotency_outcomes','task_results','task_acceptances','scheduler_state','workspace_metadata','maintenance_state','human_grants','static_agents','native_credentials','sessions','login_attempts','runtimes','creation_admissions','artifacts','artifact_generations','artifact_associations','artifact_inventory_state','result_artifacts','outbox'];
const requestInserted:Record<string,number>={approvals:1,decision_checkpoints:1,decision_proposals:1,decision_artifact_edges:2,decision_notice_intents:2,decision_lifecycle_heads:1,decision_lifecycle_transitions:1,events:1,task_history:1,idempotency_outcomes:1};
const unchangedRows=()=>tables.map(table=>({table,before_count:0,after_count:0,inserted:0,updated:0,deleted:0}));
function unitInput():any{
 const step=(operation:string,status:number,code:string|null)=>({operation,request_id:'request_'+operation,key_sha256:hash,before_sha256:hash,after_sha256:hash,rows:unchangedRows(),response:{status,code},event_ids:[],outcome_ids:[]});
 return {format_version:1,stage:'command-source-fixture',origin:'local-workers-synthetic-fixture',acceptance_eligible:false,case_id:'request_pause_replay',schema_version:19,workspace_id:'ws_example',source_id:'source_fixture',target_id:null,observation_sequence:1,
  provenance:{private_descriptor:true,synthetic_human_session:true,local_sqlite:true,emulated_artifact_store:true},
  descriptor:{action_id:'synthetic.task-review',schema_version:1,schema_sha256:hash,semantic_revision:'synthetic-task-review@2'},policy:{version:3,sha256:hash,config_epoch:1,installation_sha256:hash},
  principals:{requester:{kind:'agent',principal_id:'agent_research'},human:null},
  decision:{task_id:'task_a',approval_id:'approval_a',proposal_id:'proposal_a',checkpoint_id:'checkpoint_a',task_version:4,proposal_version:1,approval_version:1,task_state:'waiting',approval_status:'pending',created_at:1000,expires_at:121000,original_expires_at:121000,decided_at:null,consumed_run_id:null,consumed_fence:null,semantic_anchor_sha256:hash},
  runs:{original:{id:'run_initial',fence:1,status:'paused',ended_at:1000},active_run_id:null},
  artifacts:[{id:'input_a',generation_id:'generation_a',version:3,sha256:hash,byte_size:37,measured_sha256:hash,measured_byte_size:37,roles:['checkpoint','input']}],
  reviewer_ids:['human_operator','human_reviewer'],notices:[{reviewer_id:'human_operator',event_id:'event_request'},{reviewer_id:'human_reviewer',event_id:'event_request'}],
  steps:[{...step('request',200,null),event_ids:['event_request'],outcome_ids:['outcome_request'],after_sha256:'b'.repeat(64),rows:unchangedRows().map(row=>requestInserted[row.table]?{...row,after_count:requestInserted[row.table],inserted:requestInserted[row.table]}:['tasks','runs'].includes(row.table)?{...row,before_count:1,after_count:1,updated:1}:row)},step('request-replay',200,null),step('request-conflict',409,'IDEMPOTENCY_CONFLICT'),step('paused-heartbeat-denial',409,'STALE_RUN'),step('paused-submit-denial',409,'STALE_RUN'),step('paused-fail-denial',409,'STALE_RUN')],
  history:[{sequence:1,kind:'request',before_version:3,after_version:4,before_state:'doing',after_state:'waiting',run_id:'run_initial'}],recovery:null};
}
it('provides a closed encoder and predicate checker, not a release acceptance entrypoint',()=>{
 expect(typeof implementation.encodeR3LocalObservation).toBe('function');expect(typeof implementation.assertR3LocalObservation).toBe('function');
});
it('encodes only local-synthetic unit consistency and always retains acceptance false',async()=>{
 const value=unitInput();expect(()=>implementation.assertR3LocalObservation(value)).not.toThrow();const artifact=await implementation.encodeR3LocalObservation(value);
 expect(artifact.bytes).toBeInstanceOf(Uint8Array);expect(artifact.bytes.byteLength).toBeLessThanOrEqual(262144);expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
 expect(JSON.parse(new TextDecoder().decode(artifact.bytes))).toMatchObject({origin:'local-workers-synthetic-fixture',acceptance_eligible:false});
});
for(const [name,mutate]of [
 ['unknown root field',(x:any)=>{x.passed=true;}],['claimed acceptance',(x:any)=>{x.acceptance_eligible=true;}],['deployed provenance',(x:any)=>{x.origin='isolated-deployment';}],
 ['unsupported case',(x:any)=>{x.case_id='caller_chooses_gate';}],['wrong schema',(x:any)=>{x.schema_version=18;}],['missing reviewer notice',(x:any)=>{x.notices.pop();}],
 ['duplicate reviewer notice',(x:any)=>{x.notices[1]=x.notices[0];}],['unrelated notice event',(x:any)=>{x.notices[1].event_id='other';}],
 ['renewed expiry',(x:any)=>{x.decision.expires_at++;}],['consumed pair mismatch',(x:any)=>{x.decision.consumed_run_id='fabricated';}],
 ['paused owner revived',(x:any)=>{x.runs.original.status='active';}],['new execution after request',(x:any)=>{x.runs.active_run_id='new_run';}],
 ['wrong measured bytes',(x:any)=>{x.artifacts[0].measured_sha256='b'.repeat(64);}],['wrong measured size',(x:any)=>{x.artifacts[0].measured_byte_size++;}],
 ['duplicate artifact role',(x:any)=>{x.artifacts[0].roles.push('input');}],['lineage gap',(x:any)=>{x.history[0].after_version++;}],
 ['replay mutation',(x:any)=>{x.steps[1].rows.find((r:any)=>r.table==='tasks').updated=1;}],
 ['request event without actual writes',(x:any)=>{x.steps[0].rows=unchangedRows();}],
 ['duplicate request outcome',(x:any)=>{x.steps[0].outcome_ids.push('second');}],
 ['request wrong transition cardinality',(x:any)=>{const r=x.steps[0].rows.find((r:any)=>r.table==='decision_lifecycle_transitions');r.inserted=r.after_count=2;}],
 ['omitted snapshot table',(x:any)=>{x.steps[1].rows.pop();}],
 ['omitted fixed step',(x:any)=>{x.steps.pop();}],['raw secret field',(x:any)=>{x.principals.requester.token='not-allowed';}],
 ['oversized step inventory',(x:any)=>{x.steps=Array.from({length:17},()=>x.steps[0]);}],
]as const)it('rejects '+name+' in unit observation input',()=>{const x=unitInput();mutate(x);expect(typeof implementation.assertR3LocalObservation).toBe('function');expect(()=>implementation.assertR3LocalObservation(x)).toThrow();});
it('never promotes a fully self-consistent hand-authored observation to runtime acceptance',async()=>{
 const artifact=await implementation.encodeR3LocalObservation(unitInput());expect(JSON.parse(new TextDecoder().decode(artifact.bytes)).acceptance_eligible).toBe(false);
});
it('rejects accessor-backed array elements instead of executing them during validation',()=>{
 const x=unitInput();let reads=0;Object.defineProperty(x.artifacts,'0',{get(){reads++;return unitInput().artifacts[0];},enumerable:true});
 expect(()=>implementation.assertR3LocalObservation(x)).toThrow();expect(reads).toBe(0);
});
it('rejects extra array keys instead of treating them as a JSON extension bag',()=>{
 const x=unitInput();x.history.secret='not-allowed';expect(()=>implementation.assertR3LocalObservation(x)).toThrow();
});
function approvedUnitInput():any{
 const x=unitInput(),noop=(operation:string,status=409,code:string|null='VERSION_CONFLICT')=>({...structuredClone(x.steps[1]),operation,response:{status,code}});
 const inserts=['decision_lifecycle_transitions','events','task_history','idempotency_outcomes'],updates=['tasks','approvals','decision_lifecycle_heads'];
 const approve={...noop('approve',200,null),before_sha256:'b'.repeat(64),after_sha256:'c'.repeat(64),rows:unchangedRows().map(r=>inserts.includes(r.table)?{...r,before_count:1,after_count:2,inserted:1}:updates.includes(r.table)?{...r,before_count:1,after_count:1,updated:1}:r),event_ids:['event_approve'],outcome_ids:['outcome_approve']};
 x.case_id='human_approve_replay_revoked';x.principals.human={kind:'human',principal_id:'human_operator'};x.decision={...x.decision,task_version:5,approval_version:2,task_state:'ready',approval_status:'approved',decided_at:1001};
 x.steps=[x.steps[0],noop('stale-task-denial'),noop('stale-approval-denial'),noop('stale-proposal-denial'),approve,noop('approve-replay',200,null),noop('revoked-session-denial',401,'UNAUTHENTICATED')];
 x.history.push({sequence:2,kind:'approve',before_version:4,after_version:5,before_state:'waiting',after_state:'ready',run_id:null});return x;
}
it('validates structurally consistent synthetic human facts without accepting a release',()=>{expect(()=>implementation.assertR3LocalObservation(approvedUnitInput())).not.toThrow();});
for(const[name,mutate]of [
 ['human minted run',(x:any)=>{const r=x.steps[4].rows.find((r:any)=>r.table==='runs');r.after_count=r.inserted=1;}],
 ['human rewrote paused fence',(x:any)=>{const r=x.steps[4].rows.find((r:any)=>r.table==='runs');r.before_count=r.after_count=r.updated=1;}],
 ['human missing event',(x:any)=>{x.steps[4].event_ids=[];}],['human missing outcome',(x:any)=>{x.steps[4].outcome_ids=[];}],
 ['human missing transition',(x:any)=>{const r=x.steps[4].rows.find((r:any)=>r.table==='decision_lifecycle_transitions');r.after_count=r.before_count;r.inserted=0;}],
 ['human rewrote proposal',(x:any)=>{const r=x.steps[4].rows.find((r:any)=>r.table==='decision_proposals');r.before_count=r.after_count=r.updated=1;}],
 ['pause timestamp differs from request',(x:any)=>{x.runs.original.ended_at++;}],
 ['decision predates request',(x:any)=>{x.decision.decided_at=x.decision.created_at-1;}],
 ['decision at expiry',(x:any)=>{x.decision.decided_at=x.decision.expires_at;}],
]as const)it('rejects '+name+' in local human observation',()=>{const x=approvedUnitInput();mutate(x);expect(()=>implementation.assertR3LocalObservation(x)).toThrow();});
function recoveryUnitInput():any{
 const x=unitInput(),noop=(operation:string)=>({...structuredClone(x.steps[1]),operation});x.case_id='changed_chunk_continuation_denied';x.target_id='target_fixture';
 x.steps=[x.steps[0],...['capture','begin-restore','chunk-write','chunk-replay','changed-chunk-denial','continue-restore','old-runtime-denial','old-session-denial'].map(noop)];
 x.steps.find((s:any)=>s.operation==='changed-chunk-denial').response={status:null,code:'RECOVERY_CHUNK_MISMATCH'};
 for(const label of ['old-runtime-denial','old-session-denial'])x.steps.find((s:any)=>s.operation===label).response={status:401,code:'UNAUTHENTICATED'};
 x.recovery={capture_id:'capture_fixture',source_job_id:'source_job',target_job_id:'target_job',operation_id:'operation_fixture',manifest_sha256:hash,schema_version:19,checkpoint_sha256:hash,chunks:[{index:0,sha256:hash,byte_size:10}],source_epoch:1,target_epoch:2,before_projection_sha256:hash,after_projection_sha256:hash,before_artifacts_sha256:hash,after_artifacts_sha256:hash,maintenance_phase:'restored',old_runtime_denial:'UNAUTHENTICATED',old_session_denial:'UNAUTHENTICATED',continued_job_id:'target_job'};return x;
}
it('records source chunk exception without an unobserved HTTP status',()=>{expect(()=>implementation.assertR3LocalObservation(recoveryUnitInput())).not.toThrow();});
it('rejects invented HTTP status for direct source chunk exception',()=>{const x=recoveryUnitInput();x.steps.find((s:any)=>s.operation==='changed-chunk-denial').response.status=400;expect(()=>implementation.assertR3LocalObservation(x)).toThrow();});
