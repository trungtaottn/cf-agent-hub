import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import entry from '../../src/index';
import {claimFixture,claimSetup,claimSnapshot} from '../helpers/claims';
it('public_claim_and_run_routes_remain_unavailable_without_any_ownership_mutation',async()=>{
 const {stub,raw}=await claimFixture('claim-exposure');
 await runInDurableObject(stub,(_o,state)=>claimSetup(state.storage));
 const before=await runInDurableObject(stub,(_o,state)=>claimSnapshot(state.storage));
 const seen:string[]=[];
 const bindings={...env,DEPLOYMENT_CONFIG:JSON.stringify(raw.config),WORKSPACE:{getByName(name:string){seen.push(name);return stub;}}} as unknown as Env;
 for(const [path,method,body] of [
  ['tasks/task_a:claim','POST',{expected_version:2,runtime_instance_id:'runtime_a'}],
  ['runs/run_a:heartbeat','POST',{expected_run_version:1,fence:1}],
  ['runs/run_a','GET',undefined],
  ['tasks/task_a:submit-result','POST',{}],
  ['tasks/task_a:cancel','POST',{}],
  ['tasks/task_a:requeue','POST',{}]
 ] as const){
  const request=()=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/'+path,{method,headers:{authorization:'Bearer '+'A'.repeat(43),'x-runtime-token':'B'.repeat(43),'content-type':'application/json','idempotency-key':'blocked'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const worker=await entry.fetch(request(),bindings);expect(worker.status).toBe(404);expect(await worker.json()).not.toHaveProperty('data');
  const direct=await stub.fetch(request());expect(direct.status).toBe(404);expect(await direct.json()).not.toHaveProperty('data');
 }
 expect(seen).toEqual([]);
 expect(await runInDurableObject(stub,(_o,state)=>claimSnapshot(state.storage))).toEqual(before);
});
