import {identityFixture as settingsFixture} from '../helpers/identity';
import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {human} from '../helpers/settings';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {listAgents,listCredentials} from '../../src/agents/reads';
import {createCursorCodec,type CursorBinding} from '../../src/http/cursors';
const binding=(operation:'agents'|'credentials'):CursorBinding=>({workspaceId:'ws_example',principalId:'human_operator',lane:'human',credentialId:null,sessionId:'session_settings',operation,queryHash:'a'.repeat(64)});
it('identity_pages_are_bounded_seek_pages_and_archive_retains_attribution',async()=>{
 const {stub}=await settingsFixture('identity-read-pages');
 await runInDurableObject(stub,(_o,state)=>{
  const id=human(state.storage);state.storage.sql.exec(`UPDATE human_grants SET scopes_json='["agents:read","credentials:manage","messages:read"]'`);
  state.storage.sql.exec("UPDATE static_agents SET created_at=1");
  for(const [key,status]of [['agent_b','active'],['agent_c','archived']])state.storage.sql.exec('INSERT INTO static_agents(agent_id,workspace_id,display_name,config_epoch,created_at,updated_at,status) VALUES(?,?,?,?,?,?,?)',key,'ws_example',key,1,2,2,status);
  withTransaction(state.storage,tx=>{
   const actor=resolveActor(tx,id,Date.now()),options={limit:1,nowMs:Date.now(),binding:binding('agents')};
   const first=listAgents(tx,actor,options);expect(first.items.map(x=>x.id)).toEqual(['agent_research']);expect(first.hasMore).toBe(true);
   const second=listAgents(tx,actor,{...options,cursor:first.next!});expect(second.items.map(x=>x.id)).toEqual(['agent_b']);
   const third=listAgents(tx,actor,{...options,cursor:second.next!});expect(third.items[0].status).toBe('archived');expect(third.next).toBeNull();
   expect(()=>listAgents(tx,actor,{...options,limit:201})).toThrow();
   tx.exec("UPDATE human_grants SET project_ids_json='[]'");expect(()=>listAgents(tx,actor,options)).toThrowError(expect.objectContaining({status:403}));
  });
 });
});
it('credential_pages_hide_complete_out_of_ceiling_rows_and_hidden_suffix',async()=>{
 const {stub}=await settingsFixture('identity-read-credentials');
 await runInDurableObject(stub,(_o,state)=>{
  const id=human(state.storage);state.storage.sql.exec(`UPDATE human_grants SET scopes_json='["credentials:manage","messages:read"]', project_ids_json='["project_a"]'`);
  state.storage.sql.exec("UPDATE native_credentials SET scopes_json='[\"messages:read\"]',project_ids_json='[\"project_a\"]',created_at=1");
  state.storage.sql.exec(`INSERT INTO native_credentials(credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,created_at) VALUES('hidden_credential','ws_example','agent_research',?,'["messages:read"]','null',9999999999999,1,1,2)`,'c'.repeat(64));
  withTransaction(state.storage,tx=>{
   const actor=resolveActor(tx,id,Date.now()),page=listCredentials(tx,actor,{limit:1,nowMs:Date.now(),binding:binding('credentials')});
   expect(page.items.map(x=>x.id)).toEqual(['credential_research_1']);expect(page.next).toBeNull();expect(page.hasMore).toBe(false);expect(JSON.stringify(page)).not.toContain('token_sha256');
   tx.exec(`UPDATE human_grants SET project_ids_json='[]'`);expect(listCredentials(tx,actor,{limit:1,nowMs:Date.now(),binding:binding('credentials')}).items).toEqual([]);
  });
 });
});
it('identity_cursor_is_closed_bound_and_expiring',async()=>{
 const codec=createCursorCodec('f'.repeat(64),{bytes:n=>new Uint8Array(n).fill(3)}),b=binding('agents');
 const payload={version:1 as const,binding:b,highWater:{createdAt:2,id:'agent_c'},lastScanned:{createdAt:1,id:'agent_a'},expiresAt:1000};
 const token=await codec.encodeCursor(payload);expect(await codec.decodeCursor(token,b,999)).toEqual(payload);
 await expect(codec.decodeCursor(token,{...b,operation:'credentials'},999)).rejects.toThrow();
 await expect(codec.decodeCursor(token,b,1000)).rejects.toThrowError(expect.objectContaining({status:410}));
});

import {owned} from '../helpers/settings';
import {sha256} from '../../src/config/bootstrap';
import {dispatchIdentityRead} from '../../src/http/identity-read-routes';
it('http_identity_reads_bind_cursor_to_query_epoch_and_session_and_deny_after_await',async()=>{
 const {stub,name}=await settingsFixture('identity-http-read');
 await runInDurableObject(stub,async(_o,state)=>{
  human(state.storage);const token='A'.repeat(43),digest=await sha256(token);
  state.storage.sql.exec('UPDATE sessions SET token_digest=?',digest);
  state.storage.sql.exec(`UPDATE human_grants SET scopes_json='["agents:read","credentials:manage","messages:read"]'`);
  state.storage.sql.exec("UPDATE static_agents SET created_at=1");
  state.storage.sql.exec("INSERT INTO static_agents(agent_id,workspace_id,display_name,config_epoch,created_at,updated_at) VALUES('agent_second','ws_example','Second',1,2,2)");
  const workspace={...owned(state.storage,name),secrets:{CURSOR_ENCRYPTION_KEY:'f'.repeat(64)}};
  const req=(query='')=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/agents'+query,{headers:{cookie:'cfhub_session='+token}});
  const result=await dispatchIdentityRead(req('?limit=1'),workspace,{operation:'agents',agentId:null});expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toBe('no-store');
  const first=await result.json() as {data:{id:string}[];page:{next_cursor:string;has_more:boolean}};expect(first.page.has_more).toBe(true);expect(first.data[0].id).toBe('agent_research');
  expect(first.page.next_cursor).not.toContain('agent_research');
  const next='?limit=1&cursor='+first.page.next_cursor;
  expect((await dispatchIdentityRead(req(next.replace('limit=1','limit=2')),workspace,{operation:'agents',agentId:null})).status).toBe(400);
  expect((await dispatchIdentityRead(req('?cursor='+'a'.repeat(2049)),workspace,{operation:'agents',agentId:null})).status).toBe(400);
  expect((await dispatchIdentityRead(req(next),workspace,{operation:'agents',agentId:null})).status).toBe(200);
  // Cursor nonce generation occurs after the first read, before encryption awaits.
  const revoked={...workspace,entropy:{bytes:(n:number)=>{state.storage.sql.exec('UPDATE sessions SET revoked_at=1');return crypto.getRandomValues(new Uint8Array(n));}}};
  expect((await dispatchIdentityRead(req('?limit=1'),revoked,{operation:'agents',agentId:null})).status).toBe(401);
  expect((await dispatchIdentityRead(req(next),workspace,{operation:'agents',agentId:null})).status).toBe(401);
 });
});
