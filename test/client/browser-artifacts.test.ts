import {it,expect} from 'vitest';
import {HubClient} from '../../packages/client/src/client';
it('exposes a closed cookie artifact lane without native credentials',()=>{
 expect((new HubClient('ws') as unknown as {artifact:unknown}).artifact).toBeTypeOf('function');
});
import {vi} from 'vitest';
import type {Artifact} from '../../src/http/dto';
const metadata:Artifact={id:'artifact_one',workspace_id:'ws',task_id:null,run_id:null,owner:{kind:'human',principal_id:'human_one',agent_id:null},artifact_version:1,filename:'file.txt',media_type:'text/plain',byte_size:3,sha256:'a'.repeat(64),status:'staged',created_at:'2026-10-31T00:00:00Z',committed_at:null,expires_at:'2026-11-01T00:00:00Z'};
const stage={body:{task_id:null,run_id:null,filename:'file.txt',media_type:'text/plain',byte_size:3,sha256:'a'.repeat(64)}};
function fixture(reply:()=>Response=()=>Response.json({data:metadata,request_id:'artifact_request'},{status:201})){
 const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>reply());const client=new HubClient('ws',{fetch});client.setCsrfToken('synthetic-csrf');return {client,fetch};
}
it.each(['stageArtifact','uploadArtifactContent','commitArtifact'] as const)('dispatches %s once with exact cookie contract and no forbidden native headers',async operation=>{
 const resultArtifact={...metadata,status:operation==='stageArtifact'?'staged':operation==='uploadArtifactContent'?'uploaded':'committed',committed_at:operation==='commitArtifact'?'2026-10-31T00:00:01Z':null} as Artifact;
 const {client,fetch}=fixture(()=>Response.json({data:resultArtifact,request_id:'artifact_request'},{status:operation==='stageArtifact'?201:200}));
 const blob=new Blob(['abc'],{type:'text/html'}),input=operation==='stageArtifact'?stage:operation==='commitArtifact'?{path:{artifact_id:'artifact_one'},body:{expected_artifact_version:1}}:{path:{artifact_id:'artifact_one'}};
 expect(await client.artifact(operation,input,{idempotencyKey:'frozen-key',...(operation==='uploadArtifactContent'?{blob,artifact:metadata}:{})} as never)).toMatchObject({ok:true,data:resultArtifact,requestId:'artifact_request'});
 expect(fetch).toHaveBeenCalledTimes(1);const [url,init]=fetch.mock.calls[0]!;expect(url).toBe('/v2/workspaces/ws/artifacts'+(operation==='stageArtifact'?'':operation==='commitArtifact'?'/artifact_one:commit':'/artifact_one/content'));
 expect(init).toMatchObject({method:operation==='uploadArtifactContent'?'PUT':'POST',credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store'});
 const headers=new Headers(init!.headers);expect(headers.get('x-csrf-token')).toBe('synthetic-csrf');expect(headers.get('idempotency-key')).toBe('frozen-key');
 for(const name of ['authorization','x-runtime-token','content-length'])expect(headers.has(name)).toBe(false);
 if(operation==='uploadArtifactContent'){expect(init!.body).toBe(blob);expect(headers.get('content-type')).toBe('application/octet-stream');}else expect(JSON.parse(init!.body as string)).toEqual(input.body);
});
it.each(['createTask','getArtifact','downloadArtifactContent','__proto__'])('rejects unrelated operation %s',async operation=>{const {client,fetch}=fixture();expect(await client.artifact(operation as never,stage as never,{idempotencyKey:'key'} as never)).toMatchObject({ok:false,error:{code:'OPERATION_UNAVAILABLE'}});expect(fetch).not.toHaveBeenCalled();});
it.each([undefined,null,{}, {idempotencyKey:''},{idempotencyKey:' key'},{idempotencyKey:'key\n'},{idempotencyKey:'key',signal:{}},{idempotencyKey:'key',headers:{}},{idempotencyKey:'key',runtimeProof:'secret'},{idempotencyKey:'key',origin:'https://foreign.invalid'},{idempotencyKey:'key',blob:new Blob(['x'])},{idempotencyKey:'key',artifact:metadata}])('rejects malformed or authority-bearing options',async options=>{const {client,fetch}=fixture();expect(await client.artifact('stageArtifact',stage,options as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();});
it('requires current CSRF and closed native request shape',async()=>{const {client,fetch}=fixture();client.setCsrfToken(null);expect(await client.artifact('stageArtifact',stage,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});client.setCsrfToken('new');for(const input of [{body:{...stage.body,owner:'foreign'}},{body:{...stage.body,byte_size:10485761}},{...stage,path:{workspace_id:'foreign'}}])expect(await client.artifact('stageArtifact',input as never,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();});
it.each([401,403])('clears shared CSRF after %s even on malformed error',async status=>{const {client,fetch}=fixture(()=>new Response('invalid',{status}));await client.artifact('stageArtifact',stage,{idempotencyKey:'key'});expect(await client.artifact('stageArtifact',stage,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'CSRF_REQUIRED'}});expect(fetch).toHaveBeenCalledTimes(1);});
it('rejects mismatched or unavailable upload metadata and non Blob bytes before fetch',async()=>{const {client,fetch}=fixture();for(const artifact of [{...metadata,workspace_id:'other'},{...metadata,id:'other'},{...metadata,status:'committed'},{...metadata,status:'expired'},{...metadata,byte_size:2},{...metadata,byte_size:10485761},{...metadata,extra:true}])expect(await client.artifact('uploadArtifactContent',{path:{artifact_id:'artifact_one'}},{idempotencyKey:'key',artifact,blob:new Blob(['abc'])} as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});for(const blob of [undefined,'abc',new Uint8Array(3),{size:3}])expect(await client.artifact('uploadArtifactContent',{path:{artifact_id:'artifact_one'}},{idempotencyKey:'key',artifact:metadata,blob} as never)).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).not.toHaveBeenCalled();});
it('accepts exact binary max and rejects max+1 independently of character count',async()=>{const max=10485760,artifact={...metadata,byte_size:max},blob=new Blob([new Uint8Array(max)]);const {client,fetch}=fixture(()=>Response.json({data:{...artifact,status:'uploaded'},request_id:'uploaded'}));expect(await client.artifact('uploadArtifactContent',{path:{artifact_id:artifact.id}},{idempotencyKey:'key',artifact,blob})).toMatchObject({ok:true});expect(fetch).toHaveBeenCalledTimes(1);expect(await client.artifact('uploadArtifactContent',{path:{artifact_id:artifact.id}},{idempotencyKey:'key',artifact:{...artifact,byte_size:max+1},blob:new Blob([blob,'x'])})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(fetch).toHaveBeenCalledTimes(1);});
it('retains conflict correlation and transport ambiguity without automatic retry',async()=>{const {client,fetch}=fixture(()=>Response.json({error:{code:'IDEMPOTENCY_CONFLICT',message:'Conflict',retryable:false,request_id:'conflict'}},{status:409}));expect(await client.artifact('stageArtifact',stage,{idempotencyKey:'key'})).toMatchObject({ok:false,status:409,requestId:'conflict',error:{code:'IDEMPOTENCY_CONFLICT'}});fetch.mockRejectedValue(new Error('private network details'));expect(await client.artifact('stageArtifact',stage,{idempotencyKey:'key'})).toMatchObject({ok:false,status:null,error:{code:'NETWORK_ERROR'}});expect(fetch).toHaveBeenCalledTimes(2);});
it('validates bounded success response and aborts before dispatch',async()=>{const {client,fetch}=fixture(()=>Response.json({data:{id:'fake'},request_id:'bad'},{status:201}));expect(await client.artifact('stageArtifact',stage,{idempotencyKey:'key'})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});const abort=new AbortController();abort.abort();expect(await client.artifact('stageArtifact',stage,{idempotencyKey:'key',signal:abort.signal})).toMatchObject({ok:false,error:{code:'REQUEST_ABORTED'}});expect(fetch).toHaveBeenCalledTimes(1);});
// Compile-only: no caller native authority or binary input on JSON operations.
function browserArtifactTypes(client:HubClient){
 const dispatch:import('../../packages/client/src/types').BrowserArtifactRequest=client.artifact.bind(client);
 void dispatch('stageArtifact',stage,{idempotencyKey:'key'});
 void dispatch('uploadArtifactContent',{path:{artifact_id:metadata.id}},{idempotencyKey:'key',artifact:metadata,blob:new Blob(['abc'])});
 // @ts-expect-error upload requires explicit metadata and Blob
 client.artifact('uploadArtifactContent',{path:{artifact_id:metadata.id}},{idempotencyKey:'key'});
 // @ts-expect-error JSON operations cannot accept bytes
 client.artifact('stageArtifact',stage,{idempotencyKey:'key',blob:new Blob(['abc'])});
 // @ts-expect-error no native runtime proof in the cookie lane
 client.artifact('stageArtifact',stage,{idempotencyKey:'key',runtimeProof:'secret'});
 // @ts-expect-error download is not an artifact mutation
 client.artifact('downloadArtifactContent',{path:{artifact_id:metadata.id}},{idempotencyKey:'key'});
}
void browserArtifactTypes;
it('uses intrinsic Blob byte size rather than an overridden size getter',async()=>{
 class MisleadingBlob extends Blob {override get size(){return 3;}}
 const {client,fetch}=fixture();
 expect(await client.artifact('uploadArtifactContent',{path:{artifact_id:metadata.id}},{idempotencyKey:'key',artifact:metadata,blob:new MisleadingBlob(['larger bytes'])})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
 expect(fetch).not.toHaveBeenCalled();
});
