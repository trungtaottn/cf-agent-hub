import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {human,owned} from '../helpers/settings';
import {sha256} from '../../src/config/bootstrap';
import {csrfToken} from '../../src/auth/csrf';
import type {SessionRecord} from '../../src/auth/authorize';
import {withTransaction} from '../../src/storage/transaction';
import {signRecord} from '../../src/recovery/manifest';
import {canonicalBytes,digestBytes} from '../../src/recovery/encoding';
import {recordProbe} from '../../src/recovery/probes';
import {resumeWorkspace} from '../../src/recovery/controls';
import type {CurrentLedger,RetirementReceipt,CutoverRecord} from '../../src/recovery/protocol';
import {fixtureIntegrity,recoveryContext} from '../helpers/recovery-fixture';
import {currentRestoreFixture,captureCurrentFixture,restoreCurrentFixture,withCurrentRecoveryWorkspace} from './current-restore-fixture';

it('captures an actual browser preparation, consumes it after authorized source resume, and cannot restore its execution authority',async()=>{
 const f=await currentRestoreFixture('actual_admission_snapshot',{seed:false,artifacts:false});
 const cookie='D'.repeat(43),body={title:'Original lost-future task',description:'Actual browser admission'},key='lost_future_original';
 const browser=async(s:DurableObjectStorage)=>{
  const identity=human(s);if(identity.kind!=='human')throw Error('Expected human');
  s.sql.exec('UPDATE sessions SET token_digest=? WHERE id=?',await sha256(cookie),identity.sessionId);
  const workspace={...owned(s,f.sourceName),secrets:env as unknown as Record<string,unknown>};
  return csrfToken(workspace,withTransaction(s,tx=>tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[identity.sessionId])!));
 };
 const request=(csrf:string,prepare:boolean,id?:string,browserCookie=cookie)=>new Request('https://hub.example.invalid/v2/workspaces/ws_example/tasks'+(prepare?':prepare':''),{method:'POST',headers:{'content-type':'application/json',origin:'https://hub.example.invalid',cookie:'cfhub_session='+browserCookie,'x-csrf-token':csrf,'idempotency-key':key,...(id?{'x-creation-admission':id}:{})},body:JSON.stringify(body)});
 const id=await runInDurableObject(f.source,async(object,{storage})=>{
  const response=await object.fetch(request(await browser(storage),true));expect(response.status).toBe(200);
  const prepared=(await response.json() as {data:{admission_id:string}}).data;expect(storage.sql.exec('SELECT * FROM tasks').toArray()).toEqual([]);return prepared.admission_id;
 });
 const capture=await captureCurrentFixture(f,{evict:true});
 expect((capture.manifest.database.table_counts as Record<string,number>).creation_admissions).toBe(1);expect(capture.manifest.database.table_counts.tasks).toBe(0);
 const ledger=await signRecord<CurrentLedger>({workspace_id:'ws_example',environment_id:'current_source',authority_epoch:1,config:f.sourceInput.config,verification_bundle:f.sourceInput.bundle,installation_digest:f.sourceInput.installationDigest,retired_authorities:[],auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 f.resolver.anchor={authorityEpoch:1,sha256:await digestBytes(canonicalBytes(ledger))};
 await withCurrentRecoveryWorkspace(f,'source',async w=>recordProbe(w,await recoveryContext(w,'probe',{},null,{anchor:f.resolver.anchor,operationId:'source_probe_actual'})));
 const resume={receipt_id:capture.progress.receipt!.id,ledger,source_retirement_receipt:null,cutover_record:null};
 await withCurrentRecoveryWorkspace(f,'source',async w=>resumeWorkspace(w,await recoveryContext(w,'resume',resume,f.captureId,{anchor:f.resolver.anchor,operationId:'source_resume_actual'}),resume));
 const task=await runInDurableObject(f.source,async(object,{storage})=>{
  expect(storage.sql.exec('SELECT id FROM creation_admissions WHERE id=?',id).one().id).toBe(id);
  const response=await object.fetch(request(await browser(storage),false,id));expect(response.status).toBe(201);await response.arrayBuffer();
  expect(storage.sql.exec('SELECT id FROM creation_admissions WHERE id=?',id).toArray()).toEqual([]);
  const event=storage.sql.exec<{resource_id:string;creation_binding:string}>('SELECT resource_id,creation_binding FROM events WHERE id=?',id).one();expect(event.creation_binding).toMatch(/^[a-f0-9]{64}$/);return event.resource_id;
 });
 f.resolver.anchor={...f.anchor};await restoreCurrentFixture(f,capture,{evict:true});
 await withCurrentRecoveryWorkspace(f,'target',w=>{
  expect(w.storage.sql.exec('SELECT * FROM creation_admissions').toArray()).toEqual([]);
  expect(w.storage.sql.exec('SELECT id FROM tasks WHERE id=?',task).toArray()).toEqual([]);
  expect(w.storage.sql.exec('SELECT id FROM events WHERE id=?',id).toArray()).toEqual([]);
  expect(w.storage.sql.exec('SELECT key FROM idempotency_outcomes WHERE key=?',key).toArray()).toEqual([]);
  expect(w.storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('restored');
 });
 // Explicitly synthetic external records model operator-approved lost-future recovery.
 // The test does NOT claim that the still-present source was actually retired or
 // that a real deployment/cutover occurred; the server validates the existing protocol.
 const retirement=await signRecord<RetirementReceipt>({id:'retired_admission_future',capture_id:f.captureId,workspace_id:'ws_example',environment_id:'current_source',authority_epoch:1,barrier_id:capture.manifest.checkpoint.barrier_id,retired_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 const cutover=await signRecord<CutoverRecord>({id:'cutover_admission_future',capture_id:f.captureId,workspace_id:'ws_example',source_environment_id:'current_source',source_authority_epoch:1,target_environment_id:'current_target',target_authority_epoch:2,source_retirement_receipt_id:retirement.id,target_catalog_mapping:{workspace_id:'ws_example',object_name:f.targetName},cutover_at:new Date().toISOString(),auth:{key_id:fixtureIntegrity.keyId,algorithm:'HMAC-SHA256',tag:'0'.repeat(64)}},fixtureIntegrity);
 await withCurrentRecoveryWorkspace(f,'target',async w=>recordProbe(w,await recoveryContext(w,'probe',{},null,{anchor:f.anchor,operationId:'target_probe_actual'})));
 const targetResume={receipt_id:(await withCurrentRecoveryWorkspace(f,'target',w=>JSON.parse(w.storage.sql.exec<{details_json:string}>("SELECT details_json FROM recovery_jobs WHERE operation='restore'").one().details_json))).receipt.id,ledger:f.ledger,source_retirement_receipt:retirement,cutover_record:cutover};
 await withCurrentRecoveryWorkspace(f,'target',async w=>resumeWorkspace(w,await recoveryContext(w,'resume',targetResume,f.captureId,{anchor:f.anchor,operationId:'target_resume_actual'}),targetResume));
 await runInDurableObject(f.target,async(object,{storage})=>{
  // A fresh verified-session fixture at the CURRENT epoch, not reactivation of a restored session.
  const targetCookie='E'.repeat(43),now=Date.now(),sessionId='session_fresh_restored';
  storage.sql.exec("INSERT INTO sessions(id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,revoked_at,auth_epoch) VALUES(?,'ws_example','human_operator',?,'csrf_fresh','https://identity.example.invalid','synthetic-subject',?,?,NULL,2)",sessionId,await sha256(targetCookie),now,now+1000000);
  const workspace={...owned(storage,f.targetName),secrets:env as unknown as Record<string,unknown>};
  const csrf=await csrfToken(workspace,withTransaction(storage,tx=>tx.one<SessionRecord>('SELECT * FROM sessions WHERE id=?',[sessionId])!));
  const counts=()=>Object.fromEntries(['tasks','events','outbox','idempotency_outcomes'].map(table=>[table,storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM '+table).one().n]));
  const before=counts();expect(storage.sql.exec('SELECT state FROM maintenance_state').one().state).toBe('open');
  const replay=await object.fetch(request(csrf,false,id,targetCookie));expect(replay.status).toBe(409);expect((await replay.json() as {error:{code:string}}).error.code).toBe('IDEMPOTENCY_CONFLICT');
  expect(counts()).toEqual(before);expect(storage.sql.exec('SELECT * FROM creation_admissions').toArray()).toEqual([]);
 });
},90000);
