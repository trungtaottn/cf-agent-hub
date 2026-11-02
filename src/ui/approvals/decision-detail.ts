import type {Approval,Artifact,Task,Workspace} from '../../http/dto';
import type {ApiResult,ArtifactDownloadResult} from '../../../packages/client/src/types';
import {validateApproval} from '../../http/generated/decision-validators.js';
import {validateArtifact,validateTask,validateWorkspace} from '../../http/generated/auth-validators.js';
import {InputInspector,renderInput,matchesProposalMetadata,type DisplayInput} from './input-viewer';
import type {ReadState} from '../read-state';
import {el} from '../dom';
export interface DecisionBinding {principalId:string;generation:number;renderGeneration:number;online:boolean;}
export interface DecisionReader {
 readAccess():Promise<ApiResult<Workspace>>;
 listApprovals(query:{limit:25;cursor?:string}):Promise<ApiResult<Approval[]>>;
 getApproval(id:string):Promise<ApiResult<Approval>>;
 getTask(id:string):Promise<ApiResult<Task>>;
 getArtifact(id:string):Promise<ApiResult<Artifact>>;
 downloadArtifact(id:string,artifact:Artifact,signal:AbortSignal):Promise<ArtifactDownloadResult>;
}
export interface DecisionView {approval:Approval;task:Task;artifact:Artifact;access:Workspace;input:DisplayInput;}
export const invalidDecision=(code='INVALID_RESPONSE'):ApiResult<never>=>({ok:false,status:null,requestId:null,error:{code,message:'Decision observation unavailable',retryable:false}});
export function decisionAccess(access:Workspace,workspaceId:string,principalId:string,inputs=false):boolean{
 return validateWorkspace(access)&&access.id===workspaceId&&access.actor.kind==='human'&&access.actor.agent_id===null&&access.actor.principal_id===principalId&&['approvals:read','tasks:read',...(inputs?['artifacts:read']:[])].every(scope=>access.effective_scopes.includes(scope as never));
}
export interface DecisionMetadataView {approval:Approval;task:Task;artifact:Artifact;access:Workspace;}
interface InspectionOptions {id:string;workspaceId:string;principalId:string;reader:DecisionReader;signal:AbortSignal;current:()=>boolean;}
function assertCurrent(options:InspectionOptions):void{if(options.signal.aborted||!options.current())throw new Error('OBSERVATION_INVALIDATED');}
async function metadataSnapshot(options:InspectionOptions):Promise<ApiResult<DecisionMetadataView>>{
 const {reader,id,workspaceId,principalId}=options;assertCurrent(options);
 const access=await reader.readAccess();assertCurrent(options);if(!access.ok)return access;if(!decisionAccess(access.data,workspaceId,principalId,true))return invalidDecision('CURRENT_AUTHORITY_REQUIRED');
 const approval=await reader.getApproval(id);assertCurrent(options);if(!approval.ok)return approval;
 if(!validateApproval(approval.data)||approval.data.id!==id||approval.data.workspace_id!==workspaceId)return invalidDecision();const a=structuredClone(approval.data);
 const task=await reader.getTask(a.task_id);assertCurrent(options);if(!task.ok)return task;
 if(!validateTask(task.data)||task.data.id!==a.task_id||task.data.workspace_id!==workspaceId)return invalidDecision();const t=structuredClone(task.data);
 const artifact=await reader.getArtifact(a.proposal.inputs.artifact_id);assertCurrent(options);if(!artifact.ok)return artifact;
 if(!validateArtifact(artifact.data)||!matchesProposalMetadata(a,artifact.data))return invalidDecision();
 return {ok:true,status:200,requestId:approval.requestId,data:{approval:a,task:t,artifact:structuredClone(artifact.data),access:structuredClone(access.data)}};
}
async function recheckMetadata(options:InspectionOptions,original:DecisionMetadataView):Promise<ApiResult<DecisionMetadataView>>{
 const latest=await metadataSnapshot(options);assertCurrent(options);if(!latest.ok)return latest;
 if(JSON.stringify([latest.data.approval,latest.data.task,latest.data.artifact])!==JSON.stringify([original.approval,original.task,original.artifact]))return invalidDecision();
 return latest;
}
/** Metadata-only rejection inspection never fetches or retains input bytes. */
export async function loadDecisionMetadata(options:InspectionOptions):Promise<ApiResult<DecisionMetadataView>>{
 try{const initial=await metadataSnapshot(options);if(!initial.ok)return initial;return await recheckMetadata(options,initial.data);}catch{return invalidDecision();}
}
/** Exact snapshot inspection is display evidence; every mutation still checks current server policy. */
export async function loadDecisionView(options:InspectionOptions&{inspector:InputInspector}):Promise<ApiResult<DecisionView>>{
 try{
  const initial=await metadataSnapshot(options);if(!initial.ok)return initial;
  const {approval,artifact}=initial.data;assertCurrent(options);
  const response=await options.reader.downloadArtifact(artifact.id,artifact,options.signal);
  try{assertCurrent(options);}catch(error){if(response.ok)void response.data.body.cancel().catch(()=>{});throw error;}if(!response.ok)return response;
  const input=await options.inspector.inspect(approval,artifact,response,options.signal);assertCurrent(options);
  const latest=await recheckMetadata(options,initial.data);if(!latest.ok)return latest;
  return {...latest,data:{...latest.data,input}};
 }catch{return invalidDecision();}
}
export function decisionDeadlineReached(approval:Approval,nowMs:number):boolean{return approval.status==='expired'||approval.status==='pending'&&Date.parse(approval.expires_at)<=nowMs;}
export function renderDecisionDetail(state:Readonly<ReadState<DecisionView>>,nowMs=Date.now()):HTMLElement{
 const root=el('section',undefined,{'aria-label':'Decision detail'});root.append(el('h2','Decision detail'),el('p','Observed: '+(state.observedAt??'Not reported')+' · Request: '+(state.requestId??'Not reported'),{class:'evidence'}));
 if(state.status!=='ready'||!state.data){root.append(el('p','Decision detail: '+state.status+(state.errorCode?' · '+state.errorCode:''),{role:'status'}));return root;}
 const {approval:a,task:t,artifact,input}=state.data;
 root.append(el('h3',a.proposal.summary),el('p','Approval '+a.id+' · '+a.status+' · task '+t.id+' ('+t.state+')'),
  el('p','Current task version '+t.task_version+' · proposal version '+a.proposal_version+' · approval version '+a.approval_version+' · task version at request '+a.task_version_at_request),
  el('p','Action: '+a.proposal.action),el('pre',JSON.stringify(a.proposal.scope,null,2),{'aria-label':'Exact requested scope',tabindex:'0'}),
  el('p','Assigned humans: '+a.assigned_human_principal_ids.join(', ')),el('p','Expires: '+a.expires_at+' · server time remains authoritative'),
  el('p','Input artifact: '+artifact.id+' · artifact version '+artifact.artifact_version),el('pre',JSON.stringify(a.checkpoint,null,2),{'aria-label':'Immutable checkpoint',tabindex:'0'}));
 if(t.approval_id!==a.id)root.append(el('p','Historical approval; this is not the current task decision.'));
 if(decisionDeadlineReached(a,nowMs))root.append(el('p','Deadline reached. Expiry leaves unresolved work Waiting; an authorized human may cancel or arrange replacement work. This view cannot renew the proposal.'));
 root.append(renderInput(input),el('p','Approval moves current work to Ready for a fresh claim, not execution or completion. Rejection moves it to Backlog. Later execution submits Review; independent acceptance makes it Done.'),el('p','Action names and summaries grant no permission. The server checks current policy and action availability.'));return root;
}
