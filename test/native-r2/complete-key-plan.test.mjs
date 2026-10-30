import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildCompleteKeyPlan,completeApplicationRequestDigest} from '../../scripts/lib/native-complete-key-plan.mjs';
import raw from '../../workers/native-fixture/required-application-plan.json' with {type:'json'};
const profile='native-r2-required-prepared-v1',runId='run_synthetic_keys';
const sha=s=>createHash('sha256').update(s).digest('hex');
const build=()=>buildCompleteKeyPlan({profile,runId});
test('fixed key bytes use exact domain and canonical original owner',()=>{
 const p=build(),row=p.entries.find(r=>r.step_id==='success/createTask');
 const expected='r2_'+sha('AGENTHUB_NATIVE_COMPLETE_IDEMPOTENCY_V2\n'+JSON.stringify({original_step_id:'success/createTask',run_id:runId})).slice(0,32);
 assert.equal(row.key,expected);assert.equal(row.key_sha256,sha(expected));assert.equal(row.ordinal,0);assert.equal(row.operation,'createTask');
 assert.equal(p.scope,'source-plan-only');assert.equal(p.installedAuthority,false);
 for(const r of p.entries){assert.match(r.key,/^r2_[a-f0-9]{32}$/);assert.equal(Buffer.byteLength(r.key),35);}
});
test('all actual mutation ordinals including six auxiliaries are included exactly',()=>{
 const expected=raw.flatMap(p=>p.ordinals.filter(o=>o.idempotency).map(o=>[p.step_id,o.ordinal,o.operation]));
 assert.deepEqual(build().entries.map(r=>[r.step_id,r.ordinal,r.operation]),expected);
 assert.equal(build().entries.filter(r=>r.step_id.startsWith('E2/')||r.step_id==='control/revoke-submitter').length,6);
 for(const id of ['success/uploadArtifactContent','success/commitArtifact'])assert.equal(build().entries.find(r=>r.step_id===id).ordinal,1);
 assert.equal(build().entries.some(r=>r.step_id==='success/getTask'),false);
});
test('only exact two no-send replay aliases share original mutation keys',()=>{
 const p=build();assert.deepEqual(p.replays.map(r=>[r.step_id,r.original_step_id]),[['case/settled-no-send','prepare/fail-create'],['case/restart-no-send','case/lost-response-retained']]);
 for(const r of p.replays){const original=p.entries.find(e=>e.step_id===r.original_step_id);assert.equal(r.key,original.key);assert.equal(r.key_sha256,original.key_sha256);}
 assert.equal(new Set(p.entries.map(r=>r.key)).size,p.entries.length);
});
test('two independent sides derive identical detached immutable plans',()=>{
 const a=build(),b=build();assert.deepEqual(a,b);assert.notEqual(a,b);assert.ok(Object.isFrozen(a.entries[0]));assert.throws(()=>{a.entries[0].key='r2_'+ '0'.repeat(32);});
 assert.notEqual(a.entries[0].key,buildCompleteKeyPlan({profile,runId:'run_other'}).entries[0].key);
});
test('fixed roster nested mutation cannot alter key owner or idempotency selection',()=>{
 assert.throws(()=>{raw[0].ordinals[0].idempotency=true;});assert.throws(()=>{raw[0].step_id='invented';});assert.equal(build().entries.some(r=>r.step_id==='success/getWorkspace'),false);
});
for(const patch of [{profile:'native-r2-complete-prepared-v1'},{runId:'not_run'},{runId:''},{runId:'run_'},{runId:'run_'+ 'a'.repeat(125)},{skip:[]},{digest:()=> '0'.repeat(64)},{entries:[]},{assurance:'installed'}])test('rejects unpinned profile/context/override '+Object.keys(patch).join(),()=>assert.throws(()=>buildCompleteKeyPlan({profile,runId,...patch})));
test('rejects accessor and proxy inputs without invoking accessors',()=>{
 let called=false;const input={profile,get runId(){called=true;return runId;}};assert.throws(()=>buildCompleteKeyPlan(input));assert.equal(called,false);assert.throws(()=>buildCompleteKeyPlan(new Proxy({profile,runId},{})));
});

const request=()=>({operation:'createTask',method:'POST',origin:'https://hub.example.invalid',path:'/v2/workspaces/ws_synthetic/tasks',query:'',request_body_sha256:sha('{}')});
test('application digest commits exact six fields and domain independently of journal fingerprint',()=>{
 const r=request(),ordered=Object.fromEntries(Object.keys(r).sort().map(k=>[k,r[k]]));
 assert.equal(completeApplicationRequestDigest(r),sha('AGENTHUB_NATIVE_COMPLETE_APPLICATION_REQUEST_V2\n'+JSON.stringify(ordered)));
 assert.notEqual(completeApplicationRequestDigest(r),completeApplicationRequestDigest({...r,request_body_sha256:sha('{ }')}));
 assert.notEqual(completeApplicationRequestDigest(r),completeApplicationRequestDigest({...r,origin:'https://other.example.invalid'}));
});
test('exact empty body and fixed encoded query are accepted without semantic normalization',()=>{
 const r={operation:'searchWorkspace',method:'GET',origin:'https://hub.example.invalid',path:'/v2/workspaces/ws_synthetic/search',query:'limit=20&q=conformance',request_body_sha256:sha('')};
 assert.match(completeApplicationRequestDigest(r),/^[a-f0-9]{64}$/);
 for(const query of ['?limit=20&q=conformance','q=conformance&limit=20','limit=20&q=%63onformance'])assert.throws(()=>completeApplicationRequestDigest({...r,query}));
});
for(const patch of [{operation:'invented'},{method:'GET'},{origin:'http://hub.example.invalid'},{origin:'https://hub.example.invalid/'},{path:'/v2/workspaces/ws_synthetic/tasks/evil'},{path:'/v2/workspaces/%77s_synthetic/tasks'},{path:'/v2/workspaces/../tasks'},{query:'x=1'},{request_body_sha256:'A'.repeat(64)},{headers:{}}])test('rejects incompatible request tuple '+JSON.stringify(patch),()=>assert.throws(()=>completeApplicationRequestDigest({...request(),...patch})));
test('metadata fetch and terminal artifact upload have different exact route-operation tuples',()=>{
 const a={...request(),operation:'getArtifact',method:'GET',path:'/v2/workspaces/ws_synthetic/artifacts/art_synthetic',request_body_sha256:sha('')};
 const b={...a,operation:'uploadArtifactContent',method:'PUT',path:a.path+'/content',request_body_sha256:sha('synthetic bytes')};
 assert.notEqual(completeApplicationRequestDigest(a),completeApplicationRequestDigest(b));
});
test('fixed wrong-runtime local intent has separate deterministic35-byte key, no HTTP ordinal',()=>{const p=buildCompleteKeyPlan({profile:'native-r2-required-prepared-v1',runId:'run_local'});assert.equal(p.local_intents.length,1);const r=p.local_intents[0];assert.deepEqual(Object.keys(r).sort(),['step_id','operation','original_step_id','key','key_sha256'].sort());assert.equal(r.step_id,'probe/wrong-runtime');assert.equal(r.operation,'heartbeatRuntime');assert.equal(r.original_step_id,r.step_id);assert.match(r.key,/^r2_[a-f0-9]{32}$/);assert.equal(p.entries.some(e=>e.step_id===r.step_id),false);assert.equal(p.replays.some(e=>e.step_id===r.step_id),false);assert.equal(new Set([...p.entries,p.local_intents[0]].map(e=>e.key)).size,p.entries.length+1);assert.deepEqual(p,buildCompleteKeyPlan({profile:p.profile,runId:'run_local'}));});
test('local intent recipe is exact fixed domain and cannot accept caller second owner',()=>{const p=build(),r=p.local_intents[0];assert.equal(r.key,'r2_'+sha('AGENTHUB_NATIVE_COMPLETE_IDEMPOTENCY_V2\n'+JSON.stringify({original_step_id:'probe/wrong-runtime',run_id:runId})).slice(0,32));assert.equal(r.key_sha256,sha(r.key));assert.throws(()=>buildCompleteKeyPlan({profile,runId,local_intents:['other']}));assert.throws(()=>p.local_intents.push({...r,step_id:'other'}));assert.throws(()=>{p.local_intents[0].step_id='other';});assert.notEqual(r.key,buildCompleteKeyPlan({profile,runId:'run_other'}).local_intents[0].key);});
