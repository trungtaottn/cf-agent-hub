import {it,expect} from 'vitest';
import type {WorkspaceTransaction} from '../../src/storage/transaction';
import {inspectAlarmMetadata} from '../../src/recovery/engine-metadata';

const valid={type:'table',name:'_cf_METADATA',tbl_name:'_cf_METADATA',sql:'CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )'};
function mock(rows:unknown[]):WorkspaceTransaction {
 return {all:(sql,bindings)=>{expect(sql).toContain('sqlite_schema');expect(sql).toContain('LIMIT 2');expect(bindings).toEqual(['_cf_METADATA','_cf_METADATA']);return rows as never;},one:()=>{throw Error('Unexpected row read');},exec:()=>{throw Error('Unexpected mutation');}};
}
it('accepts only absent or exactly observed schema16 engine metadata without reading engine content',()=>{
 expect(inspectAlarmMetadata(mock([]),16)).toBe(false);
 expect(inspectAlarmMetadata(mock([valid]),16)).toBe(true);
});
it.each([
 {type:'view'},{name:'_CF_METADATA'},{tbl_name:'another_owner'},
 {sql:'CREATE TABLE _cf_METADATA (key TEXT PRIMARY KEY,value BLOB)'},
 {sql:valid.sql+' STRICT'},{sql:valid.sql+' '},{sql:null}
])('rejects mocked identity or raw SQL variation %j',change=>{
 expect(()=>inspectAlarmMetadata(mock([{...valid,...change}]),16)).toThrow('RECOVERY_ENGINE_SCHEMA_INCOMPATIBLE');
});
it('rejects mocked extra objects owned by the reserved engine table',()=>{
 expect(()=>inspectAlarmMetadata(mock([valid,{type:'trigger',name:'extra',tbl_name:'_cf_METADATA',sql:'CREATE TRIGGER extra'}]),16)).toThrow('RECOVERY_ENGINE_SCHEMA_INCOMPATIBLE');
});
it('does not change frozen schema15 inspection policy or query optional metadata',()=>{
 expect(inspectAlarmMetadata({all:()=>{throw Error('Unexpected historical query');}} as unknown as WorkspaceTransaction,15)).toBe(false);
});
