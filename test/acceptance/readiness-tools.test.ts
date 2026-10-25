import {it,expect} from 'vitest';
import {verifyReadiness,parseReadinessConfig,readinessCredentials} from '../../scripts/verify-readiness.mjs';
const now=Date.parse('2026-10-25T05:00:00.000Z');
function fixture(){
 const input={origin:'https://isolated.example.invalid',environment_id:'isolated_fixture',workspace_id:'workspace_fixture',expected_actor_id:'human_fixture',expected_config_epoch:4,expected_schema_version:7,credential_fd:'3'};
 const health={observed_at:new Date(now).toISOString(),ready:true,checks:[...['schema','configuration','authentication_keys','cursor_key','recovery_binding','admission','storage_probe','scheduler_probe','scheduler','delivery'].map(name=>({name,status:'pass',code:name.endsWith('_probe')?'PROBE_CONFIRMED':'OBSERVED',checked_at:new Date(now-1000).toISOString()})),{name:'r2_artifacts',status:'unknown',code:'CAPABILITY_UNAVAILABLE_R1',checked_at:null}]};
 const responses=[
  {status:200,value:{request_id:'req_workspace',data:{id:'workspace_fixture',display_name:'Synthetic verifier fixture',contract_revision:'0.1',actor:{kind:'human',principal_id:'human_fixture',agent_id:null},effective_scopes:['workspace:read','operations:read']}}},
  {status:200,value:{request_id:'req_health',data:health}},
  {status:200,value:{request_id:'req_operations',data:{observed_at:health.observed_at,config_epoch:4,schema_version:7,readiness:health,outbox:{pending_count:0,in_flight_count:0,failed_count:0,suppressed_count:0,oldest_due_at:null,next_due_at:null},scheduler:{last_run_at:null,last_error_code:null}}}}
 ];
 const credentials={session_cookie:'cfhub_session='+'A'.repeat(43)},urls:string[]=[];
 const transport=async(url:URL)=>{urls.push(url.href);return responses.shift()!;};
 return {input,credentials,responses,urls,transport};
}
it('synthetic_transport_binds_workspace_actor_and_final_operations_epoch',async()=>{
 const f=fixture(),result=await verifyReadiness(f.input,f.credentials,f.transport,()=>now);
 expect(result).toMatchObject({ready:true,workspace_id:'workspace_fixture',config_epoch:4,schema_version:7,assurance:'authenticated-readiness-only'});
 expect(f.urls.map(x=>new URL(x).pathname)).toEqual(['/v2/workspaces/workspace_fixture','/v2/workspaces/workspace_fixture/readiness','/v2/workspaces/workspace_fixture/operations']);
 expect(JSON.stringify(result)).not.toContain(f.credentials.session_cookie);expect(JSON.stringify(result)).not.toContain(f.input.origin);
});
it('readiness_tool_rejects_wrong_actor_before_later_requests',async()=>{const f=fixture();(f.responses[0].value.data as any).actor.principal_id='another_human';await expect(verifyReadiness(f.input,f.credentials,f.transport,()=>now)).rejects.toThrow('READINESS_IDENTITY_MISMATCH');expect(f.urls).toHaveLength(1);});
it('readiness_tool_rejects_authority_changed_between_requests',async()=>{const f=fixture();(f.responses[2].value.data as any).config_epoch=5;await expect(verifyReadiness(f.input,f.credentials,f.transport,()=>now)).rejects.toThrow('READINESS_AUTHORITY_MISMATCH');});
it('readiness_tool_does_not_accept_a_challenge_with_a_success_body',async()=>{const f=fixture();f.responses[1].status=302;await expect(verifyReadiness(f.input,f.credentials,f.transport,()=>now)).rejects.toThrow('READINESS_HTTP_STATUS');expect(f.urls).toHaveLength(2);});
it('protected_readiness_inputs_reject_unsafe_target_headers_and_secret_fields',()=>{
 const f=fixture();
 for(const origin of ['http://isolated.example.invalid','https://127.0.0.1','https://user:password@isolated.example.invalid','https://isolated.example.invalid/path'])expect(()=>parseReadinessConfig({...f.input,origin})).toThrow();
 expect(()=>parseReadinessConfig({...f.input,session_cookie:f.credentials.session_cookie})).toThrow();
 expect(()=>readinessCredentials({...f.credentials,access_client_id:'id',access_client_secret:'value\r\nInjected: header'})).toThrow();
 expect(()=>readinessCredentials({...f.credentials,extra:'secret'})).toThrow();
});
