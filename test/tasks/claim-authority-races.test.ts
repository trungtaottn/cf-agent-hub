import {it,expect,vi,afterEach} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {claimFixture,claimSetup,claimContext,claimIdentity,claimActorContext,claimSnapshot,PROOF_A} from '../helpers/claims';
import {taskProfile} from '../helpers/tasks';
import {operator} from '../helpers/environment';
import {enrollRuntime} from '../../src/runtimes/commands';
import {hashRuntimeProof} from '../../src/auth/runtime-proof';
import {withTransaction} from '../../src/storage/transaction';
import {claimTaskCommand} from '../../src/tasks/claim';
import {heartbeatRunCommand} from '../../src/tasks/lease';
import {executeCommand} from '../../src/workspace/commands';
import {canonicalJson,sha256,prepareBootstrap} from '../../src/config/bootstrap';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import type {TaskClaimRequest} from '../../src/http/dto';
afterEach(()=>vi.restoreAllMocks());
const rawProof='A'.repeat(43);
/** These exercise the internal authenticated command boundary, not disabled public ingress. */
async function cryptoRuntime(storage:DurableObjectStorage,now:number){const proofHash=await hashRuntimeProof(rawProof);withTransaction(storage,tx=>enrollRuntime(tx,claimActorContext(storage,now),{label:'Crypto race fixture'},{runtimeId:'runtime_crypto',proofSha256:proofHash}));return proofHash;}
for(const replay of [false,true])for(const mutation of ['credential','proof','maintenance','project','archive'] as const)it(`claim_hash_await_rechecks_${mutation}_${replay?'replay':'fresh'}_before_effects`,async()=>{
 const {stub,name}=await claimFixture('claim-hash-'+mutation+'-'+replay);await runInDurableObject(stub,async(_o,state)=>{
  taskProfile(state.storage);const {now,identity}=claimSetup(state.storage,Date.now(),{project_id:'project_a',work_role_id:'role_a'}),hash=await cryptoRuntime(state.storage,now),body={expected_version:2,runtime_instance_id:'runtime_crypto'},ctx=await claimContext(state.storage,name,body,'same',now);
  if(replay)executeCommand(ctx,identity,claimTaskCommand('task_a','run_a',hash),body);
  const before=claimSnapshot(state.storage),digest=crypto.subtle.digest.bind(crypto.subtle);let intercepted=0;
  // Fault injection only narrows/revokes existing authority; it cannot grant execution.
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{const output=await digest(algorithm,data);if(new TextDecoder().decode(data)===rawProof){intercepted++;
   if(mutation==='credential')state.storage.sql.exec("UPDATE native_credentials SET enabled=0,revoked_at=? WHERE credential_id='credential_research_1'",now);
   if(mutation==='proof')state.storage.sql.exec("UPDATE runtimes SET revoked_at=? WHERE id='runtime_crypto'",now);
   if(mutation==='maintenance')state.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1');
   if(mutation==='project')state.storage.sql.exec("UPDATE native_credentials SET project_ids_json='[\"project_b\"]' WHERE credential_id='credential_research_1'");
   if(mutation==='archive')state.storage.sql.exec("UPDATE static_agents SET status='archived' WHERE agent_id='agent_research'");
  }return output;});
  try{const proof=await hashRuntimeProof(rawProof);expect(intercepted).toBe(1);expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','run_unused',proof),body)).toThrowError(expect.objectContaining({status:mutation==='project'?403:401}));expect(claimSnapshot(state.storage)).toEqual(before);}finally{spy.mockRestore();}
 });
});
for(const replay of [false,true])it(`claim_hash_await_rechecks_real_higher_epoch_${replay?'replay':'fresh'}`,async()=>{
 const {stub,name,raw,input}=await claimFixture('claim-real-epoch-'+replay);const next=structuredClone(raw);next.config.config_epoch=2;next.bundle.config_epoch=2;next.bundle.config_digest=await sha256(canonicalJson(next.config));const prepared=await prepareBootstrap(next.config,next.bundle,'ws_example');
 await runInDurableObject(stub,async(object,state)=>{
  const {now,identity}=claimSetup(state.storage),hash=await cryptoRuntime(state.storage,now),body={expected_version:2,runtime_instance_id:'runtime_crypto'},ctx=await claimContext(state.storage,name,body,'same',now);
  if(replay)executeCommand(ctx,identity,claimTaskCommand('task_a','run_a',hash),body);
  const before=claimSnapshot(state.storage),digest=crypto.subtle.digest.bind(crypto.subtle);let intercepted=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{const output=await digest(algorithm,data);if(new TextDecoder().decode(data)===rawProof){intercepted++;await object.reconcileConfiguration(operator(1,input.installationDigest),prepared);}return output;});
  try{const proof=await hashRuntimeProof(rawProof);expect(intercepted).toBe(1);expect(state.storage.sql.exec('SELECT config_epoch FROM workspace_metadata').one()).toEqual({config_epoch:2});const afterInstall=claimSnapshot(state.storage);expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','unused',proof),body)).toThrowError(expect.objectContaining({status:401}));expect(claimSnapshot(state.storage)).toEqual(afterInstall);expect(afterInstall.runs).toEqual(before.runs);expect(afterInstall.tasks).toEqual(before.tasks);expect(afterInstall.idempotency_outcomes).toEqual(before.idempotency_outcomes);}finally{spy.mockRestore();}
 });
});
for(const mutation of ['credential','maintenance','project'] as const)it('claim_fingerprint_await_rechecks_'+mutation+'_before_effects',async()=>{
 const {stub,name}=await claimFixture('claim-fingerprint-'+mutation);await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage),ctx=await claimContext(state.storage,name,body,'fingerprint',now),before=claimSnapshot(state.storage),digest=crypto.subtle.digest.bind(crypto.subtle);let intercepted=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{const output=await digest(algorithm,data);if(new TextDecoder().decode(data).includes('tasks/task_a:claim')){intercepted++;if(mutation==='credential')state.storage.sql.exec("UPDATE native_credentials SET enabled=0 WHERE credential_id='credential_research_1'");if(mutation==='maintenance')state.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1');if(mutation==='project')state.storage.sql.exec("UPDATE native_credentials SET project_ids_json='[]' WHERE credential_id='credential_research_1'");}return output;});
  try{ctx.fingerprint=await fingerprintRequest('POST','/v2/workspaces/ws_example/tasks/task_a:claim',{},body);expect(intercepted).toBe(1);expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','run_a',PROOF_A),body)).toThrowError(expect.objectContaining({status:mutation==='project'?403:401}));expect(claimSnapshot(state.storage)).toEqual(before);}finally{spy.mockRestore();}
 });
});
for(const mutation of ['missing-policy','eligibility-rule'] as const)it('first_claim_rechecks_'+mutation+'_after_proof_hash',async()=>{
 const {stub,name}=await claimFixture('claim-policy-hash-'+mutation);await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity}=claimSetup(state.storage),hash=await cryptoRuntime(state.storage,now),body={expected_version:2,runtime_instance_id:'runtime_crypto'},ctx=await claimContext(state.storage,name,body,'policy',now),before=claimSnapshot(state.storage),digest=crypto.subtle.digest.bind(crypto.subtle);let intercepted=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{const output=await digest(algorithm,data);if(new TextDecoder().decode(data)===rawProof){intercepted++;const row=state.storage.sql.exec<{config_json:string}>('SELECT config_json FROM workspace_metadata').one(),config=JSON.parse(row.config_json);if(mutation==='missing-policy')delete config.workspace_policies[0].execution_policy;else config.workspace_policies[0].execution_policy.eligibility_rules=[];
   // Explicit installed-state fault fixture: test current policy consumption, not an authorized config update API.
   state.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',JSON.stringify(config));}return output;});
  try{const proof=await hashRuntimeProof(rawProof);expect(hash).toBe(proof);expect(intercepted).toBe(1);expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','run_a',proof),body)).toThrowError(expect.objectContaining({code:mutation==='missing-policy'?'DEPENDENCY_UNAVAILABLE':'FORBIDDEN'}));expect(claimSnapshot(state.storage)).toEqual(before);}finally{spy.mockRestore();}
 });
});
for(const mode of ['expired','ended'] as const)it('claim_same_key_replay_preserves_original_after_'+mode+'_without_new_lease',async()=>{
 const {stub,name}=await claimFixture('claim-replay-'+mode);await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage),ctx=await claimContext(state.storage,name,body,'same',now),original=executeCommand(ctx,identity,claimTaskCommand('task_a','run_a',PROOF_A),body);
  if(mode==='ended')withTransaction(state.storage,tx=>{tx.exec("UPDATE tasks SET state='backlog',active_run_id=NULL,task_version=4 WHERE id='task_a'");tx.exec("UPDATE runs SET status='failed',ended_at=?,run_version=2 WHERE id='run_a'",[now+1000]);});
  const before=claimSnapshot(state.storage);ctx.workspace.clock={nowMs:()=>now+60001};expect(executeCommand(ctx,identity,claimTaskCommand('task_a','unused',PROOF_A),body)).toEqual(original);expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
for(const runtime of ['runtime_a','missing_runtime'])it('unverified_claim_proof_cannot_probe_missing_task_'+runtime,async()=>{
 const {stub,name}=await claimFixture('claim-probe-'+runtime);await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage),request={...body,runtime_instance_id:runtime},ctx=await claimContext(state.storage,name,request,'probe',now,'missing_task'),before=claimSnapshot(state.storage);
  expect(()=>executeCommand(ctx,identity,claimTaskCommand('missing_task','run_probe','f'.repeat(64)),request)).toThrowError(expect.objectContaining({status:401}));expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
it('configured_capacity_two_allows_two_distinct_active_attempts',async()=>{
 const {stub,name}=await claimFixture('claim-capacity-two',{wip:2});await runInDurableObject(stub,async(_o,state)=>{const {now,identity,body}=claimSetup(state.storage);for(const id of ['task_a','task_b'])executeCommand(await claimContext(state.storage,name,body,id,now,id),identity,claimTaskCommand(id,'run_'+id,PROOF_A),body);expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM runs WHERE status='active'").one()).toEqual({n:2});expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM idempotency_outcomes').one()).toEqual({n:2});});
});
for(const field of ['next_fence','task_version'] as const)it('claim_rejects_'+field+'_overflow_without_partial_effects',async()=>{
 const {stub,name}=await claimFixture('claim-overflow-'+field);await runInDurableObject(stub,async(_o,state)=>{const {now,identity,body}=claimSetup(state.storage);state.storage.sql.exec('UPDATE tasks SET '+field+'=? WHERE id=?',Number.MAX_SAFE_INTEGER,'task_a');const request={...body,expected_version:field==='task_version'?Number.MAX_SAFE_INTEGER:body.expected_version},ctx=await claimContext(state.storage,name,request,'overflow',now),before=claimSnapshot(state.storage);expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','run_a',PROOF_A),request)).toThrowError(expect.objectContaining({code:'LIMIT_EXCEEDED'}));expect(claimSnapshot(state.storage)).toEqual(before);});
});
it('claim_rejects_unknown_fields_and_duplicate_reserved_identity',async()=>{
 const {stub,name}=await claimFixture('claim-invalid',{wip:2});await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage),bad={...body,fence:1} as TaskClaimRequest,ctx=await claimContext(state.storage,name,bad,'bad',now),before=claimSnapshot(state.storage);expect(()=>executeCommand(ctx,identity,claimTaskCommand('task_a','run_a',PROOF_A),bad)).toThrowError(expect.objectContaining({code:'INVALID_REQUEST'}));expect(claimSnapshot(state.storage)).toEqual(before);
  executeCommand(await claimContext(state.storage,name,body,'one',now),identity,claimTaskCommand('task_a','run_a',PROOF_A),body);const committed=claimSnapshot(state.storage),second=await claimContext(state.storage,name,body,'two',now,'task_b');expect(()=>executeCommand(second,identity,claimTaskCommand('task_b','run_a',PROOF_A),body)).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));expect(claimSnapshot(state.storage)).toEqual(committed);
 });
});
it('heartbeat_hash_await_rechecks_credential_before_retained_replay',async()=>{
 const {stub,name}=await claimFixture('heartbeat-proof-replay');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity}=claimSetup(state.storage),hash=await cryptoRuntime(state.storage,now),claim={expected_version:2,runtime_instance_id:'runtime_crypto'};executeCommand(await claimContext(state.storage,name,claim,'claim',now),identity,claimTaskCommand('task_a','run_a',hash),claim);
  const body={expected_run_version:1,fence:1},ctx=await claimContext(state.storage,name,body,'heartbeat',now+1000);ctx.fingerprint=await fingerprintRequest('POST','/v2/workspaces/ws_example/runs/run_a:heartbeat',{},body);executeCommand(ctx,identity,heartbeatRunCommand('run_a',hash),body);const before=claimSnapshot(state.storage),digest=crypto.subtle.digest.bind(crypto.subtle);let intercepted=0;
  const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{const output=await digest(algorithm,data);if(new TextDecoder().decode(data)===rawProof){intercepted++;state.storage.sql.exec("UPDATE native_credentials SET enabled=0 WHERE credential_id='credential_research_1'");}return output;});
  try{const proof=await hashRuntimeProof(rawProof);expect(intercepted).toBe(1);expect(()=>executeCommand(ctx,identity,heartbeatRunCommand('run_a',proof),body)).toThrowError(expect.objectContaining({status:401}));expect(claimSnapshot(state.storage)).toEqual(before);}finally{spy.mockRestore();}
 });
});
it('claim_only_credential_cannot_probe_missing_task_with_valid_runtime_proof',async()=>{
 const {stub,name}=await claimFixture('claim-probe-execute-scope');await runInDurableObject(stub,async(_o,state)=>{
  const {now,identity,body}=claimSetup(state.storage);
  // Narrow a current installed credential; another same-agent credential retains execute.
  state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"tasks:claim\",\"runtimes:manage\"]' WHERE credential_id='credential_research_1'");
  const before=claimSnapshot(state.storage);
  for(const id of ['task_a','missing_task']){const ctx=await claimContext(state.storage,name,body,'probe-'+id,now,id);expect(()=>executeCommand(ctx,identity,claimTaskCommand(id,'run_probe',PROOF_A),body)).toThrowError(expect.objectContaining({status:403}));}
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
