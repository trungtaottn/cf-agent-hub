import test from 'node:test';
import assert from 'node:assert/strict';
import {CASE_OPERATIONS} from '../../scripts/lib/r2-case-policy.mjs';
import {getNativeScenario} from '../../scripts/lib/native-r2-scenario.mjs';
import {getCompleteProfile} from '../../scripts/lib/native-complete-profile.mjs';
import {validateCompletePreparation} from '../../scripts/lib/native-complete-preparation.mjs';
const h='a'.repeat(64),steps=getNativeScenario().steps;
const bindingBefore=new Map(),enrolled=new Set();for(const step of steps){bindingBefore.set(step.id,step.fixture!=='server-foreign-workspace'&&enrolled.has(step.actor));if(step.operation==='createRuntime')enrolled.add(step.actor);}
const subject=()=>({principal_id:'agent',agent_id:'agent',credential_id:'credential',runtime_id:null,task_id:null,run_id:null,result_id:null,workspace_id:'workspace',actor_kind:'native',request_sha256:h,key_sha256:null,grant_sha256:h,proof_sha256:null,authority_epoch:1,fixture_record_sha256:h,foreign_runs:null});
function preparation(step){
 const typed=!!step.caseId||['prepare/fail-create','prepare/revoke-own-positive'].includes(step.id);
 const value={kind:'process',step_id:step.id,invocation_id:'inv_actual',actor_slot:step.actor,fixture:step.fixture,invocation_commitment_sha256:h,refs_sha256:h,prior_bindings_sha256:h,store_binding:{actor_slot:step.actor,fixture:step.fixture,store_descriptor_sha256:h,credential_slot_sha256:h,credential_id:'credential',principal_id:'agent',agent_id:'agent',workspace_id:'workspace',runtime_id:null,proof_sha256:null,authority_epoch:1},subject:typed?subject():null,input:step.refKeys.includes('input_file')?{kind:'pinned-json',sha256:h,byte_size:2,semantic_body_sha256:h,publication_record_sha256:h,admission_record_sha256:h}:null,artifact:null,journal:null,expected:{exit_code:step.expectedExit,http_requests:step.expectedRequests,http_status:step.expectedStatus??null}};
 const artifact={sha256:getCompleteProfile().artifact.sha256,byte_size:29};
 if(step.id==='prepare/retain-artifact')value.artifact={kind:'source-retain',source_record_sha256:h,...artifact};
 else if(['stageArtifact','uploadArtifactContent'].includes(step.operation))value.artifact={kind:'retained-content',content_id:'content',retained_record_sha256:h,...artifact};
 else if(step.operation==='commitArtifact')value.artifact={kind:'commit-target',artifact_id:'artifact',expected_artifact_version:1,...artifact};
 else if(step.operation==='downloadArtifactContent')value.artifact={kind:'download-target',artifact_id:'artifact',destination_descriptor_sha256:h,...artifact};
 else if(step.operation==='getArtifact')value.artifact={kind:'metadata-target',artifact_id:'artifact',...artifact};
 if(step.kind==='local'&&step.id!=='prepare/retain-artifact')value.journal={kind:'intent-dispatch',intent_id:'intent',expected_request_sha256:h,expected_principal_sha256:h,key_sha256:h,expected_state:step.id==='case/settled-no-send'?'settled':'reconciliation-required',original_invocation_id:'inv_prior'};
 else if(step.id==='case/lost-response-retained')value.journal={kind:'new-uncertain-intent',key_sha256:h,semantic_request_sha256:h,fault_ack_sha256:h};
 else if(step.id==='probe/wrong-runtime')value.journal={kind:'new-unsent-intent',key_sha256:h,semantic_request_sha256:h};
 if(bindingBefore.get(step.id)){value.store_binding.runtime_id='runtime_current';value.store_binding.proof_sha256=h;if(value.subject){value.subject.runtime_id='runtime_current';value.subject.proof_sha256=CASE_OPERATIONS[step.operation??'createTask'].runtimeProof?h:null;}}
 return value;
}
for(const step of steps.filter(s=>s.kind!=='control'&&!s.id.startsWith('probe/swapped-')))test(`fixed preparation ${step.id} matches source applicability`,()=>{
 const p=preparation(step),v=validateCompletePreparation(p,{kind:'process',id:step.id});assert.deepEqual(v,p);assert.ok(Object.isFrozen(v));
});
for(const id of ['probe/swapped-slot','probe/swapped-generation','probe/swapped-principal'])test(`unavailable ${id} cannot acquire preparation`,()=>{const s=steps.find(s=>s.id===id);assert.throws(()=>validateCompletePreparation(preparation(s),{kind:'process',id}));});
for(const [name,change] of Object.entries({actor:p=>p.actor_slot='reviewer',fixture:p=>p.fixture='foreign',storeActor:p=>p.store_binding.actor_slot='reviewer',identity:p=>p.subject.principal_id='other',input:p=>p.input={},artifact:p=>p.artifact={},journal:p=>p.journal={},extra:p=>p.extra=true,expected:p=>p.expected.exit_code=3,subject:p=>p.subject=null}))test(`preparation rejects ${name}`,()=>{
 const s=steps.find(s=>s.id==='success/getWorkspace'),p=preparation(s);change(p);assert.throws(()=>validateCompletePreparation(p,{kind:'process',id:s.id}));
});
test('settled and uncertain journals cannot substitute lifecycle states',()=>{
 for(const id of ['case/settled-no-send','case/restart-no-send']){const s=steps.find(s=>s.id===id),p=preparation(s);p.journal.expected_state=id==='case/settled-no-send'?'reconciliation-required':'settled';assert.throws(()=>validateCompletePreparation(p,{kind:'process',id}));}
});

const ref=(family='independent-observation',i=0)=>({record_id:'record_'+i,family,sha256:h,byte_size:100});
function controlPreparation(step){
 const map={
  'control/authorize':{run_context_sha256:h,coverage_sha256:h,installation_descriptor_sha256:h},
  'control/provision':{fixture_plan_sha256:h,actors_sha256:h,workspaces_sha256:h,fixture_stores_sha256:h,artifact_source_plan_sha256:h},
  'control/observe-success-coverage':{success_case_record_refs:Array.from({length:33},(_,i)=>ref('harness-result',i)),auxiliary_process_record_refs:Array.from({length:9},(_,i)=>ref('process-custody',33+i))},
  'control/observe-server-foreign-fixture':{store_descriptor_sha256:h,credential_slot_sha256:h,primary_workspace_id:'primary',foreign_workspace_id:'foreign'},
  'control/observe-other-runtime':{own_runtime_id:'runtime',own_proof_sha256:h,other_runtime_fixture_sha256:h},
  'control/observe-settled-intent':{create_invocation_id:'inv_original',create_final_sha256:h,store_descriptor_sha256:h},
  'control/arm-lost-response':{future_step_id:'case/lost-response-retained',store_descriptor_sha256:h,key_sha256:h,semantic_request_sha256:h},
  'control/disarm-and-observe-lost':{lost_invocation_id:'inv_lost',lost_final_sha256:h,fault_ack_sha256:h,store_descriptor_sha256:h},
  'control/revoke-submitter':{positive_observation_ref:ref(),credential_id:'credential',credential_slot_sha256:h,credential_version:1,grant_sha256:h},
 };
 return{kind:'control',step_id:step.id,actor_slot:step.actor,fixture:step.fixture,prior_bindings_sha256:h,authorization_record_sha256:h,payload:map[step.id]};
}
for(const s of steps.filter(s=>s.kind==='control'&&!s.id.startsWith('control/prepare-swap-')))test(`fixed control preparation ${s.id}`,()=>{
 const p=controlPreparation(s);assert.deepEqual(validateCompletePreparation(p,{kind:'control',id:s.id}),p);
});
for(const id of ['server-foreign-workspace-denial','server-wrong-runtime-proof-denial'])test(`fixed external preparation ${id}`,()=>{
 const p={kind:'external',requirement_id:id,fixture_plan_sha256:h,authorization_record_sha256:h,actor_binding_sha256:h,workspace_binding_sha256:h,causal_plan_sha256:h};
 assert.deepEqual(validateCompletePreparation(p,{kind:'external',id}),p);
 assert.throws(()=>validateCompletePreparation({...p,requirement_id:'other'},{kind:'external',id}));
});
test('coverage control cannot omit, duplicate or substitute required terminal reference families',()=>{
 const s=steps.find(s=>s.id==='control/observe-success-coverage');
 for(const change of [p=>p.payload.success_case_record_refs.pop(),p=>p.payload.auxiliary_process_record_refs.pop(),p=>p.payload.success_case_record_refs[1]=p.payload.success_case_record_refs[0],p=>p.payload.success_case_record_refs[0].family='process-custody']){
  const p=controlPreparation(s);change(p);assert.throws(()=>validateCompletePreparation(p,{kind:'control',id:s.id}));
 }
});
test('control payload cannot redirect fault target or substitute same workspace',()=>{
 const arm=steps.find(s=>s.id==='control/arm-lost-response'),p=controlPreparation(arm);p.payload.future_step_id='success/createTask';assert.throws(()=>validateCompletePreparation(p,{kind:'control',id:arm.id}));
 const foreign=steps.find(s=>s.id==='control/observe-server-foreign-fixture'),f=controlPreparation(foreign);f.payload.foreign_workspace_id=f.payload.primary_workspace_id;assert.throws(()=>validateCompletePreparation(f,{kind:'control',id:foreign.id}));
});

test('complete fixture disallows otherwise schema-valid foreign_runs in native prepared subject',()=>{
 const s=steps.find(s=>s.id==='success/getWorkspace'),p=preparation(s);
 const row={own_task_id:'own',foreign_task_id:'foreign',foreign_workspace_id:'other',run_id:'run',proof_sha256:h,grant_sha256:h};p.subject.foreign_runs={submit:{...row},fail:{...row}};
 assert.throws(()=>validateCompletePreparation(p,{kind:'process',id:s.id}));
});
test('static before/after enrollment and foreign-store runtime applicability cannot be substituted',()=>{
 for(const sid of ['prepare/submitter-enrollment','success/createTask','probe/server-foreign-workspace']){
  const s=steps.find(s=>s.id===sid),p=preparation(s);const wasBound=p.store_binding.runtime_id!==null;
  p.store_binding.runtime_id=wasBound?null:'runtime_substitute';p.store_binding.proof_sha256=wasBound?null:h;
  if(p.subject){p.subject.runtime_id=p.store_binding.runtime_id;p.subject.proof_sha256=p.store_binding.proof_sha256;}
  assert.throws(()=>validateCompletePreparation(p,{kind:'process',id:sid}));
 }
});

test('preparation selected-profile dispatch rejects unknown tag before accepting retained slot',()=>{
 const step=steps.find(s=>s.id==='success/getWorkspace'),p=preparation(step),slot={kind:'process',id:step.id};
 assert.deepEqual(validateCompletePreparation(p,slot,'native-r2-required-prepared-v1'),p);
 assert.throws(()=>validateCompletePreparation(p,slot,'unknown'));
});

test('all53 retained required process bodies preserve existing preparation predicates',async()=>{
 const {getRequiredScenario}=await import('../../scripts/lib/native-required-profile.mjs');
 const rows=getRequiredScenario().steps.filter(s=>s.kind!=='control');assert.equal(rows.length,53);
 for(const step of rows){const p=preparation(step);assert.deepEqual(validateCompletePreparation(p,{kind:'process',id:step.id},'native-r2-required-prepared-v1'),p);}
});

test('enrolled revoke-positive read preserves active store proof but sends no operation proof',()=>{
 const step=steps.find(s=>s.id==='prepare/revoke-own-positive'),p=preparation(step);p.subject.proof_sha256=null;
 assert.equal(p.store_binding.proof_sha256,h);
 assert.deepEqual(validateCompletePreparation(p,{kind:'process',id:step.id}),p);
});
test('non-proof operation cannot present retained store proof as an operation proof',()=>{
 const step=steps.find(s=>s.id==='prepare/revoke-own-positive'),p=preparation(step);p.subject.proof_sha256=h;
 assert.throws(()=>validateCompletePreparation(p,{kind:'process',id:step.id}));
});
test('runtime-proof operation must still match actual retained active proof',()=>{
 const step=steps.find(s=>s.operation==='claimTask'),p=preparation(step);
 for(const proof of [null,'b'.repeat(64)])assert.throws(()=>validateCompletePreparation({...p,subject:{...p.subject,proof_sha256:proof}},{kind:'process',id:step.id}));
 assert.deepEqual(validateCompletePreparation(p,{kind:'process',id:step.id}),p);
});
