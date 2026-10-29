import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadNativeOriginals, nativeSourceInventoryDigest, assembleNativeEvidence} from '../../scripts/lib/native-r2-evidence.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const record=(id='one',value={kind:'original'})=>{const bytes=Buffer.from(JSON.stringify(value));return {id,sha256:sha(bytes),bytes};};
test('loader snapshots valid byte originals without authenticating them',()=>{const r=record();const loaded=loadNativeOriginals([r]);assert.deepEqual(loaded.get('one').value,{kind:'original'});r.bytes.fill(0);assert.deepEqual(loaded.get('one').value,{kind:'original'});});
test('loader rejects changed bytes and duplicate record IDs',()=>{assert.throws(()=>loadNativeOriginals([{...record(),sha256:'0'.repeat(64)}]));assert.throws(()=>loadNativeOriginals([record(),record()]));});
test('loader rejects unknown keys, getters and dangerous parsed keys',()=>{assert.throws(()=>loadNativeOriginals([{...record(),extra:true}]));let called=false;const r=record();Object.defineProperty(r,'sha256',{get(){called=true;return '0'.repeat(64);}});assert.throws(()=>loadNativeOriginals([r]));assert.equal(called,false);assert.throws(()=>loadNativeOriginals([record('one',JSON.parse('{"__proto__":{}}'))]));});
test('loader rejects invalid UTF8 and BOM',()=>{for(const bytes of [Buffer.from([255]),Buffer.from('\ufeff{}')])assert.throws(()=>loadNativeOriginals([{id:'one',sha256:sha(bytes),bytes}]));});
test('loader enforces record and cumulative limits before decoding',()=>{const bytes=Buffer.alloc(65537);assert.throws(()=>loadNativeOriginals([{id:'one',sha256:sha(bytes),bytes}]),/BUDGET/);const full=Buffer.alloc(65536,32);const rs=Array.from({length:257},(_,i)=>({id:'r'+i,sha256:sha(full),bytes:full}));assert.throws(()=>loadNativeOriginals(rs),/BUDGET/);});
test('inventory hash uses canonical sorted exact47 byte_size/mode entries',()=>{const a={path:'a.txt',sha256:'a'.repeat(64),byte_size:0,mode:'100644'},b={...a,path:'b.txt'};assert.equal(nativeSourceInventoryDigest([b,a]),nativeSourceInventoryDigest([a,b]));assert.throws(()=>nativeSourceInventoryDigest([{...a,bytes:0}]));assert.throws(()=>nativeSourceInventoryDigest([a,a]));assert.throws(()=>nativeSourceInventoryDigest([{...a,path:'../a'}]));});
test('incomplete input never exports fragments or calls supplied accessors',()=>{let called=false;const input={get context(){called=true;return {};}};const result=assembleNativeEvidence(input);assert.equal(result.status,'incomplete');assert.equal(called,false);assert.equal(result.native,undefined);assert.equal(result.acceptance,'pending-external-inspection');});

import {CASE_POLICY,CASE_OPERATIONS,canonicalCaseSubject} from '../../scripts/lib/r2-case-policy.mjs';
import {getNativeScenario} from '../../scripts/lib/native-r2-scenario.mjs';
const hash=v=>sha(typeof v==='string'?v:canonicalCaseSubject(v));
// Synthetic source fixtures exercise structural policy, never prove live execution.
function fixture(){
 const context={config_record_id:'config',run_id:'run1',candidate_sha:'a'.repeat(40),candidate_git_tree_sha:'b'.repeat(40),source_inventory:[{path:'a.txt',sha256:hash('file'),byte_size:4,mode:'100644'}],environment_id:'isolated',composition_sha256:hash('composition'),config_sha256:hash('config'),scenario_sha256:hash(getNativeScenario()),authority_record_sha256:hash('authority'),node_sha256:hash('node'),executable_sha256:hash('exe'),actors_sha256:hash('actors'),workspaces_sha256:hash('workspaces'),workspace_id:'workspace',config_epoch:1,observer_id:'observer'};
 const config={version:1,candidate_sha:context.candidate_sha,candidate_tree_sha:context.candidate_git_tree_sha,composition_sha256:context.composition_sha256,node:{path:'/opt/node/bin/node',sha256:context.node_sha256},build:{path:'/opt/app/cli.mjs',sha256:context.executable_sha256},origin:'https://isolated.example.invalid',workspaces:{primary:'workspace',foreign:'foreign'},actors:[{id:'submitter',principal_id:'agent',agent_id:'agent',state_directory:'/private/submitter'},{id:'reviewer',principal_id:'reviewer',agent_id:'reviewer',state_directory:'/private/reviewer'}],fixture_stores:[],fixture_directory:'/private/fixtures',output_directory:'/private/output',authority_record_sha256:context.authority_record_sha256,budgets:{commands:128,mutations:128,artifact_bytes:10485760,duration_ms:300000,output_bytes:1048576}};
 context.config_sha256=hash(config);context.actors_sha256=hash({actors:config.actors,fixture_stores:config.fixture_stores});context.workspaces_sha256=hash(config.workspaces);
 const tree=nativeSourceInventoryDigest(context.source_inventory),records=[record('config',config)],caseBindings=[],byStep=new Map();let idx=0;
 const add=(id,value)=>{const r=record(id,value);records.push(r);return r;};
 const ref=r=>{const v=JSON.parse(r.bytes);return {name:v.invocationId+'.'+v.status+'.json',sha256:r.sha256,byteSize:r.bytes.length};};
 const subjectFor=(op,id)=>({principal_id:'agent',agent_id:'agent',credential_id:'cred',runtime_id:'runtime',task_id:'task',run_id:'run',result_id:'result',workspace_id:'workspace',actor_kind:'native',request_sha256:hash(id),key_sha256:CASE_OPERATIONS[op]?.idempotency?hash(id+'key'):null,grant_sha256:hash('grant'),proof_sha256:CASE_OPERATIONS[op]?.runtimeProof?hash('proof'):null,authority_epoch:1,fixture_record_sha256:hash('fixture'),foreign_runs:null});
 const base={run_id:context.run_id,candidate_sha:context.candidate_sha,source_tree_sha256:tree,environment_id:context.environment_id,composition_sha256:context.composition_sha256,config_sha256:context.config_sha256,scenario_sha256:context.scenario_sha256,authority_record_sha256:context.authority_record_sha256};
 const processSubjects={config_sha256:context.config_sha256,candidate_sha:context.candidate_sha,candidate_tree_sha:context.candidate_git_tree_sha,composition_sha256:context.composition_sha256,node_sha256:context.node_sha256,build_sha256:context.executable_sha256,authority_record_sha256:context.authority_record_sha256,scenario_sha256:context.scenario_sha256,actors_sha256:context.actors_sha256,workspaces_sha256:context.workspaces_sha256};
 function make(step,subject){
  const i=++idx,prefix='r'+i,t=i*100,invocationId='inv_'+i,ps=hash('invocation'+i);
  const p=add(prefix+'prep',{type:'native-case-preparation-original',version:1,...base,case_id:step.caseId,step_id:step.id,prepared_at:t,subject,invocation_commitment_sha256:ps,record_source_id:'fixture'});
  const prepared=add(prefix+'prepared',{version:1,status:'prepared',invocationId,subjects:processSubjects,invocationSha256:ps,timeoutMs:1000,maxOutputBytes:1000,preparedAt:t+2,retryAllowed:false});
  const spawned=add(prefix+'spawned',{version:1,status:'spawned',invocationId,subjects:processSubjects,prepared:ref(prepared),identity:{pid:i+100,startTicks:String(i+100),bootId:'00000000-0000-0000-0000-000000000001'},spawnedAt:t+4,retryAllowed:false});
  const transcripts={stdout:{name:invocationId+'.stdout',sha256:hash(''),byteSize:0,complete:true},stderr:{name:invocationId+'.stderr',sha256:hash(''),byteSize:0,complete:true}};
  const final=add(prefix+'final',{version:1,invocationId,subjects:processSubjects,status:'terminal',reason:'exit',startedAt:t+3,endedAt:t+5,closeObserved:true,exitCode:step.expectedExit,signal:null,observedBytes:0,retainedBytes:0,truncated:false,prepared:ref(prepared),spawned:ref(spawned),transcripts,retryAllowed:false,effectOutcome:'unknown',descendants:'unverified'});
  const made={i,t,prefix,p,prepared,spawned,final,invocationId,subject,step};byStep.set(step.id,made);return made;
 }
 // Extra successful intent and read originals are not extra47 case rows.
 make({...getNativeScenario().steps.find(s=>s.id==='prepare/fail-create'),caseId:null},subjectFor('createTask','settled'));
 const nativeSteps=getNativeScenario().steps.filter(s=>s.caseId);
 // Source scenario order is settled before lost. Preserve that order, not CASE_POLICY order.
 for(const step of nativeSteps){
  let s=subjectFor(step.operation??'createTask',step.caseId);if(step.actor==='reviewer'){s.principal_id='reviewer';s.agent_id='reviewer';s.credential_id='reviewer-cred';}
  if(step.id==='case/settled-no-send')s=structuredClone(byStep.get('prepare/fail-create').subject);
  if(step.id==='case/restart-no-send')s=structuredClone(byStep.get('case/lost-response-retained').subject);
  if(step.id==='case/revoked-after-disable'){
   const posStep=getNativeScenario().steps.find(s=>s.id==='prepare/revoke-own-positive');make({...posStep,caseId:null},structuredClone(s));
  }
  const m=make(step,s),{i,t,prefix,p,prepared,spawned,final,invocationId}=m;
  let related=null,journal=null,revocation=null;
  if(step.caseId==='native/lost-response-retained'||step.caseId==='native/restart-no-send'||step.caseId==='native/settled-no-send'){
   const original=step.id==='case/settled-no-send'?byStep.get('prepare/fail-create'):step.id==='case/restart-no-send'?byStep.get('case/lost-response-retained'):m;
   journal={intent_id:'intent'+original.i,record_sha256:hash('journal'+i),state:step.id==='case/settled-no-send'?'settled':step.id==='case/restart-no-send'?'reconciliation-required':'within-window',original_invocation_id:original.invocationId,request_sha256:s.request_sha256,key_sha256:s.key_sha256};
   if(original!==m)related={original_prepared:original.prepared.id,original_spawned:original.spawned.id,original_final:original.final.id,original_preparation:original.p.id};
  }
  if(step.id==='case/revoked-after-disable'){
   const orig=byStep.get('prepare/revoke-own-positive');const pos=add(prefix+'positive',{type:'native-revocation-positive-original',version:1,run_id:context.run_id,step_id:orig.step.id,invocation_id:orig.invocationId,observed_at:orig.t+6,sequence:1,config_sha256:context.config_sha256,scenario_sha256:context.scenario_sha256,authority_record_sha256:context.authority_record_sha256,process_final_sha256:orig.final.sha256,preparation_sha256:orig.p.sha256,workspace_id:s.workspace_id,principal_id:s.principal_id,agent_id:s.agent_id,credential_id:s.credential_id,credential_version:1,credential_slot_sha256:hash('slot'),current_grant_state:'current',runtime_id:s.runtime_id,authority_epoch:s.authority_epoch,grant_sha256:s.grant_sha256,proof_sha256:s.proof_sha256,key_sha256:s.key_sha256,request_sha256:s.request_sha256,status:200,foreign_identifier_hashes:[],request_record_sha256:hash('posrequest')});
   const disable=add(prefix+'disable',{type:'native-revocation-disable-original',version:1,run_id:context.run_id,step_id:'control/revoke-submitter',observed_at:orig.t+7,sequence:2,config_sha256:context.config_sha256,scenario_sha256:context.scenario_sha256,authority_record_sha256:context.authority_record_sha256,positive_observation_sha256:pos.sha256,workspace_id:s.workspace_id,principal_id:s.principal_id,agent_id:s.agent_id,credential_id:s.credential_id,credential_version:2,credential_slot_sha256:hash('slot'),current_grant_state:'current',authority_epoch:s.authority_epoch,grant_sha256:s.grant_sha256,acknowledgment_record_sha256:hash('ack')});
   related={positive_prepared:orig.prepared.id,positive_spawned:orig.spawned.id,positive_final:orig.final.id,positive_preparation:orig.p.id,positive_observation:pos.id,disable_control:disable.id};
   revocation={positive_observation_record_id:pos.id,disable_control_record_id:disable.id,negative_sequence:3,credential_version:2,credential_slot_sha256:hash('slot'),current_grant_state:'current'};
  }
  const requests=step.expectedRequests===2?['getArtifact',step.operation]:[step.operation];
  const o=add(prefix+'observer',{type:'native-independent-observation',version:1,run_id:context.run_id,case_id:step.caseId,step_id:step.id,invocation_id:invocationId,observed_at:t+6,config_sha256:context.config_sha256,scenario_sha256:context.scenario_sha256,authority_record_sha256:context.authority_record_sha256,process_final_sha256:final.sha256,preparation_sha256:p.sha256,subject_sha256:hash(s),observer_id:context.observer_id,
   binding:{workspace_id:s.workspace_id,principal_id:s.principal_id,agent_id:s.agent_id,credential_id:s.credential_id,runtime_id:s.runtime_id,config_epoch:s.authority_epoch,grant_sha256:s.grant_sha256,proof_sha256:s.proof_sha256},
   projection:{record_sha256:hash('projection'+i),stdout_sha256:hash(''),stderr_sha256:hash(''),stdout_bytes:0,stderr_bytes:0,schema_error_codes:[],foreign_identifier_hashes:[],secret_match_hashes:[],runtime_token_output_count:step.operation==='createRuntime'?0:null},
   transport:journal?{record_sha256:hash('transport'+i),attempted_requests:step.expectedRequests?[{operation:'createTask',request_sha256:s.request_sha256}]:[],client_response:null,server_commit_record_sha256:step.expectedRequests?hash('commit'):null}:{record_sha256:hash('transport'+i),requests:requests.map((op,j)=>({operation:op,request_sha256:j===requests.length-1?s.request_sha256:hash('metadata'),response_record_sha256:hash('response'+i+j),status:j===requests.length-1?step.expectedStatus:200}))},
   resources:step.caseId.endsWith('/success')?{response_ids:[],state_ids:[],state_record_sha256:hash('state'+i)}:null,artifact:['uploadArtifactContent','downloadArtifactContent'].includes(step.operation)?{source_sha256:hash(''),source_bytes:0,target_sha256:hash(''),target_bytes:0}:null,journal,revocation});
  const harness=add(prefix+'harness',{type:'native-case-harness-original',version:1,id:'case'+i,...base,step_id:step.id,case_id:step.caseId,subject_sha256:hash(s),preparation_sha256:p.sha256,process_final_sha256:final.sha256,observer_sha256:o.sha256,started_at:t+1,ended_at:t+7,exit_code:0});
  caseBindings.push({case_id:step.caseId,step_id:step.id,preparation_record_id:p.id,process_prepared_record_id:prepared.id,process_spawned_record_id:spawned.id,process_final_record_id:final.id,observer_record_id:o.id,harness_record_id:harness.id,related_record_ids:related});
 }
 const assemblyBinding={record_id:'assembly',command_id:'assembly',native_artifact_path:'validation/releases/isolated/native.json'};
 const manifest=hash({context,caseBindings,records:records.map(r=>({id:r.id,sha256:r.sha256})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)});
 add('assembly',{type:'native-assembly-original',version:1,id:'assembly',run_id:context.run_id,candidate_sha:context.candidate_sha,source_tree_sha256:tree,environment_id:context.environment_id,composition_sha256:context.composition_sha256,input_manifest_sha256:manifest,started_at:10000,ended_at:10002,observed_at:10001,exit_code:0,observer_id:context.observer_id});
 return {version:1,context,records,caseBindings,assemblyBinding};
}
test('complete synthetic originals project exactly37 typed rows, not root acceptance',()=>{const result=assembleNativeEvidence(fixture());assert.equal(result.status,'structural-fragment',JSON.stringify(result));assert.equal(result.native.records.length,37);assert.equal(result.preparations.subjects.length,37);assert.equal(result.issue48Complete,false);assert.equal(result.rootMergeStatus,'pending-authenticated-global-preparation-timeline');assert.equal(result.commands.length,38);assert.ok(!JSON.stringify(result).includes('native-independent-observation'));});
const histories=new WeakMap();
function mutateOriginal(f,id,fn){const i=f.records.findIndex(r=>r.id===id),v=JSON.parse(f.records[i].bytes);if(!histories.has(f))histories.set(f,new Map(f.records.map(r=>[r.sha256,r.id])));histories.get(f).set(f.records[i].sha256,id);fn(v);f.records[i]=record(id,v);}
function resign(f){ // Re-sign all structural commitments; mutations must fail semantics, not stale hashes.
 const assemblyId=f.assemblyBinding.record_id;
 const history=histories.get(f)??new Map(f.records.map(r=>[r.sha256,r.id]));
 // Repeat because JSON originals form a directed dependency chain.
 for(let pass=0;pass<8;pass++){
  for(const r of f.records)history.set(r.sha256,r.id);const aliases=new Map([...history].map(([digest,id])=>[digest,f.records.find(x=>x.id===id).sha256]));
  function replace(v){if(typeof v==='string')return aliases.get(v)??v;if(Array.isArray(v))return v.map(replace);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)]));return v;}
  for(const r of [...f.records]){if(r.id===assemblyId)continue;const v=replace(JSON.parse(r.bytes));for(const key of ['prepared','spawned'])if(v[key]?.sha256){const target=f.records.find(x=>x.sha256===v[key].sha256);if(target)v[key].byteSize=target.bytes.length;}f.records[f.records.findIndex(x=>x.id===r.id)]=record(r.id,v);}
 }
 mutateOriginal(f,assemblyId,v=>{v.input_manifest_sha256=hash({context:f.context,caseBindings:f.caseBindings,records:f.records.filter(r=>r.id!==assemblyId).map(r=>({id:r.id,sha256:r.sha256})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)});});
}
const binding=(f,id='native/getWorkspace/success')=>f.caseBindings.find(b=>b.case_id===id);
for(const [name,field,change] of [
 ['child3 is not successful read','process_final_record_id',v=>{v.exitCode=3;}],
 ['unclosed custody','process_final_record_id',v=>{v.closeObserved=false;}],
 ['truncated process','process_final_record_id',v=>{v.truncated=true;}],
 ['incomplete transcript','process_final_record_id',v=>{v.transcripts.stdout.complete=false;}],
 ['wrong source actor commitment','process_final_record_id',v=>{v.subjects.actors_sha256=hash('wrong');}],
 ['wrong workspace commitment','process_final_record_id',v=>{v.subjects.workspaces_sha256=hash('wrong');}],
 ['failed actual harness','harness_record_id',v=>{v.exit_code=5;}],
 ['future preparation','preparation_record_id',v=>{v.prepared_at=99999;}],
 ['observer principal substitution','observer_record_id',v=>{v.binding.principal_id='other';}],
 ['unknown observer blanket flag','observer_record_id',v=>{v.passed=true;}],
 ['response/state mismatch','observer_record_id',v=>{v.resources.state_ids=['foreign'];}],
 ['observed output secret','observer_record_id',v=>{v.projection.secret_match_hashes=[hash('secret')];}],
 ['transport request substitution','observer_record_id',v=>{v.transport.requests[0].request_sha256=hash('other');}],
 ['wrong actual status','observer_record_id',v=>{v.transport.requests[0].status=401;}],
 ['transcript projection mismatch','observer_record_id',v=>{v.projection.stdout_bytes=1;}]
])test('rejects '+name+' even with refreshed original commitments',()=>{const f=fixture();mutateOriginal(f,binding(f)[field],change);resign(f);const out=assembleNativeEvidence(f);assert.equal(out.status,'incomplete');assert.equal(out.native,undefined);});
for(const [name,change] of [
 ['wrong increment',(p,d,v)=>{d.credential_version=3;v.credential_version=3;}],
 ['stale negative version',(p,d,v)=>{v.credential_version=1;}],
 ['same ID changed slot',(p,d,v)=>{v.credential_slot_sha256=hash('different-slot');}],
 ['disable preceding positive',(p,d,v)=>{d.sequence=0;}],
 ['fresh denial preceding disable',(p,d,v)=>{v.negative_sequence=1;}],
 ['unsafe version overflow',(p,d,v)=>{p.credential_version=Number.MAX_SAFE_INTEGER;d.credential_version=Number.MAX_SAFE_INTEGER;v.credential_version=Number.MAX_SAFE_INTEGER;}],
 ['unrelated grant',(p,d,v)=>{p.grant_sha256=hash('othergrant');}]
])test('revocation rejects '+name,()=>{const f=fixture(),b=binding(f,'native/revoked-after-disable'),l=b.related_record_ids;const p=JSON.parse(f.records.find(r=>r.id===l.positive_observation).bytes),d=JSON.parse(f.records.find(r=>r.id===l.disable_control).bytes),o=JSON.parse(f.records.find(r=>r.id===b.observer_record_id).bytes);change(p,d,o.revocation);for(const [id,val] of [[l.positive_observation,p],[l.disable_control,d],[b.observer_record_id,o]])mutateOriginal(f,id,v=>Object.assign(v,val));resign(f);assert.equal(assembleNativeEvidence(f).status,'incomplete');});
for(const [id,change] of [
 ['native/restart-no-send',o=>{o.transport.attempted_requests=[{operation:'createTask',request_sha256:hash('unrelated')}];}],
 ['native/settled-no-send',o=>{o.journal.original_invocation_id='inv_unrelated';}],
 ['native/lost-response-retained',o=>{o.http_status=0;}],
 ['native/lost-response-retained',o=>{o.journal.state='pending';}],
 ['native/commitArtifact/success',o=>{o.transport.requests.shift();}],
 ['native/downloadArtifactContent/success',o=>{o.artifact.source_sha256=hash('notempty');}],
 ['native/uploadArtifactContent/success',o=>{o.artifact.target_sha256=hash('notempty');}]
])test('rejects native case mutation '+id+' '+String(change),()=>{const f=fixture();mutateOriginal(f,binding(f,id).observer_record_id,change);resign(f);assert.equal(assembleNativeEvidence(f).status,'incomplete');});
test('byte array custom accessors are not executed',()=>{let called=false;const r=record();Object.defineProperty(r.bytes,'byteLength',{get(){called=true;return 1;}});assert.throws(()=>loadNativeOriginals([r]));assert.equal(called,false);});
test('full380 and unknown cases cannot replace exact37 bindings',()=>{const f=fixture();f.caseBindings.push(structuredClone(f.caseBindings[0]));assert.equal(assembleNativeEvidence(f).status,'incomplete');const g=fixture();g.caseBindings[0].case_id='fake';assert.equal(assembleNativeEvidence(g).status,'incomplete');});

test('test custody re-signing preserves valid fixture and reaches semantic denial',()=>{const f=fixture();resign(f);assert.equal(assembleNativeEvidence(f).status,'structural-fragment');mutateOriginal(f,binding(f).harness_record_id,v=>{v.exit_code=5;});resign(f);assert.deepEqual(assembleNativeEvidence(f).errors,['NATIVE_EVIDENCE_COMMAND']);});
test('restart cannot change retained intent identity from actual lost row',()=>{const f=fixture();mutateOriginal(f,binding(f,'native/restart-no-send').observer_record_id,v=>{v.journal.intent_id='other-intent';});resign(f);assert.equal(assembleNativeEvidence(f).status,'incomplete');});
test('distinct one-shot invocations cannot reuse Linux process identity',()=>{const f=fixture(),a=binding(f),b=binding(f,'native/listTasks/success');const identity=JSON.parse(f.records.find(r=>r.id===a.process_spawned_record_id).bytes).identity;mutateOriginal(f,b.process_spawned_record_id,v=>{v.identity=identity;});resign(f);assert.equal(assembleNativeEvidence(f).status,'incomplete');});

test('revocation rejects observed stale grant despite identical hash',()=>{const f=fixture();mutateOriginal(f,binding(f,'native/revoked-after-disable').observer_record_id,v=>{v.revocation.current_grant_state='stale';});resign(f);assert.equal(assembleNativeEvidence(f).status,'incomplete');});
test('Linux PID reuse with distinct start ticks remains valid',()=>{const f=fixture(),a=binding(f),b=binding(f,'native/listTasks/success');const pid=JSON.parse(f.records.find(r=>r.id===a.process_spawned_record_id).bytes).identity.pid;mutateOriginal(f,b.process_spawned_record_id,v=>{v.identity.pid=pid;});resign(f);assert.equal(assembleNativeEvidence(f).status,'structural-fragment');});

test('configured reviewer cannot be replaced by submitter across matching prepared and observed facts',()=>{const f=fixture(),b=binding(f,'native/acceptTaskResult/success');mutateOriginal(f,b.preparation_record_id,v=>{v.subject.principal_id='agent';v.subject.agent_id='agent';});const s=JSON.parse(f.records.find(r=>r.id===b.preparation_record_id).bytes).subject;mutateOriginal(f,b.harness_record_id,v=>{v.subject_sha256=hash(s);});mutateOriginal(f,b.observer_record_id,v=>{v.binding.principal_id='agent';v.binding.agent_id='agent';v.subject_sha256=hash(s);});resign(f);assert.equal(assembleNativeEvidence(f).status,'incomplete');});
test('canonical config commitment is not raw JSON byte digest',()=>{const f=fixture();const config=f.records.find(r=>r.id==='config');assert.notEqual(config.sha256,f.context.config_sha256);assert.equal(assembleNativeEvidence(f).status,'structural-fragment');f.context.config_sha256=config.sha256;resign(f);assert.equal(assembleNativeEvidence(f).status,'incomplete');});
test('loader admits exact64KiB records and cumulative16MiB, rejects one extra byte',()=>{const bytes=Buffer.from('"'+'x'.repeat(65534)+'"');assert.equal(bytes.length,65536);const rows=Array.from({length:256},(_,i)=>({id:'bound'+i,sha256:sha(bytes),bytes}));assert.equal(loadNativeOriginals(rows).size,256);rows.push({id:'extra',sha256:sha(Buffer.from('0')),bytes:Buffer.from('0')});assert.throws(()=>loadNativeOriginals(rows),/BUDGET/);});
test('loader512 records allowed and513 rejected, shared buffer forbidden',()=>{const rows=Array.from({length:512},(_,i)=>record('r'+i,0));assert.equal(loadNativeOriginals(rows).size,512);assert.throws(()=>loadNativeOriginals([...rows,record('extra',0)]),/BUDGET/);const bytes=new Uint8Array(new SharedArrayBuffer(1));bytes[0]=48;assert.throws(()=>loadNativeOriginals([{id:'shared',bytes,sha256:sha(bytes)}]));});
test('source inventory matches root canonical algorithm and exact UTF8 path bound',()=>{const row={path:'x'.repeat(256),sha256:hash('file'),byte_size:0,mode:'100644'};assert.equal(nativeSourceInventoryDigest([row]),hash([row]));assert.throws(()=>nativeSourceInventoryDigest([{...row,path:'x'.repeat(257)}]));assert.throws(()=>nativeSourceInventoryDigest([{...row,path:'é'.repeat(129)}]));assert.throws(()=>nativeSourceInventoryDigest([{...row,path:'bad path'}]));});
test('zero-copy private config is never returned in fragments',()=>{const f=fixture();const out=assembleNativeEvidence(f);assert.equal(out.status,'structural-fragment');assert.ok(!JSON.stringify(out).includes('/private/'));assert.ok(!JSON.stringify(out).includes('https://'));});
test('restart cannot use disconnected same-subject loss originals',()=>{
 const f=fixture(),b=binding(f,'native/restart-no-send'),lost=binding(f,'native/lost-response-retained');
 const clone=(id,newid,edit)=>{const v=JSON.parse(f.records.find(r=>r.id===id).bytes);edit(v);const r=record(newid,v);f.records.push(r);return r;};
 const prep=clone(lost.preparation_record_id,'otherPrep',()=>{});
 const prepared=clone(lost.process_prepared_record_id,'otherPrepared',v=>{v.invocationId='inv_other';});
 const ref=(r,name)=>({name,sha256:r.sha256,byteSize:r.bytes.length});
 const spawned=clone(lost.process_spawned_record_id,'otherSpawned',v=>{v.invocationId='inv_other';v.prepared=ref(prepared,'inv_other.prepared.json');v.identity.pid=99999;});
 const final=clone(lost.process_final_record_id,'otherFinal',v=>{v.invocationId='inv_other';v.prepared=ref(prepared,'inv_other.prepared.json');v.spawned=ref(spawned,'inv_other.spawned.json');for(const stream of ['stdout','stderr'])v.transcripts[stream].name='inv_other.'+stream;});
 b.related_record_ids={original_prepared:prepared.id,original_spawned:spawned.id,original_final:final.id,original_preparation:prep.id};
 mutateOriginal(f,b.observer_record_id,v=>{v.journal.original_invocation_id='inv_other';});resign(f);
 assert.deepEqual(assembleNativeEvidence(f).errors,['NATIVE_EVIDENCE_RESTART_JOIN']);
});
test('auxiliary positive and selected denial cannot be same OS process',()=>{const f=fixture(),b=binding(f,'native/revoked-after-disable');const identity=JSON.parse(f.records.find(r=>r.id===b.process_spawned_record_id).bytes).identity;mutateOriginal(f,b.related_record_ids.positive_spawned,v=>{v.identity=identity;});resign(f);assert.equal(assembleNativeEvidence(f).status,'incomplete');});
