import {it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import entry from '../../src/index';
import {createNativeClient} from '../../packages/client/src/native-client';
import type {CredentialProvenance,CredentialProvider,NativeClient} from '../../packages/client/src/types';
import {ingressFixture,NATIVE_TOKEN} from '../helpers/task-ingress';
import {r2IsolationFixture} from '../helpers/r2-isolation';
import {artifactFixture,artifactBucket,chunkStream} from '../helpers/artifacts';
import {sha256} from '../../src/config/bootstrap';
import {inspectArtifactStream} from '../../src/artifacts/stream';
import {boundedStream} from '../../packages/client/src/streams';
import {Deadline} from '../../packages/client/src/transport';
const origin='https://hub.example.invalid';
function adapter(bindings:Env,workspaceId='ws_example'){
 let provenance:CredentialProvenance|null=null,proof='';const releases=vi.fn();
 const provider:CredentialProvider={acquire:async()=>({slotId:'synthetic_slot',slotGeneration:1,provenance,isCurrent:()=>true,use:fn=>fn(NATIVE_TOKEN),release:releases})};
 const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>entry.fetch(new Request(input,init),bindings));
 const client=createNativeClient({origin,workspaceId,credentialProvider:provider,fetch});
 const enroll=async()=>{const result=await client.enrollRuntime({body:{label:'Native client runtime'}},{idempotencyKey:'client-enroll',captureRuntime:c=>{provenance=c.provenance;proof=c.runtimeProof;}});expect(result,JSON.stringify(result)).toMatchObject({ok:true,status:201});if(!result.ok)throw Error('enroll');return result.data;};
 return {client,fetch,enroll,releases,get proof(){return proof;},get binding(){return provenance!.binding;}};
}
it('real Worker native claim response loss preserves exact key, replay, lease and submit to Review',async()=>{
 const f=await ingressFixture('native_client_claim'),a=adapter(f.bindings),runtime=await a.enroll();
 const created=await f.send('tasks','POST',{title:'Native transport',description:''},'human-create',undefined,true);expect(created.status).toBe(201);const {data:task}=await created.json() as {data:{id:string}};
 const ready=await f.send('tasks/'+task.id+':ready','POST',{expected_version:1},'human-ready',undefined,true);expect(ready.status).toBe(200);await ready.arrayBuffer();
 const request={path:{task_id:task.id},body:{expected_version:2,runtime_instance_id:runtime.id}},options={idempotencyKey:'native-claim',runtimeProof:a.proof,expectedBinding:a.binding};
 const real=a.fetch.getMockImplementation()!;a.fetch.mockImplementationOnce(async(url,init)=>{const response=await real(url,init);expect(response.status).toBe(200);await response.arrayBuffer();throw Error('synthetic response loss');});
 expect(await a.client.call('claimTask',request,options)).toMatchObject({ok:false,error:{code:'NETWORK_ERROR'}});
 const replay=await a.client.call('claimTask',request,options);expect(replay).toMatchObject({ok:true,data:{task:{state:'doing'}}});if(!replay.ok||!replay.data.run)throw Error('claim');
 const run=replay.data.run;
 expect(await a.client.call('heartbeatRun',{path:{run_id:run.id},body:{expected_run_version:run.run_version,fence:run.fence}},{idempotencyKey:'native-renew',runtimeProof:a.proof,expectedBinding:a.binding})).toMatchObject({ok:true});
 const result=await a.client.call('submitTaskResult',{path:{task_id:task.id},body:{expected_version:3,run_id:run.id,fence:run.fence,result:{summary:'Native result',artifact_ids:[]}}},{idempotencyKey:'native-result',runtimeProof:a.proof,expectedBinding:a.binding});expect(result).toMatchObject({ok:true,data:{task:{state:'review'}}});
 expect(await a.client.call('listTaskResults',{path:{task_id:task.id},query:{limit:1}})).toMatchObject({ok:true,data:[{summary:'Native result'}],page:{has_more:false,next_cursor:null}});
 await runInDurableObject(f.stub,(_o,{storage})=>{expect(storage.sql.exec('SELECT COUNT(*) AS n FROM runs').one().n).toBe(1);expect(storage.sql.exec('SELECT COUNT(*) AS n FROM task_results').one().n).toBe(1);});
 expect(a.fetch).toHaveBeenCalledTimes(6);expect(a.releases).toHaveBeenCalledTimes(6);
});
it('real native messaging carries canonical references and current revocation remains server-owned',async()=>{
 const f=await r2IsolationFixture('native_client_messages',{human:false}),a=adapter(f.bindings);await a.enroll();
 const sent=await a.client.call('createMessage',{body:{recipient_agent_ids:['agent_other'],body:'Native message',refs:[],artifact_ids:[]}},{idempotencyKey:'native-message',expectedBinding:a.binding});expect(sent).toMatchObject({ok:true,status:201});if(!sent.ok)throw Error('message');
 expect(await a.client.call('getThread',{path:{thread_id:sent.data.thread_id},query:{limit:1}})).toMatchObject({ok:true,data:[{body:'Native message'}],page:{has_more:false}});
 await f.revokeOwner();expect(await a.client.call('getWorkspace',{})).toMatchObject({ok:false,status:401,error:{code:'UNAUTHENTICATED'}});
});
it('real trusted artifact ingress streams stage/upload/commit/download without JSON parsing raw bytes',async()=>{
 const f=await artifactFixture('native_client_artifact');await runInDurableObject(f.stub,async(_o,{storage})=>storage.sql.exec("UPDATE native_credentials SET token_sha256=? WHERE credential_id='credential_research_1'",await sha256(NATIVE_TOKEN)));
 const bindings={...env,ARTIFACT_BUCKET:artifactBucket(),DEPLOYMENT_CONFIG:JSON.stringify(f.input.config)} as Env,a=adapter(bindings);await a.enroll();
 const size=1048576,manifest=await inspectArtifactStream(chunkStream(size),size);
 const staged=await a.client.call('stageArtifact',{body:{task_id:null,run_id:null,filename:'stream.bin',media_type:'application/octet-stream',byte_size:size,sha256:manifest.sha256}},{idempotencyKey:'native-stage',runtimeProof:a.proof,expectedBinding:a.binding});expect(staged.ok).toBe(true);if(!staged.ok)throw Error('stage');
 const uploaded=await a.client.call('uploadArtifactContent',{path:{artifact_id:staged.data.id}},{artifact:staged.data,upload:chunkStream(size),idempotencyKey:'native-upload',runtimeProof:a.proof,expectedBinding:a.binding});expect(uploaded).toMatchObject({ok:true,data:{status:'uploaded'}});if(!uploaded.ok)throw Error('upload');
 const committed=await a.client.call('commitArtifact',{path:{artifact_id:staged.data.id},body:{expected_artifact_version:uploaded.data.artifact_version}},{idempotencyKey:'native-commit',runtimeProof:a.proof,expectedBinding:a.binding});expect(committed).toMatchObject({ok:true,data:{status:'committed'}});if(!committed.ok)throw Error('commit');
 const downloaded=await a.client.call('downloadArtifactContent',{path:{artifact_id:staged.data.id}},{artifact:committed.data});expect(downloaded).toMatchObject({ok:true,requestId:null});if(!downloaded.ok)throw Error('download');
 const checked=await inspectArtifactStream(downloaded.data.body,size);expect(checked).toEqual(manifest);expect(await downloaded.data.completion).toEqual({ok:true,byteSize:size});expect(a.fetch).toHaveBeenCalledTimes(5);expect(a.releases).toHaveBeenCalledTimes(5);
});
it.each([1048576,8388608])('measures actual Workers pull work against eager allocation for %i bytes',async size=>{
 let produced=0,consumed=0,maxAhead=0,pulls=0;const source=new ReadableStream<Uint8Array>({pull(c){pulls++;if(produced===size){c.close();return;}const n=Math.min(32768,size-produced);produced+=n;maxAhead=Math.max(maxAhead,produced-consumed);c.enqueue(new Uint8Array(n));}},{highWaterMark:0});
 const deadline=new Deadline(30000),relay=boundedStream(source,size,deadline,()=>deadline.check());const beforeFirstPull=produced;const reader=relay.body.getReader();let chunks=0,maxChunk=0;
 for(;;){const {value,done}=await reader.read();if(done)break;chunks++;maxChunk=Math.max(maxChunk,value.length);consumed+=value.length;}
 expect(await relay.completion).toEqual({ok:true,byteSize:size});deadline.dispose();
 const eager=await new Response(chunkStream(size,0,32768)).arrayBuffer();expect(eager.byteLength).toBe(size);expect(beforeFirstPull).toBe(0);expect(maxAhead).toBe(32768);expect(maxChunk).toBe(32768);expect(consumed).toBe(size);expect(pulls).toBe(chunks+1);
 console.log('NATIVE_STREAM_STUDY '+JSON.stringify({runtime:'Workers',size,source_chunk_bytes:32768,produced_before_read:beforeFirstPull,pulls,consumer_chunks:chunks,max_produced_ahead_bytes:maxAhead,max_emitted_chunk_bytes:maxChunk,eager_allocated_bytes:eager.byteLength}));
});
