import {afterEach,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {DurableMutations} from '../../packages/cli/src/durable-mutations';
import {ProtectedCredentialProvider} from '../../packages/cli/src/secret-store';
import {createNativeClient} from '../../packages/client/src/native-client';
import {Journal} from '../../packages/cli/src/journal';
import type {DispatchStamp} from '../../packages/cli/src/replay-clock';
const origin='https://hub.example.invalid',token='M'.repeat(43),proof='N'.repeat(43),at='2026-10-27T00:00:00Z';
const runtime={id:'runtime',workspace_id:'ws',agent_id:'agent',runtime_version:1,label:'Synthetic',status:'online',last_seen_at:at,presence_expires_at:'2026-10-27T00:01:30Z',created_at:at};
const data={task:{id:'task',workspace_id:'ws',title:'Synthetic',description:'',state:'doing',task_version:3,proposal_version:1,project_id:null,work_role_id:null,assigned_agent_id:null,active_run_id:'run',latest_run_id:'run',approval_id:null,result:null,retry_count:0,retry_limit:2,flags:[],created_at:at,updated_at:at},run:{id:'run',workspace_id:'ws',task_id:'task',agent_id:'agent',runtime_instance_id:'runtime',status:'active',run_version:1,fence:1,lease_expires_at:'2026-10-27T00:01:00Z',started_at:at,ended_at:null},approval:null};
const input={path:{task_id:'task'},body:{expected_version:2,runtime_instance_id:'runtime'}};
const roots:string[]=[],handles:{close():void}[]=[];
class Clock {now=10;epoch='first';sample(){return {clockEpochId:this.epoch,nowMonotonicMs:this.now,continuityVerified:true,suspendAwareElapsedVerified:true};}stamp(requestFingerprint:string):DispatchStamp{return {firstDispatchWallMs:100,firstDispatchMonotonicMs:this.now,clockEpochId:this.epoch,guaranteedRetentionMs:86400000,requestFingerprint};}}
async function fixture(){
 const root=mkdtempSync(join(dirname(process.cwd()),'mcp-claim-'));roots.push(root);const provider=new ProtectedCredentialProvider({directory:join(root,'secrets'),create:true});handles.push(provider);provider.importCredential(token);
 const client=createNativeClient({origin,workspaceId:'ws',credentialProvider:provider,fetch:async()=>Response.json({data:{runtime,runtime_token:proof,revealed:true},request_id:'enroll'},{status:201})});
 expect((await client.enrollRuntime({body:{label:'Synthetic'}},{idempotencyKey:'enroll',captureRuntime:c=>provider.captureRuntime(c)})).ok).toBe(true);
 const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({data,request_id:'fresh'})),clock=new Clock(),opts={origin,workspaceId:'ws',provider,journalDirectory:join(root,'journal'),journalProfile:'mcp-v1' as const,fetch,clock};
 const coordinator=new DurableMutations({...opts,create:true});handles.push(coordinator);const intent=await coordinator.prepareOrReuse('claimTask',input,{idempotencyKey:'original'});
 return {root,provider,fetch,clock,opts,coordinator,intent};
}
afterEach(()=>{for(const h of handles.splice(0))try{h.close();}catch{}for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
const invoke=(d:DurableMutations,id:string)=>(d as DurableMutations&{dispatchMcpClaim(id:string):ReturnType<DurableMutations['dispatch']>}).dispatchMcpClaim(id);
function entry(f:Awaited<ReturnType<typeof fixture>>){const j=new Journal({directory:f.opts.journalDirectory,profile:'mcp-v1',authority:()=>false});try{return j.getSync(f.intent.id);}finally{j.close();}}
it('unsent MCP claim applies once then settled repeat only reads original outcome',async()=>{
 const f=await fixture();expect(await invoke(f.coordinator,f.intent.id)).toMatchObject({ok:true,data});const before=entry(f);
 expect(await invoke(f.coordinator,f.intent.id)).toMatchObject({ok:true,data,requestId:'fresh'});
 expect(f.fetch.mock.calls.map(([url])=>String(url))).toEqual([origin+'/v2/workspaces/ws/tasks/task:claim',origin+'/v2/workspaces/ws/tasks/task:claim-outcome']);expect(entry(f)).toEqual(before);
 for(const [,init] of f.fetch.mock.calls){expect(init!.body).toBe(JSON.stringify({expected_version:2,runtime_instance_id:'runtime'}));expect(new Headers(init!.headers).get('idempotency-key')).toBe('original');expect(new Headers(init!.headers).get('x-runtime-token')).toBe(proof);}
});
it('UNKNOWN reopened claim ignores unusable write clock only for fixed lookup and preserves stamp',async()=>{
 const f=await fixture();f.fetch.mockImplementationOnce(async()=>{throw Error('lost');});expect((await invoke(f.coordinator,f.intent.id)).ok).toBe(false);const before=entry(f);f.coordinator.close();f.clock.epoch='new-process';f.clock.now+=86400000;
 const next=new DurableMutations(f.opts);handles.push(next);expect(await invoke(next,f.intent.id)).toMatchObject({ok:true,data});expect(entry(f)).toEqual(before);
 expect(f.fetch.mock.calls.map(([url])=>String(url))).toEqual([origin+'/v2/workspaces/ws/tasks/task:claim',origin+'/v2/workspaces/ws/tasks/task:claim-outcome']);
 expect((await next.dispatch(f.intent.id)).ok).toBe(false);expect(f.fetch).toHaveBeenCalledTimes(2);
});
for(const status of [401,404,409,503])it('lookup denial '+status+' never falls back or changes retained evidence',async()=>{
 const f=await fixture();await invoke(f.coordinator,f.intent.id);const before=entry(f),code=({401:'UNAUTHENTICATED',404:'NOT_FOUND',409:'IDEMPOTENCY_CONFLICT',503:'DEPENDENCY_UNAVAILABLE'} as const)[status as 401|404|409|503];
 f.fetch.mockImplementationOnce(async()=>Response.json({error:{code,message:'Synthetic denial',retryable:status===503,request_id:'denied'}},{status}));
 expect(await invoke(f.coordinator,f.intent.id)).toMatchObject({ok:false,status,error:{code},requestId:'denied'});expect(entry(f)).toEqual(before);expect(f.fetch).toHaveBeenCalledTimes(2);expect(String(f.fetch.mock.calls[1][0]).endsWith(':claim-outcome')).toBe(true);
});
it('unresolved owner heartbeat blocks historical lookup before fetch',async()=>{
 const f=await fixture();await invoke(f.coordinator,f.intent.id);
 const heartbeat=await f.coordinator.prepareOrReuse('heartbeatRuntime',{path:{runtime_instance_id:'runtime'},body:{expected_runtime_version:1}},{idempotencyKey:'heartbeat'});f.fetch.mockImplementationOnce(async()=>{throw Error('lost');});await f.coordinator.dispatch(heartbeat.id);
 expect((await invoke(f.coordinator,f.intent.id)).ok).toBe(false);expect(f.fetch).toHaveBeenCalledTimes(2);
});
it('rotated protected authority cannot read a historical claim',async()=>{
 const f=await fixture();await invoke(f.coordinator,f.intent.id);f.provider.rotateCredential('Q'.repeat(43));expect((await invoke(f.coordinator,f.intent.id)).ok).toBe(false);expect(f.fetch).toHaveBeenCalledTimes(1);
});
it('competing MCP coordinator wins unsent admission before final pin; loser never sends old claim or falls back',async()=>{
 const f=await fixture(),second=new DurableMutations(f.opts);handles.push(second);
 const acquire=f.provider.acquire.bind(f.provider);let entered!:()=>void,release!:()=>void,first=true;
 const pending=new Promise<void>(resolve=>entered=resolve),barrier=new Promise<void>(resolve=>release=resolve);
 f.provider.acquire=async binding=>{const lease=await acquire(binding);if(first){first=false;entered();await barrier;}return lease;};
 const loser=invoke(f.coordinator,f.intent.id);await pending;
 expect(await invoke(second,f.intent.id)).toMatchObject({ok:true,data});release();expect((await loser).ok).toBe(false);
 expect(f.fetch).toHaveBeenCalledTimes(1);expect(String(f.fetch.mock.calls[0][0]).endsWith(':claim')).toBe(true);
});
it('failed lookup transport preserves UNKNOWN and never retries claim',async()=>{
 const f=await fixture();f.fetch.mockImplementation(async()=>{throw Error('lost');});await invoke(f.coordinator,f.intent.id);const before=entry(f);
 expect((await invoke(f.coordinator,f.intent.id)).ok).toBe(false);expect(entry(f)).toEqual(before);expect(f.fetch).toHaveBeenCalledTimes(2);expect(String(f.fetch.mock.calls[1][0]).endsWith(':claim-outcome')).toBe(true);
});
it('claim-only read exception rejects another operation without dispatch or clock relaxation',async()=>{
 const f=await fixture(),other=await f.coordinator.prepareOrReuse('heartbeatRuntime',{path:{runtime_instance_id:'runtime'},body:{expected_runtime_version:1}},{idempotencyKey:'heartbeat'});
 expect((await invoke(f.coordinator,other.id)).ok).toBe(false);expect(f.fetch).not.toHaveBeenCalled();
});
