/** Fixed local capture and restore driver; checks body budgets before chunk reads. */
import {evictDurableObject} from 'cloudflare:test';
import {advanceCapture,readRecoveryChunk} from '../../src/recovery/capture';
import {beginRestore,writeRestoreChunk,advanceVerify} from '../../src/recovery/restore';
import {signRecord} from '../../src/recovery/manifest';
import {canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import type {CurrentLedger,RecoveryJobProgress} from '../../src/recovery/protocol';
import {fixtureIntegrity,recoveryContext} from './recovery-fixture';
import {captureR3PrivateSnapshot} from './r3-journey-fixture';
import {withCurrentRecoveryWorkspace,type CurrentRestoreFixture} from '../recovery/current-restore-fixture';
function invalid():never{throw Error('J2_BOUNDED_RECOVERY_INVALID');}
export async function captureBounded(f:CurrentRestoreFixture){
 const source=await withCurrentRecoveryWorkspace(f,'source',w=>captureR3PrivateSnapshot(w.storage));
 if(source.artifacts.length>3||source.artifacts.some(a=>typeof a.byte_size!=='number'||!Number.isSafeInteger(a.byte_size)||a.byte_size<0||a.byte_size>65536))invalid();
 const ledger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_source',authority_epoch:f.sourceInput.config.config_epoch,config:f.sourceInput.config,verification_bundle:f.sourceInput.bundle,installation_digest:f.sourceInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity),anchor={authorityEpoch:ledger.authority_epoch,sha256:await digestBytes(canonicalBytes(ledger))},resolver={generation:1,anchor,calls:0};
 const budget={max_rows:4224,max_artifacts:3,max_total_bytes:2097152};let progress:RecoveryJobProgress|undefined;
 for(let step=0;step<300;step++){
  progress=await withCurrentRecoveryWorkspace(f,'source',async w=>advanceCapture(w,await recoveryContext(w,'capture',{budget},f.captureId,{anchor,operationId:'j2_capture_'+step}),budget),resolver);
  if(progress.state!=='running')break;await evictDurableObject(f.source);
 }
 if(progress?.state!=='complete'||!progress.manifest||progress.manifest.format_version!==2||progress.manifest.checkpoint.schema_version!==19)invalid();
 const manifest=progress.manifest;
 if(manifest.database.chunks.length>128||manifest.artifacts.length>3||manifest.artifacts.some(a=>a.byte_size>65536)||manifest.database.byte_size>2097152||manifest.database.chunks.some(c=>!Number.isSafeInteger(c.byte_size)||c.byte_size<0||c.byte_size>2097152)||manifest.database.chunks.reduce((n,c)=>n+c.byte_size,0)!==manifest.database.byte_size)invalid();
 const chunks=[];
 for(const entry of manifest.database.chunks){
  const part=await withCurrentRecoveryWorkspace(f,'source',async w=>readRecoveryChunk(w,await recoveryContext(w,'read-chunk',{index:entry.index},f.captureId,{anchor,operationId:'j2_read_'+entry.index}),entry.index),resolver);
  if(part.bytes.byteLength!==entry.byte_size||part.metadata.sha256!==entry.sha256)invalid();chunks.push(part);
 }
 return {progress,manifest,chunks};
}
export async function restoreBounded(f:CurrentRestoreFixture,capture:Awaited<ReturnType<typeof captureBounded>>){
 let progress=await withCurrentRecoveryWorkspace(f,'target',async w=>beginRestore(w,await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'j2_begin_restore'}),capture.manifest,f.ledger));
 for(const part of capture.chunks){const metadata={index:part.metadata.index,sha256:part.metadata.sha256,byte_size:part.metadata.byte_size};progress=await withCurrentRecoveryWorkspace(f,'target',async w=>writeRestoreChunk(w,await recoveryContext(w,'write-chunk',metadata,f.captureId,{anchor:f.anchor,operationId:'j2_write_'+metadata.index}),metadata,new Uint8Array(part.bytes)));await evictDurableObject(f.target);}
 for(let step=0;step<500&&progress.state==='running';step++){
  progress=await withCurrentRecoveryWorkspace(f,'target',async w=>advanceVerify(w,await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'j2_verify_'+step}),capture.manifest));await evictDurableObject(f.target);
 }
 if(progress.state!=='complete')invalid();return progress;
}
