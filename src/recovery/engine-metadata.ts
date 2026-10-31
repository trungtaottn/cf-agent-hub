import type {WorkspaceTransaction} from '../storage/transaction';

const name='_cf_METADATA';
// Observed on pinned workerd 1.20261019.1 after real alarm API use. This is deliberately
// not SQL-normalized: an engine schema change requires compatibility review.
const declaration='CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )';
/** Inspect schema identity only. Never read, export, import or mutate engine-owned rows. */
export function inspectAlarmMetadata(tx:WorkspaceTransaction,schemaVersion:15|16):boolean {
 if(schemaVersion!==16)return false;
 const rows=tx.all<{type:string;name:string;tbl_name:string;sql:string|null}>(
  'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE OR tbl_name=? COLLATE NOCASE LIMIT 2',[name,name]);
 if(rows.length===0)return false;
 const row=rows[0];
 if(rows.length!==1||row.type!=='table'||row.name!==name||row.tbl_name!==name||row.sql!==declaration)throw Error('RECOVERY_ENGINE_SCHEMA_INCOMPATIBLE');
 return true;
}
