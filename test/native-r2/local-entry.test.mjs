import test from 'node:test';
import assert from 'node:assert/strict';
import * as runner from '../../scripts/test-native-r2.mjs';
import {readFileSync} from 'node:fs';
test('explicit local mode is a separate closed route',()=>{assert.equal(runner.nativeRunnerMode(['--local-sandbox']),'local-sandbox');assert.equal(runner.nativeRunnerMode(['--config','/private/config.json']),'protected-conformance');for(const args of [[],['--local-sandbox','--config','/private/config.json'],['--config','/private/config.json','--local-sandbox'],['--local-sandbox','--target','https://example.com'],['--local-sandbox','--adapter','module.mjs'],['--local-sandbox','--local-sandbox']])assert.throws(()=>runner.nativeRunnerMode(args));});
test('invalid local mode options do not start a host',async()=>{const out=await runner.nativeRunnerMain(['--local-sandbox','--execute']);assert.equal(out.exitCode,2);assert.equal(out.stdout,'');assert.match(out.stderr,/input rejected/);});
test('local entry is fixed lazy source import and default remains fail closed',()=>{const text=readFileSync(new URL('../../scripts/test-native-r2.mjs',import.meta.url),'utf8');assert.ok(text.includes("import('./lib/native-r2-local-host.mjs')"));assert.ok(text.includes('independently authorized target, observer and control integration is unavailable'));assert.equal(text.includes('import(args'),false);});
