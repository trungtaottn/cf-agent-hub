import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {verifyHumanSession} from '../auth/sessions';
import {resolveActor,authorize} from '../auth/authorize';
import {withTransaction,type WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {Operations} from './dto';
import {validateOperations} from './generated/auth-validators.js';
import {HttpError,toHttpError,toHttpResponse,securityHeaders} from './envelopes';
export const operationsPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/operations$/;
const iso=(value:number|null)=>value===null?null:new Date(value).toISOString();
/** Protected persisted diagnostic projection. Task 11 supplies actual probe readiness. */
export function projectOperations(tx:WorkspaceTransaction,workspace:AuthWorkspace,actor:ActorContext,nowMs:number):Operations{
 const installed=currentConfiguration(tx,workspace);if(actor.kind!=='human')throw new HttpError('FORBIDDEN',403);
 authorize(tx,actor,'operations:read',{kind:'workspace',id:workspace.workspaceId,projectId:null},nowMs);
 if(tx.one('SELECT id FROM maintenance_state WHERE id=1'))throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
 const counts=tx.one<{pending:number;in_flight:number;failed:number;suppressed:number;due:number|null}>(`SELECT
  COALESCE(SUM(status='pending'),0) AS pending,COALESCE(SUM(status='in_flight'),0) AS in_flight,
  COALESCE(SUM(status IN ('exhausted','cancelled')),0) AS failed,COALESCE(SUM(status='suppressed'),0) AS suppressed,
  MIN(CASE WHEN status='pending' THEN next_due_at WHEN status='in_flight' THEN lease_expires_at ELSE NULL END) AS due
  FROM outbox WHERE workspace_id=?`,[workspace.workspaceId])!;
 const scheduler=tx.one<{last_run_at:number|null;last_error_code:string|null}>('SELECT last_run_at,last_error_code FROM scheduler_state WHERE id=1');
 const observed=new Date(nowMs).toISOString();
 const data:Operations={observed_at:observed,config_epoch:installed.epoch,schema_version:tx.one<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations')!.version,
  readiness:{observed_at:observed,ready:false,checks:[{name:'storage_probe',status:'unknown',code:'PROBE_NOT_RUN',checked_at:null}]},
  outbox:{pending_count:counts.pending,in_flight_count:counts.in_flight,failed_count:counts.failed,suppressed_count:counts.suppressed,oldest_due_at:iso(counts.due),next_due_at:iso(counts.due)},
  scheduler:{last_run_at:iso(scheduler?.last_run_at??null),last_error_code:scheduler?.last_error_code??null}};
 if(!validateOperations(data))throw new HttpError('INTERNAL_ERROR',500);return data;
}
export async function operationsRoutes(request:Request,workspace:AuthWorkspace):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  const url=new URL(request.url);
  const match=operationsPath.exec(url.pathname);if(request.method!=='GET'||!match||match[1]!==workspace.workspaceId)throw new HttpError('NOT_FOUND',404);
  if(url.searchParams.size)throw new HttpError('INVALID_REQUEST',400);
  if(request.headers.has('authorization'))throw new HttpError('FORBIDDEN',403);
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace));
  const redirect=installed.config.authentication.redirect_uris.find(x=>x.workspace_id===workspace.workspaceId);if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const origin=new URL(redirect.redirect_uri).origin;
  if(url.origin!==origin||request.headers.has('origin')&&(request.headers.get('origin')!==origin||!installed.config.authentication.allowed_origins.includes(origin)))throw new HttpError('FORBIDDEN',403);
  if(request.headers.has('origin')){headers.set('access-control-allow-origin',origin);headers.set('access-control-allow-credentials','true');headers.set('vary','Origin');}
  const identity=await verifyHumanSession(workspace,request.headers.get('cookie'),workspace.clock.nowMs());
  const data=withTransaction(workspace.storage,tx=>{currentConfiguration(tx,workspace,installed.epoch);const nowMs=workspace.clock.nowMs();return projectOperations(tx,workspace,resolveActor(tx,identity,nowMs),nowMs);});
  return toHttpResponse({status:200,data},requestId,headers);
 }catch(error){return toHttpError(error,requestId,headers);}
}
