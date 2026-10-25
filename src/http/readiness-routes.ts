import type {AuthWorkspace} from '../auth/context';
import {diagnosticResponse} from '../health/diagnostic-auth';
import {projectReadiness} from '../health/readiness';
import {validateReadiness} from './generated/auth-validators.js';
import {HttpError,toHttpError} from './envelopes';
export const readinessPath=/^\/v2\/workspaces\/([a-zA-Z0-9_-]{1,128})\/readiness$/;
export async function readinessRoutes(request:Request,workspace:AuthWorkspace):Promise<Response>{
 const match=readinessPath.exec(new URL(request.url).pathname);
 if(!match||match[1]!==workspace.workspaceId)return toHttpError(new HttpError('NOT_FOUND',404),crypto.randomUUID());
 return diagnosticResponse(request,workspace,(tx,_actor,nowMs)=>{
  const data=projectReadiness(tx,workspace,nowMs);if(!validateReadiness(data))throw new HttpError('INTERNAL_ERROR',500);return data;
 });
}
