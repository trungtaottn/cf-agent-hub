/** Hand-authored UNIT values only; never actual pre-command or execution evidence. */
import {R3_CASE_STEPS,assertR3LocalObservation} from './r3-journey-observation';
import {J1_PRECOMMAND_TABLES,j1RecoveryCase,j1PlannedHuman} from './r3-precommand-context';
import {canonicalJson} from '../../src/config/bootstrap';
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
function approvedUnitInput():any{
 const x=unitInput(),noop=(operation:string,status=409,code:string|null='VERSION_CONFLICT')=>({...structuredClone(x.steps[1]),operation,response:{status,code}});
 const inserts=['decision_lifecycle_transitions','events','task_history','idempotency_outcomes'],updates=['tasks','approvals','decision_lifecycle_heads'];
 const approve={...noop('approve',200,null),before_sha256:'b'.repeat(64),after_sha256:'c'.repeat(64),rows:unchangedRows().map(r=>inserts.includes(r.table)?{...r,before_count:1,after_count:2,inserted:1}:updates.includes(r.table)?{...r,before_count:1,after_count:1,updated:1}:r),event_ids:['event_approve'],outcome_ids:['outcome_approve']};
 x.case_id='human_approve_replay_revoked';x.principals.human={kind:'human',principal_id:'human_operator'};x.decision={...x.decision,task_version:5,approval_version:2,task_state:'ready',approval_status:'approved',decided_at:1001};
 x.steps=[x.steps[0],noop('stale-task-denial'),noop('stale-approval-denial'),noop('stale-proposal-denial'),approve,noop('approve-replay',200,null),noop('revoked-session-denial',401,'UNAUTHENTICATED')];
 x.history.push({sequence:2,kind:'approve',before_version:4,after_version:5,before_state:'waiting',after_state:'ready',run_id:null});return x;
}
function recoveryUnitInput():any{
 const x=unitInput(),noop=(operation:string)=>({...structuredClone(x.steps[1]),operation});x.case_id='changed_chunk_continuation_denied';x.target_id='target_fixture';
 x.steps=[x.steps[0],...['capture','begin-restore','chunk-write','chunk-replay','changed-chunk-denial','continue-restore','old-runtime-denial','old-session-denial'].map(noop)];
 x.steps.find((s:any)=>s.operation==='changed-chunk-denial').response={status:null,code:'RECOVERY_CHUNK_MISMATCH'};
 for(const label of ['old-runtime-denial','old-session-denial'])x.steps.find((s:any)=>s.operation===label).response={status:401,code:'UNAUTHENTICATED'};
 x.recovery={capture_id:'capture_fixture',source_job_id:'source_job',target_job_id:'target_job',operation_id:'operation_fixture',manifest_sha256:hash,schema_version:19,checkpoint_sha256:hash,chunks:[{index:0,sha256:hash,byte_size:10}],source_epoch:1,target_epoch:2,before_projection_sha256:hash,after_projection_sha256:hash,before_artifacts_sha256:hash,after_artifacts_sha256:hash,maintenance_phase:'restored',old_runtime_denial:'UNAUTHENTICATED',old_session_denial:'UNAUTHENTICATED',continued_job_id:'target_job'};return x;
}

function rawUnitObservation(caseId:string):any{
 let x=caseId==='human_approve_replay_revoked'?approvedUnitInput():caseId==='human_reject_replay'||caseId==='rejected_command_history_restore'?approvedUnitInput():unitInput();
 if(caseId==='human_reject_replay'||caseId==='rejected_command_history_restore'){
  x.principals.human={kind:'human',principal_id:'human_operator'};x.decision.task_state='backlog';x.decision.approval_status='rejected';x.history[1].kind='reject';x.history[1].after_state='backlog';x.steps[4].operation='reject';
 }
 const byOperation=new Map(x.steps.map((s:any)=>[s.operation,s]));
 const noOp=(operation:string)=>({...structuredClone(x.steps[1]),operation,response:{status:operation.endsWith('-replay')?200:operation.endsWith('-denial')?401:409,code:operation.endsWith('-replay')?null:operation.endsWith('-denial')?'UNAUTHENTICATED':'IDEMPOTENCY_CONFLICT'}});
 x.steps=R3_CASE_STEPS[caseId as keyof typeof R3_CASE_STEPS].map(op=>byOperation.get(op)??noOp(op));
 x.case_id=caseId;
 if(caseId.endsWith('_restore')||caseId==='changed_chunk_continuation_denied'){
  const r=recoveryUnitInput();x.target_id=r.target_id;x.recovery=r.recovery;
  const changed=x.steps.find((s:any)=>s.operation==='changed-chunk-denial');if(changed)changed.response={status:null,code:'RECOVERY_CHUNK_MISMATCH'};
 }
 assertR3LocalObservation(x);return x;
}

const descriptorHash='89fd3cd5ab949eb46e2f43ce0eb1fa063bddef467579052051e5ad3f9216af4c';
export function unitContext(caseId:any):any{const recovered=j1RecoveryCase(caseId);return {format_version:1,stage:'pre-command-source-fixture-context',origin:'local-workers-synthetic-fixture',acceptance_eligible:false,provenance_authenticated:false,case_id:caseId,chronology:'before-domain-setup',source:{workspace_id:'ws_example',object_name:'j1_'+caseId+(recovered?'_source':''),config_epoch:1,config_sha256:'c'.repeat(64),installation_sha256:'d'.repeat(64),admission_state:'installed',maintenance_state:'open'},target:recovered?{workspace_id:'ws_example',object_name:'j1_'+caseId+'_target',config_epoch:2,config_sha256:'f'.repeat(64),installation_sha256:'b'.repeat(64),decision_policy_sha256:'e'.repeat(64),preparation:'prepared-not-installed'}:null,descriptor:{action_id:'synthetic.task-review',schema_version:1,schema_sha256:descriptorHash,semantic_revision:'synthetic-task-review@2'},policy:{version:3,sha256:'e'.repeat(64),configured_reviewer_ids:['human_operator','human_reviewer']},configured_principals:{requester:{kind:'agent',principal_id:'agent_research'},planned_human:j1PlannedHuman(caseId)?{kind:'human',principal_id:'human_operator'}:null},empty_domain_counts:Object.fromEntries(J1_PRECOMMAND_TABLES.map(x=>[x,0]))};}
export function unitObservation(caseId:string):any{const x=rawUnitObservation(caseId),recovered=caseId.endsWith('_restore')||caseId==='changed_chunk_continuation_denied';x.source_id='j1_'+caseId+(recovered?'_source':'');x.target_id=recovered?'j1_'+caseId+'_target':null;x.descriptor.schema_sha256=descriptorHash;x.policy={version:3,sha256:'e'.repeat(64),config_epoch:1,installation_sha256:'d'.repeat(64)};assertR3LocalObservation(x);return x;}
export const unitBytes=(x:unknown)=>new TextEncoder().encode(canonicalJson(x));

import {createHash} from 'node:crypto';
import {J1_CASES,J1_TESTS,J1_MODULE} from '../../scripts/lib/r3-source-producer-policy.mjs';
import {J1_CONTEXT_BINDINGS,J1_CONTEXT_MISSING} from '../../scripts/lib/r3-source-context-policy';
import {joinJ1PrecommandObservation} from '../../scripts/lib/r3-source-context-validator';
const unitSha=(x:Uint8Array|string)=>createHash('sha256').update(x).digest('hex');
/** Fabricated UNIT record used only to challenge the consistency API; NOT an executed run. */
export function unitExecution(){const run_id='a'.repeat(32),nonce_sha256='b'.repeat(64),prefix='validation/releases/'+run_id+'/source-fixture-context/',files=new Map<string,Uint8Array>();const ref=(path:string,bytes:Uint8Array)=>{files.set(path,bytes);return {path,sha256:unitSha(bytes),byte_size:bytes.length};};
 const source_files=[...J1_CONTEXT_BINDINGS].sort().map(path=>ref(path,new TextEncoder().encode('UNIT_SOURCE_ONLY:'+path)));
 const source={revision:'c'.repeat(40),tree:'d'.repeat(40),source_files,inventory_sha256:unitSha(canonicalJson(source_files)),lock_sha256:source_files.find(x=>x.path==='package-lock.json')!.sha256,configuration:{file:'vitest.r3-source-context-producer.config.ts',sha256:source_files.find(x=>x.path==='vitest.r3-source-context-producer.config.ts')!.sha256,project_name:'r3-j1-source-context-producer',module_path:J1_MODULE,filter:null,watch:false,retry:0,repeat_policy:'reject-nonzero-diagnostic',exclude:[],allow_only:false,shard:null,file_parallelism:false,max_workers:1,pool:'cloudflare-pool',reporter:'scripts/lib/r3-source-context-reporter.ts',profile:'j1-context-v2',provided_context:{r3SourceProfile:'j1-context-v2'}},runtime:{node:'24.22.1',node_executable_sha256:'e'.repeat(64),vitest:'4.1.12',vite:'7.3.7',workers_plugin:'1.4.7',wrangler:'4.152.0',esbuild:'0.28.2',typescript:'6.0.3',npm_engine_declared:'11.19.1',npm_executed:false,install_origin_verified:false,package_entries:['vitest','vite','@cloudflare/vitest-plugin','wrangler','esbuild','typescript'].map(name=>({name,package_json_sha256:'f'.repeat(64),entry_sha256:'e'.repeat(64),entry_path:'unit-entry.js'}))},environment:{PATH:'/unit/bin',HOME:'/unit/home',XDG_CONFIG_HOME:'/unit/config',TMPDIR:'/unit/tmp',TZ:'UTC',LANG:'C.UTF-8',CI:'true',NODE_ENV:'test',R3_SOURCE_RUN_STATE:'/unit/input.json'},product_build:null};
 const expectedSourceBytes=unitBytes(source),source_context_sha256=unitSha(expectedSourceBytes),observations=J1_CASES.map(case_id=>({case_id,artifact:ref(prefix+case_id+'.observation.json',unitBytes(unitObservation(case_id)))})),contexts=J1_CASES.map(case_id=>({case_id,artifact:ref(prefix+case_id+'.precommand.json',unitBytes(unitContext(case_id)))})),joins=J1_CASES.map(caseId=>joinJ1PrecommandObservation(unitBytes(unitObservation(caseId)),unitBytes(unitContext(caseId))));
 const manifest={format_version:2,origin:'local-workers-synthetic-fixture',run_id,nonce_sha256,source_context_sha256,stage:'j1-context-staged-source-candidate',acceptance_eligible:false,provenance_authenticated:false,module_path:J1_MODULE,project_name:'r3-j1-source-context-producer',selected_count:8,passed_count:8,failed_count:0,skipped_count:0,tests:J1_TESTS.map((name,i)=>({id:'test_'+i,name,state:'passed',retry_count:0,repeat_count:0,error_count:0})),observations,contexts,joins,profile:'j1-context-v2',context_origin:'same-reviewed-fixture-precommand',observation_count:6,context_count:6,joined_count:6};
 const reporter_manifest=ref(prefix+'reporter.json',unitBytes(manifest)),execution={format_version:2,stage:'j1-local-source-context-execution',origin:'local-workers-synthetic-fixture',acceptance_eligible:false,provenance_authenticated:false,local_execution_complete:true,product_build:null,run_id,nonce_sha256,source_context_sha256,source_context:source,process:{exit_code:0,signal:null,closed:true,error_code:null,elapsed_ms:1},reporter_manifest,selected_count:8,passed_count:8,observation_count:6,failed_count:0,skipped_count:0,missing_stages:[...J1_CONTEXT_MISSING],profile:'j1-context-v2',context_origin:'same-reviewed-fixture-precommand',precommand_comparison_join_complete:true,context_count:6,joined_count:6};
 return {files,source,expectedSourceBytes,manifest,execution,executionBytes:unitBytes(execution)};
}
