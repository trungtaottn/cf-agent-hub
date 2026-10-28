import type {WorkspaceTransaction} from '../storage/transaction';
/** All matching rows count, including retired/revoked history. Never select an eligible
 * alternative or combine grants when a secret ambiguously names multiple identities. */
export function uniqueNativeCredential(tx:WorkspaceTransaction,workspaceId:string,tokenDigest:string):string|null {
 const rows=tx.all<{credential_id:string}>('SELECT credential_id FROM native_credentials WHERE workspace_id=? AND token_sha256=? LIMIT 2',[workspaceId,tokenDigest]);
 return rows.length===1?rows[0].credential_id:null;
}
