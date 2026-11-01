import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('adapter standalone required source step runs build types and actual suite without weakening gates',()=>{
 const workflow=read('.github/workflows/ci.yml'),source=workflow.match(/^  source:\n([\s\S]*?)(?=^  native-source:)/m)?.[1];assert.ok(source);
 assert.match(source,/run: npm run check\n/);assert.match(source,/run: node --test test\/governance\/observation-adapter-ci.test.mjs/);assert.match(source,/run: node scripts\/check-observation-adapter.mjs/);assert.doesNotMatch(source,/continue-on-error|\bif:/);
 const driver=read('scripts/check-observation-adapter.mjs');for(const value of ['scripts/build-observation-adapter.mjs','node_modules/typescript/bin/tsc','tsconfig.observation-adapter.json','node_modules/vitest/vitest.mjs','vitest.observation-adapter.config.ts'])assert.ok(driver.includes(value));assert.match(driver,/process\.execPath/);assert.match(driver,/result\.status!==0/);assert.doesNotMatch(driver,/skip|continueOnError|npm install|chmod|chown/);
});
