import {it,expect} from 'vitest';
import {createNativeClient} from '../../packages/client/src/native-client';
import type {CredentialProvenance,CredentialProvider,NativeRequestOptions,RequestFor,EnabledOperationId} from '../../packages/client/src/types';
import {clientOperations} from '../../src/http/generated/client-operations';
import {isolationOperations,recordIsolationEvidence} from './r2-isolation-matrix';
import {isolationHttpFixture,prepareIsolationOperation} from './r2-isolation-http';
import {isolationTokens} from './r2-isolation';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
for(const {operation} of isolationOperations.filter(x=>x.lanes.includes('native')))it(operation+' / canonical native facade / server revocation after eviction',async()=>{
 const f=await isolationHttpFixture(('native_isolation_'+operation).toLowerCase()),token=operation==='acceptTaskResult'?isolationTokens.other:isolationTokens.reader;
 let provenance:CredentialProvenance|null=null,proof='',requests=0,releases=0;
 const provider:CredentialProvider={acquire:async()=>({slotId:'synthetic_local_slot',slotGeneration:1,provenance,isCurrent:()=>true,use:fn=>fn(token),release:()=>{releases++;}})};
 const client=createNativeClient({origin:f.a.origin,workspaceId:f.a.id,credentialProvider:provider,fetch:async(input,init)=>{requests++;return f.http(new Request(input,init));}});
 const enroll=await client.enrollRuntime({body:{label:'Facade isolation runtime'}},{idempotencyKey:'facade-enroll',captureRuntime:value=>{provenance=value.provenance;proof=value.runtimeProof;}});
 expect(enroll,JSON.stringify(enroll)).toMatchObject({ok:true,status:201});if(!enroll.ok)throw Error('native enrollment failed');
 if(operation!=='acceptTaskResult')f.runtimes.reader={runtime:enroll.data,runtime_token:proof};
 const prepared=await prepareIsolationOperation(f,operation,'native'),input=prepared.input,contract=clientOperations[operation];
 const request={...(input.path?{path:input.path}:{}),...(input.query?{query:input.query}:{}),...(input.body!==undefined?{body:input.body}:{})} as RequestFor<EnabledOperationId>;
 const options:NativeRequestOptions={...(contract.idempotency?{idempotencyKey:'facade-cell'}:{}),...(contract.runtimeProof?{runtimeProof:input.proof}:{}),expectedBinding:provenance!.binding};
 if(contract.upload||contract.download)options.artifact=await f.data('getArtifact','native',{path:input.path,token}) as import('../../src/http/dto').Artifact;
 if(contract.upload)options.upload=new Blob([input.bytes!]).stream();
 const beforeB=await f.snapshot('b'),beforeRequests=requests;
 const invoke=()=>operation==='createRuntime'?client.enrollRuntime({body:{label:'Facade new runtime'}},{idempotencyKey:'facade-cell',captureRuntime:()=>{}}):client.call(operation,request,options);
 const result=await invoke();expect(result,JSON.stringify(result)).toMatchObject({ok:true,status:contract.status});if(!result.ok)throw Error('native operation failed');
 if(operation==='createRuntime'){expect(result.data).toMatchObject({agent_id:'agent_research',label:'Facade new runtime'});expect(result.data).not.toHaveProperty('runtime_token');}
 else if(contract.download){const download=result.data as import('../../packages/client/src/types').ArtifactDownload;prepared.assertData(new Uint8Array(await new Response(download.body).arrayBuffer()));expect(await download.completion).toEqual({ok:true,byteSize:input.bytes?.length??options.artifact!.byte_size});}
 else prepared.assertData(result.data);
 expect(requests-beforeRequests).toBe(1);expect(releases).toBe(requests);expect((await f.snapshot('b')).digest).toBe(beforeB.digest);
 await runInDurableObject(f.a.stub,(_o,{storage})=>storage.sql.exec('UPDATE native_credentials SET enabled=0 WHERE credential_id=?',operation==='acceptTaskResult'?'credential_other':'credential_research_1'));
 await evictDurableObject(f.a.stub);const before=await f.snapshot();
 // Recreate a consumed upload stream; no new key or identity is introduced.
 if(contract.upload)options.upload=new Blob([input.bytes!]).stream();
 const denied=await invoke();expect(denied).toMatchObject({ok:false,status:401,error:{code:'UNAUTHENTICATED'}});expect(requests-beforeRequests).toBe(2);expect(releases).toBe(requests);expect((await f.snapshot()).digest).toBe(before.digest);recordIsolationEvidence(operation,'native','native-facade');recordIsolationEvidence(operation,'native','native-revoked-after-eviction');
},30_000);
