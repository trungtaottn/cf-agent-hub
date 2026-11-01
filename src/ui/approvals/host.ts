import type {HubClient} from '../../../packages/client/src/client';
import type {ApiResult,ArtifactDownloadResult} from '../../../packages/client/src/types';
import type {AuthSession,Workspace} from '../../http/dto';
import type {DecisionReader} from './decision-detail';
import {decisionObservationCurrent,redactDeniedDecisionTask,type DecisionCallbackBinding} from './panel';
const unavailable=():Extract<ApiResult<never>,{ok:false}>=>({ok:false,status:null,requestId:null,error:{code:'OBSERVATION_INVALIDATED',message:'Decision observation no longer current',retryable:false}});
/** Fixed same-client read adapter. Holds no authority/cache/intent of its own. */
export function createDecisionReader(options:{workspaceId:string;client:()=>HubClient;currentContext:()=>DecisionCallbackBinding;onAuthDenied:(status:401|403,requestId:string|null)=>void;onAccess:(workspace:Workspace,requestId:string,current:()=>boolean)=>Promise<void>;onTaskDenied:(id:string,code:'FORBIDDEN'|'NOT_FOUND',requestId:string|null)=>void}):DecisionReader{
 const capture=()=>({...options.currentContext()});
 const current=(captured:DecisionCallbackBinding)=>decisionObservationCurrent(captured,options.currentContext());
 async function read<T>(call:()=>Promise<ApiResult<T>>,required=false):Promise<ApiResult<T>>{
  const captured=capture();if(!current(captured))return unavailable();const result=await call();if(!current(captured))return unavailable();
  if(!result.ok&&(result.status===401||required&&result.status===403))options.onAuthDenied(result.status as 401|403,result.requestId);return result;
 }
 return {
  async readAccess(){
   const captured=capture();if(!current(captured))return unavailable();
   const auth=await read(()=>options.client().request<AuthSession>('getAuthSession',{}),true);if(!auth.ok)return auth;if(!current(captured))return unavailable();
   if(auth.data.actor.kind!=='human'||auth.data.actor.agent_id!==null||auth.data.actor.principal_id!==captured.principalId){options.onAuthDenied(401,auth.requestId);return unavailable();}
   const access=await read(()=>options.client().request<Workspace>('getWorkspace',{}),true);if(!access.ok)return access;if(!current(captured))return unavailable();
   if(access.data.id!==options.workspaceId||access.data.actor.kind!=='human'||access.data.actor.agent_id!==null||access.data.actor.principal_id!==captured.principalId){options.onAuthDenied(401,access.requestId);return unavailable();}
   await options.onAccess(access.data,access.requestId,()=>current(captured));if(!current(captured))return unavailable();options.client().setCsrfToken(auth.data.csrf_token);return access;
  },
  listApprovals:query=>read(()=>options.client().approvalRead('listApprovals',{query})),
  getApproval:id=>read(()=>options.client().approvalRead('getApproval',{path:{approval_id:id}})),
  async getTask(id){const captured=capture(),result=await read(()=>options.client().read('getTask',{path:{task_id:id}}));redactDeniedDecisionTask(captured,options.currentContext(),id,result,options.onTaskDenied);return result;},
  getArtifact:id=>read(()=>options.client().read('getArtifact',{path:{artifact_id:id}})),
  async downloadArtifact(id,artifact,signal):Promise<ArtifactDownloadResult>{const captured=capture();if(!current(captured))return unavailable();const result=await options.client().downloadArtifact({path:{artifact_id:id}},artifact,{signal});
   if(!current(captured)){if(result.ok)void result.data.body.cancel().catch(()=>{});return unavailable();}
   if(!result.ok&&result.status===401)options.onAuthDenied(401,result.requestId);return result;
  }
 };
}
/** Publish only current read capabilities; discard pending/cached task-related
 * activity on task/event scope loss without invalidating unrelated session data. */
export function applyDecisionReadCapabilities(access:Workspace,requestId:string,options:{tasks:{setCapabilities(value:{tasks:boolean;events:boolean;artifacts:boolean}):void};events:{unavailable(code:string,requestId:string|null):void};eventsEnabled:boolean;clearEventCursor:()=>void;current:()=>boolean}):{tasks:boolean;events:boolean;approvals:boolean}|null{
 if(!options.current())return null;
 const scopes=access.effective_scopes,tasks=scopes.includes('tasks:read'),events=options.eventsEnabled&&scopes.includes('events:read'),artifacts=scopes.includes('artifacts:read');
 if(!tasks||!events){options.clearEventCursor();options.events.unavailable('CURRENT_SCOPE_REQUIRED',requestId);}
 options.tasks.setCapabilities({tasks,events,artifacts});return {tasks,events,approvals:access.actor.kind==='human'&&tasks&&scopes.includes('approvals:read')};
}
