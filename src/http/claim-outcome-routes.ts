import {currentConfiguration,type AuthWorkspace} from '../auth/context';
import {verifyNativeCredential} from '../auth/native';
import {hashRuntimeProof} from '../auth/runtime-proof';
import {withTransaction} from '../storage/transaction';
import {fingerprintRequest} from '../workspace/idempotency';
import {lookupTaskClaimOutcome} from '../tasks/claim-outcome';
import {parseBoundedJson} from './bounds';
import type {TaskClaimRequest} from './dto';
import {HttpError,securityHeaders,toHttpError,toHttpResponse} from './envelopes';
/** Native-only read: distinct URL, never admitted to the command executor or alarm repair. */
export const claimOutcomePath=/^\/v2\/workspaces\/([A-Za-z0-9_-]{1,128})\/tasks\/([^/:]+):claim-outcome$/;
export async function claimOutcomeRoutes(request:Request,workspace:AuthWorkspace):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(securityHeaders);
 try{
  workspace={...workspace,secrets:{...workspace.secrets},clock:{nowMs:workspace.clock.nowMs.bind(workspace.clock)},entropy:{bytes:workspace.entropy.bytes.bind(workspace.entropy)}};
  const url=new URL(request.url),match=claimOutcomePath.exec(url.pathname);
  if(!match||match[1]!==workspace.workspaceId||request.method!=='POST')throw new HttpError('NOT_FOUND',404);
  let taskId:string;try{taskId=decodeURIComponent(match[2]);}catch{throw new HttpError('INVALID_REQUEST',400);}
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(taskId)||url.searchParams.size||request.headers.has('cookie')||request.headers.has('x-csrf-token')||request.headers.has('x-creation-admission'))throw new HttpError('INVALID_REQUEST',400);
  const key=request.headers.get('idempotency-key');if(key===null||!/^[\x21-\x7e]{1,256}$/.test(key))throw new HttpError('INVALID_REQUEST',400);
  const bearer=request.headers.get('authorization'),proof=request.headers.get('x-runtime-token');
  // Capture original installed admission before any body/auth/proof/fingerprint await.
  const installed=withTransaction(workspace.storage,tx=>currentConfiguration(tx,workspace));
  const body=await parseBoundedJson(request,'TaskClaimRequest') as TaskClaimRequest;
  const auth=installed.config.authentication,redirect=auth.redirect_uris.find(value=>value.workspace_id===workspace.workspaceId);
  if(!redirect)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const origin=new URL(redirect.redirect_uri).origin;
  if(url.origin!==origin||request.headers.has('origin')&&(request.headers.get('origin')!==origin||!auth.allowed_origins.includes(origin)))throw new HttpError('FORBIDDEN',403);
  const credential=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer??'');if(!credential)throw new HttpError('UNAUTHENTICATED',401);
  const identity=await verifyNativeCredential(workspace,credential[1],workspace.clock.nowMs()),proofHash=await hashRuntimeProof(proof);
  // Only the original claim intent is fingerprinted. This URL cannot apply it.
  const fingerprint=await fingerprintRequest('POST','/v2/workspaces/'+workspace.workspaceId+'/tasks/'+taskId+':claim',{},body);
  const outcome=lookupTaskClaimOutcome({workspace,requestId,idempotencyKey:key,fingerprint,admissionEpoch:installed.epoch,admissionGeneration:installed.fence.maintenanceGeneration},identity,taskId,body,proofHash);
  return toHttpResponse(outcome,requestId,headers);
 }catch(error){return toHttpError(error,requestId,headers);}
}
