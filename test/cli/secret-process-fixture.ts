/** Synthetic child fixture only; no real network, credentials, or executable login surface. */
import {ProtectedCredentialProvider} from '../../packages/cli/src/secret-store';
import {createNativeClient} from '../../packages/client/src/native-client';
const token='S'.repeat(43),proof='P'.repeat(43),mode=process.argv[2],directory=process.argv[3];
const runtime={id:'runtime_synthetic',workspace_id:'ws',agent_id:'agent_synthetic',runtime_version:1,label:'Synthetic',status:'online' as const,last_seen_at:'2026-10-27T00:00:00Z',presence_expires_at:'2026-10-27T00:01:30Z',created_at:'2026-10-27T00:00:00Z'};
try{
 const provider=new ProtectedCredentialProvider({directory,create:true});provider.importCredential(token);
 const client=createNativeClient({origin:'https://hub.example.invalid',workspaceId:'ws',credentialProvider:provider,timeoutMs:120000,fetch:async()=>Response.json({data:{runtime,runtime_token:proof,revealed:true},request_id:'synthetic_process'},{status:201})});
 const result=await client.enrollRuntime({body:{label:'Synthetic'}},{idempotencyKey:'synthetic_process_enroll',captureRuntime:capture=>{
  const finalizer=provider.captureRuntime(capture);
  if(mode==='staged'){process.stdout.write(JSON.stringify({state:'staged',binding:{...capture.provenance.binding,runtimeId:capture.runtime.id}})+'\n');return new Promise<never>(()=>{});}
  return finalizer;
 }});
 if(!result.ok)throw Error('SECRET_FIXTURE_FAILED');
 process.stdout.write(JSON.stringify({state:'active',binding:provider.runtimeBinding()})+'\n');setInterval(()=>{},1000);
}catch{process.stderr.write('SECRET_FIXTURE_FAILED\n');process.exit(1);}
