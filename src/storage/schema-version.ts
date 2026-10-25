import type {WorkspaceTransaction} from './transaction';
export const CURRENT_SCHEMA_VERSION=7;
export const EXPECTED_SCHEMA_VERSIONS=[1,2,3,4,5,6,7] as const;
/** Every ordinary admission checks the compiled migration sequence, including gaps. */
export function assertCurrentSchema(tx:WorkspaceTransaction):void {
 const versions=tx.all<{version:number}>('SELECT version FROM schema_migrations ORDER BY version');
 if(versions.length!==EXPECTED_SCHEMA_VERSIONS.length||versions.some((row,i)=>row.version!==EXPECTED_SCHEMA_VERSIONS[i]))throw Error('UNSUPPORTED_SCHEMA');
}
