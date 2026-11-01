/** Source-export protocol unit fixtures, NEVER actual producer execution receipts. */
import {it,expect} from 'vitest';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const packetUrl=new URL('../helpers/r3-source-export-packet.ts',import.meta.url);
const codec:Record<string,any>=existsSync(packetUrl)?await import(/* @vite-ignore */packetUrl.href):{};
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const caseId='request_pause_replay';
it('exports bounded producer packet codec',()=>{expect(typeof codec.encodeR3SourcePacket).toBe('function');expect(typeof codec.decodeR3SourcePacket).toBe('function');});
it('roundtrips immutable canonical base64 with explicit source-only stage',async()=>{const bytes=new TextEncoder().encode('{"synthetic":"escape\\\\quote\\\"☃"}'),encoded=await codec.encodeR3SourcePacket(caseId,{bytes,sha256:sha(bytes)}),packet=JSON.parse(encoded);expect(packet.stage).toBe('j1-safe-observation');expect(packet.byte_size).toBe(bytes.length);expect(packet.base64_json).toBe(Buffer.from(bytes).toString('base64'));const decoded=await codec.decodeR3SourcePacket(encoded);expect(decoded.bytes).toEqual(bytes);expect(decoded.case_id).toBe(caseId);});
it('pins mutable caller data before async hashing',async()=>{const bytes=new TextEncoder().encode('synthetic-original'),original=bytes.slice(),artifact={bytes,sha256:sha(bytes)},pending=codec.encodeR3SourcePacket(caseId,artifact);bytes.fill(0);artifact.sha256='f'.repeat(64);const decoded=await codec.decodeR3SourcePacket(await pending);expect(decoded.bytes).toEqual(original);});
it('bounds escape-heavy maximum logical payload independently of serialized field',async()=>{const bytes=new TextEncoder().encode('"'+('\\"'.repeat(131071))+'"');expect(bytes.length).toBe(262144);const packet=await codec.encodeR3SourcePacket(caseId,{bytes,sha256:sha(bytes)});expect(JSON.parse(packet).base64_json.length).toBe(349528);expect(Buffer.byteLength(JSON.stringify({r3SourceObservation:packet}))).toBeLessThanOrEqual(360448);expect((await codec.decodeR3SourcePacket(packet)).bytes).toEqual(bytes);});
it('rejects logical overflow before producer metadata assignment',async()=>{const bytes=new Uint8Array(262145);await expect(codec.encodeR3SourcePacket(caseId,{bytes,sha256:sha(bytes)})).rejects.toThrow('R3_SOURCE_PACKET_INVALID');});
it('rejects oversized serialized field before parser work',async()=>{await expect(codec.decodeR3SourcePacket('x'.repeat(360449))).rejects.toThrow('R3_SOURCE_PACKET_INVALID');});
it('rejects unknown cases and mismatched byte digest',async()=>{const bytes=new Uint8Array([1]);await expect(codec.encodeR3SourcePacket('unknown',{bytes,sha256:sha(bytes)})).rejects.toThrow();await expect(codec.encodeR3SourcePacket(caseId,{bytes,sha256:'a'.repeat(64)})).rejects.toThrow();});
for(const [name,change]of [['extra',(x:any)=>{x.raw='PRIVATE_CANARY';}],['stage',(x:any)=>{x.stage='release';}],['size',(x:any)=>{x.byte_size++;}],['digest',(x:any)=>{x.sha256='f'.repeat(64);}],['noncanonical padding',(x:any)=>{x.base64_json='YR==';}],['base64 whitespace',(x:any)=>{x.base64_json+='\n';}],['case',(x:any)=>{x.case_id='unknown';}]]as const)it('rejects packet '+name,async()=>{const bytes=new TextEncoder().encode('a'),packet=JSON.parse(await codec.encodeR3SourcePacket(caseId,{bytes,sha256:sha(bytes)}));change(packet);await expect(codec.decodeR3SourcePacket(JSON.stringify(packet))).rejects.toThrow('R3_SOURCE_PACKET_INVALID');});
it('never invokes artifact accessors or accepts shared/resizable backing',async()=>{let reads=0;await expect(codec.encodeR3SourcePacket(caseId,{get bytes(){reads++;return new Uint8Array([1]);},sha256:'a'.repeat(64)})).rejects.toThrow();expect(reads).toBe(0);for(const buffer of [new SharedArrayBuffer(1),Reflect.construct(ArrayBuffer,[1,{maxByteLength:2}])]){const bytes=new Uint8Array(buffer);await expect(codec.encodeR3SourcePacket(caseId,{bytes,sha256:sha(bytes)})).rejects.toThrow();}});

import {R3_CASE_STEPS,assertR3LocalObservation,encodeR3LocalObservation} from "../helpers/r3-journey-observation";
import {J1_TESTS,J1_CASES,J1_MODULE} from "../../scripts/lib/r3-source-producer-policy.mjs";
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

const coreUrl=new URL('../../scripts/lib/r3-source-producer-run.ts',import.meta.url);
const core:Record<string,any>=existsSync(coreUrl)?await import(/* @vite-ignore */coreUrl.href):{};
async function runFacts(){
 const cases:any[]=[];
 for(let i=0;i<J1_TESTS.length;i++){let packet=null;if(i<6){const x=observation(J1_CASES[i]),encoded=await encodeR3LocalObservation(x);packet=await codec.encodeR3SourcePacket(J1_CASES[i],encoded);}cases.push({id:'test_'+i,name:J1_TESTS[i],state:'passed',mode:'run',packet,retry_count:0,repeat_count:0,flaky:false,error_count:0});}
 const completed={module_path:J1_MODULE,project_name:'r3-j1-source-producer',state:'passed',cases};
 const collected=structuredClone(completed);collected.state='pending';for(const t of collected.cases){t.state='pending';t.packet=null;t.retry_count=null;t.repeat_count=null;t.flaky=null;}
 return {collected,completed};
}
async function feed(run:any,f:Awaited<ReturnType<typeof runFacts>>){run.collect(f.collected);for(const c of f.completed.cases)await run.result(c);}
it('exports exact source run state machine',()=>{expect(typeof core.J1SourceRun).toBe('function');});
it('requires exact eight actual final states and six safe observation packets',async()=>{const f=await runFacts(),run=new core.J1SourceRun();await feed(run,f);const candidate=run.finish(f.completed,'passed',0);expect(candidate.tests).toHaveLength(8);expect(candidate.artifacts).toHaveLength(6);expect(candidate.acceptance_eligible).toBe(false);expect(candidate.provenance_authenticated).toBe(false);expect(candidate.stage).toBe('j1-staged-source-candidate');});
for(const name of ['skipped','pending','failed'])it('rejects nonpassed result even if a hypothetical ok() is true: '+name,async()=>{const f=await runFacts(),run=new core.J1SourceRun();run.collect(f.collected);f.completed.cases[0].state=name;await expect(run.result(f.completed.cases[0])).rejects.toThrow('R3_SOURCE_RUN_INVALID');expect(()=>run.finish(f.completed,'passed',0)).toThrow();});
for(const [name,mutate]of [['retry',(x:any)=>x.retry_count=1],['repeat',(x:any)=>x.repeat_count=1],['flaky',(x:any)=>x.flaky=true],['errors',(x:any)=>x.error_count=1],['only',(x:any)=>x.mode='only'],['unknown name',(x:any)=>x.name='unknown'],['unknown id',(x:any)=>x.id='unknown'],['no packet',(x:any)=>x.packet=null]]as const)it('rejects result '+name,async()=>{const f=await runFacts(),run=new core.J1SourceRun();run.collect(f.collected);mutate(f.completed.cases[0]);await expect(run.result(f.completed.cases[0])).rejects.toThrow();});
it('rejects metadata on guard test',async()=>{const f=await runFacts(),run=new core.J1SourceRun();run.collect(f.collected);f.completed.cases[6].packet=f.completed.cases[0].packet;await expect(run.result(f.completed.cases[6])).rejects.toThrow();});
it('rejects duplicate callback and cannot recover by final pass',async()=>{const f=await runFacts(),run=new core.J1SourceRun();run.collect(f.collected);await run.result(f.completed.cases[0]);await expect(run.result(f.completed.cases[0])).rejects.toThrow();expect(()=>run.finish(f.completed,'passed',0)).toThrow();});
for(const [name,mutate]of [['afterAll module failure',(f:any)=>f.completed.state='failed'],['missing guard',(f:any)=>f.completed.cases.pop()],['late metadata mutation',(f:any)=>f.completed.cases[0].packet+=' '],['wrong module',(f:any)=>f.completed.module_path='test/acceptance/r3.test.ts'],['wrong project',(f:any)=>f.completed.project_name='another']]as const)it('rejects final '+name+' after every body passed',async()=>{const f=await runFacts(),run=new core.J1SourceRun();await feed(run,f);mutate(f);expect(()=>run.finish(f.completed,'passed',0)).toThrow('R3_SOURCE_RUN_INVALID');});
it('rejects failed/interrupted run or unhandled errors',async()=>{for(const [reason,errors]of [['failed',0],['interrupted',0],['passed',1]]as const){const f=await runFacts(),run=new core.J1SourceRun();await feed(run,f);expect(()=>run.finish(f.completed,reason,errors)).toThrow();}});
it('rejects second collected module and extra discovery before results',async()=>{const f=await runFacts(),run=new core.J1SourceRun();run.collect(f.collected);expect(()=>run.collect(f.collected)).toThrow();const r=new core.J1SourceRun();f.collected.cases.push(f.collected.cases[0]);expect(()=>r.collect(f.collected)).toThrow();});
it('cannot finish while async packet verification is still pending',async()=>{const f=await runFacts(),run=new core.J1SourceRun();run.collect(f.collected);const pending=run.result(f.completed.cases[0]);expect(()=>run.finish(f.completed,'passed',0)).toThrow();await expect(pending).rejects.toThrow();});
