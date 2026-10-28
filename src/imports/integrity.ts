import {sha256,canonicalJson} from '../config/bootstrap';
import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {resolveActor} from '../auth/authorize';
import {withTransaction} from '../storage/transaction';
import type {CommandPreparationContext} from '../http/router';
import type {ImportEnvelope,ImportPreview} from '../http/dto';
import {importHuman,readImport,assertImportVisible,fail,type StoredImport,type Evidence} from './repository';
export interface ImportBinding{workspace_id:string;actor_principal_id:string;profile_revision:number;created_at:number;preview:ImportPreview;batch:ImportEnvelope;evidence:Evidence;}
export interface ImportIntegrity{id:string;immutable:string;}
export const bindingValue=(stored:StoredImport):ImportBinding=>({workspace_id:stored.row.workspace_id,actor_principal_id:stored.row.actor_principal_id,profile_revision:stored.row.profile_revision,created_at:stored.row.created_at,preview:stored.preview,batch:stored.batch,evidence:stored.evidence});
const immutable=(stored:StoredImport)=>canonicalJson({binding:bindingValue(stored),source_digest:stored.row.source_digest});
/** Corrupted saved bytes fail before use; this checksum is not authority or a replacement for backup authentication. */
export async function verifyImportIntegrity(stored:StoredImport):Promise<ImportIntegrity>{
 const {preview_sha256,...publicBody}=stored.preview;
 const [previewDigest,bindingDigest,...sourceHashes]=await Promise.all([sha256(canonicalJson(publicBody)),sha256(canonicalJson(bindingValue(stored))),...stored.batch.rows.map(row=>row===null?Promise.resolve(null):sha256(canonicalJson(row)))]);
 if(previewDigest!==preview_sha256||bindingDigest!==stored.row.source_digest||canonicalJson(sourceHashes)!==canonicalJson(stored.evidence.source_hashes))fail('INTERNAL_ERROR',500);
 return {id:stored.row.id,immutable:immutable(stored)};
}
export function assertImportIntegrity(stored:StoredImport,verified:ImportIntegrity):void{
 if(stored.row.id!==verified.id||immutable(stored)!==verified.immutable)fail('VERSION_CONFLICT',409);
}
export async function prepareStoredImport(workspace:AuthWorkspace,proof:Pick<CommandPreparationContext,'identity'|'fence'>,id:string,apply=false):Promise<ImportIntegrity>{
 const stored=withTransaction(workspace.storage,tx=>{currentConfiguration(tx,workspace,proof.fence);const nowMs=workspace.clock.nowMs(),actor=importHuman(tx,{actor:resolveActor(tx,proof.identity,nowMs),nowMs},apply),saved=readImport(tx,actor,id);assertImportVisible(tx,{actor,nowMs},saved);return saved;});
 return verifyImportIntegrity(stored);
}
