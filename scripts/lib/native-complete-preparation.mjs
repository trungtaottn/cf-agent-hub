/** Exact per-step preparation shape. Authentic custody/causality joins are separate. */
import Ajv from 'ajv';
import {caseSchemas} from './r2-case-policy.mjs';
import {getNativeScenario} from './native-r2-scenario.mjs';
import {getCompleteProfile} from './native-complete-profile.mjs';
import {snapshotCompleteValue as snapshot,completeKeys as keys,completeCheck as check,completeId as id,completeDigest as digest,completeInteger as integer,freezeCompleteValue as freeze} from './native-complete-protocol.mjs';
const scenario=getNativeScenario(),steps=scenario.steps,profile=getCompleteProfile();
const bindingBefore=new Map(),enrolled=new Set();for(const step of steps){bindingBefore.set(step.id,step.fixture!=='server-foreign-workspace'&&enrolled.has(step.actor));if(step.operation==='createRuntime')enrolled.add(step.actor);}
let preparedShape;
function validSubject(value){
 if(!preparedShape){const ajv=new Ajv({strict:true,allErrors:false,inlineRefs:false});ajv.addSchema(caseSchemas);preparedShape=ajv.compile({$ref:caseSchemas.$id+'#/$defs/prepared_subject'});}
 return preparedShape(value);
}
const typed=step=>!!step.caseId||['prepare/fail-create','prepare/revoke-own-positive'].includes(step.id);
function expected(value,step){keys(value,'exit_code http_requests http_status');check(value.exit_code===step.expectedExit&&value.http_requests===step.expectedRequests&&value.http_status===(step.expectedStatus??null));}
function store(value,step){
 keys(value,'actor_slot fixture store_descriptor_sha256 credential_slot_sha256 credential_id principal_id agent_id workspace_id runtime_id proof_sha256 authority_epoch');
 check(value.actor_slot===step.actor&&value.fixture===step.fixture&&value.principal_id===value.agent_id);
 for(const k of ['credential_id','principal_id','agent_id','workspace_id'])id(value[k]);
 for(const k of ['store_descriptor_sha256','credential_slot_sha256'])digest(value[k]);integer(value.authority_epoch,1);
 check((value.runtime_id!==null)===bindingBefore.get(step.id));
 if(value.runtime_id===null)check(value.proof_sha256===null);else{id(value.runtime_id);digest(value.proof_sha256);}
}
function input(value,step){
 if(!step.refKeys.includes('input_file')){check(value===null);return;}
 keys(value,'kind sha256 byte_size semantic_body_sha256 publication_record_sha256 admission_record_sha256');check(value.kind==='pinned-json');integer(value.byte_size,1,65536);
 for(const key of ['sha256','semantic_body_sha256','publication_record_sha256','admission_record_sha256'])digest(value[key]);
}
function artifact(value,step){
 let kind,fields;
 if(step.id==='prepare/retain-artifact'){kind='source-retain';fields='source_record_sha256';}
 else if(['stageArtifact','uploadArtifactContent'].includes(step.operation)){kind='retained-content';fields='content_id retained_record_sha256';}
 else if(step.operation==='commitArtifact'){kind='commit-target';fields='artifact_id expected_artifact_version';}
 else if(step.operation==='downloadArtifactContent'){kind='download-target';fields='artifact_id destination_descriptor_sha256';}
 else if(step.operation==='getArtifact'){kind='metadata-target';fields='artifact_id';}
 else{check(value===null);return;}
 keys(value,'kind sha256 byte_size '+fields);check(value.kind===kind&&value.sha256===profile.artifact.sha256&&value.byte_size===profile.artifact.byte_size);
 for(const key of fields.split(' ')){if(key.endsWith('_sha256'))digest(value[key]);else if(key==='expected_artifact_version')integer(value[key],1);else id(value[key]);}
}
function journal(value,step){
 if(step.kind==='local'&&step.id!=='prepare/retain-artifact'){
  keys(value,'kind intent_id expected_request_sha256 expected_principal_sha256 key_sha256 expected_state original_invocation_id');check(value.kind==='intent-dispatch');
  id(value.intent_id);id(value.original_invocation_id);for(const k of ['expected_request_sha256','expected_principal_sha256','key_sha256'])digest(value[k]);
  check(value.expected_state===(step.id==='case/settled-no-send'?'settled':'reconciliation-required'));return;
 }
 if(step.id==='case/lost-response-retained'||step.id==='probe/wrong-runtime'){
  const lost=step.id==='case/lost-response-retained';keys(value,'kind key_sha256 semantic_request_sha256'+(lost?' fault_ack_sha256':''));
  check(value.kind===(lost?'new-uncertain-intent':'new-unsent-intent'));digest(value.key_sha256);digest(value.semantic_request_sha256);if(lost)digest(value.fault_ack_sha256);return;
 }
 check(value===null);
}

function reference(value,family){
 keys(value,'record_id family sha256 byte_size');id(value.record_id);check(value.family===family);digest(value.sha256);integer(value.byte_size,1,family==='process-custody'?8192:65536);
}
function external(p,slot){
 check(scenario.externalRequirements.some(row=>row.id===slot.id));
 keys(p,'kind requirement_id fixture_plan_sha256 authorization_record_sha256 actor_binding_sha256 workspace_binding_sha256 causal_plan_sha256');
 check(p.kind==='external'&&p.requirement_id===slot.id);
 for(const key of ['fixture_plan_sha256','authorization_record_sha256','actor_binding_sha256','workspace_binding_sha256','causal_plan_sha256'])digest(p[key]);
 // These refs must resolve to the fixed compiled causal plan and genuine owned
 // authority in the service; hash syntax alone is not that resolution.
}
function control(p,step){
 check(!profile.unavailable.includes(step.id));
 keys(p,'kind step_id actor_slot fixture prior_bindings_sha256 authorization_record_sha256 payload');
 check(p.kind==='control'&&p.step_id===step.id&&p.actor_slot===step.actor&&p.fixture===step.fixture);digest(p.prior_bindings_sha256);digest(p.authorization_record_sha256);
 const fields={
  'control/authorize':'run_context_sha256 coverage_sha256 installation_descriptor_sha256',
  'control/provision':'fixture_plan_sha256 actors_sha256 workspaces_sha256 fixture_stores_sha256 artifact_source_plan_sha256',
  'control/observe-success-coverage':'success_case_record_refs auxiliary_process_record_refs',
  'control/observe-server-foreign-fixture':'store_descriptor_sha256 credential_slot_sha256 primary_workspace_id foreign_workspace_id',
  'control/observe-other-runtime':'own_runtime_id own_proof_sha256 other_runtime_fixture_sha256',
  'control/observe-settled-intent':'create_invocation_id create_final_sha256 store_descriptor_sha256',
  'control/arm-lost-response':'future_step_id store_descriptor_sha256 key_sha256 semantic_request_sha256',
  'control/disarm-and-observe-lost':'lost_invocation_id lost_final_sha256 fault_ack_sha256 store_descriptor_sha256',
  'control/revoke-submitter':'positive_observation_ref credential_id credential_slot_sha256 credential_version grant_sha256',
 };
 check(Object.hasOwn(fields,step.id));const value=p.payload;keys(value,fields[step.id]);
 if(step.id==='control/observe-success-coverage'){
  check(Array.isArray(value.success_case_record_refs)&&value.success_case_record_refs.length===33&&Array.isArray(value.auxiliary_process_record_refs)&&value.auxiliary_process_record_refs.length===9);
  const seen=new Set();for(const [rows,family] of [[value.success_case_record_refs,'harness-result'],[value.auxiliary_process_record_refs,'process-custody']])for(const row of rows){reference(row,family);check(!seen.has(row.record_id));seen.add(row.record_id);}return;
 }
 for(const key of fields[step.id].split(' ')){
  if(key.endsWith('_sha256'))digest(value[key]);
  else if(key==='future_step_id')check(value[key]==='case/lost-response-retained');
  else if(key==='positive_observation_ref')reference(value[key],'independent-observation');
  else if(key==='credential_version')integer(value[key],1);
  else id(value[key]);
 }
 if(step.id==='control/observe-server-foreign-fixture')check(value.primary_workspace_id!==value.foreign_workspace_id);
}

export function validateCompletePreparation(value,slot){
 try{
  const p=snapshot(value),s=snapshot(slot,1024);keys(s,'kind id');
  if(s.kind==='external'){external(p,s);return freeze(p);}
  const step=steps.find(row=>row.id===s.id);
  if(s.kind==='control'){check(step&&step.kind==='control');control(p,step);return freeze(p);}
  check(step&&s.kind==='process'&&step.kind!=='control'&&!step.id.startsWith('probe/swapped-'));
  keys(p,'kind step_id invocation_id actor_slot fixture invocation_commitment_sha256 refs_sha256 prior_bindings_sha256 store_binding subject input artifact journal expected');
  check(p.kind==='process'&&p.step_id===step.id&&p.actor_slot===step.actor&&p.fixture===step.fixture);id(p.invocation_id);
  for(const key of ['invocation_commitment_sha256','refs_sha256','prior_bindings_sha256'])digest(p[key]);
  store(p.store_binding,step);expected(p.expected,step);input(p.input,step);artifact(p.artifact,step);journal(p.journal,step);
  if(!typed(step))check(p.subject===null);
  else{
   check(validSubject(p.subject)&&p.subject.actor_kind==='native'&&p.subject.foreign_runs===null);
   for(const key of ['principal_id','agent_id','credential_id','workspace_id','runtime_id','proof_sha256','authority_epoch'])check(p.subject[key]===p.store_binding[key]);
  }
  return freeze(p);
 }catch{throw Error('NATIVE_COMPLETE_PREPARATION_REJECTED');}
}
