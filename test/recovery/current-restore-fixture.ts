import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {setupReview,committedEvidence,client,submission,proof,sessionToken,token,other,rotated} from '../helpers/results';
import {claimContext,claimIdentity} from '../helpers/claims';
import {claimTaskCommand} from '../../src/tasks/claim';
import {executeCommand} from '../../src/workspace/commands';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import {systemClock,systemEntropy} from '../../src/workspace/context';
import {fixtureIntegrity,recoveryContext} from '../helpers/recovery-fixture';
import {signRecord} from '../../src/recovery/manifest';
import {canonicalBytes,digestBytes,decodeCurrentChunk,encodeCurrentChunk,type SqlCell} from '../../src/recovery/encoding';
import {advanceCapture,readRecoveryChunk} from '../../src/recovery/capture';
import {beginRestore,writeRestoreChunk,advanceVerify} from '../../src/recovery/restore';
import {human,owned,commandContext} from '../helpers/settings';
import {catalogProfile} from '../helpers/catalog';
import {messageInput} from '../helpers/messages';
import {messageCommand} from '../../src/messages/commands';
import {issueCredentialCommand} from '../../src/auth/native-credentials';
import {createAgentCommand,archiveAgentCommand} from '../../src/agents/commands';
import {previewCatalogCommand} from '../../src/config/catalog-commands';
import {importRoutes} from '../../src/http/import-routes';
import {importBatch,importRow,applyBody} from '../imports/helpers';
import {csrfToken} from '../../src/auth/csrf';
import {withTransaction} from '../../src/storage/transaction';
import type {SessionRecord} from '../../src/auth/authorize';
import type {ImportPreview} from '../../src/http/dto';
import {artifactBucket} from '../helpers/artifacts';
import type {CurrentLedger,CurrentRecoveryManifest,LedgerAnchor,RecoveryWorkspace,RecoveryJobProgress} from '../../src/recovery/protocol';

/** Synthetic isolated current-schema fixture. Source artifacts are made through domain commands. */
export async function currentRestoreFixture(name:string,options:{seed?:boolean;artifacts?:boolean;rich?:boolean}={}){
 const sourceName=name+'_source',targetName=name+'_target',captureId='capture_'+name;
 const raw=await fixture(sourceName);
 raw.config.human_grants[0].scopes=[...new Set([...raw.config.human_grants[0].scopes,'tasks:read','tasks:create','tasks:edit','tasks:schedule','tasks:cancel','tasks:review','artifacts:read','artifacts:write','agents:read','agents:manage','credentials:manage','imports:manage'] as const)];
 const scopes=['workspace:read','events:read','tasks:read','tasks:claim','tasks:execute','tasks:review','runtimes:manage','artifacts:read','artifacts:write','messages:read','messages:send'] as const;
 const credential={...raw.config.static_credential_refs[0],scopes:[...scopes]};
 raw.config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_other',display_name:'Other synthetic agent'});
 raw.config.static_credential_refs=[credential,{...credential,credential_id:'credential_research_2'},{...credential,credential_id:'credential_other',agent_id:'agent_other'}];
 raw.bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_research_2',token_sha256:'2'.repeat(64)},{workspace_id:'ws_example',credential_id:'credential_other',token_sha256:'3'.repeat(64)});
 // setupReview binds these synthetic secrets; install the same immutable hashes in both signed authorities.
 for(const [id,value] of [['credential_research_1',token],['credential_other',other],['credential_research_2',rotated]])raw.bundle.credentials.find(c=>c.credential_id===id)!.token_sha256=await sha256(value);
 raw.config.workspace_policies[0].execution_policy={policy_version:7,agent_wip_limit:2,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research','agent_other']},{project_id:'project_a',work_role_id:'role_a',eligible_agent_ids:['agent_research','agent_other']}],replay_safety_rules:[{id:'synthetic_safe',project_id:null,work_role_id:null,classification:'replay_safe',evidence_ref:'urn:synthetic:restore-fixture'}]};
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const sourceInput=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),source=env.WORKSPACE.getByName(sourceName),target=env.WORKSPACE.getByName(targetName);
 await source.reconcileConfiguration(operator(),sourceInput);
 const targetMaterial=structuredClone(raw);targetMaterial.config.config_epoch=2;targetMaterial.config.workspace_catalog[0].object_name=targetName;targetMaterial.bundle.config_epoch=2;
 targetMaterial.config.static_credential_refs.find(c=>c.credential_id==='credential_research_2')!.enabled=false;
 targetMaterial.bundle.config_digest=await sha256(canonicalJson(targetMaterial.config));
 const targetInput=await prepareBootstrap(targetMaterial.config,targetMaterial.bundle,'ws_example');
 const ledger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_target',authority_epoch:2,config:targetInput.config,verification_bundle:targetInput.bundle,installation_digest:targetInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const anchor:LedgerAnchor={authorityEpoch:2,sha256:await digestBytes(canonicalBytes(ledger))};
 const resolver={generation:1,anchor:{...anchor},calls:0};
 const f={source,target,sourceName,targetName,captureId,sourceInput,targetInput,ledger,anchor,resolver};
 if(options.seed??true)await seedCurrentRestoreHistory(f,options.artifacts??true);
 if(options.rich)await seedRichCurrentRestoreHistory(f,options.artifacts??true);
 return f;
}
export type CurrentRestoreFixture=Awaited<ReturnType<typeof currentRestoreFixture>>;
export function targetArtifactBucket():R2Bucket{return (env as unknown as {TEST_RESTORE_ARTIFACT_BUCKET:R2Bucket}).TEST_RESTORE_ARTIFACT_BUCKET;}
export async function withCurrentRecoveryWorkspace<T>(f:CurrentRestoreFixture,lane:'source'|'target',body:(w:RecoveryWorkspace)=>Promise<T>|T):Promise<T>{
 const stub=lane==='source'?f.source:f.target,name=lane==='source'?f.sourceName:f.targetName;
 return runInDurableObject(stub,(_instance,state)=>{
  const workspace={storage:state.storage,bucket:env.RECOVERY_BUCKET,artifactBucket:lane==='source'?artifactBucket():targetArtifactBucket(),workspaceId:'ws_example',objectName:name,environmentId:'current_'+lane,clock:systemClock,entropy:systemEntropy,integrity:fixtureIntegrity,release:{revision:'synthetic_current_restore',worker_version:'synthetic_current_restore',binding_ids:['recovery_fixture',lane==='source'?'source_artifact_fixture':'target_artifact_fixture','anchor_fixture'],catalog_mapping:{workspace_id:'ws_example',object_name:name}},repairSchedule:async()=>({armed:false,nextDueAt:null,generation:0,dirty:false}),trustedAnchor:{bindingId:'anchor_fixture',binding:{fetch:async(_request:Request)=>{f.resolver.calls++;return Response.json({workspace_id:'ws_example',environment_id:'current_'+lane,object_name:name,authority_epoch:f.resolver.anchor.authorityEpoch,ledger_sha256:f.resolver.anchor.sha256,generation:f.resolver.generation});}}}} satisfies RecoveryWorkspace & {trustedAnchor:unknown};
  return body(workspace);
 });
}
async function seedCurrentRestoreHistory(f:CurrentRestoreFixture,artifacts:boolean):Promise<void>{
 await runInDurableObject(f.source,async(_instance,state)=>{
  const now=await setupReview(state.storage,f.sourceName);
  if(artifacts)await committedEvidence(state.storage,f.sourceName,now,'artifact_a');
  const send=await client(state.storage,f.sourceName,now);
  const submitted=await send('submit-result',submission(artifacts?['artifact_a']:[]));
  if(submitted.status!==200)throw Error('Synthetic result submission failed: '+await submitted.text());
  const version=state.storage.sql.exec<{task_version:number}>("SELECT task_version FROM tasks WHERE id='task_a'").one().task_version;
  const accepted=await send('accept-result',{expected_version:version,reason:'Synthetic independent acceptance'},'accept_fixture','human',undefined);
  if(accepted.status!==200)throw Error('Synthetic result acceptance failed: '+await accepted.text());
  const body={expected_version:2,runtime_instance_id:'runtime_a'};
  await executeCommand(await claimContext(state.storage,f.sourceName,body,'claim_b',now,'task_b'),claimIdentity(state.storage),claimTaskCommand('task_b','run_b',await sha256(proof)),body);
  state.storage.sql.exec("INSERT INTO login_attempts(id,workspace_id,state_digest,nonce,pkce_verifier,cookie_digest,redirect_uri,created_at,expires_at,consumed_at,auth_epoch,return_path) VALUES('login_restore','ws_example',?,'synthetic_nonce','synthetic_verifier',?,?,?, ?,NULL,1,'/tasks')",'a'.repeat(64),'b'.repeat(64),f.sourceInput.config.authentication.redirect_uris[0].redirect_uri,now,now+300000);
 });
}
export async function captureCurrentFixture(f:CurrentRestoreFixture,options:{evict?:boolean}={}){
 const budget={max_rows:1000000,max_artifacts:1000,max_total_bytes:268435456};let progress:RecoveryJobProgress|undefined;
 for(let step=0;step<300;step++){
  progress=await withCurrentRecoveryWorkspace(f,'source',async w=>advanceCapture(w,await recoveryContext(w,'capture',{budget},f.captureId,{operationId:'capture_'+step}),budget));
  if(progress.state!=='running')break;if(options.evict)await evictDurableObject(f.source);
 }
 if(progress?.state!=='complete'||!progress.manifest||progress.manifest.format_version!==2||progress.manifest.checkpoint.schema_version!==16)throw Error('Genuine current capture failed');
 const manifest=progress.manifest as CurrentRecoveryManifest,chunks=[];
 for(const entry of manifest.database.chunks)chunks.push(await withCurrentRecoveryWorkspace(f,'source',async w=>readRecoveryChunk(w,await recoveryContext(w,'read-chunk',{index:entry.index},f.captureId),entry.index)));
 return {progress,manifest,chunks};
}
export async function restoreCurrentFixture(f:CurrentRestoreFixture,capture:Awaited<ReturnType<typeof captureCurrentFixture>>,options:{evict?:boolean}={}){
 let progress=await withCurrentRecoveryWorkspace(f,'target',async w=>beginRestore(w,await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'begin_current_restore'}),capture.manifest,f.ledger));
 for(const chunk of capture.chunks){const metadata={index:chunk.metadata.index,sha256:chunk.metadata.sha256,byte_size:chunk.metadata.byte_size};progress=await withCurrentRecoveryWorkspace(f,'target',async w=>writeRestoreChunk(w,await recoveryContext(w,'write-chunk',metadata,f.captureId,{anchor:f.anchor,operationId:'write_'+metadata.index}),metadata,new Uint8Array(chunk.bytes)));if(options.evict)await evictDurableObject(f.target);}
 for(let step=0;step<500&&progress.state==='running';step++){
  progress=await withCurrentRecoveryWorkspace(f,'target',async w=>advanceVerify(w,await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'verify_'+step}),capture.manifest));
  if(options.evict)await evictDurableObject(f.target);
 }
 if(progress.state!=='complete')throw Error('Current restore did not finish');return progress;
}

/** Additional domain-generated histories; kept optional so the smallest RED remains focused. */
export async function seedRichCurrentRestoreHistory(f:CurrentRestoreFixture,artifacts=true):Promise<void>{
 await runInDurableObject(f.source,async(_instance,{storage})=>{
  catalogProfile(storage);
  const identity=human(storage);
  const created={display_name:'Archived synthetic worker',description:'Historical identity',work_role_ids:[]};
  await executeCommand(await commandContext(storage,f.sourceName,created,'create_archived'),identity,createAgentCommand('agent_archived'),created);
  const live={...created,display_name:'Active synthetic worker'};
  await executeCommand(await commandContext(storage,f.sourceName,live,'create_managed'),identity,createAgentCommand('agent_managed'),live);
  const credential={agent_id:'agent_managed',label:'Synthetic delegated reader',scopes:['tasks:read' as const],project_ids:null,expires_at:new Date(Date.now()+86400000).toISOString()};
  await executeCommand(await commandContext(storage,f.sourceName,credential,'issue_managed'),identity,issueCredentialCommand({credentialId:'credential_managed',tokenSha256:'f'.repeat(64)}),credential);
  const archive={expected_agent_version:1,reason:'Synthetic archived identity'};
  await executeCommand(await commandContext(storage,f.sourceName,archive,'archive_identity'),identity,archiveAgentCommand('agent_archived'),archive);
  const message=messageInput({recipient_agent_ids:['agent_other'],artifact_ids:artifacts?['artifact_a']:[]});
  await executeCommand(await commandContext(storage,f.sourceName,message,'message_history'),claimIdentity(storage),messageCommand(owned(storage,f.sourceName)),message);
  const catalog={expected_profile_revision:1,kind:'project' as const,id:'project_b',operation:'archive' as const,replacement_id:null,reason:'Synthetic pending catalog change'};
  await executeCommand(await commandContext(storage,f.sourceName,catalog,'catalog_preview'),identity,previewCatalogCommand('catalog_pending'),catalog);
  const workspace=owned(storage,f.sourceName),csrf=await csrfToken(workspace,withTransaction(storage,tx=>tx.one<SessionRecord>("SELECT * FROM sessions WHERE id='session_settings'")!));
  const send=async(path:string,body:unknown,key:string)=>{
   const response=await importRoutes(new Request('https://hub.example.invalid/v2/workspaces/ws_example/'+path,{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,cookie:'cfhub_session='+sessionToken,origin:'https://hub.example.invalid','x-csrf-token':csrf},body:JSON.stringify(body)}),workspace);
   if(response.status!==200)throw Error('Synthetic import '+path+' failed: '+await response.text());
   return (await response.json() as {data:ImportPreview}).data;
  };
  const applied=await send('imports:preview',importBatch([importRow('applied_external')]),'import_applied_preview');
  await send('imports/'+applied.id+':apply',applyBody(applied),'import_apply');
  await send('imports:preview',importBatch([importRow('pending_external')]),'import_pending_preview');
 });
}


/** Re-sign bounded, canonical in-memory copies only. Original source objects and capture remain untouched. */
export async function mutateAuthenticatedCapture(
 capture:Awaited<ReturnType<typeof captureCurrentFixture>>,
 mutate:(table:string,row:Record<string,SqlCell>)=>void,
):Promise<Awaited<ReturnType<typeof captureCurrentFixture>>>{
 const copy=structuredClone(capture),encoded:Uint8Array<ArrayBuffer>[]=[];
 for(const part of copy.chunks){
  const chunk=decodeCurrentChunk(new Uint8Array(part.bytes));
  if(chunk.rows.length>200)throw Error('Fixture row bound exceeded');
  chunk.rows=chunk.rows.map(cells=>{const row=Object.fromEntries(chunk.columns.map((column,i)=>[column,cells[i]]));mutate(chunk.table,row);return chunk.columns.map(column=>row[column]);});
  const bytes=encodeCurrentChunk(chunk),sha256=await digestBytes(bytes);
  part.bytes=bytes.buffer;part.metadata={...part.metadata,sha256,byte_size:bytes.length};encoded.push(bytes);
  const entry=copy.manifest.database.chunks[chunk.index];entry.sha256=sha256;entry.byte_size=bytes.length;
 }
 const stream=new (crypto as Crypto&{DigestStream:typeof DigestStream}).DigestStream('SHA-256'),writer=stream.getWriter();
 for(const bytes of encoded)await writer.write(bytes);await writer.close();
 copy.manifest.database.sha256=Array.from(new Uint8Array(await stream.digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 copy.manifest.database.byte_size=encoded.reduce((sum,bytes)=>sum+bytes.length,0);
 copy.manifest=await signRecord(copy.manifest,fixtureIntegrity);
 copy.progress.manifest=copy.manifest;
 return copy;
}
