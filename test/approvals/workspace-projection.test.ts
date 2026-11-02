import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {decisionFixture} from '../helpers/decision-policy';
import {human} from '../helpers/settings';
import {sha256} from '../../src/config/bootstrap';
const url='https://hub.example.invalid/v2/workspaces/ws_example';
it('actual WorkspaceDO advertises current human approval read and decide grants and removes both on revocation',async()=>{
 const f=await decisionFixture('approval_workspace_human',null),token='D'.repeat(42)+'A';
 await runInDurableObject(f.stub,async(_o,s)=>{human(s.storage);s.storage.sql.exec('UPDATE sessions SET token_digest=?',await sha256(token));});
 const read=()=>f.stub.fetch(new Request(url,{headers:{cookie:'cfhub_session='+token}}));
 const response=await read();expect(response.status).toBe(200);
 const body=await response.json() as {data:{effective_scopes:string[]}};
 expect(body.data.effective_scopes).toContain('approvals:read');
 expect(body.data.effective_scopes).toContain('approvals:decide');
 await runInDurableObject(f.stub,(_o,s)=>{s.storage.sql.exec("UPDATE human_grants SET scopes_json=? WHERE principal_id='human_operator'",JSON.stringify(['workspace:read','tasks:read']));});
 const revoked=await read();expect(revoked.status).toBe(200);
 const revokedScopes=(await revoked.json() as typeof body).data.effective_scopes;expect(revokedScopes).not.toContain('approvals:read');expect(revokedScopes).not.toContain('approvals:decide');
});
it('actual native workspace projection never advertises human approval capabilities',async()=>{
 const f=await decisionFixture('approval_workspace_native',null),token='E'.repeat(42)+'A';
 await runInDurableObject(f.stub,async(_o,s)=>{s.storage.sql.exec("UPDATE native_credentials SET token_sha256=? WHERE credential_id='credential_research_1'",await sha256(token));});
 const response=await f.stub.fetch(new Request(url,{headers:{authorization:'Bearer '+token}}));expect(response.status).toBe(200);
 const body=await response.json() as {data:{actor:{kind:string};effective_scopes:string[]}};
 expect(body.data.actor.kind).toBe('agent');
 expect(body.data.effective_scopes).not.toContain('approvals:read');expect(body.data.effective_scopes).not.toContain('approvals:decide');
});

it('current read-only human never receives a decide display capability',async()=>{
 const f=await decisionFixture('approval_workspace_read_only',null),token='F'.repeat(42)+'A';
 await runInDurableObject(f.stub,async(_o,s)=>{human(s.storage);s.storage.sql.exec('UPDATE sessions SET token_digest=?',await sha256(token));s.storage.sql.exec("UPDATE human_grants SET scopes_json=? WHERE principal_id='human_operator'",JSON.stringify(['workspace:read','tasks:read','artifacts:read','approvals:read']));});
 const response=await f.stub.fetch(new Request(url,{headers:{cookie:'cfhub_session='+token}}));expect(response.status).toBe(200);
 const body=await response.json() as {data:{effective_scopes:string[]}};expect(body.data.effective_scopes).toContain('approvals:read');expect(body.data.effective_scopes).not.toContain('approvals:decide');
});
