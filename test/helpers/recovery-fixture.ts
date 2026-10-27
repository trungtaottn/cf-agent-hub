import {env} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {fixture} from './environment';
import type {HistoricalStorageDO} from './historical-storage';
import {HistoricalOutboxScheduler} from './historical-scheduler';
import {DeliveryDispatcher} from '../../src/outbox/dispatcher';
import {canonicalJson,prepareBootstrap,sha256,installConfiguration} from '../../src/config/bootstrap';
import {systemClock,systemEntropy} from '../../src/workspace/context';
import {withTransaction} from '../../src/storage/transaction';
import {canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import {signRecord} from '../../src/recovery/manifest';
import {advanceCapture,readRecoveryChunk} from '../../src/recovery/capture';
import {beginRestore,writeRestoreChunk,advanceVerify} from '../../src/recovery/restore';
import type {RecoveryWorkspace,RecoveryContext,RecoveryOperation,RecoveryManifest,RecoveryJobProgress,CurrentLedger,LedgerAnchor} from '../../src/recovery/protocol';
export const fixtureIntegrity={keyId:'recovery_fixture',key:btoa('r'.repeat(32))};
export async function recoveryFixture(name:string,options:{disableCredential?:boolean;seed?:boolean}={}){
 const sourceName=name+'_source',targetName=name+'_target',captureId='capture_'+name;
 // Explicit historical schema7 host: these fixtures do not exercise production schema8 recovery.
 const namespace=(env as unknown as {HISTORICAL_WORKSPACE:DurableObjectNamespace<HistoricalStorageDO>}).HISTORICAL_WORKSPACE;
 const source=namespace.getByName(sourceName),target=namespace.getByName(targetName);
 const sourceMaterial=await fixture(sourceName,1);sourceMaterial.bundle.credentials[0].token_sha256=await sha256('A'.repeat(43));
 const sourceInput=await prepareBootstrap(sourceMaterial.config,sourceMaterial.bundle,'ws_example');await runInDurableObject(source,(_instance,state)=>withTransaction(state.storage,tx=>installConfiguration(tx,sourceInput.config,sourceInput,Date.now())));
 const targetMaterial=await fixture(targetName,2);targetMaterial.bundle.credentials[0].token_sha256=sourceMaterial.bundle.credentials[0].token_sha256;
 if(options.disableCredential??true){targetMaterial.config.static_credential_refs[0].enabled=false;targetMaterial.config.human_grants[0].enabled=false;}
 targetMaterial.bundle.config_digest=await sha256(canonicalJson(targetMaterial.config));
 const targetInput=await prepareBootstrap(targetMaterial.config,targetMaterial.bundle,'ws_example');
 const ledger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'fixture_target',authority_epoch:2,config:targetInput.config,verification_bundle:targetInput.bundle,installation_digest:targetInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const anchor:LedgerAnchor={authorityEpoch:2,sha256:await digestBytes(canonicalBytes(ledger))};
 const result={source,target,sourceName,targetName,captureId,sourceInput,targetInput,ledger,anchor};
 if(options.seed??true)await seedRecoveryHistory(result);return result;
}
export type RecoveryFixture=Awaited<ReturnType<typeof recoveryFixture>>;
export async function withRecoveryWorkspace<T>(f:RecoveryFixture,lane:'source'|'target',body:(workspace:RecoveryWorkspace)=>Promise<T>|T):Promise<T>{
 const name=lane==='source'?f.sourceName:f.targetName,stub=lane==='source'?f.source:f.target;
 return runInDurableObject(stub,(_instance,state)=>{const auth={storage:state.storage,workspaceId:'ws_example',objectName:name,secrets:env as unknown as Record<string,unknown>,clock:systemClock,entropy:systemEntropy};return body({storage:state.storage,bucket:env.RECOVERY_BUCKET,workspaceId:'ws_example',objectName:name,environmentId:'fixture_'+lane,clock:systemClock,entropy:systemEntropy,integrity:fixtureIntegrity,release:{revision:'synthetic_fixture',worker_version:'synthetic_fixture',binding_ids:['workspace_fixture','recovery_fixture'],catalog_mapping:{workspace_id:'ws_example',object_name:name}},repairSchedule:()=>new HistoricalOutboxScheduler(auth,new DeliveryDispatcher(auth)).repairSchedule()});});
}
export async function recoveryContext(w:RecoveryWorkspace,operation:RecoveryOperation,payload:unknown,captureId:string|null,options:{operationId?:string;anchor?:LedgerAnchor|null;expectedEpoch?:number}={}):Promise<RecoveryContext>{
 const current=withTransaction(w.storage,tx=>tx.one<{config_epoch:number;installation_digest:string}>('SELECT config_epoch,installation_digest FROM workspace_metadata WHERE id=1'));
 const operationId=options.operationId??'op_'+crypto.randomUUID(),expectedEpoch=options.expectedEpoch??current?.config_epoch??0;
 const body={operation,workspace_id:w.workspaceId,capture_id:captureId,expected_authority_epoch:expectedEpoch,operation_id:operationId,reason:'Synthetic R1 recovery fixture',payload};
 return {principalId:'operator_fixture',workspaceId:w.workspaceId,objectName:w.objectName,environmentId:w.environmentId,requestId:'request_'+crypto.randomUUID(),operationId,operation,captureId,expectedEpoch,expectedInstallationDigest:current?.installation_digest??null,proofExpiresAt:Date.now()+120000,requestFingerprint:await digestBytes(canonicalBytes(body)),ledgerAnchor:options.anchor??null};
}
async function seedRecoveryHistory(f:RecoveryFixture):Promise<void>{
 const grant=f.sourceInput.config.human_grants[0],agent=f.sourceInput.config.static_participants[0],destination=f.sourceInput.config.workspace_policies[0].notification_destinations[0],tokenDigest=await sha256('A'.repeat(43));
 await withRecoveryWorkspace(f,'source',w=>withTransaction(w.storage,tx=>{
  const now=w.clock.nowMs(),actor={kind:'agent',principal_id:agent.agent_id,agent_id:agent.agent_id};
  tx.exec('INSERT INTO threads (id,workspace_id,subject,created_at) VALUES (?,?,?,?)',['thread_fixture',w.workspaceId,'Recovery fixture',now]);
  tx.exec("INSERT INTO thread_participants (thread_id,participant_kind,participant_id) VALUES (?,'agent',?)",['thread_fixture',agent.agent_id]);
  tx.exec("INSERT INTO messages (id,workspace_id,thread_id,sender_kind,sender_principal_id,sender_agent_id,body,refs_json,created_at) VALUES (?,?,?,'agent',?,?,?,'[]',?)",['message_fixture',w.workspaceId,'thread_fixture',agent.agent_id,agent.agent_id,'Retained message body',now]);
  tx.exec('INSERT INTO inbox (message_id,recipient_agent_id,workspace_id,created_at,acknowledged_at) VALUES (?,?,?,?,NULL)',['message_fixture',agent.agent_id,w.workspaceId,now]);
  tx.exec("INSERT INTO events (id,workspace_id,type,actor_json,resource_type,resource_id,resource_version,thread_id,request_id,occurred_at,summary) VALUES (?,?,'message.accepted',?,'message',?,NULL,?,'request_fixture',?,'Message accepted.')",['event_fixture',w.workspaceId,canonicalJson(actor),'message_fixture','thread_fixture',now]);
  if(destination){const notification={payload_version:1,type:'message.accepted',delivery_id:'delivery_fixture',workspace_id:w.workspaceId,recipient_agent_id:agent.agent_id,message_id:'message_fixture',thread_id:'thread_fixture',event_id:'event_fixture',occurred_at:new Date(now).toISOString()};
   tx.exec("INSERT INTO outbox (id,workspace_id,message_id,destination_id,notification_id,payload_json,status,attempts,next_due_at,retry_multiplier,lease_token,lease_expires_at,last_status,last_error,created_at,updated_at,destination_snapshot_json) VALUES (?,?,?,? ,?,?,'pending',1,?,1,NULL,NULL,503,'network',?,?,?)",['delivery_fixture',w.workspaceId,'message_fixture',destination.destination_id,'delivery_fixture',canonicalJson(notification),now+3600000,now,now,canonicalJson({agent_id:agent.agent_id,url:destination.url,signing_key_ref:destination.signing_key_ref})]);}
  tx.exec('INSERT INTO preferences (principal_id,workspace_id,version,document_json,updated_at,record_id) VALUES (?,?,1,?,?,?)',[grant.principal_id,w.workspaceId,'{}',now,'pref_'+'1'.repeat(32)]);
  tx.exec('INSERT INTO sessions (id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,revoked_at,auth_epoch) VALUES (?,?,?,?,?,?,?,?,?,NULL,1)',['session_fixture',w.workspaceId,grant.principal_id,tokenDigest,'0'.repeat(64),grant.issuer,grant.subject,now,now+3600000]);
  tx.exec('INSERT INTO login_attempts (id,workspace_id,state_digest,nonce,pkce_verifier,cookie_digest,redirect_uri,created_at,expires_at,consumed_at,auth_epoch,return_path) VALUES (?,?,?,?,?,?,?,?,?,NULL,1,?)',['login_fixture',w.workspaceId,'1'.repeat(64),'nonce_fixture','verifier_fixture','2'.repeat(64),f.sourceInput.config.authentication.redirect_uris[0].redirect_uri,now,now+300000,'/inbox']);
  tx.exec("INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES (?,'domain.messages:send','messages','domain_fixture',?, ?,201,?,'request_fixture','event_fixture',?,?)",[agent.agent_id,w.workspaceId,'d'.repeat(64),canonicalJson({id:'message_fixture'}),now,now+86400000]);
  tx.exec("UPDATE sqlite_sequence SET seq=500 WHERE name='events'");
 }));
}
export async function captureFixture(f:RecoveryFixture,options:{evict?:boolean}={}):Promise<{progress:RecoveryJobProgress;manifest:RecoveryManifest;chunks:Array<{metadata:{capture_id:string;index:number;sha256:string;byte_size:number};bytes:ArrayBuffer}>}>{
 const budget={max_rows:10000,max_artifacts:0 as const,max_total_bytes:16777216};let result:RecoveryJobProgress|undefined;
 for(let step=0;step<100;step++){
  result=await withRecoveryWorkspace(f,'source',async w=>advanceCapture(w,await recoveryContext(w,'capture',{budget},f.captureId,{operationId:'capture_step_'+step}),budget));
  if(result.state!=='running')break;if(options.evict)await evictDurableObject(f.source);
 }
 if(result?.state!=='complete'||!result.manifest)throw Error('Fixture capture did not complete');const manifest=result.manifest,chunks=[];
 for(const entry of manifest.database.chunks)chunks.push(await withRecoveryWorkspace(f,'source',async w=>readRecoveryChunk(w,await recoveryContext(w,'read-chunk',{index:entry.index},f.captureId),entry.index)));
 return {progress:result,manifest,chunks};
}
export async function restoreFixture(f:RecoveryFixture,capture:Awaited<ReturnType<typeof captureFixture>>,options:{evict?:boolean}={}):Promise<RecoveryJobProgress>{
 let result=await withRecoveryWorkspace(f,'target',async w=>beginRestore(w,await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'restore_initial'}),capture.manifest,f.ledger));
 for(const chunk of capture.chunks){const metadata={index:chunk.metadata.index,sha256:chunk.metadata.sha256,byte_size:chunk.metadata.byte_size};result=await withRecoveryWorkspace(f,'target',async w=>writeRestoreChunk(w,await recoveryContext(w,'write-chunk',metadata,f.captureId,{anchor:f.anchor,operationId:'write_'+metadata.index}),metadata,new Uint8Array(chunk.bytes)));if(options.evict)await evictDurableObject(f.target);}
 for(let step=0;step<100&&result.state==='running';step++)result=await withRecoveryWorkspace(f,'target',async w=>advanceVerify(w,await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'verify_'+step}),capture.manifest));
 if(result.state!=='complete')throw Error('Fixture restore did not complete');return result;
}
export async function restoredFixture(name:string,options:{disableCredential?:boolean;evict?:boolean}={}){const fixture=await recoveryFixture(name,{disableCredential:options.disableCredential}),capture=await captureFixture(fixture,options),restored=await restoreFixture(fixture,capture,options);return {fixture,capture,restored};}
