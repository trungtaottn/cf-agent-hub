import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {ingressFixture} from '../helpers/task-ingress';
import type {Workspace} from '../../src/http/dto';

it('workspace discovery reports the current agent-read grant used by message composition without granting access',async()=>{
 const f=await ingressFixture('message-composition-capabilities');
 const discover=async()=>{const raw=f.req('','GET',undefined,'read',undefined,true);const response=await f.stub.fetch(new Request(raw.url.replace(/\/$/,''),raw));expect(response.status).toBe(200);return (await response.json() as {data:Workspace}).data.effective_scopes;};
 expect(await discover()).not.toContain('agents:read');
 expect((await f.send('agents','GET',undefined,'read',undefined,true)).status).toBe(403);
 // Only this isolated test principal receives the existing scope; route authorization is unchanged.
 await runInDurableObject(f.stub,(_o,state)=>state.storage.sql.exec('UPDATE human_grants SET scopes_json=? WHERE principal_id=?',JSON.stringify(['workspace:read','messages:read','messages:send','agents:read']),'human_operator'));
 const allowed=await f.send('agents','GET',undefined,'read',undefined,true);expect(allowed.status).toBe(200);await allowed.arrayBuffer();
 expect(await discover()).toEqual(['agents:read','messages:read','messages:send','workspace:read']);
 await runInDurableObject(f.stub,(_o,state)=>state.storage.sql.exec('UPDATE human_grants SET scopes_json=? WHERE principal_id=?',JSON.stringify(['workspace:read','messages:read','messages:send']),'human_operator'));
 expect(await discover()).toEqual(['messages:read','messages:send','workspace:read']);
 expect((await f.send('agents','GET',undefined,'read',undefined,true)).status).toBe(403);
});
