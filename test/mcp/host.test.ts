import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {ProtectedCredentialProvider} from '../../packages/cli/src/secret-store';
import {createNativeClient} from '../../packages/client/src/native-client';
import {openMcpHost,initializeMcpJournal} from '../../packages/mcp-stdio/src/host';
const roots:string[]=[],handles:{close():void}[]=[];
const origin='https://hub.example.invalid',token='S'.repeat(43),proof='P'.repeat(43);
const runtime={id:'runtime',workspace_id:'ws',agent_id:'agent',runtime_version:1,label:'Synthetic',status:'online',last_seen_at:'2026-10-27T00:00:00Z',presence_expires_at:'2026-10-27T00:01:30Z',created_at:'2026-10-27T00:00:00Z'};
const config=(root:string)=>({initialize:false as const,origin,workspaceId:'ws',stateDirectory:root});
async function setup(){const root=mkdtempSync(join(dirname(process.cwd()),'mcp-host-'));roots.push(root);const provider=new ProtectedCredentialProvider({directory:join(root,'secrets'),create:true});handles.push(provider);provider.importCredential(token);const client=createNativeClient({origin,workspaceId:'ws',credentialProvider:provider,fetch:async()=>Response.json({data:{runtime,runtime_token:proof,revealed:true},request_id:'synthetic'},{status:201})});expect((await client.enrollRuntime({body:{label:'Synthetic'}},{idempotencyKey:'explicit-test-enrollment',captureRuntime:value=>provider.captureRuntime(value)})).ok).toBe(true);return {root,provider};}
afterEach(()=>{for(const h of handles.splice(0))try{h.close();}catch{}for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
it('launch opens only existing stores and creates no enrollment or network work',async()=>{const f=await setup();let sends=0;expect(()=>openMcpHost(config(f.root),async()=>{sends++;throw Error();})).toThrow();initializeMcpJournal(f.root);const host=openMcpHost(config(f.root),async()=>{sends++;throw Error();});handles.push(host);expect(sends).toBe(0);expect(()=>initializeMcpJournal(f.root)).toThrow();});
it('genuine protected launch dispatches exact native body/key and hides proof',async()=>{const f=await setup();initializeMcpJournal(f.root);let sends=0;const host=openMcpHost(config(f.root),async(url,init)=>{sends++;expect(String(url)).toBe(origin+'/v2/workspaces/ws/runs/run:heartbeat');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer '+token);expect(new Headers(init?.headers).get('x-runtime-token')).toBe(proof);expect(new Headers(init?.headers).get('idempotency-key')).toBe('exact:key');return Response.json({error:{code:'STALE_RUN',message:'Run is stale',retryable:false,request_id:'synthetic'}},{status:409});});handles.push(host);const args={workspace_id:'ws',run_id:'run',expected_run_version:1,fence:1,idempotency_key:'exact:key'};const result=await host.call('hub_run_heartbeat',args);expect(result).toMatchObject({ok:false,error:{code:'STALE_RUN'},requestId:'synthetic'});expect(sends).toBe(1);expect(JSON.stringify(result)).not.toContain(proof);});
it('foreign workspace and malformed decision input reject without protected dispatch',async()=>{const f=await setup();initializeMcpJournal(f.root);let sends=0;const host=openMcpHost(config(f.root),async()=>{sends++;throw Error();});handles.push(host);await expect(host.call('hub_workspace_get',{workspace_id:'other'})).rejects.toThrow();await expect(host.call('hub_task_request_decision',{workspace_id:'ws'})).rejects.toThrow();expect(sends).toBe(0);});
it('changed protected principal binding cannot silently become another MCP actor',async()=>{const f=await setup();initializeMcpJournal(f.root);let sends=0;const host=openMcpHost(config(f.root),async()=>{sends++;throw Error();});handles.push(host);f.provider.rotateCredential('Q'.repeat(43));await expect(host.call('hub_workspace_get',{workspace_id:'ws'})).rejects.toThrow();expect(sends).toBe(0);});

it('launch snapshots config so later caller mutation cannot rebind tool validation',async()=>{
 const f=await setup();initializeMcpJournal(f.root);const launch=config(f.root);let sends=0;
 const host=openMcpHost(launch,async url=>{sends++;expect(String(url)).toBe(origin+'/v2/workspaces/ws');return Response.json({error:{code:'FORBIDDEN',message:'Denied',retryable:false,request_id:'synthetic'}},{status:403});});handles.push(host);
 launch.workspaceId='foreign';launch.origin='https://foreign.example.invalid';launch.stateDirectory=join(f.root,'other');
 await expect(host.call('hub_workspace_get',{workspace_id:'foreign'})).rejects.toThrow();expect(sends).toBe(0);
 expect(await host.call('hub_workspace_get',{workspace_id:'ws'})).toMatchObject({ok:false,error:{code:'FORBIDDEN'}});expect(sends).toBe(1);
});
