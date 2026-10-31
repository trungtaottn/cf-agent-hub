import {vi} from 'vitest';
import {createNativeClient} from '../../packages/client/src/native-client';
import type {CredentialProvenance,CredentialDispatchLease,CredentialProvider,NativeClientOptions} from '../../packages/client/src/types';
export const nativeOrigin='https://hub.example.invalid';
export const secret='A'.repeat(43),proof='B'.repeat(43);
export const runtime={id:'runtime_one',workspace_id:'ws',agent_id:'agent_one',runtime_version:1,label:'Runtime',status:'online' as const,last_seen_at:'2026-10-27T00:00:00Z',presence_expires_at:'2026-10-27T00:01:30Z',created_at:'2026-10-27T00:00:00Z'};
export const configuration={config_epoch:1,profile_revision:1,preferences_revision:0,allowed_user_overrides:[],enabled_features:['workspace']};
export const ok=(data:unknown,status=200)=>Response.json({data,request_id:'req_native'},{status});
export const denied=(code='FORBIDDEN',status=403)=>Response.json({error:{code,message:'secret upstream detail '+secret,retryable:false,request_id:'req_denied',details:{current_version:2}}},{status});
export function nativeFixture(options:Partial<NativeClientOptions>={}){
 const state={generation:1,provenance:null as CredentialProvenance|null,current:true};
 const releases=vi.fn();
 const acquire=vi.fn(async():Promise<CredentialDispatchLease>=>{
  const generation=state.generation,provenance=state.provenance;
  return {slotId:'slot_one',slotGeneration:generation,provenance,isCurrent:()=>state.current&&state.generation===generation,use:dispatch=>dispatch(secret),release:releases};
 });
 const provider:CredentialProvider={acquire};
 const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>ok(configuration));
 const client=createNativeClient({origin:nativeOrigin,workspaceId:'ws',credentialProvider:provider,fetch,...options});
 const enroll=async()=>{
  fetch.mockImplementationOnce(async()=>ok({runtime,runtime_token:proof,revealed:true},201));
  return client.enrollRuntime({body:{label:'Runtime'}},{idempotencyKey:'enroll-key',captureRuntime:capture=>{state.provenance=capture.provenance;}});
 };
 return {client,fetch,provider,acquire,releases,state,enroll};
}
