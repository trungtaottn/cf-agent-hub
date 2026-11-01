/** Additive18 witness derived from immutable17 bytes; never rewrites16/17. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const root=new URL('../',import.meta.url),check=process.argv.includes('--check');
function input(path,sha){const bytes=readFileSync(new URL(path,root));if(hash(bytes)!==sha)throw Error('FROZEN_NATIVE_INPUT_CHANGED: '+path);return JSON.parse(bytes);}
function output(path,value){const text=JSON.stringify(value,null,2)+'\n',url=new URL(path,root);if(check){if(readFileSync(url,'utf8')!==text)throw Error('STALE_NATIVE_SCHEMA18_PROFILE: '+path);}else writeFileSync(url,text);return hash(text);}
const selected=input('workers/native-fixture/complete-selectors-schema17.json','d87fba0579774590ea0193ad0161a37d2b7cd6f7a5bca53b04ca9990aefdd08a');
const prior=structuredClone(selected),s=selected.catalog.S;
selected.witness_profile='native-selected-state-schema18-v1';selected.schema_version=18;
s.sql=s.sql.replace('LIMIT 18;','LIMIT 19;');s.sqlSha256=hash(s.sql);s.acceptedRows=18;s.bridgeRows=19;s.rawScalarBytes=16*s.bridgeRows;s.bridgeJsonBytes=2+s.bridgeRows*40+(s.bridgeRows-1);
let occurrences=0,queries=0,bridge=0,canonical=0;
for(const v of [...selected.phaseVectors,...selected.externalVectors]){
 if(!v.privateSelectAdmissions){if(v.bridgeJsonAdmissionBytes!==0)throw Error('NATIVE_ZERO_ADMISSION');continue;}
 const names=[...v.selectors,...(v.selectors.includes('IW')?Array(28).fill('I'):[])],count=v.phases.length;
 if(v.privateSelectAdmissions!==names.length*count)throw Error('NATIVE_VECTOR_MULTIPLICITY');
 v.bridgeJsonAdmissionBytes=names.reduce((n,k)=>n+selected.catalog[k].bridgeJsonBytes,0)*count;
 bridge+=v.bridgeJsonAdmissionBytes;queries+=v.privateSelectAdmissions;canonical+=names.reduce((n,k)=>n+selected.catalog[k].fixtureCanonicalBytes,0)*count;
 if(names.includes('S'))occurrences+=count;
}
if(occurrences!==130||queries!==2555||bridge-prior.totals.bridgeJsonAdmissionBytes!==5330||canonical!==prior.totals.canonicalAdmissionBytes)throw Error('NATIVE_SCHEMA18_DERIVATION');
selected.totals.bridgeJsonAdmissionBytes=bridge;
const catalog_sha256=output('workers/native-fixture/complete-selectors-schema18.json',selected);
output('workers/native-fixture/schema18-runtime-delta.json',{witness_profile:selected.witness_profile,schema_version:18,S:selected.catalog.S,phase_bridge_bytes:selected.phaseVectors.map(v=>v.bridgeJsonAdmissionBytes),external_bridge_bytes:selected.externalVectors.map(v=>v.bridgeJsonAdmissionBytes),bridge_total:selected.totals.bridgeJsonAdmissionBytes});
output('workers/native-fixture/selected-state-schema18-profile.json',{profile:'native-selected-state-schema18-v1',schema_version:18,catalog_sha256});
const observer=input('test/helpers/native-observer/descriptors-schema17.json','75dcca69584ed2ffb2b0e06d8cf085c5f385725dd961b9d2219419e39ea7c7eb');
observer.witness_profile='native-selected-state-schema18-v1';observer.schema_version=18;
const p=observer.preflights.S;p.sql=s.sql;p.sqlSha256=s.sqlSha256;p.acceptedRows=18;p.bridge.rows=s.bridgeRows;p.bridge.rawScalarBytes=s.rawScalarBytes;p.bridge.jsonArrayBytes=s.bridgeJsonBytes;
const q=observer.productQueries['1'];q.bound.rows=18;q.bound.rawScalarBytes=q.bound.rows*q.bound.rawScalarRowBytes;q.bound.jsonArrayBytes=2+q.bound.rows*q.bound.jsonRowBytes+(q.bound.rows-1);
for(const ledger of Object.values(observer.perObservationLedger)){ledger.productRawScalarBytes=0;ledger.productJsonArrayBytes=0;for(const [id,count]of Object.entries(ledger.productCallCounts)){ledger.productRawScalarBytes+=observer.productQueries[id].bound.rawScalarBytes*count;ledger.productJsonArrayBytes+=observer.productQueries[id].bound.jsonArrayBytes*count;}}
output('test/helpers/native-observer/descriptors-schema18.json',observer);
const fixture=input('scripts/lib/native-complete-fixture-schema17.json','a49ff8be77e8d1ee53d1e010001a941e543e820fc9b350fe64994bcce5d1425e');
fixture.profile='native-r2-complete-schema18-v1';fixture.selected_state={...fixture.selected_state,source:'workers/native-fixture/complete-selectors-schema18.json',sha256:catalog_sha256,profile:'native-selected-state-schema18-v1',schema_version:18};
output('scripts/lib/native-complete-fixture-schema18.json',fixture);
const {selectCompleteProfile}=await import('./lib/native-profile-selection.mjs');
const current=selectCompleteProfile('native-r2-required-schema18-v1');
output('workers/native-fixture/required-schema18-commitments.json',{profile:current.profile.profile,...current.commitments});
const attachmentIds=['prepare/submitter-enrollment','prepare/reviewer-enrollment','success/createTask'];
const attachment=selected.phaseVectors.filter(v=>attachmentIds.includes(v.step_id)).reduce((n,v)=>n+v.bridgeJsonAdmissionBytes,0);
const previousAttachment=prior.phaseVectors.filter(v=>attachmentIds.includes(v.step_id)).reduce((n,v)=>n+v.bridgeJsonAdmissionBytes,0);
if(attachment!==2369184||attachment-previousAttachment!==246)throw Error('NATIVE_ATTACHMENT_DERIVATION');
output('workers/native-fixture/schema18-budget-evidence.json',{schema_version:18,s_executions:occurrences,query_admissions:queries,bridge_json_admission_bytes:bridge,bridge_delta:bridge-prior.totals.bridgeJsonAdmissionBytes,canonical_admission_bytes:canonical,s_canonical_bytes:Buffer.byteLength(JSON.stringify(Array.from({length:18},(_,i)=>({version:i+1})))),attachment_bridge_bytes:attachment,attachment_bridge_delta:attachment-previousAttachment,private_query1:q.bound});
