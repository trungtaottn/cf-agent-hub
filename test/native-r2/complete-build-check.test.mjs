import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkCompleteBuildPair} from '../../scripts/lib/native-complete-build-check.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(extra='') {
 const bytes=Buffer.from(`export const COMPLETE_HOST_BUNDLE_VERSION=1;export const COMPLETE_HOST_SOURCE_INVENTORY=Object.freeze([]);export function executeFixedCompleteHost(){throw Error('EXECUTOR_MUST_NOT_RUN');}${extra}`);
 return {bytes,sha256:hash(bytes),inventory:[],inventorySha256:hash('[]'),sourceBytes:0};
}
test('imports identical artifact without calling executor',async()=>{const a=fixture();assert.equal((await checkCompleteBuildPair(a,a)).executorInvoked,false);});
test('rejects unequal builds before import',async()=>{const a=fixture(),b=fixture('export const extra=1;');await assert.rejects(checkCompleteBuildPair(a,b));});
test('rejects wrong digest before import',async()=>{const a=fixture();a.sha256='0'.repeat(64);await assert.rejects(checkCompleteBuildPair(a,a));});
test('rejects inventory commitment mismatch',async()=>{const a=fixture();a.inventorySha256='0'.repeat(64);await assert.rejects(checkCompleteBuildPair(a,a));});
test('rejects unexpected exports',async()=>{const a=fixture('export const extra=1;');await assert.rejects(checkCompleteBuildPair(a,a));});
test('rejects oversized artifact before import',async()=>{const a=fixture();a.bytes=Buffer.alloc(4194305);a.sha256=hash(a.bytes);await assert.rejects(checkCompleteBuildPair(a,a));});
function replaceSource(artifact,from,to){artifact.bytes=Buffer.from(artifact.bytes.toString().replace(from,to));artifact.sha256=hash(artifact.bytes);return artifact;}
test('rejects embedded inventory different from committed inventory',async()=>{const a=replaceSource(fixture(),'Object.freeze([])','Object.freeze([Object.freeze({path:"different"})])');await assert.rejects(checkCompleteBuildPair(a,a));});
test('rejects unsupported embedded version',async()=>{const a=replaceSource(fixture(),'BUNDLE_VERSION=1','BUNDLE_VERSION=2');await assert.rejects(checkCompleteBuildPair(a,a));});
test('rejects mutable embedded inventory',async()=>{const a=replaceSource(fixture(),'Object.freeze([])','[]');await assert.rejects(checkCompleteBuildPair(a,a));});
