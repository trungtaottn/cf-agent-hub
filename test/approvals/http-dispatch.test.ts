import worker from '../../src/index';
import {env} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture,claimSetup,proposal} from '../helpers/decision-policy';
import {human} from '../helpers/settings';
import {sha256} from '../../src/config/bootstrap';
import {claimContext,PROOF_A} from '../helpers/claims';
import {claimTaskCommand} from '../../src/tasks/claim';
import {executeCommand} from '../../src/workspace/commands';
const origin='https://hub.example.invalid',base=origin+'/v2/workspaces/ws_example/';
it('actual WorkspaceDO dispatch authenticates approval reads and keeps write successors unavailable',async()=>{
 const f=await decisionFixture('decision_do_reads'),token='A'.repeat(43);
 await runInDurableObject(f.stub,async(_o,s)=>{human(s.storage);s.storage.sql.exec('UPDATE sessions SET token_digest=?',await sha256(token));});
 expect((await f.stub.fetch(new Request(base+'approvals/missing'))).status).toBe(401);
 const headers={cookie:'cfhub_session='+token,origin};
 expect((await f.stub.fetch(new Request(base+'approvals/missing',{headers}))).status).toBe(404);
 expect((await f.stub.fetch(new Request(base+'approvals',{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET'}}))).status).toBe(204);
 expect((await f.stub.fetch(new Request(base.replace('ws_example','foreign')+'approvals/missing',{headers}))).status).toBe(401);
 expect((await f.stub.fetch(new Request(base+'approvals/missing:approve',{method:'POST',headers}))).status).toBe(404);
});
it('actual WorkspaceDO request route retains empty production registry and unchanged SQL',async()=>{
 const f=await decisionFixture('decision_do_request'),token='B'.repeat(42)+'A',proof='C'.repeat(42)+'A';
 const before=await runInDurableObject(f.stub,async(_o,s)=>{
  const c=claimSetup(s.storage),ctx=await claimContext(s.storage,f.name,c.body,'claim',c.now);executeCommand(ctx,c.identity,claimTaskCommand('task_a','run_a',PROOF_A),c.body);
  s.storage.sql.exec('UPDATE native_credentials SET token_sha256=? WHERE credential_id=?',await sha256(token),'credential_research_1');s.storage.sql.exec('UPDATE runtimes SET proof_sha256=? WHERE id=?',await sha256(proof),'runtime_a');
  return snapshot(s.storage);
 });
 const request=new Request(base+'tasks/task_a:request-decision',{method:'POST',headers:{authorization:'Bearer '+token,'x-runtime-token':proof,'content-type':'application/json','idempotency-key':'request'},body:JSON.stringify({expected_version:3,run_id:'run_a',fence:1,checkpoint:{summary:'Synthetic checkpoint',artifact_ids:[]},proposal:proposal('a'.repeat(64))})});
 const result=await f.stub.fetch(request);expect(result.status).toBe(503);expect(await result.json()).toMatchObject({error:{code:'DEPENDENCY_UNAVAILABLE'}});
 expect(await runInDurableObject(f.stub,(_o,s)=>snapshot(s.storage))).toEqual(before);
});
function snapshot(storage:DurableObjectStorage){return Object.fromEntries(storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name").toArray().map(({name})=>[name,storage.sql.exec('SELECT * FROM "'+name+'"').toArray()]));}

it('public Worker entry forwards only configured decision routes to their bound WorkspaceDO',async()=>{
 const f=await decisionFixture('decision_public_entry');
 const configured={...env,DEPLOYMENT_CONFIG:JSON.stringify(f.raw.config)} as Env;
 expect((await worker.fetch(new Request(base+'approvals'),configured)).status).toBe(401);
 expect((await worker.fetch(new Request(base+'tasks/task_a:request-decision',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'public-entry'},body:JSON.stringify({expected_version:3,run_id:'run_a',fence:1,checkpoint:{summary:'Synthetic',artifact_ids:[]},proposal:proposal('a'.repeat(64))})}),configured)).status).toBe(401);
 expect((await worker.fetch(new Request(base.replace('ws_example','foreign')+'approvals'),configured)).status).toBe(401);
 expect((await worker.fetch(new Request(base+'approvals/missing:approve',{method:'POST'}),configured)).status).toBe(404);
});
