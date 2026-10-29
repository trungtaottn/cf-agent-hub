import {it,expect} from 'vitest';
import {beginRestore,writeRestoreChunk,advanceVerify} from '../../src/recovery/restore';
import {resolveDelivery,retireWorkspace,resumeWorkspace} from '../../src/recovery/controls';
import {recordProbe} from '../../src/recovery/probes';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry';
import type {RecoveryWorkspace,CurrentLedger} from '../../src/recovery/protocol';
import {recoveryContext,fixtureIntegrity} from '../helpers/recovery-fixture';
import {signRecord} from '../../src/recovery/manifest';
import {canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import {messageInput,owned,commandContext} from '../helpers/messages';
import {claimIdentity} from '../helpers/claims';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {currentRestoreFixture,captureCurrentFixture,withCurrentRecoveryWorkspace} from './current-restore-fixture';

function snapshot(w:RecoveryWorkspace){return [...TABLE_REGISTRY.map(table=>[table.name,w.storage.sql.exec('SELECT * FROM "'+table.name+'" ORDER BY '+table.primaryKey.map(k=>'"'+k+'"').join(',')).toArray()]),['sqlite_sequence',w.storage.sql.exec('SELECT name,seq FROM sqlite_sequence ORDER BY name').toArray()]];}
function blockEffects(w:RecoveryWorkspace){
 let calls=0;const deny=async()=>{calls++;throw Error('UNEXPECTED_EXTERNAL_EFFECT');};
 const guardBucket=(base:R2Bucket)=>new Proxy(base,{get(target,key){if(['get','head','put','delete','list'].includes(String(key)))return deny;const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
 const storage=new Proxy(w.storage,{get(target,key){if(['setAlarm','deleteAlarm','put','delete','deleteAll'].includes(String(key)))return deny;const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
 return {workspace:{...w,storage,trustedAnchor:undefined,bucket:guardBucket(w.bucket),artifactBucket:w.artifactBucket?guardBucket(w.artifactBucket):undefined,repairSchedule:async()=>{calls++;throw Error('UNEXPECTED_SCHEDULER_EFFECT');}},calls:()=>calls};
}
it('all seven current16 mutable controllers deny missing trusted binding without SQL or external effects',async()=>{
 const f=await currentRestoreFixture('current_controller_binding_required',{artifacts:false});
 const deliveryId=await withCurrentRecoveryWorkspace(f,'source',async w=>{
  const message=messageInput();await executeCommand(await commandContext(w.storage,f.sourceName,message,'binding_message'),claimIdentity(w.storage),messageCommand(owned(w.storage,f.sourceName)),message);
  const id=w.storage.sql.exec<{id:string}>('SELECT id FROM outbox ORDER BY id LIMIT 1').one().id;
  w.storage.sql.exec("UPDATE outbox SET status='in_flight',attempts=1,lease_token='binding_lease',lease_expires_at=? WHERE id=?",Date.now()+3600000,id);return id;
 });
 const capture=await captureCurrentFixture(f);
 const sourceLedger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_source',authority_epoch:f.sourceInput.config.config_epoch,config:f.sourceInput.config,verification_bundle:f.sourceInput.bundle,installation_digest:f.sourceInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const sourceAnchor={authorityEpoch:sourceLedger.authority_epoch,sha256:await digestBytes(canonicalBytes(sourceLedger))};
 let denied=0;
 await withCurrentRecoveryWorkspace(f,'target',async w=>{
  const ctx=await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'binding_begin'}),blocked=blockEffects(w),before=snapshot(w);
  await expect(beginRestore(blocked.workspace,ctx,capture.manifest,f.ledger)).rejects.toThrow('RECOVERY_ANCHOR_UNAVAILABLE');denied++;
  expect(snapshot(w)).toEqual(before);expect(blocked.calls()).toBe(0);
  await beginRestore(w,ctx,capture.manifest,f.ledger);
  const chunk=capture.chunks[0],metadata={index:chunk.metadata.index,sha256:chunk.metadata.sha256,byte_size:chunk.metadata.byte_size};
  for(const operation of ['write-chunk','verify'] as const){
   const body=operation==='write-chunk'?metadata:{manifest:capture.manifest},context=await recoveryContext(w,operation,body,f.captureId,{anchor:f.anchor,operationId:'binding_'+operation}),guarded=blockEffects(w),state=snapshot(w);
   const pending=operation==='write-chunk'?writeRestoreChunk(guarded.workspace,context,metadata,new Uint8Array(chunk.bytes)):advanceVerify(guarded.workspace,context,capture.manifest);
   await expect(pending).rejects.toThrow('RECOVERY_ANCHOR_UNAVAILABLE');denied++;expect(snapshot(w)).toEqual(state);expect(guarded.calls()).toBe(0);
  }
 });
 await withCurrentRecoveryWorkspace(f,'source',async w=>{
  for(const operation of ['probe','resolve-delivery','retire','resume'] as const){
   const delivery={delivery_id:deliveryId,disposition:'failed_without_redrive' as const,evidence_sha256:'a'.repeat(64)},resume={receipt_id:capture.progress.receipt!.id,ledger:sourceLedger,source_retirement_receipt:null,cutover_record:null};
   const body=operation==='resolve-delivery'?delivery:operation==='resume'?resume:{},ctx=await recoveryContext(w,operation,body,operation==='probe'?null:f.captureId,{anchor:sourceAnchor,operationId:'binding_'+operation}),guarded=blockEffects(w),before=snapshot(w);
   const pending=operation==='probe'?recordProbe(guarded.workspace,ctx):operation==='resolve-delivery'?resolveDelivery(guarded.workspace,ctx,delivery):operation==='retire'?retireWorkspace(guarded.workspace,ctx):resumeWorkspace(guarded.workspace,ctx,resume);
   await expect(pending).rejects.toThrow('RECOVERY_ANCHOR_UNAVAILABLE');denied++;expect(snapshot(w)).toEqual(before);expect(guarded.calls()).toBe(0);
  }
 });
 expect(denied).toBe(7);
},60000);
