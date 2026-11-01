import {fingerprintRequest} from '../../src/workspace/idempotency';
import {cancelTaskCommand} from '../../src/tasks/commands';
import {executeCommand} from '../../src/workspace/commands';
import {commandContext} from '../helpers/settings';
import {isCompletedRestoreDecisionHead,isRestoreDecisionCancellationGap} from '../../src/recovery/decision-provenance';
import {resumeThenNext,restoreWithAuditChecks} from './decision-roundtrip-fixture';
import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {canonicalJson} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {verifyDecisionSourceRow} from '../../src/recovery/decision-graph';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {currentRestoreFixture,captureCurrentFixture,restoreCurrentFixture,withCurrentRecoveryWorkspace,mutateAuthenticatedCapture,targetArtifactBucket} from './current-restore-fixture';
import {token,proof} from '../helpers/results';
/** Synthetic historical rows, not product action admission or #65 journey acceptance. */
async function source(name:string){
 const f=await currentRestoreFixture(name);
 await runInDurableObject(f.source,(_instance,{storage})=>withTransaction(storage,tx=>{
  const task=tx.one<any>("SELECT * FROM tasks WHERE id='task_b'")!,run=tx.one<any>("SELECT * FROM runs WHERE id='run_b'")!,artifact=tx.one<any>("SELECT * FROM artifacts WHERE id='artifact_a'")!,meta=tx.one<any>('SELECT * FROM workspace_metadata')!;
  const at=run.started_at+1,expiry=at+1000,checkpoint={summary:'Synthetic retained checkpoint',artifact_ids:['artifact_a']},proposal={action:'SyntheticRecoveryOnly',summary:'Inert history',artifact_ids:['artifact_a'],inputs:{artifact_id:artifact.id,sha256:artifact.sha256},scope:{project_id:task.project_id,resource_ids:['task_b']}};
  const input={artifactId:artifact.id,generationId:artifact.committed_generation_id,artifactVersion:artifact.artifact_version,sha256:artifact.sha256,byteLength:artifact.byte_size,associations:tx.all<any>('SELECT resource_kind AS kind,resource_id AS id FROM artifact_associations WHERE artifact_id=? ORDER BY resource_kind,resource_id',[artifact.id])};
  const reviewer='human_reviewer',policy={policy_version:1,expiry_seconds:1,expiry_batch_limit:1,actions:[]};
  const binding={phase:'resolved',requestedBy:{kind:'agent',principalId:run.agent_id,credentialId:run.credential_id},workspaceId:task.workspace_id,taskId:task.id,taskVersion:task.task_version,taskProposalVersion:task.proposal_version,projectId:task.project_id,proposalCanonicalJson:canonicalJson(proposal),checkpointCanonicalJson:canonicalJson(checkpoint),actionId:proposal.action,schemaVersion:1,schemaSha256:'a'.repeat(64),semanticRevision:'synthetic-v1',resourceKinds:['task'],configEpoch:1,configDigest:meta.config_digest,installationDigest:meta.installation_digest,admissionGeneration:0,policyVersion:1,policyCanonicalJson:canonicalJson(policy),resolvedAt:at,expiresAt:expiry,reviewerIds:[reviewer],reviewers:[{principalId:reviewer,configEpoch:1,scopes:['tasks:read'],projectIds:null}],artifacts:[input],artifactEdges:['checkpoint','proposal','input'].map(role=>({role,artifact:input})),targetBindings:[{kind:'task',id:task.id,version:task.task_version,projectId:task.project_id}]};
  const anchor=Object.fromEntries(['id','workspace_id','title','description','project_id','work_role_id','assigned_agent_id','retry_limit','created_at'].map(k=>[k,task[k]]));
  tx.exec('INSERT INTO decision_checkpoints VALUES(?,?,?,?,?,?)',['checkpoint_test',task.workspace_id,task.id,run.id,canonicalJson(checkpoint),at]);
  tx.exec('INSERT INTO decision_proposals VALUES(?,?,?,?,?,?,?,?)',['proposal_test',task.workspace_id,task.id,task.proposal_version+1,canonicalJson(proposal),canonicalJson(binding),canonicalJson(anchor),at]);
  tx.exec("INSERT INTO approvals(id,workspace_id,task_id,run_id,checkpoint_id,proposal_id,approval_version,proposal_version,task_version_at_request,status,reviewer_ids_json,requested_by_json,created_at,expires_at) VALUES(?,?,?,?,?,?,1,?,?,'pending',?,?,?,?)",['approval_test',task.workspace_id,task.id,run.id,'checkpoint_test','proposal_test',task.proposal_version+1,task.task_version,canonicalJson([reviewer]),canonicalJson({kind:'agent',principal_id:run.agent_id,agent_id:run.agent_id}),at,expiry]);
  for(const role of ['checkpoint','proposal','input'])tx.exec('INSERT INTO decision_artifact_edges VALUES(?,?,?,?,?,?,?,?)',[task.workspace_id,'approval_test',role,artifact.id,input.generationId,input.artifactVersion,input.sha256,input.byteLength]);
  tx.exec("UPDATE runs SET status='paused',run_version=run_version+1,ended_at=? WHERE id=?",[at,run.id]);
  tx.exec("UPDATE tasks SET state='waiting',task_version=task_version+1,proposal_version=proposal_version+1,approval_id='approval_test',active_run_id=NULL,updated_at=? WHERE id=?",[at,task.id]);
  tx.exec("INSERT INTO decision_lifecycle_transitions VALUES('transition_test',?,?,?,1,'request',?,?,'doing','waiting',?,?)",[task.workspace_id,'approval_test',task.id,task.task_version,task.task_version+1,run.id,at]);
  tx.exec("INSERT INTO decision_lifecycle_heads VALUES(?,?,?,?, 'waiting',1,'transition_test')",[task.workspace_id,'approval_test',task.id,task.task_version+1]);
  const actor=canonicalJson({kind:'agent',principal_id:run.agent_id,agent_id:run.agent_id});
  tx.exec("INSERT INTO events(id,workspace_id,type,actor_json,resource_type,resource_id,resource_version,thread_id,request_id,occurred_at,summary,task_version,run_id,fence) VALUES('event_decision',?,'task.decision_requested',?,'task',?,NULL,NULL,'request_decision',?,'Task paused for a human decision.',?,?,?)",[task.workspace_id,actor,task.id,at,task.task_version+1,run.id,run.fence]);
  tx.exec("INSERT INTO task_history(id,workspace_id,event_id,task_id,task_version,run_id,kind,created_at,reason) VALUES('event_decision',?,'event_decision',?,?,?,'task.decision_requested',?,NULL)",[task.workspace_id,task.id,task.task_version+1,run.id,at]);
  tx.exec("INSERT INTO decision_notice_intents VALUES(?,? ,?,'event_decision',?)",[task.workspace_id,'approval_test',reviewer,at]);
 }));return f;
}
async function decisionRows(f:Awaited<ReturnType<typeof source>>,lane:'source'|'target'){
 return withCurrentRecoveryWorkspace(f,lane,w=>Object.fromEntries(TABLE_REGISTRY.filter(t=>t.name.startsWith('decision_')||t.name==='approvals').map(t=>[t.name,w.storage.sql.exec('SELECT * FROM '+t.name+' ORDER BY '+t.primaryKey.join(',')).toArray()])));
}
it('retains exact decision history, expired deadline and artifact bytes while paused execution stays ended and old proof denied',async()=>{
 const f=await source('r3_recovery_history');
 await withCurrentRecoveryWorkspace(f,'source',w=>w.storage.sql.exec("UPDATE approvals SET expiry_hold_code='DECISION_STATE_INVALID'"));
 const before=await decisionRows(f,'source'),capture=await captureCurrentFixture(f,{evict:true});
 const result=await restoreCurrentFixture(f,capture,{evict:true});expect(result.state).toBe('complete');expect(await decisionRows(f,'target')).toEqual(before);
 await withCurrentRecoveryWorkspace(f,'target',w=>{
  expect(w.storage.sql.exec("SELECT status,ended_at FROM runs WHERE id='run_b'").one()).toMatchObject({status:'paused'});
  expect(w.storage.sql.exec("SELECT state,active_run_id FROM tasks WHERE id='task_b'").one()).toEqual({state:'waiting',active_run_id:null});
  expect(w.storage.sql.exec("SELECT expires_at FROM approvals WHERE id='approval_test'").one().expires_at).toBeLessThan(Date.now());
 });
 const entry=capture.manifest.artifacts[0],object=await targetArtifactBucket().get(entry.object_key);expect(new Uint8Array(await object!.arrayBuffer())).toEqual(new TextEncoder().encode('hello'));
 const response=await f.target.fetch(new Request('https://hub.example.invalid/v2/workspaces/ws_example/tasks/task_b',{headers:{authorization:'Bearer '+token,'x-runtime-token':proof}}));expect(response.status).toBe(401);
},90000);
it('rejects authenticated role hash mismatch before authority transforms instead of laundering it through restore',async()=>{
 const f=await source('r3_recovery_bad_role'),capture=await captureCurrentFixture(f);
 const corrupt=await mutateAuthenticatedCapture(capture,(table,row)=>{if(table==='decision_artifact_edges'&&row.role==='input')row.sha256='f'.repeat(64);});
 await expect(restoreCurrentFixture(f,corrupt,{evict:true})).rejects.toThrow('RECOVERY_DECISION_GRAPH_MISMATCH');
 await withCurrentRecoveryWorkspace(f,'target',w=>{expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('restoring');expect(w.storage.sql.exec("SELECT revoked_at FROM sessions WHERE id='session_settings'").one().revoked_at).toBeNull();});
},90000);
it('closed source graph rejects wrong head identity, gaps, orphan roles, pointer and artifact drift without current reviewer reauthorization',async()=>{
 const f=await source('r3_graph_negative');
 await runInDurableObject(f.source,(_instance,{storage})=>{
  storage.sql.exec("UPDATE approvals SET expiry_hold_code='DECISION_STATE_INVALID'");
  const check=()=>withTransaction(storage,tx=>{for(const table of TABLE_REGISTRY)for(const row of tx.all<any>('SELECT * FROM '+table.name))verifyDecisionSourceRow(tx,table.name,row);});
  expect(check).not.toThrow();
  withTransaction(storage,tx=>expect(()=>verifyDecisionSourceRow(tx,'approvals',{...tx.one<any>('SELECT * FROM approvals')!,expiry_hold_code:'UNREVIEWED'})).toThrow('RECOVERY_DECISION_GRAPH_MISMATCH'));
  for(const sql of ["UPDATE decision_lifecycle_heads SET last_transition_id='missing'","UPDATE decision_lifecycle_transitions SET sequence=2","UPDATE approvals SET proposal_version=2","UPDATE decision_artifact_edges SET byte_size=4 WHERE role='input'","UPDATE tasks SET approval_id='missing' WHERE id='task_b'","UPDATE decision_proposals SET binding_json='{}'","UPDATE decision_notice_intents SET reviewer_principal_id='unassigned'","DELETE FROM decision_notice_intents","UPDATE approvals SET expires_at=expires_at+1","UPDATE events SET task_version=task_version+1 WHERE id='event_decision'"]){
   expect(()=>storage.transactionSync(()=>{storage.sql.exec(sql);check();throw Error('expected rejection');})).toThrow('RECOVERY_DECISION_GRAPH_MISMATCH');
   expect(check).not.toThrow();
  }
 });
});

it('retains consumed lineage through restore, recapture and second restore only with genuine recovery uncertainty provenance',async()=>{
 let f=await source('r3_recovery_roundtrip');
 await runInDurableObject(f.source,(_instance,{storage})=>withTransaction(storage,tx=>{
  const task=tx.one<any>("SELECT * FROM tasks WHERE id='task_b'")!,original=tx.one<any>("SELECT * FROM runs WHERE id='run_b'")!;
  const now=original.ended_at+1,run={...original,id:'run_consumed',fence:2,status:'active',run_version:1,started_at:now,ended_at:null};
  const keys=Object.keys(run);tx.exec('INSERT INTO runs ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',keys.map(k=>run[k]));
  tx.exec("UPDATE approvals SET status='approved',approval_version=2,decided_at=?,decided_by_json=?,consumed_run_id='run_consumed',consumed_fence=2 WHERE id='approval_test'",[now,canonicalJson({kind:'human',principal_id:'human_reviewer',agent_id:null})]);
  for(const [sequence,kind,before,after] of [[2,'approve','waiting','ready'],[3,'claim','ready','doing']] as const)tx.exec('INSERT INTO decision_lifecycle_transitions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',['transition_'+sequence,task.workspace_id,'approval_test',task.id,sequence,kind,task.task_version+sequence-2,task.task_version+sequence-1,before,after,sequence===3?'run_consumed':null,now]);
  tx.exec("UPDATE tasks SET state='doing',task_version=task_version+2,active_run_id='run_consumed',latest_run_id='run_consumed',next_fence=3 WHERE id='task_b'");
  tx.exec("UPDATE decision_lifecycle_heads SET task_state='doing',task_version=task_version+2,transition_count=3,last_transition_id='transition_3'");
 }));
 const original=await decisionRows(f,'source');
 for(let round=1;round<=2;round++){
  const capture=await captureCurrentFixture(f,{evict:true}),restored=round===2?await restoreWithAuditChecks(f,capture):await restoreCurrentFixture(f,capture,{evict:true});
  expect(await decisionRows(f,'target')).toEqual(original);
  await withCurrentRecoveryWorkspace(f,'target',w=>{
   expect(w.storage.sql.exec("SELECT status FROM runs WHERE id='run_b'").one().status).toBe('paused');
   expect(w.storage.sql.exec("SELECT status FROM runs WHERE id='run_consumed'").one().status).toBe('expired');
   expect(w.storage.sql.exec("SELECT state,active_run_id FROM tasks WHERE id='task_b'").one()).toEqual({state:'backlog',active_run_id:null});
   withTransaction(w.storage,tx=>verifyDecisionSourceRow(tx,'decision_lifecycle_heads',tx.one<any>('SELECT * FROM decision_lifecycle_heads')!));
  });
  if(round===1)f=await resumeThenNext(f,capture,restored.receipt,round);
 }
 // Arbitrary unknown/expired drift is NOT recovery provenance.
 await withCurrentRecoveryWorkspace(f,'target',w=>{
  w.storage.sql.exec("DELETE FROM idempotency_outcomes WHERE operation='operator.recovery.imported-audit'");
  expect(()=>withTransaction(w.storage,tx=>verifyDecisionSourceRow(tx,'decision_lifecycle_heads',tx.one<any>('SELECT * FROM decision_lifecycle_heads')!))).toThrow('RECOVERY_DECISION_GRAPH_MISMATCH');
 });
},180000);

it('retains synthetic cancellation history after one authenticated restore gap without inventing a lifecycle transition',async()=>{
 let f=await source('r3_recovery_cancel_gap');
 await runInDurableObject(f.source,(_instance,{storage})=>withTransaction(storage,tx=>{
  const task=tx.one<any>("SELECT * FROM tasks WHERE id='task_b'")!,original=tx.one<any>("SELECT * FROM runs WHERE id='run_b'")!;
  const now=original.ended_at+1,run={...original,id:'run_consumed',fence:2,status:'active',run_version:1,started_at:now,ended_at:null};
  const keys=Object.keys(run);tx.exec('INSERT INTO runs ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',keys.map(k=>run[k]));
  tx.exec("UPDATE approvals SET status='approved',approval_version=2,decided_at=?,decided_by_json=?,consumed_run_id='run_consumed',consumed_fence=2 WHERE id='approval_test'",[now,canonicalJson({kind:'human',principal_id:'human_reviewer',agent_id:null})]);
  for(const [sequence,kind,before,after] of [[2,'approve','waiting','ready'],[3,'claim','ready','doing']] as const)tx.exec('INSERT INTO decision_lifecycle_transitions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',['transition_'+sequence,task.workspace_id,'approval_test',task.id,sequence,kind,task.task_version+sequence-2,task.task_version+sequence-1,before,after,sequence===3?'run_consumed':null,now]);
  tx.exec("UPDATE tasks SET state='doing',task_version=task_version+2,active_run_id='run_consumed',latest_run_id='run_consumed',next_fence=3 WHERE id='task_b'");
  tx.exec("UPDATE decision_lifecycle_heads SET task_state='doing',task_version=task_version+2,transition_count=3,last_transition_id='transition_3'");
 }));
 const capture=await captureCurrentFixture(f),restored=await restoreCurrentFixture(f,capture);
 f=await resumeThenNext(f,capture,restored.receipt,1);
 await withCurrentRecoveryWorkspace(f,'source',w=>withTransaction(w.storage,tx=>{
  const task=tx.one<any>("SELECT * FROM tasks WHERE id='task_b'")!;
  const head=tx.one<any>('SELECT * FROM decision_lifecycle_heads')!,approval=tx.one<any>('SELECT * FROM approvals')!,now=Date.now();
  expect(isCompletedRestoreDecisionHead(tx,task,head,approval,now)).toBe(true);
  for(const patch of [{workspace_id:'foreign'},{task_version:task.task_version+1},{latest_run_id:'run_b'},{active_run_id:'run_b'},{flags_json:'[]'}])expect(isCompletedRestoreDecisionHead(tx,{...task,...patch},head,approval,now)).toBe(false);
  for(const patch of [{workspace_id:'foreign'},{consumed_fence:3},{consumed_run_id:'run_b'},{id:'foreign'}])expect(isCompletedRestoreDecisionHead(tx,task,head,{...approval,...patch},now)).toBe(false);
  expect(isCompletedRestoreDecisionHead(tx,task,head,approval,0)).toBe(false);
  const audit=tx.one<any>("SELECT * FROM idempotency_outcomes WHERE operation='operator.recovery.audit'");
  if(!audit)throw Error('expected actual native restore audit');
  tx.exec("UPDATE idempotency_outcomes SET fingerprint=? WHERE operation='operator.recovery.audit'",['f'.repeat(64)]);expect(isCompletedRestoreDecisionHead(tx,task,head,approval,now)).toBe(false);tx.exec("UPDATE idempotency_outcomes SET fingerprint=? WHERE operation='operator.recovery.audit'",[audit.fingerprint]);
  tx.exec("INSERT INTO decision_lifecycle_transitions VALUES('transition_cancel',?,'approval_test',?,4,'cancel',?,?,'backlog','cancelled',NULL,?)",[task.workspace_id,task.id,task.task_version,task.task_version+1,now]);
  tx.exec("UPDATE tasks SET state='cancelled',task_version=task_version+1 WHERE id='task_b'");
  tx.exec("UPDATE approvals SET status='invalidated' WHERE id='approval_test'");
  tx.exec("UPDATE decision_lifecycle_heads SET task_state='cancelled',task_version=?,transition_count=4,last_transition_id='transition_cancel'",[task.task_version+1]);
  for(const table of ['decision_lifecycle_heads','decision_lifecycle_transitions'])for(const row of tx.all<any>('SELECT * FROM '+table))verifyDecisionSourceRow(tx,table,row);
  const current=tx.one<any>("SELECT * FROM tasks WHERE id='task_b'")!,updated=tx.one<any>('SELECT * FROM approvals')!,previous=tx.one<any>("SELECT * FROM decision_lifecycle_transitions WHERE id='transition_3'")!,cancel=tx.one<any>("SELECT * FROM decision_lifecycle_transitions WHERE id='transition_cancel'")!;
  expect(isCompletedRestoreDecisionHead(tx,current,head,updated,now)).toBe(false);
  expect(isRestoreDecisionCancellationGap(tx,updated,previous,cancel)).toBe(true);
  for(const patch of [{before_version:cancel.before_version+1,after_version:cancel.after_version+1},{workspace_id:'foreign'},{run_id:'run_consumed'},{kind:'expiry'},{created_at:0}])expect(isRestoreDecisionCancellationGap(tx,updated,previous,{...cancel,...patch})).toBe(false);

 }));
 const expected=await decisionRows(f,'source'),next=await captureCurrentFixture(f);
 expect((await restoreCurrentFixture(f,next)).state).toBe('complete');expect(await decisionRows(f,'target')).toEqual(expected);
},180000);

it('runs the existing cancel command with fresh synthetic human authority after real restore and preserves its history on recapture',async()=>{
 let f=await source('r3_recovery_command_cancel');
 await runInDurableObject(f.source,(_instance,{storage})=>withTransaction(storage,tx=>{
  const task=tx.one<any>("SELECT * FROM tasks WHERE id='task_b'")!,original=tx.one<any>("SELECT * FROM runs WHERE id='run_b'")!;
  const now=original.ended_at+1,run={...original,id:'run_consumed',fence:2,status:'active',run_version:1,started_at:now,ended_at:null};
  const keys=Object.keys(run);tx.exec('INSERT INTO runs ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',keys.map(k=>run[k]));
  tx.exec("UPDATE approvals SET status='approved',approval_version=2,decided_at=?,decided_by_json=?,consumed_run_id='run_consumed',consumed_fence=2 WHERE id='approval_test'",[now,canonicalJson({kind:'human',principal_id:'human_reviewer',agent_id:null})]);
  for(const [sequence,kind,before,after] of [[2,'approve','waiting','ready'],[3,'claim','ready','doing']] as const)tx.exec('INSERT INTO decision_lifecycle_transitions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',['transition_'+sequence,task.workspace_id,'approval_test',task.id,sequence,kind,task.task_version+sequence-2,task.task_version+sequence-1,before,after,sequence===3?'run_consumed':null,now]);
  tx.exec("UPDATE tasks SET state='doing',task_version=task_version+2,active_run_id='run_consumed',latest_run_id='run_consumed',next_fence=3 WHERE id='task_b'");
  tx.exec("UPDATE decision_lifecycle_heads SET task_state='doing',task_version=task_version+2,transition_count=3,last_transition_id='transition_3'");
 }));
 const capture=await captureCurrentFixture(f),restored=await restoreCurrentFixture(f,capture);
 f=await resumeThenNext(f,capture,restored.receipt,1);
 await withCurrentRecoveryWorkspace(f,'source',async w=>{
  const task=w.storage.sql.exec<any>("SELECT * FROM tasks WHERE id='task_b'").one(),now=Date.now();
  // A new synthetic authenticated session at the restored epoch, never revival of an old proof.
  w.storage.sql.exec("INSERT INTO sessions(id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,revoked_at,auth_epoch) SELECT 'session_after_restore',g.workspace_id,g.principal_id,'digest_after_restore','csrf_after_restore',g.issuer,g.subject,?,?,NULL,m.config_epoch FROM human_grants g JOIN workspace_metadata m ON m.workspace_id=g.workspace_id WHERE g.principal_id='human_operator'",now,now+100000);
  const session=w.storage.sql.exec<any>("SELECT * FROM sessions WHERE id='session_after_restore'").one();
  const identity={kind:'human' as const,workspaceId:session.workspace_id,issuer:session.issuer,subject:session.subject,sessionId:session.id};
  const body={expected_version:task.task_version,reason:'Synthetic safety cancellation after actual restore'},ctx=await commandContext(w.storage,f.sourceName,body,'cancel_restored');
  ctx.fingerprint=await fingerprintRequest('POST','/v2/workspaces/ws_example/tasks/task_b/cancel',{},body);
  const snapshot=()=>Object.fromEntries(['tasks','approvals','decision_lifecycle_heads','decision_lifecycle_transitions','events','task_history','idempotency_outcomes'].map(t=>[t,w.storage.sql.exec('SELECT * FROM '+t).toArray()])),before=snapshot();
  expect(()=>executeCommand(ctx,{...identity,sessionId:'session_settings'},cancelTaskCommand('task_b'),body)).toThrow();expect(snapshot()).toEqual(before);
  w.storage.sql.exec("UPDATE human_grants SET enabled=0 WHERE principal_id='human_operator'");
  expect(()=>executeCommand(ctx,identity,cancelTaskCommand('task_b'),body)).toThrow();expect(snapshot()).toEqual(before);
  w.storage.sql.exec("UPDATE human_grants SET enabled=1 WHERE principal_id='human_operator'");
  const audit=w.storage.sql.exec<any>("SELECT * FROM idempotency_outcomes WHERE operation='operator.recovery.audit'").one();
  w.storage.sql.exec("UPDATE idempotency_outcomes SET fingerprint=? WHERE operation='operator.recovery.audit'",'f'.repeat(64));
  const wrongProof=snapshot();expect(()=>executeCommand(ctx,identity,cancelTaskCommand('task_b'),body)).toThrow();expect(snapshot()).toEqual(wrongProof);
  w.storage.sql.exec("UPDATE idempotency_outcomes SET fingerprint=? WHERE operation='operator.recovery.audit'",audit.fingerprint);
  const result=executeCommand(ctx,identity,cancelTaskCommand('task_b'),body);expect(result.status).toBe(200);
  expect(w.storage.sql.exec("SELECT state,approval_id FROM tasks WHERE id='task_b'").one()).toEqual({state:'cancelled',approval_id:null});
  expect(w.storage.sql.exec('SELECT status,consumed_run_id,consumed_fence FROM approvals').one()).toEqual({status:'invalidated',consumed_run_id:'run_consumed',consumed_fence:2});
  expect(w.storage.sql.exec("SELECT before_version,after_version,before_state,after_state,run_id FROM decision_lifecycle_transitions WHERE kind='cancel'").one()).toEqual({before_version:task.task_version,after_version:task.task_version+1,before_state:'backlog',after_state:'cancelled',run_id:null});
 });
 const expected=await decisionRows(f,'source'),next=await captureCurrentFixture(f);
 expect((await restoreCurrentFixture(f,next)).state).toBe('complete');expect(await decisionRows(f,'target')).toEqual(expected);
},180000);
