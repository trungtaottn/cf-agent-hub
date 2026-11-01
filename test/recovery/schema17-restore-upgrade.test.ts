import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import frozen from '../fixtures/genuine-schema17-bundle.json';
import {canonicalBytes,digestBytes,decodeCurrentChunk} from '../../src/recovery/encoding';
import {verifyRecord,validateManifestShape} from '../../src/recovery/manifest';
import {fixtureIntegrity} from '../helpers/recovery-fixture';
import {currentRestoreFixture,restoreCurrentFixture,withCurrentRecoveryWorkspace,type captureCurrentFixture} from './current-restore-fixture';

it('restores an untouched genuine baseline17 signed bundle into18 with preserved source evidence and empty diagnostic tables',async()=>{
 const f=await currentRestoreFixture('genuine17_oldbinary',{seed:false});
 const capture={...frozen.capture,chunks:frozen.capture.chunks.map(chunk=>({...chunk,bytes:new Uint8Array(chunk.bytes).buffer}))} as unknown as Awaited<ReturnType<typeof captureCurrentFixture>>;
 const before=await digestBytes(canonicalBytes(frozen.capture.manifest));
 validateManifestShape(capture.manifest);await verifyRecord(capture.manifest,fixtureIntegrity);
 expect(capture.manifest.checkpoint.schema_version).toBe(17);
 for(const c of capture.chunks){const bytes=new Uint8Array(c.bytes);expect(await digestBytes(bytes)).toBe(c.metadata.sha256);expect(decodeCurrentChunk(bytes).schema_version).toBe(17);}
 for(const a of frozen.capture.artifacts)await env.RECOVERY_BUCKET.put(a.entry.recovery_object_key,new Uint8Array(a.bytes));
 const result=await restoreCurrentFixture(f,capture,{evict:true});expect(result.state).toBe('complete');
 await withCurrentRecoveryWorkspace(f,'target',w=>{
  expect(w.storage.sql.exec('SELECT MAX(version) AS version FROM schema_migrations').one().version).toBe(18);
  expect(w.storage.sql.exec('SELECT * FROM creation_admissions').toArray()).toEqual([]);
  expect(w.storage.sql.exec('SELECT * FROM observation_slots').toArray()).toEqual([]);
  expect(w.storage.sql.exec('SELECT * FROM observation_records').toArray()).toEqual([]);
  expect(w.storage.sql.exec('SELECT count(*) AS n FROM events').one().n).toBeGreaterThan(0);
  const job=w.storage.sql.exec<{details_json:string}>("SELECT details_json FROM recovery_jobs WHERE operation='restore'").one();
  expect(JSON.parse(job.details_json).manifest).toEqual(frozen.capture.manifest);
 });
 expect(await digestBytes(canonicalBytes(frozen.capture.manifest))).toBe(before);
},90000);
