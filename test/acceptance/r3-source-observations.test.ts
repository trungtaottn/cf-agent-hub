/** Hand-authored verifier inputs are UNIT evidence only, never actual producer records. */
import {it,expect} from 'vitest';
import {existsSync} from 'node:fs';
const url=new URL('../../scripts/lib/r3-source-observation-validator.ts',import.meta.url);
const implementation:Record<string,any>=existsSync(url)?await import(/* @vite-ignore */url.href):{};
it('exports bounded source consistency API without release authority',()=>{expect(typeof implementation.validateR3SourceObservations).toBe('function');});

import {createHash} from 'node:crypto';
import {assertR3LocalObservation,R3_JOURNEY_CASES,R3_CASE_STEPS} from '../helpers/r3-journey-observation';
const digest=(x:string|Uint8Array)=>createHash('sha256').update(x).digest('hex');
const canonical=(x:any):string=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const bytes=(x:any)=>new TextEncoder().encode(canonical(x));
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

function observation(caseId:string):any{
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
function binding(x:any){return {workspace_id:x.workspace_id,source_id:x.source_id,target_id:x.target_id,descriptor:x.descriptor,policy:x.policy,principals:x.principals,reviewer_ids:x.reviewer_ids};}
function fixture(){
 const files=new Map<string,Uint8Array>();const ref=(path:string,value:Uint8Array)=>{files.set(path,value);return {path,sha256:digest(value),byte_size:value.byteLength};};
 const sourcePaths=['package-lock.json','test/helpers/r3-journey-fixture.ts','test/helpers/r3-journey-observation.ts','test/acceptance/r3-request-journey.test.ts'];
 const sources=sourcePaths.map(path=>ref(path,new TextEncoder().encode('SYNTHETIC UNIT SOURCE '+path))).sort((a,b)=>a.path.localeCompare(b.path));
 const source={revision:'a'.repeat(40),git_tree:'b'.repeat(40),producer_revision:'c'.repeat(40),inventory_sha256:digest(canonical(sources)),lock_sha256:files.has('package-lock.json')?digest(files.get('package-lock.json')!):'',toolchain:{node:'24.22.1',npm:'11.19.1',vitest:'4.1.12',workers_plugin:'1.4.7'},bindings:{lock:sourcePaths[0],fixture:sourcePaths[1],predicate:sourcePaths[2],test:sourcePaths[3]},build:null};
 const environment={class:'local-workers-synthetic-fixture',local_sqlite:true,emulated_artifact_store:true,synthetic_human_session:true};
 const observations=R3_JOURNEY_CASES.map(case_id=>({case_id,artifact:ref('validation/releases/unit/source-fixture/'+case_id+'.json',bytes(observation(case_id)))}));
 const root={format_version:1,round:'R3',mode:'source-fixture',profile:'r3-j1-source-v1',run_id:'unit',source,environment,sources,observations};
 const context={format_version:1,profile:root.profile,run_id:'unit',source:structuredClone(source),environment:structuredClone(environment),cases:R3_JOURNEY_CASES.map(case_id=>({case_id,...binding(observation(case_id))}))};
 return {root,context,files};
}
const invoke=(f:ReturnType<typeof fixture>)=>implementation.validateR3SourceObservations(bytes(f.root),{files:f.files,expectedContextBytes:bytes(f.context)});
it('validates exactly six synthetic unit observations with no execution or acceptance authority',()=>{const r=invoke(fixture());expect(r.structurally_valid).toBe(true);expect(r.source_profile_complete).toBe(true);expect(r.acceptance_eligible).toBe(false);expect(r.provenance_authenticated).toBe(false);expect(r.observed_case_ids).toEqual([...R3_JOURNEY_CASES]);expect(r.missing_stages).toContain('execution-transport');expect(r.missing_stages).toContain('formal67');});
for(const [name,mutate]of [
 ['unknown root key',(f:any)=>{f.root.acceptance_eligible=true;}],['wrong round',(f:any)=>{f.root.round='R2';}],['unsupported J2',(f:any)=>{f.root.profile='r3-j1-j2-source-v1';f.context.profile=f.root.profile;}],['missing case',(f:any)=>{f.root.observations.pop();}],['extra case',(f:any)=>{f.root.observations.push(f.root.observations[0]);}],['reordered cases',(f:any)=>{f.root.observations.reverse();}],['forged context actor',(f:any)=>{f.context.cases[0].principals.requester.principal_id='other';}],['wrong source revision',(f:any)=>{f.context.source.revision='d'.repeat(40);}],['missing source bytes',(f:any)=>{f.files.delete('package-lock.json');}],['unknown map key',(f:any)=>{f.files.set('undeclared',new Uint8Array());}],['wrong artifact size',(f:any)=>{f.root.observations[0].artifact.byte_size++;}],['traversal',(f:any)=>{f.root.observations[0].artifact.path='../escape';}],['source digest',(f:any)=>{f.root.sources[0].sha256='f'.repeat(64);}],['unknown context key',(f:any)=>{f.context.actual_runtime=true;}],
] as const)it('fails closed: '+name,()=>{const f=fixture();mutate(f);const r=invoke(f);expect(r.structurally_valid).toBe(false);expect(r.source_profile_complete).toBe(false);expect(r.acceptance_eligible).toBe(false);expect(r.provenance_authenticated).toBe(false);});
for(const [name,mutate]of [['renewed expiry',(x:any)=>x.decision.expires_at++],['invented consumed run',(x:any)=>x.decision.consumed_run_id='run_new'],['changed input bytes',(x:any)=>x.artifacts[0].measured_sha256='f'.repeat(64)],['missing request event',(x:any)=>x.steps[0].event_ids=[]],['secret unknown key',(x:any)=>x.private_raw='SYNTHETIC_SECRET_CANARY']]as const)it('uses actual J1 predicate: '+name,()=>{const f=fixture(),ref=f.root.observations[0].artifact,x=JSON.parse(new TextDecoder().decode(f.files.get(ref.path)!));mutate(x);const value=bytes(x);f.files.set(ref.path,value);ref.byte_size=value.length;ref.sha256=digest(value);const r=invoke(f);expect(r.structurally_valid).toBe(false);expect(JSON.stringify(r)).not.toContain('SYNTHETIC_SECRET_CANARY');});
it('permits identical content at distinct source paths',()=>{const f=fixture(),value=new TextEncoder().encode('identical generated unit source');for(const r of f.root.sources){f.files.set(r.path,value);r.sha256=digest(value);r.byte_size=value.length;}f.root.source.lock_sha256=digest(value);f.root.source.inventory_sha256=digest(canonical(f.root.sources));f.context.source=structuredClone(f.root.source);expect(invoke(f).structurally_valid).toBe(true);});
it('does not call Map subclass overrides',()=>{const f=fixture();class Untrusted extends Map{override get size():number{throw Error('override');}override entries():any{throw Error('override');}override get(_k:any):any{throw Error('override');}override [Symbol.iterator]():any{throw Error('override');}}const collection=new Untrusted();for(const [key,value]of f.files)Map.prototype.set.call(collection,key,value);f.files=collection;expect(invoke(f).structurally_valid).toBe(true);});
it('rejects oversize intrinsic Map before inspecting values',()=>{const f=fixture();for(let i=0;i<300;i++)f.files.set('extra'+i,new Proxy({} as Uint8Array,{get(){throw Error('must not inspect');}}));expect(invoke(f).findings[0].code).toBe('R3_SOURCE_BUDGET');});
it('never evaluates options accessors',()=>{let calls=0;const f=fixture(),options={files:f.files,get expectedContextBytes(){calls++;throw Error('private');}};expect(implementation.validateR3SourceObservations(bytes(f.root),options).structurally_valid).toBe(false);expect(calls).toBe(0);});
it('sanitizes hostile thrown values without invoking their diagnostic getters',()=>{const f=fixture(),thrown=new Proxy({}, {getPrototypeOf(){throw Error('SECONDARY_PRIVATE_ERROR');}}),options=new Proxy({}, {getPrototypeOf(){throw thrown;}});expect(()=>implementation.validateR3SourceObservations(bytes(f.root),options)).not.toThrow();expect(implementation.validateR3SourceObservations(bytes(f.root),options).structurally_valid).toBe(false);});
it.each([new Uint8Array([0xff]),new Uint8Array([239,187,191,123,125]),new Uint8Array(65537)])('rejects malformed/bounded envelope bytes',value=>{const f=fixture();expect(implementation.validateR3SourceObservations(value,{files:f.files,expectedContextBytes:bytes(f.context)}).structurally_valid).toBe(false);});
it('rejects shared and resizable caller buffers',()=>{const f=fixture();for(const buffer of [new SharedArrayBuffer(4),Reflect.construct(ArrayBuffer,[4,{maxByteLength:8}]) as ArrayBuffer])expect(implementation.validateR3SourceObservations(new Uint8Array(buffer),{files:f.files,expectedContextBytes:bytes(f.context)}).structurally_valid).toBe(false);});
it('rejects observation overflow before file copying',()=>{const f=fixture();f.root.observations[0].artifact.byte_size=262145;expect(invoke(f).structurally_valid).toBe(false);});
it('rejects aliased observation claims even when refs agree',()=>{const f=fixture();f.root.observations[1].artifact={...f.root.observations[0].artifact};expect(invoke(f).structurally_valid).toBe(false);});
it('never runs submitted command or schema strings',()=>{const f=fixture();(f.root as any).command='do-not-execute';(f.root as any).schema='file:///private';expect(invoke(f).structurally_valid).toBe(false);});
it('detaches caller byte arrays and does not mutate inputs',()=>{const f=fixture(),before=Array.from(f.files,([k,v])=>[k,digest(v)]);expect(invoke(f).structurally_valid).toBe(true);expect(Array.from(f.files,([k,v])=>[k,digest(v)])).toEqual(before);});
