import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import entry from '../../src/index';
import {decisionFixture,claimSetup} from '../helpers/decision-policy';
import {claimContext,PROOF_A} from '../helpers/claims';
import {claimTaskCommand} from '../../src/tasks/claim';
import {executeCommand} from '../../src/workspace/commands';
import {sha256} from '../../src/config/bootstrap';
import {decisionRequest,decisionError,decisionEffects} from '../helpers/decision-boundary';
it('registered decision request authenticates real owner but empty production registry cannot admit effects',async()=>{
 const {stub,raw,name}=await decisionFixture('claim-exposure'),token='A'.repeat(43),proof='B'.repeat(42)+'A';
 await runInDurableObject(stub,async(_o,state)=>{
  const c=claimSetup(state.storage),ctx=await claimContext(state.storage,name,c.body,'claim',c.now);executeCommand(ctx,c.identity,claimTaskCommand('task_a','run_boundary',PROOF_A),c.body);
  state.storage.sql.exec("UPDATE native_credentials SET token_sha256=? WHERE credential_id='credential_research_1'",await sha256(token));state.storage.sql.exec("UPDATE runtimes SET proof_sha256=? WHERE id='runtime_a'",await sha256(proof));
 });
 const before=await runInDurableObject(stub,(_o,state)=>decisionEffects(state.storage)),seen:string[]=[];
 const bindings={...env,DEPLOYMENT_CONFIG:JSON.stringify(raw.config),WORKSPACE:{getByName(name:string){seen.push(name);return stub;}}} as unknown as Env;
 const request=()=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/tasks/task_a:request-decision',{method:'POST',headers:{authorization:'Bearer '+token,'x-runtime-token':proof,'content-type':'application/json','idempotency-key':'blocked'},body:JSON.stringify(decisionRequest('task_a',3,'run_boundary'))});
 await decisionError(await entry.fetch(request(),bindings),503,'DEPENDENCY_UNAVAILABLE');await decisionError(await stub.fetch(request()),503,'DEPENDENCY_UNAVAILABLE');expect(seen).toEqual([name]);
 const unknown=()=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/teams',{method:'POST'});await decisionError(await entry.fetch(unknown(),bindings),404,'NOT_FOUND');await decisionError(await stub.fetch(unknown()),404,'NOT_FOUND');expect(seen).toEqual([name]);
 expect(await runInDurableObject(stub,(_o,state)=>decisionEffects(state.storage))).toEqual(before);
});
