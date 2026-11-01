import {mkdtempSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {ProtectedCredentialProvider} from '../../packages/cli/src/secret-store';
import {createNativeClient} from '../../packages/client/src/native-client';
import {binding} from './helpers';
export const syntheticToken='S'.repeat(43),syntheticProof='P'.repeat(43);
export async function protectedFixture(){
 const directory=mkdtempSync(join(dirname(process.cwd()),'b2-provider-test-'));let provider=new ProtectedCredentialProvider({directory,create:true});provider.importCredential(syntheticToken);
 const runtime={id:'runtime_synthetic',workspace_id:'ws_example',agent_id:'agent_synthetic',runtime_version:1,label:'Synthetic',status:'online' as const,last_seen_at:'2026-11-01T00:00:00Z',presence_expires_at:'2026-11-01T01:00:00Z',created_at:'2026-11-01T00:00:00Z'};
 const client=createNativeClient({origin:binding.origin,workspaceId:binding.workspaceId,credentialProvider:provider,fetch:async()=>Response.json({data:{runtime,runtime_token:syntheticProof,revealed:true},request_id:'synthetic_enrollment'},{status:201})});
 const result=await client.enrollRuntime({body:{label:'Synthetic'}},{idempotencyKey:'synthetic-only',captureRuntime:value=>provider.captureRuntime(value)});if(!result.ok)throw Error('SYNTHETIC_SETUP_FAILED');
 const frozen={...binding,principal:provider.binding()!,runtimeId:runtime.id};provider.close();provider=new ProtectedCredentialProvider({directory,create:false});
 return {provider,binding:frozen,directory,close(){provider.close();rmSync(directory,{recursive:true,force:true});}};
}
