import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const moduleUrl=new URL('../../scripts/lib/r3-prerequisite-validator.mjs',import.meta.url);
const implementation=existsSync(moduleUrl)?await import(moduleUrl):{};
test('R3 prerequisite validator exists without advertising release acceptance',()=>{
 assert.equal(typeof implementation.validateR3Prerequisites,'function');
 const result=implementation.validateR3Prerequisites(null,{});
 assert.equal(result.structurally_valid,false);
 assert.equal(result.acceptance_eligible,false);
 assert.ok(result.incomplete_policy.includes('typed-r3-producers'));
 assert.ok(result.findings.length>0);
});
import {prerequisiteFixture} from './r3-prerequisite-fixture.mjs';
test('closed synthetic prerequisite records establish only unit consistency, never acceptance',()=>{
 const f=prerequisiteFixture();const result=implementation.validateR3Prerequisites(f.input,f.options);
 assert.equal(result.structurally_valid,true,JSON.stringify(result));
 assert.equal(result.acceptance_eligible,false);
 assert.equal(result.scope,'verifier-unit-only');
 assert.ok(result.incomplete_policy.includes('typed-r3-producers'));
 assert.deepEqual(result.findings,[]);
});
import {rewriteProducer,canonical,hash} from './r3-prerequisite-fixture.mjs';
const rejected=(f,code)=>{const r=implementation.validateR3Prerequisites(f.input,f.options);assert.equal(r.structurally_valid,false);assert.equal(r.acceptance_eligible,false);assert.ok(r.findings.some(x=>x.code===code),JSON.stringify(r));};
for(const [name,change,code] of [
 ['unknown root field',f=>{f.input.accepted=true;},'R3_SCHEMA_INVALID'],
 ['round confusion',f=>{f.input.round='R2';},'R3_SCHEMA_INVALID'],
 ['missing independent comparison context',f=>{delete f.options.expectedContext;},'R3_CONTEXT_REQUIRED'],
 ['self consistent forged candidate',f=>{f.input.identity.revision='b'.repeat(40);for(let i=0;i<f.input.producers.length;i++)rewriteProducer(f,i,p=>{p.identity.revision=f.input.identity.revision;});},'R3_CONTEXT_MISMATCH'],
 ['wrong named tool despite count17',f=>{f.input.tools[0].name='hub_approval_approve';},'R3_TOOL_INVENTORY'],
 ['wrong native operation',f=>{f.input.tools[0].operation='approveApproval';},'R3_TOOL_INVENTORY'],
 ['missing producer family',f=>{f.input.producers.pop();},'R3_PRODUCER_INVENTORY'],
 ['unknown producer identity',f=>{f.input.producers[0].id='unknown';},'R3_PRODUCER_INVENTORY'],
 ['synthetic outside fixture mode',f=>{f.options.fixtureMode=false;},'R3_SYNTHETIC_PROVENANCE'],
 ['source bytes changed',f=>{f.files.set('package-lock.json','[]');},'R3_DIGEST'],
 ['build bytes absent',f=>{f.files.delete(f.input.build.path);},'R3_MISSING'],
 ['source file omitted from inventory',f=>{f.files.set('unreviewed.txt','x');},'R3_SOURCE_INVENTORY'],
 ['same producer bytes at alternate path',f=>{const original=f.input.producers[0].artifact;const next={...original,path:original.path+'.alias'};f.files.set(next.path,f.files.get(original.path));f.input.producers[1].artifact=next;},'R3_DUPLICATE_ARTIFACT'],
 ['unsafe path before reads',f=>{f.input.build.path='../escape';},'R3_PATH'],
 ['oversized reserved bytes before reads',f=>{f.input.build.byte_size=17*1024*1024;},'R3_BUDGET'],
])test('rejects '+name,()=>{const f=prerequisiteFixture();change(f);rejected(f,code);});
for(const [name,change,code] of [
 ['failed exit',p=>{p.exit_code=1;},'R3_PRODUCER_OUTCOME'],
 ['zero selected',p=>{p.selected_count=0;p.passed_count=0;},'R3_PRODUCER_OUTCOME'],
 ['skipped cases',p=>{p.skipped_count=1;},'R3_PRODUCER_OUTCOME'],
 ['unknown case',p=>{p.case_ids=['caller-chosen'];},'R3_CASE_INVENTORY'],
 ['missing case',p=>{p.case_ids=[];},'R3_CASE_INVENTORY'],
 ['wrong environment',p=>{p.identity.environment_id='wrong';},'R3_PRODUCER_IDENTITY'],
 ['wrong client launch inventory',p=>{p.client_inventory_sha256='f'.repeat(64);},'R3_PRODUCER_IDENTITY'],
 ['unknown receipt field',p=>{p.passed=true;},'R3_PRODUCER_SCHEMA'],
])test('rejects producer '+name,()=>{const f=prerequisiteFixture();rewriteProducer(f,0,change);rejected(f,code);});
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
test('matching attacker-controlled comparison context never establishes authenticity or acceptance',()=>{
 const f=prerequisiteFixture();f.options.fixtureMode=false;
 for(let i=0;i<f.input.producers.length;i++)rewriteProducer(f,i,p=>{p.provenance='recorded';});
 const r=implementation.validateR3Prerequisites(f.input,f.options);
 assert.equal(r.structurally_valid,true);assert.equal(r.acceptance_eligible,false);assert.equal(r.scope,'prerequisite-only');
 assert.ok(r.incomplete_policy.includes('runtime-origin-inspection'));assert.ok(r.incomplete_policy.includes('prior-round-acceptance'));
});
test('null options fails closed rather than throwing',()=>{
 const f=prerequisiteFixture();let r;assert.doesNotThrow(()=>{r=implementation.validateR3Prerequisites(f.input,null);});
 assert.equal(r.structurally_valid,false);assert.equal(r.acceptance_eligible,false);
});
test('whole batch budget rejection occurs before any byte read',()=>{
 const f=prerequisiteFixture();let reads=0;
 class TrackingMap extends Map{get(key){reads++;return super.get(key);}}
 f.options.files=new TrackingMap(f.files);f.input.producers.at(-1).artifact.byte_size=65537;
 rejected(f,'R3_BUDGET');assert.equal(reads,0);
});
test('fixture mode refuses disk access',()=>{
 const f=prerequisiteFixture();delete f.options.files;f.options.root='/nonexistent';rejected(f,'R3_FIXTURE_MODE');
});
test('realpath guard rejects symlinked producer artifact',()=>{
 const f=prerequisiteFixture();f.options.fixtureMode=false;
 for(let i=0;i<f.input.producers.length;i++)rewriteProducer(f,i,p=>{p.provenance='recorded';});
 const root=mkdtempSync(join(tmpdir(),'r3-prerequisite-disk-'));
 try{
  for(const [path,bytes]of f.files){const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);}
  const ref=f.input.producers[0].artifact;const original=join(root,ref.path);const alternate=join(root,'same-bytes.json');
  writeFileSync(alternate,f.files.get(ref.path));rmSync(original);symlinkSync(alternate,original);
  delete f.options.files;f.options.root=root;rejected(f,'R3_PATH');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('nonstring Map keys fail closed before inventory traversal throws',()=>{
 const f=prerequisiteFixture();f.files.set(1,'x');assert.doesNotThrow(()=>rejected(f,'R3_SOURCE_INVENTORY'));
});
test('oversized supplied Map is rejected before key iteration or byte reads',()=>{
 const f=prerequisiteFixture();let keys=0,reads=0;
 class BoundedMap extends Map{keys(){keys++;return super.keys();}get(key){reads++;return super.get(key);}}
 const map=new BoundedMap(f.files);for(let i=0;i<2305;i++)map.set('validation/releases/synthetic_r3/extra-'+i,'');
 f.options.files=map;rejected(f,'R3_BUDGET');assert.equal(keys,0);assert.equal(reads,0);
});
