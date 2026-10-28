import {describe,it,expect,vi} from 'vitest';
import {nativeFixture,nativeOrigin,proof} from './native-helpers';
import type {Artifact} from '../../src/http/dto';
const artifact:Artifact={id:'artifact_one',workspace_id:'ws',task_id:null,run_id:null,owner:{kind:'agent',principal_id:'agent_one',agent_id:'agent_one'},artifact_version:3,filename:'hello.txt',media_type:'text/plain',byte_size:4,sha256:'a'.repeat(64),status:'committed',created_at:'2026-10-27T00:00:00Z',committed_at:'2026-10-27T00:00:01Z',expires_at:null};
const stream=(parts:number[],cancel=vi.fn())=>new ReadableStream<Uint8Array>({pull(c){const n=parts.shift();if(n===undefined)c.close();else c.enqueue(new Uint8Array(n));},cancel},{highWaterMark:0});
const download=(body:ReadableStream<Uint8Array>,headers:Record<string,string>={})=>new Response(body,{headers:{'content-type':'text/plain','content-length':'4','content-disposition':'attachment; filename="hello.txt"',...headers}});
describe('native bounded artifact streaming',()=>{
 it('returns binary stream without JSON parsing or fabricated correlation and keeps lease until clean EOF',async()=>{
  const f=nativeFixture();let pulls=0;f.fetch.mockImplementation(async()=>download(new ReadableStream({pull(c){pulls++;if(pulls===1)c.enqueue(new Uint8Array(4));else c.close();}},{highWaterMark:0})));
  const result=await f.client.call('downloadArtifactContent',{path:{artifact_id:artifact.id}},{artifact});expect(result).toMatchObject({ok:true,requestId:null});expect(pulls).toBe(0);expect(f.releases).not.toHaveBeenCalled();
  if(!result.ok)throw Error('download failed');const reader=result.data.body.getReader();expect((await reader.read()).value?.length).toBe(4);expect(await reader.read()).toEqual({done:true,value:undefined});expect(await result.data.completion).toEqual({ok:true,byteSize:4});expect(f.releases).toHaveBeenCalledTimes(1);expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it.each([[[3]],[[5]],[[2,3]]])('fails completion and cancels mismatched actual byte lengths %j',async parts=>{
  const f=nativeFixture(),cancel=vi.fn();f.fetch.mockImplementation(async()=>download(stream([...parts],cancel)));const result=await f.client.call('downloadArtifactContent',{path:{artifact_id:artifact.id}},{artifact});expect(result.ok).toBe(true);if(!result.ok)return;
  const reader=result.data.body.getReader();await expect((async()=>{while(!(await reader.read()).done){}})()).rejects.toThrow('STREAM_INVALID');expect(await result.data.completion).toMatchObject({ok:false,error:{code:'STREAM_INVALID'}});expect(f.releases).toHaveBeenCalledTimes(1);
 });
 it.each([{'content-type':'text/html'},{'content-length':'5'},{'content-length':'abc'},{'content-disposition':'inline'},{'content-disposition':''}] as Record<string,string>[])('rejects wrong metadata %j before exposing any bytes',async headers=>{
  const f=nativeFixture(),cancel=vi.fn();f.fetch.mockImplementation(async()=>download(stream([4],cancel),headers));expect(await f.client.call('downloadArtifactContent',{path:{artifact_id:artifact.id}},{artifact})).toMatchObject({ok:false,error:{code:'INVALID_RESPONSE'}});expect(cancel).toHaveBeenCalledTimes(1);expect(f.releases).toHaveBeenCalledTimes(1);
 });
 it.each([{...artifact,workspace_id:'other'},{...artifact,id:'other'},{...artifact,status:'staged',committed_at:null},{...artifact,byte_size:10485761},{...artifact,byte_size:Number.MAX_SAFE_INTEGER+1}])('rejects wrong/unbounded manifest before acquire',async manifest=>{const f=nativeFixture();expect(await f.client.call('downloadArtifactContent',{path:{artifact_id:artifact.id}},{artifact:manifest as Artifact})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(f.acquire).not.toHaveBeenCalled();});
 it('cancels a never-consumed download on the total deadline',async()=>{
  const f=nativeFixture({timeoutMs:15}),cancel=vi.fn();f.fetch.mockImplementation(async()=>download(new ReadableStream({cancel},{highWaterMark:0})));
  const result=await f.client.call('downloadArtifactContent',{path:{artifact_id:artifact.id}},{artifact});expect(result.ok).toBe(true);if(!result.ok)return;
  expect(await result.data.completion).toMatchObject({ok:false,error:{code:'REQUEST_TIMEOUT'}});expect(cancel).toHaveBeenCalledTimes(1);expect(f.releases).toHaveBeenCalledTimes(1);
 });
 it('uploads caller stream once with exact byte size/proof/key, then validates JSON Artifact response',async()=>{
  const f=nativeFixture();await f.enroll();const manifest={...artifact,status:'staged' as const,committed_at:null,expires_at:'2026-10-27T00:15:00Z'};let bytes=0;
  f.fetch.mockImplementation(async(_url,init)=>{const reader=(init!.body as ReadableStream<Uint8Array>).getReader();for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;}return Response.json({data:{...manifest,status:'uploaded',artifact_version:2},request_id:'req_upload'});});
  expect(await f.client.call('uploadArtifactContent',{path:{artifact_id:artifact.id}},{artifact:manifest,upload:stream([2,2]),runtimeProof:proof,idempotencyKey:'upload-key'})).toMatchObject({ok:true,requestId:'req_upload'});
  expect(bytes).toBe(4);expect(f.fetch).toHaveBeenCalledTimes(2);const h=new Headers(f.fetch.mock.calls[1]![1]!.headers);expect(h.get('content-type')).toBe('application/octet-stream');expect(h.get('content-length')).toBe('4');expect(h.get('x-runtime-token')).toBe(proof);expect(h.get('idempotency-key')).toBe('upload-key');
 });
 it('cannot accept premature HTTP success before upload reaches exact clean EOF',async()=>{
  const f=nativeFixture({timeoutMs:15});await f.enroll();f.fetch.mockImplementation(async()=>Response.json({data:{...artifact,status:'uploaded'},request_id:'premature'}));
  const cancel=vi.fn();const result=await f.client.call('uploadArtifactContent',{path:{artifact_id:artifact.id}},{artifact:{...artifact,status:'staged'},upload:new ReadableStream({cancel},{highWaterMark:0}),runtimeProof:proof,idempotencyKey:'key'});
  expect(result).toMatchObject({ok:false,error:{code:'REQUEST_TIMEOUT'}});expect(cancel).toHaveBeenCalledTimes(1);expect(f.fetch).toHaveBeenCalledTimes(2);
 });
});
it('rejects zero-progress binary producer chunks and sanitizes producer ClientFault secrets',async()=>{
 const {ClientFault}=await import('../../packages/client/src/transport');
 for(const error of [null,new ClientFault(proof)]){
  const f=nativeFixture();let n=0;f.fetch.mockImplementation(async()=>download(new ReadableStream({pull(c){if(error)throw error;if(n++===0)c.enqueue(new Uint8Array());else if(n===2)c.enqueue(new Uint8Array(4));else c.close();}},{highWaterMark:0})));
  const result=await f.client.call('downloadArtifactContent',{path:{artifact_id:artifact.id}},{artifact});expect(result.ok).toBe(true);if(!result.ok)return;
  const rejected=(async()=>{const reader=result.data.body.getReader();while(!(await reader.read()).done){}})();await expect(rejected).rejects.not.toThrow(proof);expect(await result.data.completion).toMatchObject({ok:false});expect(JSON.stringify(await result.data.completion)).not.toContain(proof);
 }
});
it('accepts a valid zero-byte artifact with immediate clean EOF, and cancels explicitly abandoned streams',async()=>{
 const f=nativeFixture();f.fetch.mockImplementation(async()=>download(stream([]),{'content-length':'0'}));
 const empty=await f.client.call('downloadArtifactContent',{path:{artifact_id:artifact.id}},{artifact:{...artifact,byte_size:0}});expect(empty.ok).toBe(true);if(!empty.ok)return;expect(await empty.data.body.getReader().read()).toEqual({done:true,value:undefined});expect(await empty.data.completion).toEqual({ok:true,byteSize:0});
 const cancel=vi.fn();f.fetch.mockImplementation(async()=>download(stream([4],cancel)));const abandoned=await f.client.call('downloadArtifactContent',{path:{artifact_id:artifact.id}},{artifact});if(!abandoned.ok)throw Error('download');await abandoned.data.body.cancel();expect(await abandoned.data.completion).toMatchObject({ok:false,error:{code:'REQUEST_ABORTED'}});expect(cancel).toHaveBeenCalledTimes(1);expect(f.releases).toHaveBeenCalledTimes(2);
});
it('compares safe declared media type after the same Headers whitespace normalization as the server',async()=>{
 const f=nativeFixture(),media='text/plain; charset=utf-8 ';f.fetch.mockImplementation(async()=>download(stream([4]),{'content-type':media}));
 const result=await f.client.call('downloadArtifactContent',{path:{artifact_id:artifact.id}},{artifact:{...artifact,media_type:media}});expect(result.ok).toBe(true);if(!result.ok)return;const reader=result.data.body.getReader();while(!(await reader.read()).done){}expect(await result.data.completion).toEqual({ok:true,byteSize:4});expect(f.releases).toHaveBeenCalledTimes(1);
});
