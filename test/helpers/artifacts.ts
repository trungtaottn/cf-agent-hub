import {env} from 'cloudflare:workers';
import {fixture,operator} from './environment';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import {claimSetup,claimIdentity,PROOF_A} from './claims';
import {owned} from './settings';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import {executeCommand} from '../../src/workspace/commands';
import {stageArtifactCommand} from '../../src/artifacts/commands';
import type {ArtifactStageRequest} from '../../src/http/dto';
import type {ArtifactOperationContext} from '../../src/artifacts/content';
export const artifactBucket=()=> (env as unknown as {ARTIFACT_BUCKET:R2Bucket}).ARTIFACT_BUCKET;
export async function artifactFixture(name:string,extraScopes:('messages:read'|'messages:send')[]=[]){
 const raw=await fixture(name);
 raw.config.human_grants[0].scopes=[...new Set([...raw.config.human_grants[0].scopes,'tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:cancel','artifacts:read','artifacts:write'] as const)];
 const scopes=['workspace:read','events:read','tasks:read','tasks:claim','tasks:execute','runtimes:manage','artifacts:read','artifacts:write',...extraScopes] as const;
 const cred={...raw.config.static_credential_refs[0],scopes:[...scopes]};
 raw.config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_other',display_name:'Other synthetic agent'});
 raw.config.static_credential_refs=[cred,{...cred,credential_id:'credential_research_2'},{...cred,credential_id:'credential_other',agent_id:'agent_other'}];
 raw.bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_research_2',token_sha256:'2'.repeat(64)},{workspace_id:'ws_example',credential_id:'credential_other',token_sha256:'3'.repeat(64)});
 raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:2,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research','agent_other']},{project_id:'project_a',work_role_id:'role_a',eligible_agent_ids:['agent_research','agent_other']}],replay_safety_rules:[]};
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),input);return {stub,name,input};
}
export function artifactContext(storage:DurableObjectStorage,name:string,key:string,now=Date.now()):ArtifactOperationContext{
 return {workspace:{...owned(storage,name),clock:{nowMs:()=>now}},identity:claimIdentity(storage),requestId:'artifact_'+key,idempotencyKey:key,admission:{authorityEpoch:1,maintenanceGeneration:0},runtimeId:'runtime_a',proofHash:PROOF_A,bucket:artifactBucket()};
}
export async function stage(ctx:ArtifactOperationContext,id='artifact_a',input:Partial<ArtifactStageRequest>={}){
 const body:ArtifactStageRequest={task_id:null,run_id:null,filename:'evidence.txt',media_type:'text/plain',byte_size:5,sha256:await sha256('hello'),...input};
 return executeCommand({workspace:ctx.workspace,requestId:ctx.requestId,idempotencyKey:'stage_'+id,fingerprint:await fingerprintRequest('POST','/artifacts',{},body),admissionEpoch:ctx.admission.authorityEpoch,admissionGeneration:ctx.admission.maintenanceGeneration},ctx.identity,stageArtifactCommand(id,ctx.runtimeId,ctx.proofHash),body).data;
}
export const bytes=(text='hello')=>new Blob([text]).stream();
export function chunkStream(size:number,byte=7,chunkSize=65536):ReadableStream<Uint8Array>{let offset=0;return new ReadableStream({pull(c){if(offset===size)return c.close();const n=Math.min(chunkSize,size-offset);offset+=n;c.enqueue(new Uint8Array(n).fill(byte));}},{highWaterMark:0});}
export {claimSetup};
export function wrapBucket(base:R2Bucket,overrides:Partial<Pick<R2Bucket,'put'|'get'>>):R2Bucket{
 return new Proxy(base,{get(target,key){const override=overrides[key as keyof typeof overrides];if(override)return override;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
}
