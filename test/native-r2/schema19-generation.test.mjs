import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../..',import.meta.url));
function sandbox(){const dir=mkdtempSync(join(tmpdir(),'native19-generation-'));for(const path of ['scripts/lib','validation','workers/native-fixture','test/helpers/native-observer']){mkdirSync(join(dir,path,'..'),{recursive:true});cpSync(join(root,path),join(dir,path),{recursive:true});}cpSync(join(root,'scripts/generate-native-schema19.mjs'),join(dir,'scripts/generate-native-schema19.mjs'));symlinkSync(join(root,'node_modules'),join(dir,'node_modules'),'dir');return dir;}
function run(dir,check=true){return spawnSync(process.execPath,['scripts/generate-native-schema19.mjs',...(check?['--check']:[])],{cwd:dir,encoding:'utf8'});}
for(const path of ['workers/native-fixture/complete-selectors-schema19.json','workers/native-fixture/selected-state-schema19-profile.json','test/helpers/native-observer/descriptors-schema19.json','scripts/lib/native-complete-fixture-schema19.json','workers/native-fixture/required-schema19-commitments.json','workers/native-fixture/schema19-runtime-delta.json','workers/native-fixture/schema19-budget-evidence.json'])test('generator checks and repairs only exact current artifact '+path,()=>{
 const dir=sandbox();try{
  const original=readFileSync(join(dir,path));const frozenPaths=['workers/native-fixture/complete-selectors.json','scripts/lib/native-complete-fixture.json','test/helpers/native-observer/descriptors.json','workers/native-fixture/complete-selectors-schema17.json','scripts/lib/native-complete-fixture-schema17.json','test/helpers/native-observer/descriptors-schema17.json','workers/native-fixture/required-schema17-commitments.json','workers/native-fixture/selected-state-schema17-profile.json','workers/native-fixture/complete-selectors-schema18.json','scripts/lib/native-complete-fixture-schema18.json','test/helpers/native-observer/descriptors-schema18.json','workers/native-fixture/required-schema18-commitments.json'];const frozen=frozenPaths.map(p=>readFileSync(join(dir,p)));
  const baseline=run(dir);assert.equal(baseline.status,0,baseline.stderr);const changed=JSON.parse(original);changed.profile='untrusted-current-profile';writeFileSync(join(dir,path),JSON.stringify(changed,null,2)+'\n');
  assert.notEqual(run(dir).status,0,'check must reject stale current artifact');assert.equal(run(dir,false).status,0);assert.deepEqual(readFileSync(join(dir,path)),original);assert.equal(run(dir).status,0);
  frozenPaths.forEach((p,i)=>assert.deepEqual(readFileSync(join(dir,p)),frozen[i]));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

for(const input of ['workers/native-fixture/complete-selectors-schema18.json','test/helpers/native-observer/descriptors-schema18.json','scripts/lib/native-complete-fixture-schema18.json'])test('generator refuses changed original18 bytes before writing any additive artifact: '+input,()=>{
 const dir=sandbox();try{
  const path=input,output='workers/native-fixture/complete-selectors-schema19.json',before=readFileSync(join(dir,output));
  writeFileSync(join(dir,path),Buffer.concat([readFileSync(join(dir,path)),Buffer.from(' ')]));
  const result=run(dir,false);assert.notEqual(result.status,0);assert.match(result.stderr,/FROZEN_NATIVE_INPUT_CHANGED/);assert.deepEqual(readFileSync(join(dir,output)),before);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
