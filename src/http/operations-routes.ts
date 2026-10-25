import type {AuthWorkspace} from '../auth/context';
import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import {diagnosticConfiguration,diagnosticResponse,recheckDiagnosticActor} from '../health/diagnostic-auth';
import {projectReadiness} from '../health/readiness';
import type {Operations} from './dto';
import {validateOperations} from './generated/auth-validators.js';
import {HttpError,toHttpError} from './envelopes';
export const operationsPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/operations$/;
const iso=(value:number|null)=>value===null?null:new Date(value).toISOString();
/** Protected read-only projection, including deliberately paused authority.
 * It does not repair scheduling, run probes or authorize a domain mutation. */
export function projectOperations(tx:WorkspaceTransaction,workspace:AuthWorkspace,actor:ActorContext,nowMs:number):Operations{
 recheckDiagnosticActor(tx,workspace,actor,nowMs);
 const installed=diagnosticConfiguration(tx,workspace);
 const counts=tx.one<{pending:number;in_flight:number;failed:number;suppressed:number;due:number|null}>(`SELECT
  COALESCE(SUM(status='pending'),0) AS pending,COALESCE(SUM(status='in_flight'),0) AS in_flight,
  COALESCE(SUM(status IN ('exhausted','cancelled')),0) AS failed,COALESCE(SUM(status='suppressed'),0) AS suppressed,
  MIN(CASE WHEN status='pending' THEN next_due_at WHEN status='in_flight' THEN lease_expires_at ELSE NULL END) AS due
  FROM outbox WHERE workspace_id=?`,[workspace.workspaceId])!;
 const scheduler=tx.one<{last_run_at:number|null;last_error_code:string|null}>('SELECT last_run_at,last_error_code FROM scheduler_state WHERE id=1');
 const observed=new Date(nowMs).toISOString();
 const data:Operations={observed_at:observed,config_epoch:installed.epoch,schema_version:tx.one<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations')!.version,
  readiness:projectReadiness(tx,workspace,nowMs),
  outbox:{pending_count:counts.pending,in_flight_count:counts.in_flight,failed_count:counts.failed,suppressed_count:counts.suppressed,oldest_due_at:iso(counts.due),next_due_at:iso(counts.due)},
  scheduler:{last_run_at:iso(scheduler?.last_run_at??null),last_error_code:scheduler?.last_error_code??null}};
 if(!validateOperations(data))throw new HttpError('INTERNAL_ERROR',500);return data;
}
export async function operationsRoutes(request:Request,workspace:AuthWorkspace):Promise<Response>{
 const match=operationsPath.exec(new URL(request.url).pathname);
 if(!match||match[1]!==workspace.workspaceId)return toHttpError(new HttpError('NOT_FOUND',404),crypto.randomUUID());
 return diagnosticResponse(request,workspace,(tx,actor,nowMs)=>projectOperations(tx,workspace,actor,nowMs));
}
