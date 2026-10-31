import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {canonicalCaseSubject} from '../../scripts/lib/r2-case-policy.mjs';
import {selectCompleteProfile} from '../../scripts/lib/native-profile-selection.mjs';
import {completeSlotRegistry,completePolicyDigest} from '../../scripts/lib/native-complete-protocol.mjs';
import {encodeCompleteOriginal} from '../../scripts/lib/native-complete-original-wire.mjs';
import {validateCompleteResponse,parseCompleteResponseWire,completeResponseByteLimit} from '../../scripts/lib/native-complete-response.mjs';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:canonicalCaseSubject(v)).digest('hex'),h='a'.repeat(64),now=1700000000000;
function fixture(tag='native-r2-required-prepared-v1',supported=false){
 const selected=selectCompleteProfile(tag),context={version:2,runId:'run',configSha256:h,scenarioSha256:hash(selected.scenario),candidateSha:'b'.repeat(40),candidateTreeSha:'c'.repeat(40),compositionSha256:h,nodeSha256:h,buildSha256:h,authorityRecordSha256:h};
 const policy={type:'native-complete-run-policy',version:2,profile:tag,assurance:'source-test-only',service_id:'service',instance_id:'instance',run_id:'run',descriptor_sha256:h,run_context:context,actors_sha256:h,workspaces_sha256:h,fixture_stores_sha256:h,source_inventory_sha256:h,family_ledger_sha256:selected.commitments.family_ledger_sha256,coverage:completeSlotRegistry(tag).map(row=>({...row,supported:supported&&!row.id.includes('swap'),producer_id:supported&&!row.id.includes('swap')?'native-complete-'+row.kind:null})),expires_at:now+61000};
 const options={context,now,operationalMs:60000};
 const request=(operation,payload)=>({type:'native-complete-request',version:2,profile:tag,service_id:'service',instance_id:'instance',run_id:'run',descriptor_sha256:h,policy_sha256:completePolicyDigest(policy),sequence:1,request_id:'request',operation,payload});
 const response=(r,data)=>{const {payload,...rest}=r;return {...rest,type:'native-complete-response',data,installedAuthority:false,native_conformance:false};};
 return {selected,policy,options,request,response};
}
const ref=(family='independent-observation',record_id='record')=>({record_id,family,sha256:h,byte_size:100});
const preflight=f=>f.request('preflight',{policy_sha256:completePolicyDigest(f.policy),family_ledger_sha256:f.selected.commitments.family_ledger_sha256,slot_roster_sha256:hash(completeSlotRegistry(f.policy.profile))});
test('blocked empty tuple list never implies producer readiness',()=>{
 const f=fixture(),r=preflight(f),v=f.response(r,{status:'blocked',coverage_sha256:hash(f.policy.coverage),family_ledger_sha256:f.selected.commitments.family_ledger_sha256,unsupported:[]});
 const out=validateCompleteResponse(v,r,f.policy,f.options);assert.equal(out.scope,'structural-response-only');assert.equal(out.signature_verified,false);assert.equal(out.installedAuthority,false);assert.deepEqual(out.value,v);
 assert.throws(()=>validateCompleteResponse({...v,data:{...v.data,status:'ready'}},r,f.policy,f.options));
});
test('required ready syntax requires full claimed coverage but is still not authority',()=>{
 const f=fixture(undefined,true),r=preflight(f),v=f.response(r,{status:'ready',coverage_sha256:hash(f.policy.coverage),family_ledger_sha256:f.selected.commitments.family_ledger_sha256,unsupported:[]});
 assert.equal(validateCompleteResponse(v,r,f.policy,f.options).native_conformance,false);
 assert.throws(()=>validateCompleteResponse({...v,profile:'native-r2-complete-prepared-v1'},r,f.policy,f.options));
 assert.throws(()=>validateCompleteResponse({...v,data:{...v.data,unsupported:['success/getWorkspace']}},r,f.policy,f.options));
});
test('bound response commits the exact resource reservation',()=>{
 const f=fixture(),r=f.request('bind-run',{policy_sha256:completePolicyDigest(f.policy)}),v=f.response(r,{status:'bound',policy_sha256:r.policy_sha256,reservation_sha256:hash(f.selected.profile.reservation)});
 assert.deepEqual(validateCompleteResponse(v,r,f.policy,f.options).value,v);
 assert.throws(()=>validateCompleteResponse({...v,data:{...v.data,reservation_sha256:'0'.repeat(64)}},r,f.policy,f.options));
});
test('actual process final reference is registered, not minted by response',()=>{
 const f=fixture(),slot={kind:'process',id:'success/getWorkspace'},r=f.request('complete-process',{slot,invocation_id:'inv',preparation_sha256:h,custody:{prepared:ref('process-custody','prepared'),spawned:ref('process-custody','spawned'),final:ref('process-custody','final')},output:{stdout:{sha256:hash(''),byte_size:0},stderr:{sha256:hash(''),byte_size:0},verification_ref:ref('process-output-verification')}}),subject={preparation_sha256:h,invocation_id:'inv'};
 const v=f.response(r,{status:'process-recorded',slot,invocation_id:'inv',preparation_sha256:h,process_final_sha256:h});
 assert.deepEqual(validateCompleteResponse(v,r,f.policy,f.options,subject).value,v);
 assert.throws(()=>validateCompleteResponse({...v,data:{...v.data,process_final_sha256:'0'.repeat(64)}},r,f.policy,f.options,subject));
 assert.throws(()=>validateCompleteResponse(v,r,f.policy,f.options,{...subject,invocation_id:'other'}));
});
test('revoke manifest commits disable record while prior control ack remains separate',()=>{
 const f=fixture(undefined,true),slot={kind:'control',id:'control/revoke-submitter'},r=f.request('observe-slot',{slot,preparation_sha256:h}),subject={preparation_sha256:h,invocation_id:null};
 const manifest={type:'native-complete-slot-manifest',version:2,profile:f.policy.profile,run_id:'run',slot,preparation_sha256:h,effect_record_sha256:h,producer_id:'native-complete-control',assurance:'source-test-only',records:[ref('disable-acknowledgment')],typed_observation_ref:null,observed_at:now,usage:{commands:0,mutations:0,artifact_bytes:0,output_bytes:0}};
 const v=f.response(r,{manifest,original:null});assert.deepEqual(validateCompleteResponse(v,r,f.policy,f.options,subject).value,v);
 assert.throws(()=>validateCompleteResponse({...v,data:{manifest:{...manifest,records:[ref('control-acknowledgment')]},original:null}},r,f.policy,f.options,subject));
});
test('wire cap is selected before JSON decoding and canonical wire remains mandatory',()=>{
 const f=fixture(),r=preflight(f),limit=completeResponseByteLimit(r,f.policy,f.options);assert.equal(limit,1327);
 const parse=JSON.parse;let calls=0;JSON.parse=(...a)=>{calls++;return parse(...a);};
 try{assert.throws(()=>parseCompleteResponseWire(Buffer.alloc(limit+1),r,f.policy,f.options));assert.equal(calls,0);}finally{JSON.parse=parse;}
 const v=f.response(r,{status:'blocked',coverage_sha256:hash(f.policy.coverage),family_ledger_sha256:f.selected.commitments.family_ledger_sha256,unsupported:[]});
 assert.deepEqual(parseCompleteResponseWire(Buffer.from(canonicalCaseSubject(v)),r,f.policy,f.options).value,v);
 assert.throws(()=>parseCompleteResponseWire(Buffer.from(' '+canonicalCaseSubject(v)),r,f.policy,f.options));
});
test('full profile preserves exact six unavailable tuple obligations and cannot claim ready',()=>{
 const f=fixture('native-r2-complete-prepared-v1',true),r=preflight(f),unsupported=['control/prepare-swap-','probe/swapped-'].flatMap(p=>['slot','generation','principal'].map(x=>p+x));
 const v=f.response(r,{status:'blocked',coverage_sha256:hash(f.policy.coverage),family_ledger_sha256:f.selected.commitments.family_ledger_sha256,unsupported});
 assert.deepEqual(validateCompleteResponse(v,r,f.policy,f.options).value,v);
 for(const data of [{...v.data,status:'ready'},{...v.data,unsupported:[]},{...v.data,unsupported:[...unsupported].reverse()}])assert.throws(()=>validateCompleteResponse({...v,data},r,f.policy,f.options));
});
test('signed read framing preserves issuance identity and requires later signature authentication',()=>{
 const f=fixture(),slot={kind:'process',id:'success/getWorkspace'},subject={preparation_sha256:h,invocation_id:'inv'},bytes=Buffer.from('{}'),reference={record_id:'record',family:'independent-observation',sha256:createHash('sha256').update(bytes).digest('hex'),byte_size:bytes.length};
 const r={...f.request('read-original',{slot,...reference}),sequence:2},expected={profile:f.policy.profile,service_id:'service',instance_id:'instance',run_id:'run',request_id:'original_issuance',producer_id:'producer',...reference,descriptor_sha256:h,policy_sha256:r.policy_sha256,sequence:1,slot,...subject};
 const {privateKey}=generateKeyPairSync('ed25519'),v=JSON.parse(encodeCompleteOriginal({expected,bytes,privateKey}).toString());
 assert.equal(validateCompleteResponse(v,r,f.policy,f.options,subject).signature_verified,false);
 // Even syntactically valid but unauthenticated signatures cannot become a pass.
 const altered={...v,signature_base64:Buffer.alloc(64).toString('base64')};assert.equal(validateCompleteResponse(altered,r,f.policy,f.options,subject).signature_verified,false);
 for(const mutation of [{...v,record_id:'other'},{...v,invocation_id:'other'},{...v,run_id:'other'},{...v,byte_size:3},{...v,unexpected:true}])assert.throws(()=>validateCompleteResponse(mutation,r,f.policy,f.options,subject));
});
test('close reports actual partial cleanup and cannot normalize pending work',()=>{
 const f=fixture(),r=f.request('close-run',{}),d={status:'cleanup-unknown',attempted_slots:1,observed_slots:0,originals_read:0,pending:1,usage:{commands:0,mutations:0,artifact_bytes:0,output_bytes:0}};
 assert.deepEqual(validateCompleteResponse(f.response(r,d),r,f.policy,f.options).value.data,d);
 for(const bad of [{...d,status:'closed'},{...d,attempted_slots:65},{...d,observed_slots:2},{...d,originals_read:44},{...d,usage:{...d.usage,commands:f.selected.profile.reservation.commands+1}}])assert.throws(()=>validateCompleteResponse(f.response(r,bad),r,f.policy,f.options));
 assert.equal(validateCompleteResponse(f.response(r,{...d,status:'closed',pending:0}),r,f.policy,f.options).value.data.status,'closed');
});
test('framing rejects accessors, shared bytes, invalid UTF8 and unknown response fields',()=>{
 const f=fixture(),r=preflight(f),v=f.response(r,{status:'blocked',coverage_sha256:hash(f.policy.coverage),family_ledger_sha256:f.selected.commitments.family_ledger_sha256,unsupported:[]});let reads=0;
 const bad={...v};Object.defineProperty(bad,'data',{enumerable:true,get(){reads++;return v.data;}});assert.throws(()=>validateCompleteResponse(bad,r,f.policy,f.options));assert.equal(reads,0);
 assert.throws(()=>validateCompleteResponse({...v,extra:1},r,f.policy,f.options));
 assert.throws(()=>parseCompleteResponseWire(new Uint8Array(new SharedArrayBuffer(20)),r,f.policy,f.options));
 assert.throws(()=>parseCompleteResponseWire(Buffer.from([0xff]),r,f.policy,f.options));
});
test('canonical signed framing rejects padding aliases and non-earlier issuance',()=>{
 const f=fixture(),slot={kind:'process',id:'success/getWorkspace'},subject={preparation_sha256:h,invocation_id:'inv'},bytes=Buffer.from('{}'),reference={record_id:'record',family:'independent-observation',sha256:createHash('sha256').update(bytes).digest('hex'),byte_size:2};
 const r={...f.request('read-original',{slot,...reference}),sequence:2},expected={profile:f.policy.profile,service_id:'service',instance_id:'instance',run_id:'run',request_id:'original_issuance',producer_id:'producer',...reference,descriptor_sha256:h,policy_sha256:r.policy_sha256,sequence:1,slot,...subject};
 const {privateKey}=generateKeyPairSync('ed25519'),v=JSON.parse(encodeCompleteOriginal({expected,bytes,privateKey}).toString());
 for(const mutation of [{...v,payload_base64:'e31='},{...v,signature_base64:'A'.repeat(85)+'B=='},{...v,sequence:2},{...v,sequence:3},{...v,request_id:r.request_id}])assert.throws(()=>validateCompleteResponse(mutation,r,f.policy,f.options,subject));
});
test('manifest producer must be the selected policy producer',()=>{
 const f=fixture(undefined,true),slot={kind:'control',id:'control/revoke-submitter'},r=f.request('observe-slot',{slot,preparation_sha256:h}),subject={preparation_sha256:h,invocation_id:null};
 const manifest={type:'native-complete-slot-manifest',version:2,profile:f.policy.profile,run_id:'run',slot,preparation_sha256:h,effect_record_sha256:h,producer_id:'unrelated',assurance:'source-test-only',records:[ref('disable-acknowledgment')],typed_observation_ref:null,observed_at:now,usage:{commands:0,mutations:0,artifact_bytes:0,output_bytes:0}};
 assert.throws(()=>validateCompleteResponse(f.response(r,{manifest,original:null}),r,f.policy,f.options,subject));
});
test('finalizer retains the frozen two-roster ceiling and validates run originals',()=>{
 const f=fixture(),r=f.request('finalize-run-scan',{inventory_sha256:h}),{privateKey}=generateKeyPairSync('ed25519');
 assert.equal(completeResponseByteLimit(r,f.policy,f.options),80140);
 const original=(family,n)=>{const bytes=Buffer.alloc(n,32),expected={profile:f.policy.profile,service_id:'service',instance_id:'instance',run_id:'run',request_id:r.request_id,producer_id:'producer',record_id:family.replaceAll('-','_'),descriptor_sha256:h,policy_sha256:r.policy_sha256,sequence:r.sequence,family,byte_size:n,sha256:createHash('sha256').update(bytes).digest('hex'),scope:'run'};return JSON.parse(encodeCompleteOriginal({expected,bytes,privateKey}).toString());};
 const v=f.response(r,{status:'run-scan-complete',scan_ref:ref('final-output-scan'),control_roster:original('control-roster',33615),coverage_roster:original('slot-coverage-roster',23390)});
 assert.ok(Buffer.byteLength(canonicalCaseSubject(v))>1263);assert.equal(validateCompleteResponse(v,r,f.policy,f.options).signature_verified,false);
 assert.throws(()=>validateCompleteResponse({...v,data:{...v.data,control_roster:v.data.coverage_roster}},r,f.policy,f.options));
});
test('prepare acknowledgment cannot switch a nested process invocation',()=>{
 const f=fixture(),step=f.selected.scenario.steps.find(s=>s.id==='prepare/reviewer-binding'),slot={kind:'process',id:step.id};
 const preparation={kind:'process',step_id:step.id,invocation_id:'inv_actual',actor_slot:step.actor,fixture:step.fixture,invocation_commitment_sha256:h,refs_sha256:h,prior_bindings_sha256:h,store_binding:{actor_slot:step.actor,fixture:step.fixture,store_descriptor_sha256:h,credential_slot_sha256:h,credential_id:'credential',principal_id:'agent',agent_id:'agent',workspace_id:'workspace',runtime_id:null,proof_sha256:null,authority_epoch:1},subject:null,input:null,artifact:null,journal:null,expected:{exit_code:step.expectedExit,http_requests:step.expectedRequests,http_status:step.expectedStatus??null}};
 const r=f.request('prepare-slot',{slot,preparation}),subject={invocation_id:'inv_actual',preparation_sha256:hash(preparation)},v=f.response(r,{status:'prepared',slot,preparation_sha256:subject.preparation_sha256});
 assert.deepEqual(validateCompleteResponse(v,r,f.policy,f.options,subject).value,v);
 assert.throws(()=>validateCompleteResponse(v,r,f.policy,f.options,{...subject,invocation_id:'other'}));
});
test('external effect and sealed inventory branches are closed and bounded',()=>{
 const f=fixture(),slot={kind:'external',id:'server-wrong-runtime-proof-denial'},subject={invocation_id:null,preparation_sha256:h},r=f.request('execute-external',{slot,preparation_sha256:h}),d={status:'effect-recorded',slot,preparation_sha256:h,effect_original:ref('external-observation')};
 assert.deepEqual(validateCompleteResponse(f.response(r,d),r,f.policy,f.options,subject).value.data,d);
 assert.throws(()=>validateCompleteResponse(f.response(r,{...d,effect_original:ref('independent-observation')}),r,f.policy,f.options,subject));
 const seal=f.request('seal-scan-inventory',{expected_inventory_generation:15}),data={status:'inventory-sealed',inventory_generation:15,inventory_sha256:h,secret_pattern_count:10,foreign_pattern_count:5,secret_inventory_sha256:h,foreign_inventory_sha256:h,secret_provenance_sha256:h,foreign_provenance_sha256:h};
 assert.deepEqual(validateCompleteResponse(f.response(seal,data),seal,f.policy,f.options).value.data,data);
 assert.throws(()=>validateCompleteResponse(f.response(seal,{...data,secret_pattern_count:9}),seal,f.policy,f.options));
});
function issued(r,subject,family,bytes=Buffer.from('{}'),changes={}){
 const {privateKey}=generateKeyPairSync('ed25519'),reference={record_id:'record',family,sha256:createHash('sha256').update(bytes).digest('hex'),byte_size:bytes.length};
 const expected={profile:r.profile,service_id:r.service_id,instance_id:r.instance_id,run_id:r.run_id,request_id:r.request_id,producer_id:subject?'native-complete-'+r.payload.slot.kind:'producer',...reference,descriptor_sha256:r.descriptor_sha256,policy_sha256:r.policy_sha256,sequence:r.sequence,...(subject?{slot:r.payload.slot,...subject}:{scope:'run'}),...changes};
 return {reference,value:JSON.parse(encodeCompleteOriginal({expected,bytes,privateKey}).toString())};
}
test('non-recorder manifest returns exactly its same-producer signed summary',()=>{
 const f=fixture(undefined,true),slot={kind:'process',id:'prepare/reviewer-binding'},subject={invocation_id:'inv',preparation_sha256:h},r=f.request('observe-slot',{slot,preparation_sha256:h}),{reference,value}=issued(r,subject,'process-observation-summary');
 const manifest={type:'native-complete-slot-manifest',version:2,profile:r.profile,run_id:r.run_id,slot,preparation_sha256:h,effect_record_sha256:h,producer_id:'native-complete-process',assurance:'source-test-only',records:[reference],typed_observation_ref:reference,observed_at:now,usage:{commands:0,mutations:0,artifact_bytes:0,output_bytes:0}},v=f.response(r,{manifest,original:value});
 assert.deepEqual(validateCompleteResponse(v,r,f.policy,f.options,subject).value,v);
 for(const original of [null,{...value,producer_id:'other'},{...value,sha256:h}])assert.throws(()=>validateCompleteResponse({...v,data:{manifest,original}},r,f.policy,f.options,subject));
});
test('control and process-scan originals have exact selected family and issuance',()=>{
 const f=fixture(),slot={kind:'control',id:'control/authorize'},subject={invocation_id:null,preparation_sha256:h},r=f.request('execute-control',{slot,preparation_sha256:h}),{value}=issued(r,subject,'control-acknowledgment');
 assert.deepEqual(validateCompleteResponse(value,r,f.policy,f.options,subject).value,value);assert.throws(()=>validateCompleteResponse({...value,sequence:2},r,f.policy,f.options,subject));
 const process={kind:'process',id:'success/getWorkspace'},ps={invocation_id:'inv',preparation_sha256:h},scan=f.request('scan-process-output',{slot:process,...ps,pass:'immediate',final_original_ref:ref('process-custody'),inventory_sha256:null,stdout:{sha256:hash(''),byte_size:0,payload_base64:''},stderr:{sha256:hash(''),byte_size:0,payload_base64:''}}),signed=issued(scan,ps,'secret-inventory-scan').value;
 assert.deepEqual(validateCompleteResponse(signed,scan,f.policy,f.options,ps).value,signed);assert.throws(()=>validateCompleteResponse({...signed,family:'independent-observation'},scan,f.policy,f.options,ps));
});
test('read-run-original preserves a prior final scan and rejects slot substitution',()=>{
 const f=fixture(),prior=f.request('finalize-run-scan',{inventory_sha256:h}),{reference,value}=issued(prior,null,'final-output-scan'),r={...f.request('read-run-original',reference),sequence:2,request_id:'read'};
 assert.deepEqual(validateCompleteResponse(value,r,f.policy,f.options).value,value);
 assert.throws(()=>validateCompleteResponse({...value,scope:undefined,slot:{kind:'process',id:'success/getWorkspace'}},r,f.policy,f.options));
 assert.throws(()=>validateCompleteResponse(value,r,f.policy,f.options,{invocation_id:null,preparation_sha256:h}));
});
