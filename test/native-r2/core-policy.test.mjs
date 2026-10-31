import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as policy from '../../scripts/lib/r2-case-policy.mjs';
import {makeCaseEvidence} from '../acceptance/r2-case-fixtures.ts';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const core=receipt=>Object.fromEntries(['type','version','revision','tree_sha256','environment_id','composition_sha256','records'].map(k=>[k,receipt[k]]));
// Frozen against ec8e750 validator before extraction; hashes include finding messages/order.
const expected={
  "native/valid": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "native/missing-assembly": "d478cadd089b4701d4b163284d51bdff395cedaf070fb2e19a6cebb9b3df04b6",
  "native/failed-assembly": "d478cadd089b4701d4b163284d51bdff395cedaf070fb2e19a6cebb9b3df04b6",
  "native/multi-record-errors": "df61cae353ad945b338a6e8232ce28d82c57840ebb34313e1857c72e5ba87d32",
  "native/missing-context": "cd270356c4dd1f4de421a775cce0b88532490e097f526d5a601a04db367b4e16",
  "native/duplicate-coverage": "0bae47effa89c0e5555a342c4b85ea97147c53e12ff7fd45e6d8d08206f3e106",
  "isolation/valid": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "isolation/missing-assembly": "d478cadd089b4701d4b163284d51bdff395cedaf070fb2e19a6cebb9b3df04b6",
  "isolation/failed-assembly": "d478cadd089b4701d4b163284d51bdff395cedaf070fb2e19a6cebb9b3df04b6",
  "isolation/multi-record-errors": "848d5bbf45a8a20c43bb8fcf8fad7ef3271dc8f30ec7fdf06331015139efb6b0",
  "isolation/missing-context": "cd270356c4dd1f4de421a775cce0b88532490e097f526d5a601a04db367b4e16",
  "isolation/duplicate-coverage": "a10e8cfde439f3b684193f8126ed1357162ba019da13d205ef82b588420b8edb",
  "gates/valid": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "gates/missing-assembly": "d478cadd089b4701d4b163284d51bdff395cedaf070fb2e19a6cebb9b3df04b6",
  "gates/failed-assembly": "d478cadd089b4701d4b163284d51bdff395cedaf070fb2e19a6cebb9b3df04b6",
  "gates/multi-record-errors": "2001654f40b18cb5b23e88ec726ecb3563a2105b8169119a08d31e77d4eaf8fe",
  "gates/missing-context": "cd270356c4dd1f4de421a775cce0b88532490e097f526d5a601a04db367b4e16",
  "gates/duplicate-coverage": "7a078ba84549cd9b6d64fa7b58cbf4c31a9feaec61b29d106b4738b3474a2930",
  "browser/valid": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "browser/missing-assembly": "d478cadd089b4701d4b163284d51bdff395cedaf070fb2e19a6cebb9b3df04b6",
  "browser/failed-assembly": "d478cadd089b4701d4b163284d51bdff395cedaf070fb2e19a6cebb9b3df04b6",
  "browser/multi-record-errors": "52efbe8e2d827f759275eac69e58b7f76fcc0d37e6bbfe8cd5ab9a0db5f58eaf",
  "browser/missing-context": "cd270356c4dd1f4de421a775cce0b88532490e097f526d5a601a04db367b4e16",
  "browser/duplicate-coverage": "9132cb5aead5c0dd7daaca8f6c7739f1b72e65c47da508721d8a5b4b9dc16d9c"
};
function scenarios(family){
 const cases=[];
 for(const mode of ['valid','missing-assembly','failed-assembly','multi-record-errors','missing-context','duplicate-coverage']){
  const f=makeCaseEvidence(),r=f.receipts[family],first=r.records[0];
  if(mode==='missing-assembly')f.commands.delete(r.command_id);
  if(mode==='failed-assembly')f.commands.get(r.command_id).exit_code=2;
  if(mode==='multi-record-errors'){first.observed_at=99;first.subject_sha256='0'.repeat(64);first.observations.projection_error_count=1;first.observations.foreign_leak_count=1;const last=r.records.at(-1);last.observations.outcome_kind='invalid';last.command_id='missing';}
  if(mode==='missing-context')delete f.context.commands;
  if(mode==='duplicate-coverage')r.records[1]=structuredClone(r.records[0]);
  cases.push({name:family+'/'+mode,receipt:r,context:f.context});
 }
 return cases;
}
for(const family of ['native','isolation','gates','browser'])for(const s of scenarios(family))test('legacy exact findings/order '+s.name,()=>{const result=policy.validateCaseFamily(s.receipt,s.context);assert.equal(hash(result),expected[s.name],JSON.stringify(result));});
test('native core accepts complete rows without completed assembly receipt',()=>{const f=makeCaseEvidence(),r=f.receipts.native;f.commands.delete(r.command_id);assert.deepEqual(policy.validateNativeCaseCore(core(r),f.context),[]);assert.ok(policy.validateCaseFamily(r,f.context).some(x=>x.code==='R2_CASE_ASSEMBLY'));});
test('native core applies exact static predicates and cannot become another family',()=>{const f=makeCaseEvidence(),r=f.receipts.native;r.records[0].observations.process_exit=5;assert.ok(policy.validateNativeCaseCore(core(r),f.context).some(x=>x.code==='R2_CASE_PREDICATE'));assert.ok(policy.validateNativeCaseCore(core(f.receipts.browser),f.context).length);assert.ok(policy.validateNativeCaseCore(r,f.context).length);});
test('native core retains execution intervals and preparation lowerbound, only defers assembly relation',()=>{const f=makeCaseEvidence(),r=f.receipts.native;f.commands.get(r.command_id).started_at=1;assert.deepEqual(policy.validateNativeCaseCore(core(r),f.context),[]);assert.ok(policy.validateCaseFamily(r,f.context).some(x=>x.code==='R2_CASE_TIME'));r.records[0].observed_at=99;assert.ok(policy.validateNativeCaseCore(core(r),f.context).some(x=>x.code==='R2_CASE_TIME'));});
export function legacyBaseline(){return Object.fromEntries(['native','isolation','gates','browser'].flatMap(scenarios).map(s=>[s.name,hash(policy.validateCaseFamily(s.receipt,s.context))]));}
