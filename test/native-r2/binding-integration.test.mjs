import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../scripts/lib/native-r2-controller.mjs',import.meta.url),'utf8');
// Source wiring checks only: protected executable positives remain separately gated.
test('binding registry is mandatory, privately owned and not an adapter supplied bypass',()=>{
 assert.match(source,/import \{createNativeBindingRegistry\} from '\.\/native-r2-bindings\.mjs'/);
 const create=source.indexOf('const bindings=createNativeBindingRegistry('),loop=source.indexOf('for(let i=0;i<scenario.steps.length;i++)');
 assert.ok(create>=0&&create<loop);
 assert.ok(!source.includes('adapter.bindings'));
 assert.match(source,/workspaceId:config\.workspaces\.primary/);
});
test('control advances bindings only after generic and optional typed control observations',()=>{
 const prepare=source.indexOf('bindings.prepare(step.id)'),effect=source.indexOf('adapter.control('),typed=source.indexOf('recorder.captureAcknowledgedDisable('),commit=source.indexOf('bindings.completeControl(');
 assert.ok(prepare>=0&&prepare<effect&&effect<typed&&typed<commit);
 assert.ok(commit<source.indexOf('completed.push(step.id);continue;'));
});
test('source refs checked before child dispatch and output committed after observers',()=>{
 const prepare=source.indexOf('bindings.prepare(step.id,refs)'),spawn=source.indexOf('await runOwnedProcess('),observe=source.indexOf('adapter.observe('),typed=source.indexOf('recorder.finish(caseToken,'),commit=source.indexOf('bindings.completeProcess(');
 assert.ok(prepare>=0&&prepare<spawn&&spawn<observe&&observe<typed&&typed<commit);
 assert.ok(source.slice(commit).includes('stdout:capture.stdout,stderr:capture.stderr,custody:capture.custody'));
});
test('binding summary remains protected and never upgrades issue48 completion',()=>{
 assert.match(source,/Object\.defineProperty\(result,'readProtectedBindings'/);
 assert.match(source,/value:\(\)=>bindings\.readSummary\(\)/);
 assert.ok(!source.includes('issue48Complete:true'));
});

test('owned capture is detached before awaited host observation',()=>{
 const capture=source.indexOf('const ownedCapture=processResult.readCapturedOutput()'),snapshot=source.indexOf('custody:structuredClone(ownedCapture.custody)'),observe=source.indexOf('adapter.observe(');
 assert.ok(capture>=0&&capture<snapshot&&snapshot<observe);
});
