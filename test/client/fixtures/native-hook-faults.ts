import {createNativeClient} from '../../../packages/client/src/native-client';
import type {CredentialDispatchLease,CredentialProvenance,NativeRequestOptions} from '../../../packages/client/src/types';
const token='F'.repeat(43),proof='G'.repeat(43),runtime={id:'runtime_hook',workspace_id:'ws',agent_id:'agent_hook',runtime_version:1,label:'Synthetic',status:'online',last_seen_at:'2026-10-27T00:00:00Z',presence_expires_at:'2026-10-27T00:01:30Z',created_at:'2026-10-27T00:00:00Z'};
const cancellation=new AbortController();const mode=process.argv[2];let unhandled=0,abort=0,fetches=0,provenance:CredentialProvenance|null=null;
process.on('unhandledRejection',()=>{unhandled++;});
const provider={acquire:async():Promise<CredentialDispatchLease>=>({slotId:'slot_hook',slotGeneration:0,provenance,isCurrent:()=>true,use:fn=>fn(token),release(){}})};
const client=createNativeClient({origin:'https://hub.example.invalid',workspaceId:'ws',credentialProvider:provider,timeoutMs:1000,fetch:async()=>{fetches++;return Response.json(fetches===1?{data:{runtime,runtime_token:proof,revealed:true},request_id:'synthetic'}:{data:runtime,request_id:'synthetic'},{status:fetches===1?201:200});}});
let result:unknown;
if(['commit','abort','late'].includes(mode))result=await client.enrollRuntime({body:{label:'Synthetic'}},{idempotencyKey:'synthetic',signal:cancellation.signal,captureRuntime:async c=>{
 provenance=c.provenance;if(mode==='late'){cancellation.abort();await new Promise(r=>setTimeout(r,30));}
 return {commit:mode==='commit'?async()=>{throw Error('synthetic failure');}:()=>{if(mode==='abort')throw Error('synthetic commit');},abort:mode==='abort'?async()=>{abort++;throw Error('synthetic abort');}:()=>{abort++;}};
}});
else{
 await client.enrollRuntime({body:{label:'Synthetic'}},{idempotencyKey:'enroll',captureRuntime:c=>{provenance=c.provenance;}});
 const options:NativeRequestOptions={idempotencyKey:'mutation',runtimeProof:proof};
 if(mode==='proof'){delete options.runtimeProof;options.runtimeProofDispatch=(async()=>{throw Error('synthetic proof');}) as never;}
 if(mode==='guard')options.dispatchGuard=()=>async()=>{throw Error('synthetic guard');};
 result=await client.call('heartbeatRuntime',{path:{runtime_instance_id:'runtime_hook'},body:{expected_runtime_version:1}},options);
}
await new Promise(r=>setTimeout(r,60));process.stdout.write(JSON.stringify({unhandled,abort,fetches,ok:(result as {ok:boolean}).ok}));
