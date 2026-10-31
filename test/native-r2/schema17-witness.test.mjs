import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import old from '../../workers/native-fixture/complete-selectors.json' with {type:'json'};
import current from '../../workers/native-fixture/complete-selectors-schema17.json' with {type:'json'};
import identity from '../../workers/native-fixture/selected-state-schema17-profile.json' with {type:'json'};
import observer16 from '../helpers/native-observer/descriptors.json' with {type:'json'};
import observer from '../helpers/native-observer/descriptors-schema17.json' with {type:'json'};
import {NATIVE_SQL_CATALOG_SCHEMA17} from '../../scripts/lib/native-host-v2-sql-catalog-schema17.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
test('schema17 generator preserves frozen inputs and checks exact derived artifacts',()=>{
 execFileSync(process.execPath,['scripts/generate-native-schema17.mjs','--check']);
 assert.equal(identity.catalog_sha256,hash(readFileSync(new URL('../../workers/native-fixture/complete-selectors-schema17.json',import.meta.url))));
 assert.equal(identity.profile,'native-selected-state-schema17-v1');
 assert.notEqual(identity.catalog_sha256,hash(JSON.stringify(old)));
});
test('schema17 complete bridge ledger counts only admitted phases, excludes E1 reuse',()=>{
 let count=0,bridge=0,canonical=0,queries=0;
 for(const v of [...current.phaseVectors,...current.externalVectors]){
  if(!v.privateSelectAdmissions){assert.equal(v.bridgeJsonAdmissionBytes,0);continue;}
  const names=[...v.selectors,...(v.selectors.includes('IW')?Array(28).fill('I'):[])];
  const phases=v.phases.length;queries+=names.length*phases;
  const bytes=names.reduce((n,k)=>n+current.catalog[k].bridgeJsonBytes,0)*phases;
  assert.equal(v.bridgeJsonAdmissionBytes,bytes);bridge+=bytes;
  canonical+=names.reduce((n,k)=>n+current.catalog[k].fixtureCanonicalBytes,0)*phases;
  if(names.includes('S'))count+=phases;
 }
 assert.equal(count,130);assert.equal(queries,2555);assert.equal(bridge,180800154);assert.equal(bridge-old.totals.bridgeJsonAdmissionBytes,5330);
 assert.equal(canonical,old.totals.canonicalAdmissionBytes);assert.equal(current.catalog.S.fixtureCanonicalBytes,424);
 assert.equal(Buffer.byteLength(JSON.stringify(Array.from({length:17},(_,i)=>({version:i+1})))),247);
 for(const [k,v]of Object.entries(old.catalog))if(k!=='S')assert.deepEqual(current.catalog[k],v);
});
test('current observer SQL parity, scalar bridge math, and multiplicity ledgers independent of frozen16',()=>{
 const s=observer.preflights.S,n=NATIVE_SQL_CATALOG_SCHEMA17.S;
 assert.equal(s.sql,n.sql);assert.equal(s.sqlSha256,hash(s.sql));assert.match(s.sql,/LIMIT 18;/);
 assert.equal(s.bridge.rawScalarBytes,16*18);assert.equal(s.bridge.jsonArrayBytes,2+40*18+17);
 assert.equal(s.canonicalBytes,16384);assert.equal(observer.productQueries['1'].bound.rawScalarBytes,8*17);assert.equal(observer.productQueries['1'].bound.jsonArrayBytes,2+28*17+16);
 for(const [op,ledger]of Object.entries(observer.perObservationLedger)){
  const count=ledger.productCallCounts['1'];assert.ok(count===7||count===8);
  const raw=Object.entries(ledger.productCallCounts).reduce((n,[id,c])=>n+c*observer.productQueries[id].bound.rawScalarBytes,0);
  const json=Object.entries(ledger.productCallCounts).reduce((n,[id,c])=>n+c*observer.productQueries[id].bound.jsonArrayBytes,0);
  assert.equal(ledger.productRawScalarBytes,raw);assert.equal(ledger.productJsonArrayBytes,json);
  assert.equal(raw-observer16.perObservationLedger[op].productRawScalarBytes,count*8);
  assert.equal(json-observer16.perObservationLedger[op].productJsonArrayBytes,count*29);
 }
 assert.equal(observer16.preflights.S.acceptedRows,16);assert.equal(observer16.productQueries['1'].bound.rows,16);
});
