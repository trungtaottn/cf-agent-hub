import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import old from '../../workers/native-fixture/complete-selectors-schema18.json' with {type:'json'};
import current from '../../workers/native-fixture/complete-selectors-schema19.json' with {type:'json'};
import observer from '../helpers/native-observer/descriptors-schema19.json' with {type:'json'};
import {nativeSchema19Catalog} from '../../scripts/lib/native-schema19-catalog.mjs';
import {NATIVE_SQL_CATALOG_SCHEMA19} from '../../scripts/lib/native-host-v2-sql-catalog-schema19.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const labels=['preferences','outbox','catalog_plans','import_plans','decision_checkpoints','decision_proposals','approvals','decision_artifact_edges','decision_lifecycle_heads','decision_lifecycle_transitions','decision_notice_intents'];
test('compact19 equals full committed artifact and exact S19 lookahead20 is bounded',()=>{
 assert.deepEqual(nativeSchema19Catalog,current);
 assert.equal(JSON.stringify(nativeSchema19Catalog,null,2)+'\n',readFileSync(new URL('../../workers/native-fixture/complete-selectors-schema19.json',import.meta.url),'utf8'));
 const s=current.catalog.S;assert.equal(s.acceptedRows,19);assert.equal(s.bridgeRows,20);assert.match(s.sql,/LIMIT 20;/);assert.equal(s.rawScalarBytes,320);assert.equal(s.bridgeJsonBytes,821);assert.equal(s.sqlSha256,hash(s.sql));assert.equal(NATIVE_SQL_CATALOG_SCHEMA19.S.sql,s.sql);
 assert.equal(observer.preflights.S.sql,s.sql);assert.equal(observer.productQueries['1'].bound.rows,19);assert.equal(observer.productQueries['1'].bound.rawScalarBytes,152);assert.equal(observer.productQueries['1'].bound.jsonArrayBytes,552);
 for(const [name,d]of Object.entries(old.catalog))if(!['S','Z'].includes(name))assert.deepEqual(current.catalog[name],d);
});
test('independently derive19 bridge and canonical ledgers without new admissions',()=>{
 let s=0,z=0,q=0,b=0,c=0;
 for(const v of [...current.phaseVectors,...current.externalVectors]){
  if(!v.privateSelectAdmissions){assert.equal(v.bridgeJsonAdmissionBytes,0);assert.equal(v.canonicalAdmissionBytes,0);continue;}
  const names=[...v.selectors,...(v.selectors.includes('IW')?Array(28).fill('I'):[])],n=v.phases.length;
  q+=n*names.length;s+=n*Number(names.includes('S'));z+=n*Number(names.includes('Z'));
  const bridge=n*names.reduce((a,k)=>a+current.catalog[k].bridgeJsonBytes,0),canonical=n*names.reduce((a,k)=>a+current.catalog[k].fixtureCanonicalBytes,0);
  assert.equal(v.bridgeJsonAdmissionBytes,bridge);assert.equal(v.canonicalAdmissionBytes,canonical);b+=bridge;c+=canonical;
 }
 assert.equal(s,130);assert.equal(z,24);assert.equal(q,2555);assert.equal(b,180810814);assert.equal(c,7896990);assert.equal(b-old.totals.bridgeJsonAdmissionBytes,5330);assert.equal(c-old.totals.canonicalAdmissionBytes,8568);
 assert.equal(current.catalog.Z.rawScalarBytes,512);assert.equal(current.catalog.Z.bridgeJsonBytes,2048);assert.equal(current.catalog.Z.canonicalBytes,16384);
 assert.equal(labels.reduce((n,k)=>n+Buffer.byteLength(k)+8,0),277);assert.equal(Buffer.byteLength(JSON.stringify(labels.map(table_name=>({present:0,table_name})))),520);
});
test('actual SQLite literal Z19 witnesses each decision table and intentionally scopes workspace',()=>{
 // Isolated SQL-shape test; actual product19 migration/phase covered by Worker tests.
 const db=new DatabaseSync(':memory:');try{
  for(const label of labels)db.exec(`CREATE TABLE ${label}(workspace_id TEXT NOT NULL);`);
  const z=current.catalog.Z,query=db.prepare(z.sql);assert.equal(z.sqlSha256,hash(z.sql));assert.deepEqual(z.parameters,Array(11).fill('W'));
  const read=()=>query.all(...z.parameters.map(()=> 'primary')).map(r=>({...r}));
  assert.deepEqual(read(),labels.map(table_name=>({table_name,present:0})));
  for(const table of labels){
   db.prepare(`INSERT INTO ${table} VALUES(?)`).run('foreign');assert.ok(read().every(r=>r.present===0));
   db.prepare(`INSERT INTO ${table} VALUES(?)`).run('primary');assert.deepEqual(read().filter(r=>r.present!==0),[{table_name:table,present:1}]);
   db.exec(`DELETE FROM ${table}`);
  }
 }finally{db.close();}
});
test('Z19 enumerates every table created by the actual generic19 migration',()=>{
 const sql=readFileSync(new URL('../../src/storage/migrations/0019-decisions.sql',import.meta.url),'utf8');
 const tables=[...sql.matchAll(/CREATE TABLE ([a-z_]+)\s*\(/g)].map(m=>m[1]);
 assert.deepEqual(tables,[...labels.slice(4)]);
});
