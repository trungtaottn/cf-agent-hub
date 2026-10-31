import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getNativeScenario} from '../../scripts/lib/native-r2-scenario.mjs';
import {canonicalCaseSubject} from '../../scripts/lib/r2-case-policy.mjs';
import {getCompleteProfile,getCompleteCommitments} from '../../scripts/lib/native-complete-profile.mjs';
import {completeSlotRegistry,completePolicyDigest} from '../../scripts/lib/native-complete-protocol.mjs';
import {validateCompleteRequest} from '../../scripts/lib/native-complete-request.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex'),h='a'.repeat(64),now=1700000000000;
const context={version:2,runId:'run_actual',configSha256:h,scenarioSha256:hash(canonicalCaseSubject(getNativeScenario())),candidateSha:'b'.repeat(40),candidateTreeSha:'c'.repeat(40),compositionSha256:h,nodeSha256:h,buildSha256:h,authorityRecordSha256:h};
const policy={type:'native-complete-run-policy',version:2,profile:getCompleteProfile().profile,assurance:'source-test-only',service_id:'service',instance_id:'instance',run_id:'run_actual',descriptor_sha256:h,run_context:context,actors_sha256:h,workspaces_sha256:h,fixture_stores_sha256:h,source_inventory_sha256:h,family_ledger_sha256:getCompleteCommitments().family_ledger_sha256,coverage:completeSlotRegistry().map(row=>({...row,supported:false,producer_id:null})),expires_at:now+61000};
const options={context,now,operationalMs:60000};
const request=(operation,payload)=>({type:'native-complete-request',version:2,profile:policy.profile,service_id:policy.service_id,instance_id:policy.instance_id,run_id:policy.run_id,descriptor_sha256:h,policy_sha256:completePolicyDigest(policy),sequence:1,request_id:'request',operation,payload});
const ref=(family='process-custody',record_id='record')=>({record_id,family,sha256:h,byte_size:100});
const stream=text=>({sha256:hash(text),byte_size:Buffer.byteLength(text),payload_base64:Buffer.from(text).toString('base64')});
const scan=()=>request('scan-process-output',{slot:{kind:'process',id:'success/getWorkspace'},invocation_id:'inv_actual',preparation_sha256:h,pass:'immediate',final_original_ref:ref(),inventory_sha256:null,stdout:stream('safe output'),stderr:stream('')});
test('actual bounded process stream bytes are digest-checked, empty stderr is valid',()=>{const r=scan(),v=validateCompleteRequest(r,policy,options);assert.deepEqual(v,r);assert.ok(Object.isFrozen(v.payload.stdout));});
for(const [name,change] of Object.entries({digest:r=>r.payload.stdout.sha256='0'.repeat(64),length:r=>r.payload.stdout.byte_size++,padding:r=>r.payload.stdout.payload_base64+='=',unknown:r=>r.payload.stdout.secret=true,slot:r=>r.payload.slot.kind='control',pass:r=>r.payload.pass='later',inventory:r=>r.payload.inventory_sha256=h,wrongRun:r=>r.run_id='run_other',wrongPolicy:r=>r.policy_sha256='0'.repeat(64),version:r=>r.version=1,profile:r=>r.profile='readers',overflow:r=>r.payload.stdout=stream('x'.repeat(2049))}))test(`scan request rejects ${name}`,()=>{const r=scan();change(r);assert.throws(()=>validateCompleteRequest(r,policy,options));});
test('final scan requires explicit sealed inventory commitment',()=>{const r=scan();r.payload.pass='final';assert.throws(()=>validateCompleteRequest(r,policy,options));r.payload.inventory_sha256=h;assert.deepEqual(validateCompleteRequest(r,policy,options),r);});
test('scan accepts exact combined process cap and rejects one over across both streams',()=>{const r=scan();r.payload.stdout=stream('x'.repeat(1024));r.payload.stderr=stream('y'.repeat(1024));assert.deepEqual(validateCompleteRequest(r,policy,options),r);r.payload.stderr=stream('y'.repeat(1025));assert.throws(()=>validateCompleteRequest(r,policy,options));});
for(const [op,payload] of [['preflight',{policy_sha256:completePolicyDigest(policy),family_ledger_sha256:getCompleteCommitments().family_ledger_sha256,slot_roster_sha256:hash(canonicalCaseSubject(completeSlotRegistry()))}],['bind-run',{policy_sha256:completePolicyDigest(policy)}],['seal-scan-inventory',{expected_inventory_generation:15}],['finalize-run-scan',{inventory_sha256:h}],['read-run-original',{record_id:'final_scan',family:'final-output-scan',sha256:h,byte_size:100}],['close-run',{}]])test(`run-scoped ${op} has a closed payload`,()=>{const r=request(op,payload);assert.deepEqual(validateCompleteRequest(r,policy,options),r);assert.throws(()=>validateCompleteRequest({...r,payload:{...payload,extra:true}},policy,options));});
test('complete-process is custody registration, not a remote execution request',()=>{
 const r=request('complete-process',{slot:{kind:'process',id:'success/getWorkspace'},invocation_id:'inv_actual',preparation_sha256:h,custody:{prepared:ref('process-custody','prepared'),spawned:ref('process-custody','spawned'),final:ref('process-custody','final')},output:{stdout:{sha256:hash(''),byte_size:0},stderr:{sha256:hash(''),byte_size:0},verification_ref:ref('process-output-verification')}});
 assert.deepEqual(validateCompleteRequest(r,policy,options),r);r.payload.argv=['danger'];assert.throws(()=>validateCompleteRequest(r,policy,options));
});

test('combined declared scanner cap rejects before any base64 decoding',()=>{
 const r=scan();r.payload.stdout=stream('x'.repeat(2048));r.payload.stderr=stream('y');
 const original=Buffer.from;let decoded=0;
 Buffer.from=function(...args){if(args[1]==='base64')decoded++;return Reflect.apply(original,this,args);};
 try{assert.throws(()=>validateCompleteRequest(r,policy,options));assert.equal(decoded,0);}finally{Buffer.from=original;}
});
const privateInputs=()=>({credentials:['S','R','X'].map((role,i)=>({role,token:Buffer.alloc(32,i+1).toString('base64url')})),human:{session_cookie:Buffer.alloc(32,4).toString('base64url'),csrf_token:Buffer.alloc(32,5).toString('base64url')}});
const provision=()=>request('execute-control',{slot:{kind:'control',id:'control/provision'},preparation_sha256:h,private_inputs:privateInputs()});
test('only fixed provision carries five canonical private values with exact ordered roles',()=>{const r=provision();assert.deepEqual(validateCompleteRequest(r,policy,options),r);});
for(const [name,change] of Object.entries({roles:r=>r.payload.private_inputs.credentials.reverse(),extraRole:r=>r.payload.private_inputs.credentials.push({role:'other',token:'x'}),extraSecret:r=>r.payload.private_inputs.human.password='synthetic',wrongLane:r=>r.payload.slot.id='control/authorize',missingHuman:r=>delete r.payload.private_inputs.human,noncanonical:r=>{const row=r.payload.private_inputs.credentials[0];row.token=row.token.slice(0,-1)+'B';}}))test(`private provision rejects ${name}`,()=>{const r=provision();change(r);assert.throws(()=>validateCompleteRequest(r,policy,options));});

test('required request dispatch binds policy profile and exact346 boundary',async()=>{
 const {getRequiredCommitments,getRequiredProfile}=await import('../../scripts/lib/native-required-profile.mjs');
 const c=getRequiredCommitments(),p=structuredClone(policy),o=structuredClone(options);
 p.profile=getRequiredProfile().profile;p.family_ledger_sha256=c.family_ledger_sha256;p.run_context.scenarioSha256=c.scenario_sha256;o.context.scenarioSha256=c.scenario_sha256;
 p.coverage=completeSlotRegistry(p.profile).map(row=>({...row,supported:false,producer_id:null}));
 const r=scan();r.profile=p.profile;r.policy_sha256=completePolicyDigest(p);assert.deepEqual(validateCompleteRequest(r,p,o),r);
 assert.throws(()=>validateCompleteRequest({...r,profile:policy.profile},p,o));
 assert.throws(()=>validateCompleteRequest({...r,sequence:347},p,o));
 const close={...r,operation:'close-run',payload:{},sequence:346};assert.deepEqual(validateCompleteRequest(close,p,o),close);
 for(const id of ['control/prepare-swap-slot','probe/swapped-generation'])assert.throws(()=>validateCompleteRequest({...r,payload:{...r.payload,slot:{kind:id.startsWith('control')?'control':'process',id}}},p,o));
 const preflight={...r,operation:'preflight',payload:{policy_sha256:r.policy_sha256,family_ledger_sha256:c.family_ledger_sha256,slot_roster_sha256:hash(canonicalCaseSubject(completeSlotRegistry(p.profile)))}};
 assert.deepEqual(validateCompleteRequest(preflight,p,o),preflight);
});
test('schema17 requests bind exact17 ledger and cannot downgrade to historical profile',async()=>{
 const {selectCompleteProfile}=await import('../../scripts/lib/native-profile-selection.mjs');
 for(const roster of ['complete','required']){
  const selected=selectCompleteProfile(`native-r2-${roster}-schema17-v1`),p=structuredClone(policy),o=structuredClone(options);
  p.profile=selected.profile.profile;p.family_ledger_sha256=selected.commitments.family_ledger_sha256;p.run_context.scenarioSha256=hash(canonicalCaseSubject(selected.scenario));o.context.scenarioSha256=p.run_context.scenarioSha256;p.coverage=completeSlotRegistry(p.profile).map(row=>({...row,supported:false,producer_id:null}));
  const r=scan();r.profile=p.profile;r.policy_sha256=completePolicyDigest(p);assert.deepEqual(validateCompleteRequest(r,p,o),r);
  const old=selectCompleteProfile(`native-r2-${roster}-prepared-v1`);assert.throws(()=>validateCompleteRequest({...r,profile:old.profile.profile},p,o));
  const mixed={...p,family_ledger_sha256:old.commitments.family_ledger_sha256};assert.throws(()=>validateCompleteRequest({...r,policy_sha256:hash(canonicalCaseSubject(mixed))},mixed,o));
  assert.throws(()=>validateCompleteRequest({...r,selected_state_profile:'native-selected-state-schema17-v1'},p,o));
 }
});
