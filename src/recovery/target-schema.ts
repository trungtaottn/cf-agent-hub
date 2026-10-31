import type {WorkspaceTransaction} from '../storage/transaction';
import {assertSchemaVersion} from '../storage/schema-version';
/** Physical schema, never a caller flag or the imported source manifest version.
 * Constructor/admission and final completion separately inspect its exact registry. */
export function physicalRecoverySchema(tx:WorkspaceTransaction):16|17 {
 const version=tx.one<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations')?.version;
 if(version!==16&&version!==17)throw Error('RECOVERY_SCHEMA_MISMATCH');
 assertSchemaVersion(tx,version);return version;
}
