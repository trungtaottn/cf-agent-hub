import {it,expect,vi} from 'vitest';
import {HubClient} from '../../packages/client/src/client';
const view={status:'no_retained_data',binding:null,coverage:null,retained_range:null,truncated:false,records:[],read_at:'2026-11-01T00:00:00Z'};
const reply=()=>Response.json({data:view,page:{next_cursor:null,has_more:false},request_id:'observation_read'});
it('browser observation read uses generated closed route and cookie transport only',async()=>{
 const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>reply()),client=new HubClient('ws',{fetch});
 const result=await client.read('listTaskObservations' as never,{path:{task_id:'task /?#'},query:{limit:50}} as never);expect(result).toMatchObject({ok:true,data:view,page:{has_more:false,next_cursor:null}});
 expect(fetch).toHaveBeenCalledTimes(1);const [url,init]=fetch.mock.calls[0]!;expect(url).toBe('/v2/workspaces/ws/tasks/task%20%2F%3F%23/observations?limit=50');expect(init).toMatchObject({method:'GET',credentials:'same-origin',mode:'same-origin',cache:'no-store',redirect:'error'});for(const h of ['authorization','x-runtime-token','x-csrf-token','idempotency-key'])expect(new Headers(init?.headers).has(h)).toBe(false);
});
it.each([{query:{limit:51}},{query:{cursor:'a'.repeat(2048)}},{query:{expected_session_id:'guessed'}},{body:{}}])('browser observation query rejects invalid closed input before dispatch %j',async input=>{
 const fetch=vi.fn(async()=>reply());expect(await new HubClient('ws',{fetch}).read('listTaskObservations' as never,{path:{task_id:'task_a'},...input} as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();
});
it.each([401,403])('observation HTTP%s clears memory CSRF and never retries',async status=>{
 const fetch=vi.fn(async()=>new Response('private',{status})),client=new HubClient('ws',{fetch});client.setCsrfToken('synthetic');expect(await client.read('listTaskObservations' as never,{path:{task_id:'a'}} as never)).toMatchObject({ok:false,status});expect(await client.compose('createMessage',{body:{body:'text',recipient_agent_ids:['agent_one'],refs:[],artifact_ids:[]}},{idempotencyKey:'one'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});expect(fetch).toHaveBeenCalledTimes(1);
});
it('owner diagnostic transports remain unavailable to generic browser read',async()=>{
 for(const op of ['establishObservationSession','appendObservationBatch','replaceObservationSession','getObservationOwnerStatus']){const fetch=vi.fn(async()=>reply());expect(await new HubClient('ws',{fetch}).read(op as never,{} as never)).toMatchObject({ok:false,error:{code:'OPERATION_UNAVAILABLE'}});expect(fetch).not.toHaveBeenCalled();}
});
it('observation browser read rejects response authority/completeness leakage',async()=>{
 const fetch=vi.fn(async()=>Response.json({data:{...view,request_fingerprint:'a'.repeat(64)},page:{next_cursor:null,has_more:false},request_id:'one'}));expect(await new HubClient('ws',{fetch}).read('listTaskObservations' as never,{path:{task_id:'a'}} as never)).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});
});
