import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,writeFileSync,rmSync,lstatSync,symlinkSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {getRequiredProfile,getRequiredCommitments} from '../../scripts/lib/native-required-profile.mjs';
import {readCompleteConfig,completeConfigDigest} from '../../scripts/lib/native-complete-config-reader.mjs';
const config=()=>{const p=getRequiredProfile(),c=getRequiredCommitments();return {version:2,profile:p.profile,fixture_sha256:c.fixture_sha256,family_ledger_sha256:c.family_ledger_sha256,candidate_sha:'a'.repeat(40),candidate_tree_sha:'b'.repeat(40),composition_sha256:'c'.repeat(64),authority_record_sha256:'d'.repeat(64),node:{path:'/opt/node/bin/node',sha256:'e'.repeat(64)},build:{path:'/opt/candidate/agenthub.mjs',sha256:'f'.repeat(64)},origin:'https://isolated.example.test',workspaces:{primary:'ws_primary',foreign:'ws_foreign'},actors:[{id:'submitter',principal_id:'agent_s',agent_id:'agent_s',state_directory:'/private/s'},{id:'reviewer',principal_id:'agent_r',agent_id:'agent_r',state_directory:'/private/r'}],fixture_stores:[{fixture:'server-foreign-workspace',actor_slot:'submitter',principal_id:'agent_s',agent_id:'agent_s',state_directory:'/private/e1'}],fixture_directory:'/private/fixture',output_directory:'/private/output',budgets:{...p.reservation,duration_ms:60000}};};
test('complete reader is separate, sanitized and never coerces supplied path objects',()=>{
 assert.throws(()=>readCompleteConfig('/missing/native-complete-config.json'),/^Error: NATIVE_COMPLETE_CONFIG_INPUT_REJECTED$/);
 let calls=0;assert.throws(()=>readCompleteConfig({toString(){calls++;return '/missing';}}));assert.equal(calls,0);
 assert.throws(()=>readCompleteConfig('relative.json'));
});
test('complete digest commits validated selected config rather than unvalidated aliases',()=>{
 const c=config(),sha=completeConfigDigest(c);assert.match(sha,/^[a-f0-9]{64}$/);
 assert.equal(completeConfigDigest(Object.fromEntries(Object.entries(c).reverse())),sha);
 assert.notEqual(completeConfigDigest({...c,candidate_sha:'f'.repeat(40)}),sha);
 assert.throws(()=>completeConfigDigest({...c,trusted:true}));assert.throws(()=>completeConfigDigest({...c,version:1}));
});
test('complete configuration remains rejected inside Git ancestry',()=>{
 const dir=mkdtempSync(resolve('.complete-config-test-'));try{chmodSync(dir,0o700);const path=join(dir,'config.json');writeFileSync(path,JSON.stringify(config()),{mode:0o600});assert.throws(()=>readCompleteConfig(path),/NATIVE_COMPLETE_CONFIG_INPUT_REJECTED/);}finally{rmSync(dir,{recursive:true});}
});
test('eligible default-root complete config reads exact data and rejects unsafe metadata',t=>{
 for(let p=tmpdir();;p=dirname(p)){try{lstatSync(join(p,'.git'));t.skip('Default temporary root has Git ancestry; protected complete config positive and isolated file-metadata negatives not exercised locally.');return;}catch(e){if(e.code!=='ENOENT')throw e;}if(p===dirname(p))break;}
 const dir=mkdtempSync(join(tmpdir(),'complete-config-'));try{chmodSync(dir,0o700);const path=join(dir,'config.json'),c=config();writeFileSync(path,JSON.stringify(c),{mode:0o600,flag:'wx'});assert.deepEqual(readCompleteConfig(path),c);
  symlinkSync(path,join(dir,'link.json'));assert.throws(()=>readCompleteConfig(join(dir,'link.json')));
  chmodSync(path,0o644);assert.throws(()=>readCompleteConfig(path));chmodSync(path,0o600);
  writeFileSync(path,'x'.repeat(65537));assert.throws(()=>readCompleteConfig(path));
 }finally{rmSync(dir,{recursive:true});}
});
