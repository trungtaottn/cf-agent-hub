/** Build-time consistency only. Inputs in the fixed CLI come directly from the builder. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
export async function checkCompleteBuildPair(first,second){
 for(const artifact of [first,second]){
  assert.ok(Buffer.isBuffer(artifact.bytes)&&artifact.bytes.length>0&&artifact.bytes.length<=4194304);
  assert.equal(hash(artifact.bytes),artifact.sha256);
  assert.ok(Array.isArray(artifact.inventory)&&artifact.inventory.length<=2048);
  const encoded=canonical(artifact.inventory);
  assert.ok(Buffer.byteLength(encoded)<=4194304);
  assert.equal(hash(encoded),artifact.inventorySha256);
 }
 assert.ok(first.bytes.equals(second.bytes));
 assert.deepEqual(first.inventory,second.inventory);
 const mod=await import('data:text/javascript;base64,'+first.bytes.toString('base64'));
 assert.deepEqual(Object.keys(mod).sort(),['COMPLETE_HOST_BUNDLE_VERSION','COMPLETE_HOST_SOURCE_INVENTORY','executeFixedCompleteHost']);
 assert.equal(mod.COMPLETE_HOST_BUNDLE_VERSION,1);
 assert.equal(typeof mod.executeFixedCompleteHost,'function');
 assert.equal(mod.executeFixedCompleteHost.name,'executeFixedCompleteHost');
 assert.deepEqual(mod.COMPLETE_HOST_SOURCE_INVENTORY,first.inventory);
 assert.ok(Object.isFrozen(mod.COMPLETE_HOST_SOURCE_INVENTORY));
 for(const row of mod.COMPLETE_HOST_SOURCE_INVENTORY)assert.ok(Object.isFrozen(row));
 return Object.freeze({status:'built-and-imported-not-executed',bytes:first.bytes.length,sha256:first.sha256,inventoryRows:first.inventory.length,inventorySha256:first.inventorySha256,repeatedBuildEqual:true,executorInvoked:false});
}
