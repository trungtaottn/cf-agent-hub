import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {deriveCompleteFixtureContext} from '../../scripts/lib/native-complete-fixture-context.mjs';
import {canonicalCaseSubject as canonical} from '../../scripts/lib/r2-case-policy.mjs';
import {selectCompleteProfile} from '../../scripts/lib/native-profile-selection.mjs';
import {verifyCompleteInstallationStatement,COMPLETE_INSTALLATION_CAPABILITIES} from '../../scripts/lib/native-complete-installation.mjs';
import {completePolicyDigest,validateCompletePolicy} from '../../scripts/lib/native-complete-protocol.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),h='a'.repeat(64),now=1700000000000;
// Ephemeral synthetic roots only; no fixed installation files are read.
const root=generateKeyPairSync('ed25519'),service=generateKeyPairSync('ed25519'),client=generateKeyPairSync('ed25519');
function fixture(tag='native-r2-required-prepared-v1',edit=()=>{}){
 const selected=selectCompleteProfile(tag),config={version:2,profile:tag,fixture_sha256:selected.commitments.fixture_sha256,family_ledger_sha256:selected.commitments.family_ledger_sha256,candidate_sha:'a'.repeat(40),candidate_tree_sha:'b'.repeat(40),composition_sha256:'7'.repeat(64),authority_record_sha256:'4'.repeat(64),node:{path:'/opt/node/bin/node',sha256:'5'.repeat(64)},build:{path:'/opt/candidate/agenthub.mjs',sha256:'6'.repeat(64)},origin:'https://synthetic.example',workspaces:{primary:'primary',foreign:'foreign'},actors:[{id:'submitter',principal_id:'agent_s',agent_id:'agent_s',state_directory:'/private/s'},{id:'reviewer',principal_id:'agent_r',agent_id:'agent_r',state_directory:'/private/r'}],fixture_stores:[{fixture:'server-foreign-workspace',actor_slot:'submitter',principal_id:'agent_s',agent_id:'agent_s',state_directory:'/private/e1'}],fixture_directory:'/private/fixture',output_directory:'/private/output',budgets:{...selected.profile.reservation,duration_ms:60000}};
 const subjects={candidate_sha:config.candidate_sha,candidate_tree_sha:config.candidate_tree_sha,composition_sha256:config.composition_sha256,cli_sha256:config.build.sha256,host_sha256:'3'.repeat(64),config_sha256:hash(canonical(config)),scenario_sha256:hash(canonical(selected.scenario)),source_inventory_sha256:'2'.repeat(64),target_origin:config.origin,primary_workspace:'primary',foreign_workspace:'foreign',profile:tag,fixture_sha256:config.fixture_sha256,family_ledger_sha256:config.family_ledger_sha256};
 const der=root.publicKey.export({format:'der',type:'spki'}),anchor={type:'native-host-trust',version:2,epoch:1,key_id:hash(der),public_key_spki_base64:der.toString('base64'),not_before:now-1000,expires_at:now+200000};
 const payload={epoch:1,installation_id:'synthetic_installation',issuer:'https://issuer.example',service_id:'synthetic_service',service_origin:'https://observer.example',service_key_spki_base64:service.publicKey.export({format:'der',type:'spki'}).toString('base64'),auth_ref:'client',not_before:now-1000,expires_at:now+100000,...subjects,environment_id:'synthetic_environment',namespace_id:'synthetic_namespace',capabilities:[...COMPLETE_INSTALLATION_CAPABILITIES],private_inputs_sha256:'8'.repeat(64),client_auth_sha256:'9'.repeat(64),client_key_spki_base64:client.publicKey.export({format:'der',type:'spki'}).toString('base64')};
 edit({config,payload,subjects});subjects.config_sha256=hash(canonical(config));payload.config_sha256=subjects.config_sha256;
 const envelope={type:'native-host-installation',version:2,key_id:anchor.key_id,payload},descriptor={...envelope,signature_base64:sign(null,Buffer.from('AGENTHUB_NATIVE_HOST_INSTALLATION_V2\n'+canonical(envelope)),root.privateKey).toString('base64')};
 const installation=verifyCompleteInstallationStatement({anchorBytes:Buffer.from(canonical(anchor)),descriptorBytes:Buffer.from(canonical(descriptor)),subjects,now,operationalMs:1});
 return {config,installation,runId:'run_synthetic'};
}

function values(){let inputs;const f=fixture(undefined,({config,payload})=>{
 inputs={type:'native-complete-inputs',version:2,profile:config.profile,credentials:['S','R','X'].map((role,i)=>({role,credential_ref:'token_'+role,credential_id:'credential_'+role,principal_id:['agent_s','agent_r','agent_x'][i],agent_id:['agent_s','agent_r','agent_x'][i],workspace_id:i===2?'foreign':'primary'})),stores:[['primary-S','submitter','primary','S'],['primary-R','reviewer','primary','R'],['server-foreign-S','submitter','server-foreign-workspace','S']].map(([role,actor_slot,fixture,credential_role])=>({role,actor_slot,fixture,credential_role,store_descriptor_sha256:h})),human:{human_ref:'human',principal_id:'human_principal',session_id:'human_session',workspace_id:'primary'},fixture_facts:{config_epoch:7,config_sha256:'b'.repeat(64),audience:'synthetic_client',human:{issuer:'https://identity.example',subject:'synthetic_subject'},workspaces:[{role:'primary',object_name:'primary_object',installation_sha256:'c'.repeat(64),generation:2},{role:'foreign',object_name:'foreign_object',installation_sha256:'d'.repeat(64),generation:3}],credentials:['S','R','X'].map(role=>({role,credential_version:1,expires_at:2000000000000}))}};
 payload.private_inputs_sha256=hash(canonical(inputs));
 });
 const credentials=['S','R','X'].map((role,i)=>{const token=Buffer.alloc(32,i+1).toString('base64url');return{role,token,sha256:hash(token)};}),human={session_cookie:Buffer.alloc(32,4).toString('base64url'),csrf_token:Buffer.alloc(32,5).toString('base64url')};
 return {...f,inputs,credentials,human};
}
test('existing Expected derives exact source fixture identities with no signing epoch alias',()=>{
 const v=values(),o=deriveCompleteFixtureContext(v),e=o.expected;
 assert.deepEqual(Object.keys(e).sort(),['role','epoch','config_sha256','origin','audience','workspaces','actors','human'].sort());assert.equal(e.role,'primary');assert.equal(e.epoch,7);assert.notEqual(e.epoch,v.installation.payload.epoch);assert.equal(e.config_sha256,'b'.repeat(64));assert.equal(e.origin,v.config.origin);assert.equal(e.audience,'synthetic_client');
 assert.deepEqual(e.workspaces.primary,{id:'primary',object_name:'primary_object',installation_sha256:'c'.repeat(64),generation:2});assert.deepEqual(e.workspaces.foreign,{id:'foreign',object_name:'foreign_object',installation_sha256:'d'.repeat(64),generation:3});
 assert.deepEqual(e.actors.S,{agent_id:'agent_s',credential_id:'credential_S',token_sha256:hash(v.credentials[0].token)});
 assert.deepEqual(e.human,{principal_id:'human_principal',issuer:'https://identity.example',subject:'synthetic_subject',session_id:'human_session',token_sha256:hash(v.human.session_cookie),csrf_sha256:hash(v.human.csrf_token)});
 assert.deepEqual(o.observation_context,{config_epoch:7,observer_id:v.installation.payload.service_id,environment_id:v.installation.payload.environment_id});
});
test('initial grant is exact canonical G row, not scopes or row-array digest',()=>{
 const v=values(),o=deriveCompleteFixtureContext(v),g=o.initial_grants.find(g=>g.role==='X');
 const row={workspace_id:'foreign',credential_id:'credential_X',agent_id:'agent_x',credential_version:1,token_sha256:hash(v.credentials[2].token),scopes_json:'["runtimes:manage","workspace:read"]',project_ids_json:'null',enabled:1,expires_at:2000000000000,config_epoch:7,retired_at_epoch:null,revoked_at:null,origin:'operator_static',agent_status:'active',agent_origin:'operator_static',agent_epoch:7};
 assert.deepEqual(g.row,row);assert.equal(g.sha256,hash(canonical(row)));assert.notEqual(g.sha256,hash(canonical([row])));assert.notEqual(g.sha256,hash(row.scopes_json));
 const revoked={...row,enabled:0,revoked_at:1700000000001,credential_version:2};assert.notEqual(hash(canonical(revoked)),g.sha256);assert.equal(o.initial_grants.length,3);
});
test('deterministic frozen output retains no raw token/cookie/CSRF material or authority',()=>{
 const v=values(),o=deriveCompleteFixtureContext(v);assert.deepEqual(o,deriveCompleteFixtureContext(structuredClone(v)));assert.equal(o.installedAuthority,false);assert.equal(o.native_conformance,false);const text=canonical(o);for(const secret of [...v.credentials.map(c=>c.token),v.human.session_cookie,v.human.csrf_token])assert.equal(text.includes(secret),false);assert.ok(Object.isFrozen(o.initial_grants[0].row));
});
for(const [name,edit]of Object.entries({role:v=>v.credentials.reverse(),hash:v=>v.credentials[0].sha256=h,token:v=>v.credentials[0].token='bad',duplicateToken:v=>{v.credentials[1].token=v.credentials[0].token;v.credentials[1].sha256=v.credentials[0].sha256;},humanCookieHeader:v=>v.human.session_cookie='cfhub_session='+v.human.session_cookie,descriptorInputs:v=>v.installation.payload.private_inputs_sha256=h,changedFacts:v=>v.inputs.fixture_facts.config_epoch=8,changedConfig:v=>v.config.origin='https://other.example',missingFacts:v=>delete v.inputs.fixture_facts,extra:v=>v.allowed=true}))test('rejects unbound source context '+name,()=>{const v=structuredClone(values());edit(v);assert.throws(()=>deriveCompleteFixtureContext(v));});
test('initial grant field names exactly match selected G source catalog',async()=>{
 const {default:catalog}=await import('../../workers/native-fixture/complete-selectors.json',{with:{type:'json'}});
 for(const g of deriveCompleteFixtureContext(values()).initial_grants)assert.deepEqual(Object.keys(g.row).sort(),catalog.catalog.G.fields.map(f=>f.name).sort());
});
test('fixed native scope source cannot be mutated by a later importer',async()=>{
 const {default:manifest}=await import('../../scripts/lib/native-complete-fixture.json',{with:{type:'json'}});assert.throws(()=>{manifest.configuration_constraints.native_scopes.X[0]='tasks:review';});assert.equal(deriveCompleteFixtureContext(values()).initial_grants[2].row.scopes_json,'["runtimes:manage","workspace:read"]');
});
test('signed content environment identity is never normalized to fit evidence context',()=>{const v=structuredClone(values());v.installation.payload.environment_id='Uppercase';assert.throws(()=>deriveCompleteFixtureContext(v));});
test('human identity cannot alias a native actor even when signed input digest matches',()=>{const v=structuredClone(values());v.inputs.human.principal_id='agent_s';v.installation.payload.private_inputs_sha256=hash(canonical(v.inputs));assert.throws(()=>deriveCompleteFixtureContext(v));});
