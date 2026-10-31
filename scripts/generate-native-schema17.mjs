/** Additive current-schema witness. Never rewrites the frozen schema16 inputs. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const root=new URL('../',import.meta.url),check=process.argv.includes('--check');
function input(path,sha){const bytes=readFileSync(new URL(path,root));if(hash(bytes)!==sha)throw Error('FROZEN_NATIVE_INPUT_CHANGED');return JSON.parse(bytes);}
function output(path,value){const text=JSON.stringify(value,null,2)+'\n',url=new URL(path,root);if(check){if(readFileSync(url,'utf8')!==text)throw Error('STALE_NATIVE_SCHEMA17_PROFILE: '+path);}else writeFileSync(url,text);return hash(text);}
const selected=input('workers/native-fixture/complete-selectors.json','e63f87cd0c522867507d9fa1c373d78f21f8cb70f9a2fc52a8d9c350be179a81');
selected.witness_profile='native-selected-state-schema17-v1';selected.schema_version=17;
const s=selected.catalog.S;s.sql=s.sql.replace('LIMIT 17;','LIMIT 18;');s.sqlSha256=hash(s.sql);s.acceptedRows=17;s.bridgeRows=18;s.rawScalarBytes=16*18;s.bridgeJsonBytes=2+18*40+17;
// Exact contiguous1..17 serializes to247 bytes: keep the historical424 cap.
let occurrences=0;
for(const v of [...selected.phaseVectors,...selected.externalVectors]){if(!v.privateSelectAdmissions||!v.selectors.includes('S'))continue;const count=v.privateSelectAdmissions/(v.selectors.length+(v.selectors.includes('IW')?28:0));if(!Number.isInteger(count)||count!==v.phases.length)throw Error('NATIVE_VECTOR_MULTIPLICITY');v.bridgeJsonAdmissionBytes+=41*count;occurrences+=count;}
if(occurrences!==130)throw Error('NATIVE_S_MULTIPLICITY');selected.totals.bridgeJsonAdmissionBytes+=41*occurrences;
const catalog_sha256=output('workers/native-fixture/complete-selectors-schema17.json',selected);
output('workers/native-fixture/selected-state-schema17-profile.json',{profile:'native-selected-state-schema17-v1',schema_version:17,catalog_sha256});
const observer=input('test/helpers/native-observer/descriptors.json','560eee9c8ad996317812d81b0a70d2d618fe6db588075f8ea07e239a498ee392');
observer.witness_profile='native-selected-state-schema17-v1';observer.schema_version=17;
const p=observer.preflights.S;p.sql=s.sql;p.sqlSha256=s.sqlSha256;p.acceptedRows=17;p.bridge.rows=18;p.bridge.rawScalarBytes=288;p.bridge.jsonArrayBytes=739;
const q=observer.productQueries['1'];q.bound.rows=17;q.bound.rawScalarBytes=136;q.bound.jsonArrayBytes=494;
for(const ledger of Object.values(observer.perObservationLedger)){ledger.productRawScalarBytes=0;ledger.productJsonArrayBytes=0;for(const [id,count]of Object.entries(ledger.productCallCounts)){ledger.productRawScalarBytes+=observer.productQueries[id].bound.rawScalarBytes*count;ledger.productJsonArrayBytes+=observer.productQueries[id].bound.jsonArrayBytes*count;}}
output('test/helpers/native-observer/descriptors-schema17.json',observer);
// Emit current fixture BEFORE importing its profile derivation. The frozen16
// source and its byte identity remain independent, including historical receipts.
const fixture=input('scripts/lib/native-complete-fixture.json','3ae71f86ab8bec34059efc8fd12e511bfa202a850d7aa1eb54cfab9722df8912');
fixture.profile='native-r2-complete-schema17-v1';
fixture.selected_state={...fixture.selected_state,source:'workers/native-fixture/complete-selectors-schema17.json',sha256:catalog_sha256,profile:'native-selected-state-schema17-v1',schema_version:17};
output('scripts/lib/native-complete-fixture-schema17.json',fixture);
const {selectCompleteProfile}=await import('./lib/native-profile-selection.mjs');
const current=selectCompleteProfile('native-r2-required-schema17-v1');
output('workers/native-fixture/required-schema17-commitments.json',{profile:current.profile.profile,...current.commitments});
