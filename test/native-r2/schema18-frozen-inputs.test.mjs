import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import frozen from './fixtures/schema18-frozen-inputs.json' with {type:'json'};
test('all original16/17 SQL, descriptor, fixture, ledger and commitment bytes remain immutable',()=>{
 for(const [path,expected]of Object.entries(frozen.artifacts)){
  const bytes=readFileSync(new URL('../../'+path,import.meta.url));
  assert.equal(bytes.byteLength,expected.bytes,path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256,path);
 }
});
