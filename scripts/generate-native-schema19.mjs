/** Additive19 witness derived from immutable18 bytes; never rewrites16/17/18. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const root=new URL('../',import.meta.url),check=process.argv.includes('--check');
function input(path,sha){const bytes=readFileSync(new URL(path,root));if(hash(bytes)!==sha)throw Error('FROZEN_NATIVE_INPUT_CHANGED: '+path);return JSON.parse(bytes);}
function output(path,value){const text=JSON.stringify(value,null,2)+'\n',url=new URL(path,root);if(check){if(readFileSync(url,'utf8')!==text)throw Error('STALE_NATIVE_SCHEMA19_PROFILE: '+path);}else writeFileSync(url,text);return hash(text);}
const observer=input('test/helpers/native-observer/descriptors-schema18.json','a3f2b66341945ddda3ba0cc11927750098e880e4e95984ec543fcec0cf93deb3');
const fixture=input('scripts/lib/native-complete-fixture-schema18.json','e6cb09cd76b280be2d36fedb48ee2633adde27969e5305d6f32ac72cb24c1019');
const selected=input('workers/native-fixture/complete-selectors-schema18.json','75cbdea13fb6053f69ba3560e37ebb347978db585411fd2eaccf1dd53d6ec8ce');
const prior=structuredClone(selected),s=selected.catalog.S;
selected.witness_profile='native-selected-state-schema19-v1';selected.schema_version=19;
s.sql=s.sql.replace('LIMIT 19;','LIMIT 20;');s.sqlSha256=hash(s.sql);s.acceptedRows=19;s.bridgeRows=20;s.rawScalarBytes=16*s.bridgeRows;s.bridgeJsonBytes=2+s.bridgeRows*40+(s.bridgeRows-1);

const labels=['preferences','outbox','catalog_plans','import_plans','decision_checkpoints','decision_proposals','approvals','decision_artifact_edges','decision_lifecycle_heads','decision_lifecycle_transitions','decision_notice_intents'];
const z=selected.catalog.Z;
z.sql='WITH witness(ordinal,table_name,present) AS (VALUES\n'+labels.map((name,i)=>`(${i},'${name}',CASE WHEN EXISTS(SELECT 1 FROM ${name} WHERE workspace_id=? LIMIT 1) THEN 1 ELSE 0 END)`).join(',\n')+'\n) SELECT table_name,present FROM witness ORDER BY ordinal LIMIT 11;';
z.sqlSha256=hash(z.sql);z.parameters=labels.map(()=> 'W');z.acceptedRows=11;z.bridgeRows=11;
z.fixtureCanonicalBytes=Buffer.byteLength(JSON.stringify(labels.map(table_name=>({present:0,table_name}))));
z.note='Exact eleven fixed labels; all present=0. Includes all seven inactive decision tables; no decision operation or grant.';
if(z.fixtureCanonicalBytes!==520||labels.reduce((n,label)=>n+Buffer.byteLength(label)+8,0)!==277)throw Error('NATIVE_SCHEMA19_Z_DERIVATION');

let occurrences=0,zOccurrences=0,queries=0,bridge=0,canonical=0;
for(const v of [...selected.phaseVectors,...selected.externalVectors]){
 if(!v.privateSelectAdmissions){if(v.bridgeJsonAdmissionBytes!==0)throw Error('NATIVE_ZERO_ADMISSION');continue;}
 const names=[...v.selectors,...(v.selectors.includes('IW')?Array(28).fill('I'):[])],count=v.phases.length;
 if(v.privateSelectAdmissions!==names.length*count)throw Error('NATIVE_VECTOR_MULTIPLICITY');
 v.bridgeJsonAdmissionBytes=names.reduce((n,k)=>n+selected.catalog[k].bridgeJsonBytes,0)*count;
 bridge+=v.bridgeJsonAdmissionBytes;queries+=v.privateSelectAdmissions;v.canonicalAdmissionBytes=names.reduce((n,k)=>n+selected.catalog[k].fixtureCanonicalBytes,0)*count;canonical+=v.canonicalAdmissionBytes;
 if(names.includes('Z'))zOccurrences+=count;
 if(names.includes('S'))occurrences+=count;
}
if(occurrences!==130||queries!==2555||bridge-prior.totals.bridgeJsonAdmissionBytes!==5330||zOccurrences!==24||canonical-prior.totals.canonicalAdmissionBytes!==8568)throw Error('NATIVE_SCHEMA19_DERIVATION');
selected.totals.bridgeJsonAdmissionBytes=bridge;selected.totals.canonicalAdmissionBytes=canonical;
const catalog_sha256=output('workers/native-fixture/complete-selectors-schema19.json',selected);
output('workers/native-fixture/schema19-runtime-delta.json',{witness_profile:selected.witness_profile,schema_version:19,S:selected.catalog.S,Z:selected.catalog.Z,phase_canonical_bytes:selected.phaseVectors.map(v=>v.canonicalAdmissionBytes),external_canonical_bytes:selected.externalVectors.map(v=>v.canonicalAdmissionBytes),canonical_total:canonical,phase_bridge_bytes:selected.phaseVectors.map(v=>v.bridgeJsonAdmissionBytes),external_bridge_bytes:selected.externalVectors.map(v=>v.bridgeJsonAdmissionBytes),bridge_total:selected.totals.bridgeJsonAdmissionBytes});
output('workers/native-fixture/selected-state-schema19-profile.json',{profile:'native-selected-state-schema19-v1',schema_version:19,catalog_sha256});
observer.witness_profile='native-selected-state-schema19-v1';observer.schema_version=19;
const p=observer.preflights.S;p.sql=s.sql;p.sqlSha256=s.sqlSha256;p.acceptedRows=19;p.bridge.rows=s.bridgeRows;p.bridge.rawScalarBytes=s.rawScalarBytes;p.bridge.jsonArrayBytes=s.bridgeJsonBytes;
const q=observer.productQueries['1'];q.bound.rows=19;q.bound.rawScalarBytes=q.bound.rows*q.bound.rawScalarRowBytes;q.bound.jsonArrayBytes=2+q.bound.rows*q.bound.jsonRowBytes+(q.bound.rows-1);
for(const ledger of Object.values(observer.perObservationLedger)){ledger.productRawScalarBytes=0;ledger.productJsonArrayBytes=0;for(const [id,count]of Object.entries(ledger.productCallCounts)){ledger.productRawScalarBytes+=observer.productQueries[id].bound.rawScalarBytes*count;ledger.productJsonArrayBytes+=observer.productQueries[id].bound.jsonArrayBytes*count;}}
output('test/helpers/native-observer/descriptors-schema19.json',observer);
fixture.profile='native-r2-complete-schema19-v1';fixture.selected_state={...fixture.selected_state,source:'workers/native-fixture/complete-selectors-schema19.json',sha256:catalog_sha256,profile:'native-selected-state-schema19-v1',schema_version:19};
output('scripts/lib/native-complete-fixture-schema19.json',fixture);
const {selectCompleteProfile}=await import('./lib/native-profile-selection.mjs');
const current=selectCompleteProfile('native-r2-required-schema19-v1');
output('workers/native-fixture/required-schema19-commitments.json',{profile:current.profile.profile,...current.commitments});
const attachmentIds=['prepare/submitter-enrollment','prepare/reviewer-enrollment','success/createTask'];
const attachment=selected.phaseVectors.filter(v=>attachmentIds.includes(v.step_id)).reduce((n,v)=>n+v.bridgeJsonAdmissionBytes,0);
const previousAttachment=prior.phaseVectors.filter(v=>attachmentIds.includes(v.step_id)).reduce((n,v)=>n+v.bridgeJsonAdmissionBytes,0);
if(attachment!==2369430||attachment-previousAttachment!==246)throw Error('NATIVE_ATTACHMENT_DERIVATION');
output('workers/native-fixture/schema19-budget-evidence.json',{schema_version:19,z_required_empty_tables:labels,z_executions:zOccurrences,z_canonical_bytes:z.fixtureCanonicalBytes,z_raw_scalar_bytes:277,s_executions:occurrences,query_admissions:queries,bridge_json_admission_bytes:bridge,bridge_delta:bridge-prior.totals.bridgeJsonAdmissionBytes,canonical_admission_bytes:canonical,canonical_delta:canonical-prior.totals.canonicalAdmissionBytes,s_canonical_bytes:Buffer.byteLength(JSON.stringify(Array.from({length:19},(_,i)=>({version:i+1})))),attachment_bridge_bytes:attachment,attachment_bridge_delta:attachment-previousAttachment,private_query1:q.bound});
