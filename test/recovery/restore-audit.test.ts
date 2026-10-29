import {it,expect} from 'vitest';
import {cleanupCompletedOutcomes} from '../../src/workspace/idempotency';
import {currentRestoreFixture,captureCurrentFixture,restoreCurrentFixture,withCurrentRecoveryWorkspace} from './current-restore-fixture';
import {projectEvent,resourceEventVisibility} from '../../src/audit/events';
import {resolveActor} from '../../src/auth/authorize';
import {withTransaction} from '../../src/storage/transaction';
import {human} from '../helpers/settings';
import {isRestoreExpiryEvent,RESTORE_EXPIRY_SUMMARY} from '../../src/recovery/restore-audit';

it('projects genuine completed restore audit only with exact nonimportable provenance and current visibility',async()=>{
 const f=await currentRestoreFixture('restore_audit_projection',{artifacts:false}),capture=await captureCurrentFixture(f);await restoreCurrentFixture(f,capture,{evict:true});
 await withCurrentRecoveryWorkspace(f,'target',w=>{
  const s=w.storage,id=s.sql.exec<{id:string}>("SELECT id FROM events WHERE type='task.expired' AND json_extract(actor_json,'$.principal_id')='system:recovery'").one().id;
  // Explicit projection-only post-resume simulation; this does not test the resume controller.
  s.sql.exec("UPDATE maintenance_state SET state='open',barrier_id=NULL,capture_id=NULL,generation=generation+1");s.sql.exec("UPDATE workspace_metadata SET admission_state='installed'");
  const identity=human(s);s.sql.exec("UPDATE sessions SET revoked_at=NULL,auth_epoch=2 WHERE id='session_settings'");
  const read=(custom=false)=>withTransaction(s,tx=>projectEvent(tx,resolveActor(tx,identity,Date.now()),id,Date.now(),custom?()=>true:resourceEventVisibility));
  const event=read();expect(event).toMatchObject({id,type:'task.expired',resource_id:'task_b',run_id:'run_b',actor:{kind:'system',principal_id:'system:recovery'},summary:RESTORE_EXPIRY_SUMMARY});
  expect(withTransaction(s,tx=>isRestoreExpiryEvent(tx,event!))).toBe(true);
  const stored=s.sql.exec<{target:string;outcome_json:string}>("SELECT target,outcome_json FROM idempotency_outcomes WHERE operation='operator.recovery.audit' AND key=?",id).one();
  const record=JSON.parse(stored.outcome_json);
  for(const change of [{manifest_digest:'f'.repeat(64)},{row_offset:200},{chunk_index:0},{source_task_version:record.source_task_version+1},{run_id:'run_a'},{task_id:'task_a'},{occurred_at:record.occurred_at+1},{extra:'forged'}]){
   s.sql.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE operation='operator.recovery.audit' AND key=?",JSON.stringify({...record,...change}),id);expect(read(),JSON.stringify(change)).toBeNull();expect(read(true)).toBeNull();
  }
  s.sql.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE operation='operator.recovery.audit' AND key=?",stored.outcome_json,id);expect(read()).not.toBeNull();
  const job=s.sql.exec<{details_json:string}>("SELECT details_json FROM recovery_jobs WHERE id=?",stored.target).one(),details=JSON.parse(job.details_json);
  s.sql.exec("UPDATE recovery_jobs SET details_json=? WHERE id=?",JSON.stringify({...details,counts:{rows:0,chunks:0,bytes:0},artifactIndex:0,artifactBytes:0}),stored.target);expect(read()).toBeNull();
  s.sql.exec("UPDATE recovery_jobs SET details_json=? WHERE id=?",job.details_json,stored.target);
  s.sql.exec("UPDATE recovery_jobs SET state='running',details_json=? WHERE id=?",JSON.stringify({...details,stage:'transform',phase:'verify_pages',receipt:null}),stored.target);expect(read()).toBeNull();
  s.sql.exec("UPDATE recovery_jobs SET state='complete',details_json=? WHERE id=?",job.details_json,stored.target);expect(read()).not.toBeNull();
  s.sql.exec('UPDATE task_history SET created_at=created_at+1 WHERE id=?',id);expect(read()).toBeNull();s.sql.exec('UPDATE task_history SET created_at=created_at-1 WHERE id=?',id);
  s.sql.exec("UPDATE events SET summary='Task execution lease expired.' WHERE id=?",id);expect(read()).toBeNull();s.sql.exec('UPDATE events SET summary=? WHERE id=?',RESTORE_EXPIRY_SUMMARY,id);
  s.sql.exec("UPDATE tasks SET project_id='hidden_project' WHERE id='task_b'");s.sql.exec("UPDATE human_grants SET project_ids_json='[\"different_project\"]' WHERE principal_id='human_operator'");expect(read()).toBeNull();
  s.sql.exec("UPDATE human_grants SET project_ids_json='null' WHERE principal_id='human_operator'");expect(read()).not.toBeNull();
  s.sql.exec("UPDATE human_grants SET enabled=0 WHERE principal_id='human_operator'");expect(read).toThrow();s.sql.exec("UPDATE human_grants SET enabled=1 WHERE principal_id='human_operator'");
  // A retained source-looking event/history pair cannot supply the excluded operator namespace.
  s.sql.exec("DELETE FROM idempotency_outcomes WHERE operation='operator.recovery.audit' AND key=?",id);expect(read()).toBeNull();expect(read(true)).toBeNull();
 });
},90000);

import {env} from 'cloudflare:workers';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import {signRecord} from '../../src/recovery/manifest';
import {canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import {fixtureIntegrity,recoveryContext} from '../helpers/recovery-fixture';
import {retireWorkspace,resumeWorkspace} from '../../src/recovery/controls';
import {recordProbe} from '../../src/recovery/probes';
import type {CurrentLedger,CutoverRecord} from '../../src/recovery/protocol';
import type {CurrentRestoreFixture} from './current-restore-fixture';
import {mutateAuthenticatedCapture} from './current-restore-fixture';

async function resumeThenNext(f:CurrentRestoreFixture,capture:Awaited<ReturnType<typeof captureCurrentFixture>>,receipt:any,round:number):Promise<CurrentRestoreFixture>{
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
function auditEvent(w:any):any{
 const raw=w.storage.sql.exec("SELECT * FROM events WHERE type='task.expired' AND json_extract(actor_json,'$.principal_id')='system:recovery'").one();
 return {id:raw.id,workspace_id:raw.workspace_id,type:raw.type,actor:JSON.parse(raw.actor_json),resource_type:raw.resource_type,resource_id:raw.resource_id,resource_version:raw.resource_version,thread_id:raw.thread_id,request_id:raw.request_id,occurred_at:new Date(raw.occurred_at).toISOString(),summary:raw.summary,task_version:raw.task_version,run_id:raw.run_id,fence:raw.fence};
}
it('preserves original truthful recovery audit through second and third genuine capture/restore without executable source authority',async()=>{
 let f=await currentRestoreFixture('audit_multigeneration',{artifacts:false});let original:any;
 for(let round=1;round<=3;round++){
  const capture=await captureCurrentFixture(f,{evict:true}),result=await restoreCurrentFixture(f,capture,{evict:true});
  await withCurrentRecoveryWorkspace(f,'target',w=>{
   const event=auditEvent(w);if(!original)original=event;else expect(event).toEqual(original);
   expect(withTransaction(w.storage,tx=>isRestoreExpiryEvent(tx,event))).toBe(true);
   expect(w.storage.sql.exec("SELECT count(*) AS n FROM recovery_jobs WHERE operation='restore'").one().n).toBe(1);
   expect(w.storage.sql.exec("SELECT count(*) AS n FROM idempotency_outcomes WHERE operation='operator.recovery.audit'").one().n).toBe(round===1?1:0);
   if(round===3){
    const storage=w.storage;
    // Projection-only state setup: genuine resume was already exercised between generations.
    storage.sql.exec("UPDATE maintenance_state SET state='open',barrier_id=NULL,capture_id=NULL,generation=generation+1");storage.sql.exec("UPDATE workspace_metadata SET admission_state='installed'");
    withTransaction(storage,tx=>cleanupCompletedOutcomes(tx,'ws_example',Number.MAX_SAFE_INTEGER));
    expect(withTransaction(storage,tx=>isRestoreExpiryEvent(tx,event))).toBe(true);
    const record=storage.sql.exec<{outcome_json:string}>("SELECT outcome_json FROM idempotency_outcomes WHERE operation='operator.recovery.imported-audit' AND key=?",event.id).one();
    const value=JSON.parse(record.outcome_json);
    for(const change of [{importer_manifest_digest:'f'.repeat(64)},{importer_job_id:'job_'+'f'.repeat(48)},{original:{...value.original,run_id:'run_a'}},{extra:'forged'}]){
     storage.sql.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE operation='operator.recovery.imported-audit' AND key=?",JSON.stringify({...value,...change}),event.id);
     expect(withTransaction(storage,tx=>isRestoreExpiryEvent(tx,event))).toBe(false);
    }
    storage.sql.exec("UPDATE idempotency_outcomes SET outcome_json=? WHERE operation='operator.recovery.imported-audit' AND key=?",record.outcome_json,event.id);
    const identity=human(storage);storage.sql.exec("UPDATE sessions SET revoked_at=NULL,auth_epoch=? WHERE id='session_settings'",f.targetInput.config.config_epoch);
    const read=()=>withTransaction(storage,tx=>projectEvent(tx,resolveActor(tx,identity,Date.now()),event.id,Date.now(),resourceEventVisibility));
    expect(read()).not.toBeNull();storage.sql.exec("UPDATE tasks SET project_id='hidden_project' WHERE id='task_b'");storage.sql.exec("UPDATE human_grants SET project_ids_json='[\"different_project\"]' WHERE principal_id='human_operator'");expect(read()).toBeNull();
   }
  });
  if(round<3)f=await resumeThenNext(f,capture,result.receipt,round);
 }
},180000);

for(const bad of ['candidate-extra','source-incomplete','source-page','source-zero-progress','event-time'] as const)it('rejects authenticated malformed recovery audit '+bad,async()=>{
 let f=await currentRestoreFixture('audit_bad_'+bad.replaceAll('-','_'),{artifacts:false});
 const first=await captureCurrentFixture(f),restored=await restoreCurrentFixture(f,first);
 f=await resumeThenNext(f,first,restored.receipt,1);
 const capture=await captureCurrentFixture(f);
 const malformed=await mutateAuthenticatedCapture(capture,(table,row)=>{
  if(table==='idempotency_outcomes'&&row.operation==='operator.recovery.audit'&&bad==='candidate-extra')row.outcome_json=JSON.stringify({...JSON.parse(String(row.outcome_json)),resume_authority:true});
  if(table==='recovery_jobs'&&row.operation==='restore'){
   if(bad==='source-incomplete')row.state='running';
   if(bad==='source-zero-progress'){const details=JSON.parse(String(row.details_json));details.counts={rows:0,chunks:0,bytes:0};details.artifactIndex=0;details.artifactBytes=0;row.details_json=JSON.stringify(details);}
   if(bad==='source-page'){const details=JSON.parse(String(row.details_json));for(const chunk of details.manifest.database.chunks)if(chunk.table==='tasks')chunk.table='profiles';row.details_json=JSON.stringify(details);}
  }
  if(table==='events'&&row.type==='task.expired'&&JSON.parse(String(row.actor_json)).principal_id==='system:recovery'&&bad==='event-time')row.occurred_at=Number(row.occurred_at)+1;
 });
 await expect(restoreCurrentFixture(f,malformed)).rejects.toThrow(/RECOVERY_AUDIT_PROVENANCE_MISMATCH|RECOVERY_RELATIONSHIP_MISMATCH/);
 await withCurrentRecoveryWorkspace(f,'target',w=>expect(w.storage.sql.exec("SELECT count(*) n FROM recovery_jobs WHERE operation='restore' AND state='complete'").one().n).toBe(0));
},90000);
