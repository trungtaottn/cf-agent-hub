import {env} from 'cloudflare:workers';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import {signRecord} from '../../src/recovery/manifest';
import {canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import {fixtureIntegrity,recoveryContext} from '../helpers/recovery-fixture';
import {retireWorkspace,resumeWorkspace} from '../../src/recovery/controls';
import {recordProbe} from '../../src/recovery/probes';
import type {CurrentLedger,CutoverRecord} from '../../src/recovery/protocol';
import {captureCurrentFixture,withCurrentRecoveryWorkspace,type CurrentRestoreFixture} from './current-restore-fixture';
export async function resumeThenNext(f:CurrentRestoreFixture,capture:Awaited<ReturnType<typeof captureCurrentFixture>>,receipt:any,round:number):Promise<CurrentRestoreFixture>{
 const sourceLedger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_source',authority_epoch:f.sourceInput.config.config_epoch,config:f.sourceInput.config,verification_bundle:f.sourceInput.bundle,installation_digest:f.sourceInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 f.resolver.anchor={authorityEpoch:sourceLedger.authority_epoch,sha256:await digestBytes(canonicalBytes(sourceLedger))};
 const retirement=await withCurrentRecoveryWorkspace(f,'source',async w=>retireWorkspace(w,await recoveryContext(w,'retire',{},f.captureId,{anchor:f.resolver.anchor,operationId:'audit_retire_'+round})));
 f.resolver.anchor={...f.anchor};
 await withCurrentRecoveryWorkspace(f,'target',async w=>recordProbe(w,await recoveryContext(w,'probe',{},null,{anchor:f.anchor,operationId:'audit_probe_'+round})));
 const cutover=await signRecord<CutoverRecord>({id:'audit_cutover_'+round,capture_id:f.captureId,workspace_id:'ws_example',source_environment_id:'current_source',source_authority_epoch:sourceLedger.authority_epoch,target_environment_id:'current_target',target_authority_epoch:f.ledger.authority_epoch,source_retirement_receipt_id:retirement.id,target_catalog_mapping:{workspace_id:'ws_example',object_name:f.targetName},cutover_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const body={receipt_id:receipt.id,ledger:f.ledger,source_retirement_receipt:retirement,cutover_record:cutover};
 await withCurrentRecoveryWorkspace(f,'target',async w=>resumeWorkspace(w,await recoveryContext(w,'resume',body,f.captureId,{anchor:f.anchor,operationId:'audit_resume_'+round}),body));
 const targetName=f.targetName+'_next',config=structuredClone(f.targetInput.config),bundle=structuredClone(f.targetInput.bundle);config.config_epoch++;bundle.config_epoch=config.config_epoch;config.workspace_catalog[0].object_name=targetName;bundle.config_digest=await sha256(canonicalJson(config));
 const targetInput=await prepareBootstrap(config,bundle,'ws_example');
 const ledger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_target',authority_epoch:config.config_epoch,config,verification_bundle:bundle,installation_digest:targetInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const anchor={authorityEpoch:config.config_epoch,sha256:await digestBytes(canonicalBytes(ledger))};
 return {...f,source:f.target,sourceName:f.targetName,sourceInput:f.targetInput,target:env.WORKSPACE.getByName(targetName),targetName,targetInput,ledger,anchor,resolver:{generation:1,anchor:{...anchor},calls:0},captureId:f.captureId+'_next'};
}

import {expect} from 'vitest';
import {beginRestore,writeRestoreChunk,advanceVerify} from '../../src/recovery/restore';
import {verifyDecisionSourceRow} from '../../src/recovery/decision-graph';
import {isRestoreExpiryEvent} from '../../src/recovery/restore-audit';
import {isStagedRestoreExpiryEvent} from '../../src/recovery/restore-audit-history';
import {loadCurrentRestoreJob,saveCurrentRestoreJob} from '../../src/recovery/restore-job';
import {withTransaction} from '../../src/storage/transaction';
import type {Event} from '../../src/http/dto';
function eventFor(w:any):Event|null{
 const row=w.storage.sql.exec("SELECT * FROM events WHERE type='task.expired' AND json_extract(actor_json,'$.principal_id')='system:recovery' LIMIT 1").toArray()[0];
 if(!row)return null;return {...row,actor:JSON.parse(row.actor_json),occurred_at:new Date(row.occurred_at).toISOString()} as Event;
}
/** Actual failed verify reservation is retained; the test does not invent a pending operation. */
export async function restoreWithAuditChecks(f:CurrentRestoreFixture,capture:Awaited<ReturnType<typeof captureCurrentFixture>>){
 const work=<T>(fn:(w:import('../../src/recovery/protocol').RecoveryWorkspace)=>T|Promise<T>)=>withCurrentRecoveryWorkspace(f,'target',fn);
 let progress=await work(async w=>beginRestore(w,await recoveryContext(w,'restore',{manifest:capture.manifest,ledger:f.ledger},f.captureId,{anchor:f.anchor,operationId:'audit_graph_begin'}),capture.manifest,f.ledger));
 for(const chunk of capture.chunks){const metadata={index:chunk.metadata.index,sha256:chunk.metadata.sha256,byte_size:chunk.metadata.byte_size};progress=await work(async w=>writeRestoreChunk(w,await recoveryContext(w,'write-chunk',metadata,f.captureId,{anchor:f.anchor,operationId:'audit_graph_write_'+metadata.index}),metadata,new Uint8Array(chunk.bytes)));
  await work(w=>withTransaction(w.storage,tx=>{const event=eventFor(w);if(!event)return;const raw=tx.one<{id:string}>("SELECT id FROM recovery_jobs WHERE operation='restore'")!,job=loadCurrentRestoreJob(tx,raw.id)!;expect(isRestoreExpiryEvent(tx,event)).toBe(false);expect(isStagedRestoreExpiryEvent(tx,event,job)).toBe(false);}));
 }
 let checked=false;
 for(let step=0;step<500&&progress.state==='running';step++){
  const shouldCheck=await work(w=>withTransaction(w.storage,tx=>{const raw=tx.one<{id:string}>("SELECT id FROM recovery_jobs WHERE operation='restore'")!,job=loadCurrentRestoreJob(tx,raw.id)!;return !checked&&job.details.stage==='validate'&&job.details.manifest.database.chunks[job.details.verifyIndex]?.table==='decision_lifecycle_heads';}));
  const advance=()=>work(async w=>advanceVerify(w,await recoveryContext(w,'verify',{manifest:capture.manifest},f.captureId,{anchor:f.anchor,operationId:'audit_graph_verify_'+step}),capture.manifest));
  if(shouldCheck){
   const original=await work(w=>w.storage.sql.exec<{last_transition_id:string}>('SELECT last_transition_id FROM decision_lifecycle_heads').one().last_transition_id);
   await work(w=>w.storage.sql.exec("UPDATE decision_lifecycle_heads SET last_transition_id='synthetic_interruption'"));
   await expect(advance()).rejects.toThrow('RECOVERY_RESTORED_ROW_MISMATCH');
   await work(w=>w.storage.sql.exec('UPDATE decision_lifecycle_heads SET last_transition_id=?',original));
   await work(w=>withTransaction(w.storage,tx=>{
    const event=eventFor(w)!,raw=tx.one<{id:string}>("SELECT id FROM recovery_jobs WHERE operation='restore'")!,job=loadCurrentRestoreJob(tx,raw.id)!;
    expect(isRestoreExpiryEvent(tx,event)).toBe(false);expect(isStagedRestoreExpiryEvent(tx,event,job)).toBe(true);
    expect(isStagedRestoreExpiryEvent(tx,event,{...job,updated_at:job.updated_at+1})).toBe(false);expect(isStagedRestoreExpiryEvent(tx,event,{...job,id:'job_'+'e'.repeat(48)})).toBe(false);
    for(const patch of [{run_id:'run_b'},{task_version:event.task_version!+1},{workspace_id:'ws_other'}])expect(isStagedRestoreExpiryEvent(tx,{...event,...patch},job)).toBe(false);
    const head=tx.one<any>('SELECT * FROM decision_lifecycle_heads')!;expect(()=>verifyDecisionSourceRow(tx,'decision_lifecycle_heads',head)).toThrow('RECOVERY_DECISION_GRAPH_MISMATCH');expect(()=>verifyDecisionSourceRow(tx,'decision_lifecycle_heads',head,job)).not.toThrow();
    const record=tx.one<any>("SELECT * FROM idempotency_outcomes WHERE operation='operator.recovery.imported-audit'")!,original=JSON.parse(record.outcome_json);
    for(const patch of [{importer_job_id:'job_'+'f'.repeat(48)},{importer_manifest_digest:'f'.repeat(64)}]){tx.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE operation='operator.recovery.imported-audit'",[canonicalJson({...original,...patch})]);expect(isStagedRestoreExpiryEvent(tx,event,job)).toBe(false);}tx.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE operation='operator.recovery.imported-audit'",[record.outcome_json]);
    for(const [column,value] of [['fingerprint','f'.repeat(64)],['workspace_id','ws_other'],['created_at',record.created_at+1]] as const){tx.exec("UPDATE idempotency_outcomes SET "+column+"=? WHERE operation='operator.recovery.imported-audit'",[value]);expect(isStagedRestoreExpiryEvent(tx,event,job)).toBe(false);tx.exec("UPDATE idempotency_outcomes SET "+column+"=? WHERE operation='operator.recovery.imported-audit'",[record[column]]);}
    for(const patch of [{stage:'import'},{phase:'hash_chunks'},{pending:null},{pending:{...job.details.pending,kind:'write'}}]){const changed=structuredClone(job);Object.assign(changed.details,patch);saveCurrentRestoreJob(tx,changed);expect(isStagedRestoreExpiryEvent(tx,event,changed)).toBe(false);saveCurrentRestoreJob(tx,job);}
    tx.exec("UPDATE idempotency_outcomes SET operation='operator.synthetic.absent' WHERE operation='operator.recovery.imported-audit'");expect(isStagedRestoreExpiryEvent(tx,event,job)).toBe(false);tx.exec("UPDATE idempotency_outcomes SET operation='operator.recovery.imported-audit' WHERE operation='operator.synthetic.absent'");
    expect(isStagedRestoreExpiryEvent(tx,event,job)).toBe(true);expect(isRestoreExpiryEvent(tx,event)).toBe(false);
   }));checked=true;
  }
  progress=await advance();
 }
 expect(checked).toBe(true);expect(progress.state).toBe('complete');await work(w=>withTransaction(w.storage,tx=>expect(isRestoreExpiryEvent(tx,eventFor(w)!)).toBe(true)));
 return progress;
}
