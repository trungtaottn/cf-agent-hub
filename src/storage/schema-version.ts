import type {WorkspaceTransaction} from './transaction';
export const CURRENT_SCHEMA_VERSION=13;
export const EXPECTED_SCHEMA_VERSIONS=[1,2,3,4,5,6,7,8,9,10,11,12,13] as const;
/** Authority capability is limited to explicitly compiled R2 schema versions, never future numbers. */
export function hasR2AuthoritySchema(version:unknown):boolean {
 return typeof version==='number'&&version>=8&&EXPECTED_SCHEMA_VERSIONS.some(supported=>supported===version);
}
/** Every ordinary admission checks the compiled migration sequence, including gaps. */
export function assertCurrentSchema(tx:WorkspaceTransaction):void {
 assertSchemaVersion(tx,CURRENT_SCHEMA_VERSION);
}
/** Explicit historical policy is used only by the version1 recovery lane. */
export function assertSchemaVersion(tx:WorkspaceTransaction,version:7|8|9|10|11|12|13):void {
 const expected=EXPECTED_SCHEMA_VERSIONS.slice(0,version);
 const versions=tx.all<{version:number}>('SELECT version FROM schema_migrations ORDER BY version');
 if(versions.length!==expected.length||versions.some((row,i)=>row.version!==expected[i]))throw Error('UNSUPPORTED_SCHEMA');
}
