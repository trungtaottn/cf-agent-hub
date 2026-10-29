import {describe,it,expect} from 'vitest';
import {env,exports} from 'cloudflare:workers';
import {evictDurableObject,listDurableObjectIds} from 'cloudflare:test';
const identity={workspace_id:'ws_example',environment_id:'runtime_test',object_name:'provider_runtime'};
const input={...identity,operation_id:'bootstrap_runtime',expected:null,next:{authority_epoch:1,ledger_sha256:'a'.repeat(64)}};
const bindings=env as unknown as {ANCHORS:DurableObjectNamespace;TEST_BOOTSTRAP:{create(input:unknown):Promise<{anchor:unknown}>};TEST_WRITER:{publish(input:unknown):Promise<{anchor:unknown}>}};
const read=()=>exports.default.fetch(new Request('https://recovery-anchor.invalid/current',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(identity)}));
describe('actual independent provider SQLite durability',()=>{
 it('retains tuple and exact operation receipt after actual eviction without bootstrapping reads',async()=>{
  expect((await read()).status).not.toBe(200);
  const first=await bindings.TEST_BOOTSTRAP.create(input);
  const ids=await listDurableObjectIds(bindings.ANCHORS);expect(ids).toHaveLength(1);
  await evictDurableObject(bindings.ANCHORS.get(ids[0]));
  expect(await (await read()).json()).toEqual(first.anchor);
  expect(await bindings.TEST_BOOTSTRAP.create(input)).toEqual(first);
  let rejected=false;try{await bindings.TEST_BOOTSTRAP.create({...input,operation_id:'not_a_reset'});}catch{rejected=true;}expect(rejected).toBe(true);
  const second=await bindings.TEST_WRITER.publish({...input,operation_id:'rotation_runtime',expected:{authority_epoch:1,ledger_sha256:'a'.repeat(64),generation:1},next:{authority_epoch:2,ledger_sha256:'b'.repeat(64)}});
  await evictDurableObject(bindings.ANCHORS.get(ids[0]));
  expect(await (await read()).json()).toEqual(second.anchor);
  expect(second.anchor).toMatchObject({generation:2,authority_epoch:2});
 });
 it('rejects malformed, oversized and read-facade mutation requests',async()=>{
  for(const [path,body] of [['/publish',JSON.stringify(input)],['/current',JSON.stringify({...identity,expected:input.next})],['/current',JSON.stringify({...identity,environment_id:'foreign'})],['/current',' '.repeat(4097)],['/current','{"workspace_id":']]){
   const response=await exports.default.fetch(new Request('https://recovery-anchor.invalid'+path,{method:'POST',headers:{'content-type':'application/json'},body}));expect(response.status).not.toBe(200);
  }
 });
});
