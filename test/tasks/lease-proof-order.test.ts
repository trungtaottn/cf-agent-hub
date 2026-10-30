import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {claimFixture,claimSetup,claimContext,claimSnapshot,PROOF_A} from '../helpers/claims';
import {taskProfile} from '../helpers/tasks';
import {claimTaskCommand} from '../../src/tasks/claim';
import {heartbeatRunCommand} from '../../src/tasks/lease';
import {executeCommand} from '../../src/workspace/commands';
import {fingerprintRequest} from '../../src/workspace/idempotency';

/** Internal command boundary only; public execution ingress remains unavailable. */
for(const target of ['missing','visible','foreign-project'] as const)it('heartbeat_wrong_proof_cannot_distinguish_'+target+'_target',async()=>{
 const {stub,name}=await claimFixture('lease-proof-order-'+target);
 await runInDurableObject(stub,async(_object,state)=>{
  taskProfile(state.storage);
  const {now,identity,body}=claimSetup(state.storage,Date.now(),{project_id:'project_a',work_role_id:'role_a'});
  executeCommand(await claimContext(state.storage,name,body,'claim',now),identity,claimTaskCommand('task_a','run_a',PROOF_A),body);
  // Narrow existing native authority; never add unsupported scopes or human execution grants.
  state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"tasks:execute\"]' WHERE credential_id='credential_research_1'");
  if(target==='foreign-project')state.storage.sql.exec("UPDATE native_credentials SET project_ids_json='[\"project_b\"]' WHERE credential_id='credential_research_1'");
  const runId=target==='missing'?'run_missing':'run_a',request={expected_run_version:1,fence:1};
  const ctx=await claimContext(state.storage,name,request,'bad-proof',now+1);
  ctx.fingerprint=await fingerprintRequest('POST','/v2/workspaces/ws_example/runs/'+runId+':heartbeat',{},request);
  const before=claimSnapshot(state.storage);
  expect(()=>executeCommand(ctx,identity,heartbeatRunCommand(runId,'f'.repeat(64)),request)).toThrowError(expect.objectContaining({status:401}));
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});

it('heartbeat_valid_owner_proof_does_not_bypass_current_project_restriction',async()=>{
 const {stub,name}=await claimFixture('lease-proof-order-valid-project');
 await runInDurableObject(stub,async(_object,state)=>{
  taskProfile(state.storage);
  const {now,identity,body}=claimSetup(state.storage,Date.now(),{project_id:'project_a',work_role_id:'role_a'});
  executeCommand(await claimContext(state.storage,name,body,'claim',now),identity,claimTaskCommand('task_a','run_a',PROOF_A),body);
  state.storage.sql.exec("UPDATE native_credentials SET project_ids_json='[\"project_b\"]' WHERE credential_id='credential_research_1'");
  const request={expected_run_version:1,fence:1},ctx=await claimContext(state.storage,name,request,'valid-proof',now+1);
  ctx.fingerprint=await fingerprintRequest('POST','/v2/workspaces/ws_example/runs/run_a:heartbeat',{},request);
  const before=claimSnapshot(state.storage);
  expect(()=>executeCommand(ctx,identity,heartbeatRunCommand('run_a',PROOF_A),request)).toThrowError(expect.objectContaining({status:403}));
  expect(claimSnapshot(state.storage)).toEqual(before);
 });
});
