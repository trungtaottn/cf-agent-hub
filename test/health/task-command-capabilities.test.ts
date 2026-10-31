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

it.each([true,false])('artifact write discovery intersects the current grant without authorizing absent writes (human=%s)',async human=>{
 const f=await ingressFixture('artifact-display-grant-'+human);
 const get=async()=>{const request=f.req('','GET',undefined,'read',undefined,human);const response=await f.stub.fetch(new Request(request.url.replace(/\/$/,''),request));expect(response.status).toBe(200);return (await response.json() as {data:Workspace}).data;};
 expect((await get()).effective_scopes).not.toContain('artifacts:write');
 const set=async(granted:boolean)=>runInDurableObject(f.stub,(_o,s)=>{const scopes=JSON.stringify(['workspace:read',...(granted?['artifacts:write']:[])]);if(human)s.storage.sql.exec('UPDATE human_grants SET scopes_json=? WHERE principal_id=?',scopes,'human_operator');else s.storage.sql.exec('UPDATE native_credentials SET scopes_json=?',scopes);});
 await set(true);expect((await get()).effective_scopes).toEqual(['artifacts:write','workspace:read']);
 await set(false);expect((await get()).effective_scopes).toEqual(['workspace:read']);
 const before=await runInDurableObject(f.stub,(_o,s)=>s.storage.sql.exec('SELECT (SELECT count(*) FROM artifacts) AS artifacts,(SELECT count(*) FROM events) AS events,(SELECT count(*) FROM idempotency_outcomes) AS outcomes').one());
 const denied=await f.send('artifacts','POST',{task_id:null,run_id:null,filename:'denied.txt',media_type:'text/plain',byte_size:1,sha256:'a'.repeat(64)},'revoked-artifact-write',undefined,human);
 // Native artifact writes require a run proof before scope authorization; this fixture has none.
 expect(denied.status).toBe(human?403:401);
 expect(await denied.json()).toMatchObject({error:{code:human?'FORBIDDEN':'UNAUTHENTICATED'}});
 expect(await runInDurableObject(f.stub,(_o,s)=>s.storage.sql.exec('SELECT (SELECT count(*) FROM artifacts) AS artifacts,(SELECT count(*) FROM events) AS events,(SELECT count(*) FROM idempotency_outcomes) AS outcomes').one())).toEqual(before);
});
