import {describe,it,expect,vi} from 'vitest';
import {HubClient} from '../../packages/client/src/client';
import type {Agent} from '../../src/http/dto';
const agent:Agent={id:'agent_one',workspace_id:'ws',agent_version:1,display_name:'Synthetic agent',description:'',work_role_ids:[],framework:null,model:null,status:'active',created_at:'2026-10-31T00:00:00Z',updated_at:'2026-10-31T00:00:00Z'};
const reply=(list=true)=>Response.json({data:list?[agent]:agent,...(list?{page:{has_more:false,next_cursor:null}}:{}),request_id:'agent_read'});
describe('closed browser agent reads',()=>{
 it('lists one authorized page using generated query, cookie lane and no native credentials',async()=>{
  const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>reply());const client=new HubClient('ws',{fetch});client.setCsrfToken('synthetic-memory-only');
  expect(await client.read('listAgents', {query:{limit:200,cursor:'opaque+=?'}})).toMatchObject({ok:true,data:[agent],page:{has_more:false,next_cursor:null}});
  expect(fetch).toHaveBeenCalledTimes(1);const [url,init]=fetch.mock.calls[0]!;
  expect(url).toBe('/v2/workspaces/ws/agents?cursor=opaque%2B%3D%3F&limit=200');
  expect(init).toMatchObject({method:'GET',credentials:'same-origin',mode:'same-origin',cache:'no-store',redirect:'error'});
  const headers=new Headers(init?.headers);for(const h of ['authorization','x-runtime-token','x-csrf-token','idempotency-key'])expect(headers.has(h)).toBe(false);
 });
 it('gets an encoded agent path with the canonical single-object envelope',async()=>{
  const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>reply(false));
  expect(await new HubClient('ws',{fetch}).read('getAgent',{path:{agent_id:'agent /?#'}})).toMatchObject({ok:true,data:agent});
  expect(fetch.mock.calls[0]![0]).toBe('/v2/workspaces/ws/agents/agent%20%2F%3F%23');expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([{query:{limit:201}},{query:{limit:0}},{query:{cursor:''}},{query:{principal_id:'foreign'}},{body:{}}])('rejects invalid list input %j',async input=>{
  const fetch=vi.fn(async()=>reply());expect(await new HubClient('ws',{fetch}).read('listAgents',input as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();
 });
 it.each([{path:{agent_id:'..'}},{path:{agent_id:''}},{path:{agent_id:'one',workspace_id:'foreign'}},{}])('rejects invalid get input %j',async input=>{
  const fetch=vi.fn(async()=>reply(false));expect(await new HubClient('ws',{fetch}).read('getAgent',input as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();
 });
 it.each([{headers:{authorization:'synthetic'}},{runtimeProof:'synthetic'},{origin:'https://foreign.invalid'},{signal:{}}])('rejects injected options %j',async options=>{
  const fetch=vi.fn(async()=>reply());expect(await new HubClient('ws',{fetch}).read('listAgents',{},options as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['createAgent','archiveAgent','listCredentials','stageArtifact'])('keeps operation %s unavailable',async operation=>{
  const fetch=vi.fn(async()=>reply());expect(await new HubClient('ws',{fetch}).read(operation as never,{} as never)).toMatchObject({ok:false,error:{code:'OPERATION_UNAVAILABLE'}});expect(fetch).not.toHaveBeenCalled();
 });
 it.each([
  ()=>Response.json({data:[{...agent,status:'invented'}],page:{has_more:false,next_cursor:null},request_id:'agent_read'}),
  ()=>Response.json({data:[agent],page:{has_more:true,next_cursor:null},request_id:'agent_read'}),
  ()=>Response.json({data:[agent],page:{has_more:false,next_cursor:null},request_id:'agent_read',extra:true}),
  ()=>new Response('not-json',{status:200,headers:{'content-type':'text/html'}})
 ])('rejects malformed list response through canonical validator',async response=>{
  expect(await new HubClient('ws',{fetch:vi.fn(async()=>response())}).read('listAgents',{})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
 });
 it('does not confuse list and single-object response contracts',async()=>{
  expect(await new HubClient('ws',{fetch:vi.fn(async()=>reply())}).read('getAgent',{path:{agent_id:'agent_one'}})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
 });
 it.each([401,403])('clears in-memory CSRF on HTTP%s and does not retry',async status=>{
  const fetch=vi.fn(async()=>new Response('invalid private response',{status}));const client=new HubClient('ws',{fetch});client.setCsrfToken('synthetic');
  expect(await client.read('listAgents',{})).toMatchObject({ok:false,status});
  expect(await client.compose('createMessage',{body:{body:'text',recipient_agent_ids:['agent_one'],refs:[],artifact_ids:[]}},{idempotencyKey:'one'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('honors abort without dispatch or retry',async()=>{
  const fetch=vi.fn(async()=>reply());expect(await new HubClient('ws',{fetch}).read('listAgents',{},{signal:AbortSignal.abort()})).toMatchObject({ok:false,error:{code:'REQUEST_ABORTED'}});expect(fetch).not.toHaveBeenCalled();
 });
});
// Type-only boundary; never dispatches.
function readTypes(client:HubClient){
 const list:Promise<import('../../packages/client/src/types').ApiResult<Agent[]>>=client.read('listAgents',{query:{limit:1}});
 const one:Promise<import('../../packages/client/src/types').ApiResult<Agent>>=client.read('getAgent',{path:{agent_id:'agent_one'}});
 // @ts-expect-error agent reads cannot provide runtime credentials
 client.read('getAgent',{path:{agent_id:'one'}},{runtimeProof:'no'});
 // @ts-expect-error list operation does not accept a single-agent path
 client.read('listAgents',{path:{agent_id:'one'}});
 void [list,one];
}
void readTypes;
