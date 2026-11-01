import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {registryForSchema} from '../../src/recovery/table-registry';
import {validateRecoveryManifest} from '../../src/recovery/generated/recovery-validators.js';
import {encodeCurrentChunk,decodeCurrentChunk} from '../../src/recovery/encoding';
const additions=['decision_checkpoints','decision_proposals','approvals','decision_artifact_edges','decision_lifecycle_heads','decision_lifecycle_transitions','decision_notice_intents'];
it('schema19 is additive and closes its seven historical decision tables',()=>{
 const prior=registryForSchema(18),current=registryForSchema(19);
 expect(current.slice(0,prior.length)).toEqual(prior);expect(current.slice(prior.length).map(t=>t.name)).toEqual(additions);
 for(const table of current.slice(prior.length))expect(table.mode).toBe('restore');
 // Shape-only detached copy: its historical signature is NOT valid or reused as schema19 authority.
 const manifest=JSON.parse(readFileSync('test/fixtures/genuine-schema18-bundle.json','utf8')).capture.manifest;
 manifest.checkpoint.schema_version=19;manifest.database.table_counts=Object.fromEntries(current.map(t=>[t.name,manifest.database.table_counts[t.name]??0]));
 expect(validateRecoveryManifest(manifest)).toBe(true);
 for(const name of additions){const bad=structuredClone(manifest);delete bad.database.table_counts[name];expect(validateRecoveryManifest(bad)).toBe(false);const over=structuredClone(manifest);over.database.table_counts[name]=1000001;expect(validateRecoveryManifest(over)).toBe(false);}
 manifest.checkpoint.schema_version=18;expect(validateRecoveryManifest(manifest)).toBe(false);
});
it('schema19 chunk codec does not reinterpret old schemas or unknown versions',()=>{
 const table=registryForSchema(19).find(t=>t.name==='decision_checkpoints')!;
 expect(table).toBeDefined();
 const chunk={format_version:2 as const,schema_version:19 as const,capture_id:'capture_test',index:0,table:'decision_checkpoints' as const,columns:table.columns.map(c=>c.name),rows:[['checkpoint_one','ws_one','task_one','run_one','{}',1]]};
 expect(decodeCurrentChunk(encodeCurrentChunk(chunk))).toEqual(chunk);
 for(const schema_version of [16,17,18,20])expect(()=>encodeCurrentChunk({...chunk,schema_version} as never)).toThrow();
});

it('registry selection rejects unknown schema numbers rather than falling back to historical16',()=>{expect(()=>registryForSchema(20 as never)).toThrow();});

it('existing 1MiB encoder boundary includes escaped decision metadata and full capture envelope',()=>{
 // Codec-valid typed JSON cells only; this is not policy admission or a valid product binding.
 const table=registryForSchema(19).find(t=>t.name==='decision_proposals')!;
 const row=['p'.repeat(128),'w'.repeat(128),'t'.repeat(128),Number.MAX_SAFE_INTEGER,'{}',JSON.stringify({text:'\\'.repeat(200000)}),'{}',Number.MAX_SAFE_INTEGER];
 const chunk={format_version:2 as const,schema_version:19 as const,capture_id:'c'.repeat(128),index:255,table:'decision_proposals' as const,columns:table.columns.map(c=>c.name),rows:[row]};
 row[6]=JSON.stringify({text:''});
 const limit=1048576,current=encodeCurrentChunk(chunk).length;
 row[6]=JSON.stringify({text:'a'.repeat(limit-current)});
 expect(encodeCurrentChunk(chunk)).toHaveLength(limit);
 row[6]=JSON.stringify({text:'a'.repeat(limit-current+1)});
 expect(()=>encodeCurrentChunk(chunk)).toThrow('RECOVERY_CHUNK_LIMIT');
});

it('retains the closed expiry diagnostic column without treating it as an authority exemption',()=>{
 const approvals=registryForSchema(19).find(t=>t.name==='approvals')!;
 expect(approvals.columns.at(-1)).toEqual({name:'expiry_hold_code',type:'TEXT',notNull:false,defaultValue:null,pk:0});
 expect(registryForSchema(18).some(t=>t.name==='approvals')).toBe(false);
});
