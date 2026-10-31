import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../..',import.meta.url));
function sandbox(){const dir=mkdtempSync(join(tmpdir(),'native17-generation-'));for(const path of ['scripts/lib','validation','workers/native-fixture','test/helpers/native-observer']){mkdirSync(join(dir,path,'..'),{recursive:true});cpSync(join(root,path),join(dir,path),{recursive:true});}cpSync(join(root,'scripts/generate-native-schema17.mjs'),join(dir,'scripts/generate-native-schema17.mjs'));symlinkSync(join(root,'node_modules'),join(dir,'node_modules'),'dir');return dir;}
function run(dir,check=true){return spawnSync(process.execPath,['scripts/generate-native-schema17.mjs',...(check?['--check']:[])],{cwd:dir,encoding:'utf8'});}
for(const path of ['scripts/lib/native-complete-fixture-schema17.json','workers/native-fixture/required-schema17-commitments.json'])test('generator checks and repairs only exact current artifact '+path,()=>{
 const dir=sandbox();try{
  const original=readFileSync(join(dir,path));const frozenPaths=['workers/native-fixture/complete-selectors.json','scripts/lib/native-complete-fixture.json','test/helpers/native-observer/descriptors.json'];const frozen=frozenPaths.map(p=>readFileSync(join(dir,p)));
  const baseline=run(dir);assert.equal(baseline.status,0,baseline.stderr);const changed=JSON.parse(original);changed.profile='untrusted-current-profile';writeFileSync(join(dir,path),JSON.stringify(changed,null,2)+'\n');
  assert.notEqual(run(dir).status,0,'check must reject stale current artifact');assert.equal(run(dir,false).status,0);assert.deepEqual(readFileSync(join(dir,path)),original);assert.equal(run(dir).status,0);
  frozenPaths.forEach((p,i)=>assert.deepEqual(readFileSync(join(dir,p)),frozen[i]));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
