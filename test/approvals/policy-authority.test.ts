import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture,decisionActor,proposal,syntheticPolicy,testLookup,claimSetup} from '../helpers/decision-policy';
import {artifactContext,stage,bytes} from '../helpers/artifacts';
import {uploadArtifactContent,commitArtifact} from '../../src/artifacts/content';
import {executeCommand} from '../../src/workspace/commands';
import {claimTaskCommand} from '../../src/tasks/claim';
import {claimContext,PROOF_A} from '../helpers/claims';
import {sha256,canonicalJson} from '../../src/config/bootstrap';
import {withTransaction,type WorkspaceTransaction,type SqlValue} from '../../src/storage/transaction';
const task={taskId:'task_a',taskVersion:2};
async function inputArtifact(storage:DurableObjectStorage,name:string,now:number){
 const content='{"task_id":"task_a","task_version":2}',hash=await sha256(content),ctx=artifactContext(storage,name,'policy_input',now);
 await stage(ctx,'input_a',{task_id:'task_a',media_type:'application/json',byte_size:new TextEncoder().encode(content).length,sha256:hash});
 await uploadArtifactContent({...ctx,idempotencyKey:'upload_policy_input'},'input_a',bytes(content),'upload_policy_input');
 await commitArtifact({...ctx,idempotencyKey:'commit_policy_input'},'input_a',{expected_artifact_version:2});return proposal(hash);
}
const snapshot=(storage:DurableObjectStorage)=>Object.fromEntries(['tasks','runs','runtimes','native_credentials','static_agents','artifacts','artifact_generations','events','outbox','task_history','idempotency_outcomes','human_grants','sessions','maintenance_state','workspace_metadata'].map(t=>[t,storage.sql.exec('SELECT * FROM '+t+' ORDER BY rowid').toArray()]));
const readOnly=(tx:WorkspaceTransaction):WorkspaceTransaction=>{
 const query=(sql:string)=>{if(!/^\s*SELECT\b/i.test(sql))throw Error('POLICY_WRITE_TRIPWIRE');};
 return {one:<T>(sql:string,bindings?:readonly SqlValue[])=>{query(sql);return tx.one<T>(sql,bindings);},all:<T>(sql:string,bindings?:readonly SqlValue[])=>{query(sql);return tx.all<T>(sql,bindings);},exec:()=>{throw Error('POLICY_WRITE_TRIPWIRE');}};
};
it('reads real installed policy and all assigned humans without inventing reviewer sessions or writes',async()=>{
 const f=await decisionFixture('decision_requirements');await runInDurableObject(f.stub,async(_o,s)=>{
  const setup=claimSetup(s.storage),{now}=setup;
  executeCommand(await claimContext(s.storage,f.name,setup.body,'existing_lease',now,'task_b'),setup.identity,claimTaskCommand('task_b','existing_run',PROOF_A),setup.body);
  const p=await inputArtifact(s.storage,f.name,now),actor=decisionActor(s.storage,now),lookup=await testLookup(),before=snapshot(s.storage);
  expect(before.runs).toHaveLength(1);
  const result=withTransaction(s.storage,tx=>lookup(readOnly(tx),actor,task,p,now));
  expect(result).toMatchObject({phase:'requirements-only',workspaceId:'ws_example',taskId:'task_a',taskVersion:2,configEpoch:1,admissionGeneration:0,policyVersion:3,semanticRevision:'synthetic-task-review@2',expiresAt:now+120000,reviewerIds:['human_operator','human_reviewer'],configDigest:f.input.bundle.config_digest,installationDigest:f.input.installationDigest});
  expect(result.reviewers.every(reviewer=>reviewer.scopes.includes('approvals:read')&&reviewer.scopes.includes('approvals:decide'))).toBe(true);
  expect(result.artifacts[0]).toMatchObject({artifactId:'input_a',artifactVersion:3,sha256:p.inputs.sha256});expect(typeof result.artifacts[0].generationId).toBe('string');
  expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.reviewerIds)).toBe(true);expect(Object.isFrozen(result.artifacts[0])).toBe(true);
  expect(s.storage.sql.exec("SELECT id FROM sessions WHERE principal_id='human_reviewer'").toArray()).toEqual([]);expect(snapshot(s.storage)).toEqual(before);
 });
});
it('all assigned reviewers deny as a whole on any current downgrade or identity mismatch',async()=>{
 const f=await decisionFixture('decision_reviewers');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),p=await inputArtifact(s.storage,f.name,now),actor=decisionActor(s.storage,now),lookup=await testLookup(),row=s.storage.sql.exec<Record<string,string|number|null>>("SELECT * FROM human_grants WHERE principal_id='human_reviewer'").one();
  for(const patch of [{enabled:0},{config_epoch:2},{issuer:'https://other.example.invalid'},{subject:'other'},{scopes_json:JSON.stringify(['tasks:read','artifacts:read','approvals:read'])},{scopes_json:JSON.stringify(['approvals:read','approvals:decide','tasks:read'])},{project_ids_json:'[]'},{scopes_json:'{}'}]){
   for(const [key,value] of Object.entries(patch))s.storage.sql.exec('UPDATE human_grants SET '+key+'=? WHERE principal_id=?',value,'human_reviewer');
   const before=snapshot(s.storage);expect(()=>withTransaction(s.storage,tx=>lookup(readOnly(tx),actor,task,p,now))).toThrow('DECISION_UNAVAILABLE');expect(snapshot(s.storage)).toEqual(before);
   for(const key of Object.keys(patch))s.storage.sql.exec('UPDATE human_grants SET '+key+'=? WHERE principal_id=?',row[key],'human_reviewer');
  }
  expect(withTransaction(s.storage,tx=>lookup(tx,actor,task,p,now)).reviewerIds).toHaveLength(2);
 });
});
it('current row cannot broaden installed reviewer scope or project ceiling',async()=>{
 for(const change of ['scope','project','enabled']){
  const f=await decisionFixture('decision_installed_'+change);await runInDurableObject(f.stub,async(_o,s)=>{
   const {now}=claimSetup(s.storage),p=await inputArtifact(s.storage,f.name,now),actor=decisionActor(s.storage,now),lookup=await testLookup(),config=structuredClone(f.input.config),reviewer=config.human_grants[1];
   if(change==='scope')reviewer.scopes=reviewer.scopes.filter(x=>x!=='approvals:decide');if(change==='project')reviewer.project_ids=[];if(change==='enabled')reviewer.enabled=false;
   // Deliberate installed/current divergence fixture; the real normal parser still validates the installed document.
   s.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',canonicalJson(config));const before=snapshot(s.storage);
   expect(()=>withTransaction(s.storage,tx=>lookup(readOnly(tx),actor,task,p,now))).toThrow('DECISION_UNAVAILABLE');expect(snapshot(s.storage)).toEqual(before);
  });
 }
});
it('production registry rejects every structurally installed selection and absent policy',async()=>{
 for(const mode of ['configured','absent','example']){
  const policy=mode==='absent'?null:structuredClone(syntheticPolicy);if(mode==='example'&&policy)policy.actions[0].action_id='ExampleApprovalInputs';
  const f=await decisionFixture('decision_production_'+mode,policy);await runInDurableObject(f.stub,async(_o,s)=>{
   const {now}=claimSetup(s.storage),p=await inputArtifact(s.storage,f.name,now),actor=decisionActor(s.storage,now),{lookupPolicyRequirements}=await import('../../src/approvals/policy');
   const before=snapshot(s.storage);expect(()=>withTransaction(s.storage,tx=>lookupPolicyRequirements(readOnly(tx),actor,task,p,now))).toThrow('DECISION_UNAVAILABLE');expect(snapshot(s.storage)).toEqual(before);
  });
 }
});
it('source descriptor must exactly match installed action version hash and resource kinds',async()=>{
 const f=await decisionFixture('decision_descriptor');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),p=await inputArtifact(s.storage,f.name,now),actor=decisionActor(s.storage,now),lookup=await testLookup();
  for(const patch of [{action_id:'ExampleApprovalInputs'},{schema_version:2},{schema_sha256:'f'.repeat(64)},{resource_kinds:['message']},{reviewer_ids:['not_installed']},{reviewer_ids:['agent_research']}]){
   const config=structuredClone(f.input.config);Object.assign(config.workspace_policies[0].decision_policy!.actions[0],patch);s.storage.sql.exec('UPDATE workspace_metadata SET config_json=?',canonicalJson(config));expect(()=>withTransaction(s.storage,tx=>lookup(readOnly(tx),actor,task,p,now))).toThrow('DECISION_UNAVAILABLE');
  }
 });
});
it('refreshes actor task graph and admission fences and never extends a run lease',async()=>{
 const f=await decisionFixture('decision_current_fences');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),p=await inputArtifact(s.storage,f.name,now),actor=decisionActor(s.storage,now),lookup=await testLookup();
  const tests=[
   ["UPDATE native_credentials SET enabled=0 WHERE credential_id='credential_research_1'","UPDATE native_credentials SET enabled=1 WHERE credential_id='credential_research_1'"],
   ["UPDATE tasks SET task_version=3 WHERE id='task_a'","UPDATE tasks SET task_version=2 WHERE id='task_a'"],
   ["UPDATE tasks SET project_id='project_a' WHERE id='task_a'","UPDATE tasks SET project_id=NULL WHERE id='task_a'"],
   ["INSERT INTO artifact_associations VALUES('ws_example','input_a','checkpoint','not_implemented')","DELETE FROM artifact_associations WHERE resource_kind='checkpoint'"],
   ["UPDATE maintenance_state SET state='capturing' WHERE id=1","UPDATE maintenance_state SET state='open' WHERE id=1"],
   ["UPDATE workspace_metadata SET config_epoch=2 WHERE id=1","UPDATE workspace_metadata SET config_epoch=1 WHERE id=1"],
  ];
  for(const [mutate,restore] of tests){s.storage.sql.exec(mutate);const before=snapshot(s.storage);expect(()=>withTransaction(s.storage,tx=>lookup(readOnly(tx),actor,task,p,now))).toThrow('DECISION_UNAVAILABLE');expect(snapshot(s.storage)).toEqual(before);s.storage.sql.exec(restore);}
  const requirements=withTransaction(s.storage,tx=>lookup(tx,actor,task,p,now));
  // Exact same config/policy version after a maintenance generation advance is still stale.
  s.storage.sql.exec('UPDATE maintenance_state SET generation=generation+1');expect(()=>withTransaction(s.storage,tx=>lookup.assertCurrent(tx,actor,task,p,now,requirements))).toThrow('DECISION_UNAVAILABLE');
 });
});

it('recognized human approval scopes never become managed native credential scopes or routes',async()=>{
 const f=await decisionFixture('decision_human_scope_only');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),{human}=await import('../helpers/settings'),{resolveActor}=await import('../../src/auth/authorize'),{issueCredential}=await import('../../src/auth/native-credentials'),identity=human(s.storage),before=snapshot(s.storage);
  for(const scope of ['approvals:read','approvals:decide'] as const)expect(()=>withTransaction(s.storage,tx=>{
   const ctx={actor:resolveActor(tx,identity,now),nowMs:now,requestId:'native_denial',idempotencyKey:'native_denial'};
   issueCredential(tx,ctx,{agent_id:'agent_research',label:'Synthetic denied',scopes:[scope],project_ids:null,expires_at:new Date(now+60000).toISOString()},{credentialId:'denied_credential',tokenSha256:'d'.repeat(64)});
  })).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(snapshot(s.storage)).toEqual(before);
 });
 const base='https://hub.example.invalid/v2/workspaces/ws_example/';
 for(const [path,method] of [['tasks/task_a:request-decision','POST'],['approvals/approval_a','GET'],['approvals/approval_a:approve','POST'],['approvals/approval_a:reject','POST']]){
  const response=await f.stub.fetch(new Request(base+path,{method,headers:{'content-type':'application/json'},...(method==='POST'?{body:'{}'}:{})}));expect(response.status).toBe(404);
 }
});
it('rechecks exact policy digests semantic revision and native metadata without renewing deadline',async()=>{
 const f=await decisionFixture('decision_recheck');await runInDurableObject(f.stub,async(_o,s)=>{
  const {now}=claimSetup(s.storage),p=await inputArtifact(s.storage,f.name,now),actor=decisionActor(s.storage,now),lookup=await testLookup(),requirements=withTransaction(s.storage,tx=>lookup(tx,actor,task,p,now));
  expect(()=>withTransaction(s.storage,tx=>lookup.assertCurrent(readOnly(tx),actor,task,p,now+1,requirements))).not.toThrow();
  expect(requirements.expiresAt).toBe(now+120000);
  expect(()=>withTransaction(s.storage,tx=>lookup.assertCurrent(tx,actor,task,p,now+1,{...requirements,expiresAt:requirements.expiresAt+1}))).toThrow('DECISION_UNAVAILABLE');
  expect(()=>withTransaction(s.storage,tx=>lookup.assertCurrent(tx,actor,task,p,requirements.expiresAt,requirements))).toThrow('DECISION_UNAVAILABLE');
  const metadata=s.storage.sql.exec<{config_digest:string;installation_digest:string}>('SELECT config_digest,installation_digest FROM workspace_metadata').one();
  for(const column of ['config_digest','installation_digest'] as const){s.storage.sql.exec('UPDATE workspace_metadata SET '+column+'=?','f'.repeat(64));expect(()=>withTransaction(s.storage,tx=>lookup.assertCurrent(tx,actor,task,p,now+1,requirements))).toThrow('DECISION_UNAVAILABLE');s.storage.sql.exec('UPDATE workspace_metadata SET '+column+'=?',metadata[column]);}
  const {descriptor}=await import('../helpers/decision-policy'),{createPolicyRequirementsLookup}=await import('../../src/approvals/policy-source');
  const changed=createPolicyRequirementsLookup([{...descriptor,semanticRevision:'synthetic-task-review@3'}]);
  expect(()=>withTransaction(s.storage,tx=>changed.assertCurrent(tx,actor,task,p,now+1,requirements))).toThrow('DECISION_UNAVAILABLE');
  const original=s.storage.sql.exec<{committed_generation_id:string}>("SELECT committed_generation_id FROM artifacts WHERE id='input_a'").one().committed_generation_id;
  // Metadata-only replacement fixture: no claim of committed replacement R2 bytes or final provenance.
  const generation=s.storage.sql.exec<Record<string,string|number|null>>('SELECT * FROM artifact_generations WHERE id=?',original).one();
  const replacement={...generation,id:'different_native_generation',object_key:generation.object_key+'/replacement',effect_operation_id:'replacement_operation',upload_idempotency_sha256:null};
  s.storage.sql.exec(`INSERT INTO artifact_generations(${Object.keys(replacement).join(',')}) VALUES(${Object.keys(replacement).map(()=>'?').join(',')})`,...Object.values(replacement));
  s.storage.sql.exec("UPDATE artifacts SET active_generation_id='different_native_generation',committed_generation_id='different_native_generation' WHERE id='input_a'");
  expect(withTransaction(s.storage,tx=>lookup(tx,actor,task,p,now+1)).artifacts[0]).toMatchObject({generationId:'different_native_generation',artifactVersion:requirements.artifacts[0].artifactVersion});
  expect(()=>withTransaction(s.storage,tx=>lookup.assertCurrent(tx,actor,task,p,now+1,requirements))).toThrow('DECISION_UNAVAILABLE');
  s.storage.sql.exec("UPDATE artifacts SET active_generation_id=?,committed_generation_id=? WHERE id='input_a'",original,original);
 });
});

it('test-only descriptor closes input shape but cannot turn it into final provenance',async()=>{
 const {descriptor}=await import('../helpers/decision-policy');
 expect(descriptor.validateInput({task_id:'task_a',task_version:2})).toBe(true);
 for(const value of [null,[],{task_id:'task_a'},{task_id:'task_a',task_version:0},{task_id:'task_a',task_version:2,verified:true}])expect(descriptor.validateInput(value)).toBe(false);
 const publicApi=await import('../../src/approvals/policy');expect(Object.keys(publicApi)).toEqual(['lookupPolicyRequirements']);
 const contracts=await import('../../src/approvals/contracts');expect(Object.hasOwn(contracts,'VerifiedProposalInput')).toBe(false);expect(Object.hasOwn(contracts,'DecisionPolicyResolution')).toBe(false);
});
