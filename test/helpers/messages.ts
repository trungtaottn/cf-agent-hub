import {env} from 'cloudflare:workers';
import {fixture,operator} from './environment';
import {prepareBootstrap,sha256} from '../../src/config/bootstrap';
import {owned,commandContext} from './settings';
import type {MessageCreateRequest} from '../../src/http/dto';
export {owned,commandContext};
export const messageInput=(extra:Partial<MessageCreateRequest>={}):MessageCreateRequest=>({recipient_agent_ids:['agent_research'],body:'A durable message',refs:[],artifact_ids:[],...extra});
export async function messageFixture(name:string){
 const raw=await fixture(name);raw.bundle.credentials[0].token_sha256=await sha256('A'.repeat(43));
 const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),input);
 return {stub,name,identity:{kind:'agent' as const,workspaceId:'ws_example',credentialId:'credential_research_1',tokenDigest:raw.bundle.credentials[0].token_sha256}};
}
export const messageSnapshot=(storage:DurableObjectStorage)=>Object.fromEntries(['threads','thread_participants','messages','inbox','outbox','scheduler_state','events','idempotency_outcomes'].map(t=>[t,storage.sql.exec('SELECT * FROM '+t).toArray()]));
