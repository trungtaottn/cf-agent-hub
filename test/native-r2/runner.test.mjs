import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const run=args=>spawnSync(process.execPath,['scripts/test-native-r2.mjs',...args],{encoding:'utf8',timeout:5000,env:{}});
for(const args of [[],['--config'],['--config','relative.json'],['--config','/not-present/config.json','--execute'],['--config','/not-present/config.json','--config','/second.json']])test('strict dedicated config flags '+JSON.stringify(args),()=>{const r=run(args);assert.equal(r.status,2);assert.equal(r.stdout,'');assert.equal(r.stderr,'Native conformance input rejected; no request sent.\n');});
test('missing config error does not echo private path or system error',()=>{const r=run(['--config','/private-sensitive-place/config.json']);assert.equal(r.status,2);assert.equal(r.stdout,'');assert.equal(r.stderr,'Native conformance input rejected; no request sent.\n');});
