import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getCompleteProfile,getCompleteCommitments} from '../../scripts/lib/native-complete-profile.mjs';
import {validateCompleteConfig} from '../../scripts/lib/native-complete-config.mjs';
import {validateNativeConfig} from '../../scripts/lib/native-r2-config.mjs';
const configuration=()=>({version:2,profile:getCompleteProfile().profile,...getCompleteCommitments(),candidate_sha:'a'.repeat(40),candidate_tree_sha:'b'.repeat(40),composition_sha256:'c'.repeat(64),authority_record_sha256:'d'.repeat(64),node:{path:'/opt/node/bin/node',sha256:'e'.repeat(64)},build:{path:'/opt/candidate/agenthub.mjs',sha256:'f'.repeat(64)},origin:'https://isolated.example.test',workspaces:{primary:'ws_primary',foreign:'ws_foreign'},actors:[{id:'submitter',principal_id:'agent_s',agent_id:'agent_s',state_directory:'/private/s'},{id:'reviewer',principal_id:'agent_r',agent_id:'agent_r',state_directory:'/private/r'}],fixture_stores:[{fixture:'server-foreign-workspace',actor_slot:'submitter',principal_id:'agent_s',agent_id:'agent_s',state_directory:'/private/e1'}],fixture_directory:'/private/fixture',output_directory:'/private/output',budgets:{...getCompleteProfile().reservation,duration_ms:60000}});
test('complete configuration validates only compiled fixture and ledger identities, without authority',()=>{
 const c=configuration(),v=validateCompleteConfig(c);assert.deepEqual(v,c);assert.notEqual(v,c);assert.notEqual(v.actors,c.actors);assert.equal(v.authorized,undefined);
});
for(const [name,change] of Object.entries({
 version:c=>c.version=1,profile:c=>c.profile='native-readers',fixture:c=>c.fixture_sha256='0'.repeat(64),ledger:c=>c.family_ledger_sha256='0'.repeat(64),alias:c=>{c.ledger_sha256=c.family_ledger_sha256;delete c.family_ledger_sha256;},actorOrder:c=>c.actors.reverse(),extraActor:c=>c.actors.push({...c.actors[0],id:'X'}),wrongE1:c=>c.fixture_stores[0].principal_id=c.fixture_stores[0].agent_id='agent_r',tupleStore:c=>c.fixture_stores[0].fixture='swap-slot',noE1:c=>c.fixture_stores=[],sameStore:c=>c.fixture_stores[0].state_directory=c.actors[0].state_directory,nested:c=>c.output_directory='/private/s/out',longId:c=>c.workspaces.primary='a'.repeat(65),unicode:c=>c.workspaces.primary='é',http:c=>c.origin='http://isolated.example.test',localhost:c=>c.origin='https://localhost',ip:c=>c.origin='https://127.0.0.1',longOrigin:c=>c.origin='https://'+'a'.repeat(120)+'.example',budget:c=>c.budgets.commands--,extra:c=>c.trusted=true,
}))test(`complete configuration rejects ${name}`,()=>{const c=configuration();change(c);assert.throws(()=>validateCompleteConfig(c),/NATIVE_COMPLETE_CONFIG_REJECTED/);});
test('complete configuration rejects nested accessors and proxies without invocation',()=>{
 let calls=0;const c=configuration();Object.defineProperty(c.node,'path',{enumerable:true,get(){calls++;return '/opt/node';}});
 assert.throws(()=>validateCompleteConfig(c));assert.equal(calls,0);
 const p=configuration();p.actors=new Proxy(p.actors,{get(){calls++;return undefined;}});assert.throws(()=>validateCompleteConfig(p));assert.equal(calls,0);
});
test('version one never accepts the complete budget or profile by downgrade',()=>{
 const c=configuration();assert.throws(()=>validateNativeConfig(c));c.version=1;assert.throws(()=>validateNativeConfig(c));
 delete c.profile;delete c.fixture_sha256;delete c.family_ledger_sha256;assert.throws(()=>validateNativeConfig(c));
});
test('compiled fixture pins actual selected-state and request preparation source bytes',()=>{
 const fixture=getCompleteProfile().fixture;
 for(const row of [fixture.body_recipe,fixture.scenario,fixture.selected_state]){
  const bytes=readFileSync(new URL('../../'+row.source,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
 }
});

test('explicit required R2 tag validates only its compiled ledger and budget, not a full-profile relabel',async()=>{
 const {getRequiredProfile,getRequiredCommitments}=await import('../../scripts/lib/native-required-profile.mjs');
 const p=getRequiredProfile(),c=configuration(),commitments=getRequiredCommitments();
 c.profile=p.profile;c.family_ledger_sha256=commitments.family_ledger_sha256;c.budgets={...p.reservation,duration_ms:60000};
 assert.deepEqual(validateCompleteConfig(c),c);
 assert.throws(()=>validateCompleteConfig({...c,profile:getCompleteProfile().profile}));
 assert.throws(()=>validateCompleteConfig({...c,family_ledger_sha256:getCompleteCommitments().family_ledger_sha256}));
 assert.throws(()=>validateCompleteConfig({...configuration(),profile:p.profile}));
 assert.throws(()=>validateCompleteConfig({...c,skip:['probe/swapped-slot']}));
});
