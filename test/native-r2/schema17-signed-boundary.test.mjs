import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalCaseSubject as canonical} from '../../scripts/lib/r2-case-policy.mjs';
import {values} from './complete-host-twins-values.mjs';
import {selectCompleteProfile} from '../../scripts/lib/native-profile-selection.mjs';
import {validateCompleteConfig} from '../../scripts/lib/native-complete-config.mjs';
import {verifyCompleteInstallationStatement} from '../../scripts/lib/native-complete-installation.mjs';
import {buildCompletePolicyFromStatement} from '../../scripts/lib/native-complete-policy-bootstrap.mjs';
import {completeHostSubjects,verifyCompleteHostBundle} from '../../scripts/lib/native-complete-bundle.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const current='native-r2-required-schema17-v1',historical='native-r2-required-prepared-v1';
function signed(tag=current){
 const prior=values().constructor,selected=selectCompleteProfile(tag),config={...prior.config,profile:tag,fixture_sha256:selected.commitments.fixture_sha256,family_ledger_sha256:selected.commitments.family_ledger_sha256,budgets:{...selected.profile.reservation,duration_ms:60000}};
 const root=generateKeyPairSync('ed25519'),der=root.publicKey.export({type:'spki',format:'der'}),now=Date.now(),bundle=Buffer.from('export const synthetic=true;');
 const old=JSON.parse(prior.installationBytes),payload={...old.payload,profile:tag,fixture_sha256:config.fixture_sha256,family_ledger_sha256:config.family_ledger_sha256,config_sha256:hash(canonical(config)),scenario_sha256:hash(canonical(selected.scenario)),host_sha256:hash(bundle),not_before:now-1000,expires_at:now+100000};
 const anchor={type:'native-host-trust',version:2,epoch:payload.epoch,key_id:hash(der),public_key_spki_base64:der.toString('base64'),not_before:now-1000,expires_at:now+300000};
 const envelope={type:'native-host-installation',version:2,key_id:anchor.key_id,payload};
 const descriptor={...envelope,signature_base64:sign(null,Buffer.from('AGENTHUB_NATIVE_HOST_INSTALLATION_V2\n'+canonical(envelope)),root.privateKey).toString('base64')};
 const subjects=Object.fromEntries(['candidate_sha','candidate_tree_sha','composition_sha256','cli_sha256','host_sha256','config_sha256','scenario_sha256','source_inventory_sha256','target_origin','primary_workspace','foreign_workspace','profile','fixture_sha256','family_ledger_sha256'].map(k=>[k,payload[k]]));
 return {config,descriptor,subjects,anchorBytes:Buffer.from(canonical(anchor)),descriptorBytes:Buffer.from(canonical(descriptor)),bundle,now};
}
test('fresh signed17 config and exact bundle derive17 source policy without installation authority',()=>{
 const f=signed();assert.equal(validateCompleteConfig(f.config).profile,current);
 const subjects=completeHostSubjects(f.config,hash(f.bundle),f.subjects.source_inventory_sha256);assert.deepEqual(subjects,f.subjects);
 const installation=verifyCompleteInstallationStatement({anchorBytes:f.anchorBytes,descriptorBytes:f.descriptorBytes,subjects,now:f.now,operationalMs:60000});
 const result=buildCompletePolicyFromStatement({config:f.config,installation,runId:'run_schema17'});assert.equal(result.policy.profile,current);assert.equal(result.installedAuthority,false);assert.equal(result.native_conformance,false);
 const bundle=verifyCompleteHostBundle({config:f.config,anchorBytes:f.anchorBytes,descriptorBytes:f.descriptorBytes,bundleBytes:f.bundle,now:f.now});assert.equal(bundle.installedAuthority,false);
});

for(const tag of [historical,current])test('signed '+tag+' rejects cross-profile retagging and unsigned selector overrides',()=>{
 const f=signed(tag),other=selectCompleteProfile(tag===current?historical:current);
 const verify=(descriptorBytes=f.descriptorBytes,subjects=f.subjects)=>verifyCompleteInstallationStatement({anchorBytes:f.anchorBytes,descriptorBytes,subjects,now:f.now,operationalMs:60000});
 assert.equal(verify().payload.profile,tag);
 const changed=structuredClone(f.descriptor);changed.payload.profile=other.profile.profile;changed.payload.fixture_sha256=other.commitments.fixture_sha256;changed.payload.family_ledger_sha256=other.commitments.family_ledger_sha256;
 const subjects={...f.subjects,profile:other.profile.profile,fixture_sha256:other.commitments.fixture_sha256,family_ledger_sha256:other.commitments.family_ledger_sha256};
 assert.throws(()=>verify(Buffer.from(canonical(changed)),subjects));
 assert.throws(()=>verify(f.descriptorBytes,subjects));
 for(const field of ['fixture_sha256','family_ledger_sha256'])assert.throws(()=>validateCompleteConfig({...f.config,[field]:other.commitments[field]}));
 assert.throws(()=>validateCompleteConfig({...f.config,selected_state_profile:'native-selected-state-schema17-v1'}));
 assert.throws(()=>validateCompleteConfig({...f.config,selected_state_catalog_sha256:'a'.repeat(64)}));
 const installation=verify();assert.throws(()=>buildCompletePolicyFromStatement({config:{...f.config,profile:other.profile.profile,fixture_sha256:other.commitments.fixture_sha256,family_ledger_sha256:other.commitments.family_ledger_sha256,budgets:{...other.profile.reservation,duration_ms:60000}},installation,runId:'run_schema17'}));
});

test('full17 signed fixture and source bootstrap remain distinct from required17 roster',()=>{
 const tag='native-r2-complete-schema17-v1',f=signed(tag);
 assert.equal(validateCompleteConfig(f.config).profile,tag);
 const installation=verifyCompleteInstallationStatement({anchorBytes:f.anchorBytes,descriptorBytes:f.descriptorBytes,subjects:f.subjects,now:f.now,operationalMs:60000});
 const result=buildCompletePolicyFromStatement({config:f.config,installation,runId:'run_full_schema17'});assert.equal(result.policy.profile,tag);assert.equal(result.installedAuthority,false);
 assert.throws(()=>buildCompletePolicyFromStatement({config:signed(current).config,installation,runId:'run_full_schema17'}));
});
