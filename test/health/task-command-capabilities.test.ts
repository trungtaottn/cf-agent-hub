import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {ingressFixture} from '../helpers/task-ingress';
import type {Workspace} from '../../src/http/dto';
const grants=['tasks:schedule','tasks:cancel','tasks:review'] as const;
it.each([true,false])('workspace projection reports only existing current task command grants (human=%s)',async human=>{
 const f=await ingressFixture('task-command-grants-'+human,false,true);
 const get=async()=>{const request=f.req('','GET',undefined,'read',undefined,human);const response=await f.stub.fetch(new Request(request.url.replace(/\/$/,''),request));expect(response.status).toBe(200);return (await response.json() as {data:Workspace}).data;};
 const initial=await get();expect(initial.actor.kind).toBe(human?'human':'agent');expect(initial.effective_scopes).toContain('tasks:cancel');expect(initial.effective_scopes).toContain('tasks:review');
 if(human){expect(initial.effective_scopes).toContain('tasks:schedule');expect(initial.effective_scopes).toContain('tasks:create');}else{expect(initial.effective_scopes).not.toContain('tasks:schedule');expect(initial.effective_scopes).not.toContain('tasks:create');}
 for(const excluded of ['tasks:execute','tasks:claim','approvals:decide'])expect(initial.effective_scopes).not.toContain(excluded);
 for(const grant of grants){
  await runInDurableObject(f.stub,(_o,s)=>{const scopes=JSON.stringify(['workspace:read',grant]);if(human)s.storage.sql.exec('UPDATE human_grants SET scopes_json=? WHERE principal_id=?',scopes,'human_operator');else s.storage.sql.exec('UPDATE native_credentials SET scopes_json=?',scopes);});
  expect((await get()).effective_scopes).toEqual([grant,'workspace:read']);
 }
 await runInDurableObject(f.stub,(_o,s)=>{if(human)s.storage.sql.exec('UPDATE human_grants SET scopes_json=? WHERE principal_id=?','["workspace:read"]','human_operator');else s.storage.sql.exec('UPDATE native_credentials SET scopes_json=?','["workspace:read"]');});
 expect((await get()).effective_scopes).toEqual(['workspace:read']);
});
