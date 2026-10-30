import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {validateRecoveryManifest,validateRecoveryCommand,validateRecoveryArtifactTransferState} from '../../src/recovery/generated/recovery-validators.js';
import {validateManifestShape,verifyManifest,signRecord,verifyRecord} from '../../src/recovery/manifest';
import {advanceCapture} from '../../src/recovery/capture';
import {canonicalBytes} from '../../src/recovery/encoding';
const sha='a'.repeat(64);
const integrity={keyId:'key_example',key:Buffer.alloc(32,7).toString('base64')};
function manifest(version=2){
 const m=JSON.parse(readFileSync('examples/recovery/r1-manifest.json','utf8'));
 m.format_version=version;m.checkpoint.schema_version=7;m.auth.key_id=integrity.keyId;
 for(const table of ['schema_migrations','workspace_metadata','maintenance_state']){
  const n=table==='schema_migrations'?7:1;m.database.table_counts[table]=n;
  m.database.chunks.push({index:m.database.chunks.length,table,sha256:sha,byte_size:1,row_count:n});
 }
 m.database.byte_size=3;
 if(version===2)m.artifacts=[entry()];return m;
}
function entry(id='artifact_example',size=3){return {artifact_id:id,object_key:`artifacts/ws_example/${id}/${sha}`,recovery_object_key:`r2/ws_example/capture_example/artifacts/${id}/${sha}`,byte_size:size,sha256:sha};}
describe('R2 recovery contract, not runtime restoration',()=>{
 it('valid_v1_still_valid with authenticated canonical encoding',async()=>{const m=await signRecord(manifest(1),integrity);expect(await verifyManifest(m,integrity)).toEqual(m);});
 it('V2 closed format is recognized without granting runtime admission',async()=>{const m=await signRecord(manifest(),integrity);expect(validateRecoveryManifest(m)).toBe(true);expect(()=>validateManifestShape(m)).not.toThrow();await expect(verifyRecord(m,integrity)).resolves.toBeUndefined();await expect(verifyManifest(m,integrity)).rejects.toThrow('RECOVERY_FORMAT_UNAVAILABLE');});
 it('corrupt authentication rejects',async()=>{const m=await signRecord(manifest(1),integrity);m.auth.tag='0'.repeat(64);await expect(verifyManifest(m,integrity)).rejects.toThrow('RECOVERY_AUTH_MISMATCH');});
 it.each(['artifacts','schema'])('v1_cannot_claim_r2_%s',kind=>{const m=manifest(1);if(kind==='artifacts')m.artifacts=[entry()];else m.checkpoint.schema_version=8;expect(()=>validateManifestShape(m)).toThrow();});
 it('v2_requires_complete_artifact_inventory fields',()=>{const m=manifest();delete m.artifacts[0].sha256;expect(validateRecoveryManifest(m)).toBe(false);});
 it.each(['token','runtime_proof','service_credentials'])('no_plaintext_proofs_in_export: unknown %s',key=>{const m=manifest();m.artifacts[0][key]='secret';expect(validateRecoveryManifest(m)).toBe(false);});
 it('unknown top-level fields reject',()=>{const m=manifest();m.extra=true;expect(validateRecoveryManifest(m)).toBe(false);});
 it('unknown table rejects',()=>{const m=manifest();m.database.table_counts.artifacts=1;expect(validateRecoveryManifest(m)).toBe(false);});
 it('table-count/chunk agreement remains exact',()=>{const m=manifest();m.database.table_counts.messages=1;expect(()=>validateManifestShape(m)).toThrow('RECOVERY_MANIFEST_COUNTS');});
 it('SQL byte sum remains exact',()=>{const m=manifest();m.database.byte_size++;expect(()=>validateManifestShape(m)).toThrow('RECOVERY_MANIFEST_COUNTS');});
 it.each(['artifact_id','object_key','recovery_object_key'])('duplicate generation %s rejects',key=>{const m=manifest();const second=entry('artifact_second');(second as Record<string,unknown>)[key]=m.artifacts[0][key];m.artifacts.push(second);expect(()=>validateManifestShape(m)).toThrow();});
 it.each(['../escape','https://example.com/secret','artifacts/other/artifact_example/'+sha,'artifacts/ws_example/artifact_example/'+ 'b'.repeat(64)])('noncanonical object key %s rejects',key=>{const m=manifest();m.artifacts[0].object_key=key;expect(()=>validateManifestShape(m)).toThrow();});
 it('cross-capture recovery key rejects',()=>{const m=manifest();m.artifacts[0].recovery_object_key=m.artifacts[0].recovery_object_key.replace('capture_example','capture_other');expect(()=>validateManifestShape(m)).toThrow();});
 it('unfinished ids are unique and disjoint from committed generations',()=>{const m=manifest();m.unfinished_artifact_ids=['unfinished_example'];expect(()=>validateManifestShape(m)).not.toThrow();m.unfinished_artifact_ids.push('unfinished_example');expect(()=>validateManifestShape(m)).toThrow();m.unfinished_artifact_ids=['artifact_example'];expect(()=>validateManifestShape(m)).toThrow();});
 it('1000/1001 artifact schema ceiling is independent of manifest byte ceiling',()=>{const m=manifest();m.artifacts=Array.from({length:1000},(_,i)=>entry('artifact_'+i));expect(validateRecoveryManifest(m)).toBe(true);expect(()=>validateManifestShape(m)).toThrow('INVALID_RECOVERY_MANIFEST');m.artifacts.push(entry('artifact_1000'));expect(validateRecoveryManifest(m)).toBe(false);});
 it('10 MiB individual ceiling',()=>{const m=manifest();m.artifacts=[entry('artifact_example',10485760)];expect(()=>validateManifestShape(m)).not.toThrow();m.artifacts[0].byte_size++;expect(validateRecoveryManifest(m)).toBe(false);});
 it('combined SQL plus artifact budget rejects without truncation',()=>{const m=manifest();m.artifacts=Array.from({length:26},(_,i)=>entry('artifact_'+i,10485760));expect(()=>validateManifestShape(m)).toThrow('RECOVERY_TOTAL_BYTES_LIMIT');expect(m.artifacts).toHaveLength(26);m.artifacts.pop();expect(()=>validateManifestShape(m)).not.toThrow();});
 it('65536/65537 canonical bytes are enforced exactly',()=>{const m=manifest();m.release.binding_ids=Array.from({length:32},(_,i)=>'x'.repeat(250)+i);m.artifacts=Array.from({length:100},(_,i)=>entry('artifact_'+i));const size=canonicalBytes(m).length;expect(size).toBeLessThan(65536); // pad through legal bounded unfinished IDs
  let i=0;while(canonicalBytes(m).length+133<=65536)m.unfinished_artifact_ids.push('u'+String(i++).padStart(127,'0'));
  const remaining=65536-canonicalBytes(m).length;if(remaining>=4)m.unfinished_artifact_ids.push('u'.repeat(remaining-3));
  const gap=65536-canonicalBytes(m).length;m.release.revision+='x'.repeat(gap);
  expect(canonicalBytes(m)).toHaveLength(65536);expect(()=>validateManifestShape(m)).not.toThrow();m.release.revision+='x';expect(()=>validateManifestShape(m)).toThrow('INVALID_RECOVERY_MANIFEST');
 });
 it('runtime capture refuses artifact budget before accessing storage',async()=>{await expect(advanceCapture({} as never,{} as never,{max_rows:1,max_artifacts:1,max_total_bytes:1})).rejects.toThrow('RECOVERY_FORMAT_UNAVAILABLE');});
 it('capture budget contract allows bounded artifacts',()=>{const commands=JSON.parse(readFileSync('examples/recovery/r1-commands.json','utf8'));const c=commands.commands.find((x:any)=>x.operation==='capture');for(const n of [0,1000]){c.payload.budget.max_artifacts=n;expect(validateRecoveryCommand(c)).toBe(true);}c.payload.budget.max_artifacts=1001;expect(validateRecoveryCommand(c)).toBe(false);});
});

function transfer(){return {version:2,manifest_sha256:sha,artifact_index:0,artifact_bytes:0,phase:'capture_artifacts',pending:null};}
describe('bounded future V2 restart contract',()=>{
 it('accepts initial bounded state',()=>expect(validateRecoveryArtifactTransferState(transfer())).toBe(true));
 it.each([['artifact_index',1001],['artifact_bytes',268435457],['phase','automatic_resume'],['version',1]])('rejects out-of-range %s', (key,value)=>{const s={...transfer(),[key]:value};expect(validateRecoveryArtifactTransferState(s)).toBe(false);});
 it('rejects duplicated inventory and raw authority state',()=>{expect(validateRecoveryArtifactTransferState({...transfer(),artifacts:[entry()]})).toBe(false);expect(validateRecoveryArtifactTransferState({...transfer(),token:'raw'})).toBe(false);});
 it('pending identity requires complete immutable reservation',()=>{const s={...transfer(),pending:{operation_id:'op_example',request_fingerprint:sha,index:0,artifact_id:'artifact_example',sha256:sha,byte_size:3,object_key:entry().object_key,recovery_object_key:entry().recovery_object_key}};expect(validateRecoveryArtifactTransferState(s)).toBe(true);delete (s.pending as Partial<typeof s.pending>).request_fingerprint;expect(validateRecoveryArtifactTransferState(s)).toBe(false);});
});

describe('restart consistency review regressions',()=>{
 const pending={operation_id:'op_example',request_fingerprint:sha,index:0,...entry()};
 it('complete has no outstanding reservation',()=>expect(validateRecoveryArtifactTransferState({...transfer(),phase:'complete',pending})).toBe(false));
 it('pending points at the next index only',()=>expect(validateRecoveryArtifactTransferState({...transfer(),pending:{...pending,index:999}})).toBe(false));
 it('combined byte exact boundary',()=>{const m=manifest();m.artifacts=Array.from({length:25},(_,i)=>entry('artifact_'+i,10485760));m.artifacts.push(entry('artifact_last',268435456-25*10485760-m.database.byte_size));expect(()=>validateManifestShape(m)).not.toThrow();m.artifacts.at(-1).byte_size++;expect(()=>validateManifestShape(m)).toThrow('RECOVERY_TOTAL_BYTES_LIMIT');});
});

it('published V2 example is format-only and unavailable to runtime',async()=>{const m=JSON.parse(readFileSync('examples/recovery/manifest-v2.json','utf8'));expect(()=>validateManifestShape(m)).not.toThrow();await expect(verifyManifest(m,integrity)).rejects.toThrow('RECOVERY_FORMAT_UNAVAILABLE');});

it('exact repeated immutable generation is rejected even when both keys are canonical',()=>{const m=manifest();m.artifacts.push({...m.artifacts[0]});expect(()=>validateManifestShape(m)).toThrow('RECOVERY_ARTIFACT_IDENTITY_MISMATCH');});
it('schema12 generation-qualified production keys require a future recovery amendment',()=>{const m=manifest();m.artifacts[0].object_key=`artifacts/ws_example/artifact_example/generation_${'b'.repeat(48)}/${sha}`;expect(validateRecoveryManifest(m)).toBe(true);expect(()=>validateManifestShape(m)).toThrow('RECOVERY_ARTIFACT_IDENTITY_MISMATCH');m.checkpoint.schema_version=12;expect(validateRecoveryManifest(m)).toBe(true);expect(()=>validateManifestShape(m)).toThrow('RECOVERY_MANIFEST_MISMATCH');});
