import {isRestoreDecisionCancellationGap} from './decision-provenance';
import {decisionExpiry} from '../approvals/contracts';
import {isStagedRestoreExpiryEvent} from './restore-audit-history';
import type {CurrentRestoreJob} from './restore-job';
/** Historical integrity only. Never resolves current policy or grants execution. */
import type {WorkspaceTransaction,SqlValue} from '../storage/transaction';
import {canonicalJson} from '../config/bootstrap';
import {checkpointSnapshot,proposalSnapshot} from '../approvals/policy-source';
import {parsePersistedBinding,parseSemanticAnchor,parseReviewerIds,parseDecisionActor,validDecisionTransition} from '../approvals/stored-validation';
import {isRestoreExpiryEvent} from './restore-audit';
import type {Event} from '../http/dto';
type Row=Record<string,SqlValue>;
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
function bad():never{throw Error('RECOVERY_DECISION_GRAPH_MISMATCH');}
function one(tx:WorkspaceTransaction,sql:string,args:SqlValue[]):Row{const row=tx.one<Row>(sql,args);if(!row)bad();return row;}
function proposal(tx:WorkspaceTransaction,a:Row){return one(tx,'SELECT * FROM decision_proposals WHERE workspace_id=? AND task_id=? AND id=?',[a.workspace_id,a.task_id,a.proposal_id]);}
function restoredHead(tx:WorkspaceTransaction,task:Row,head:Row,a:Row,job?:CurrentRestoreJob):boolean {
 if(task.state!=='backlog'||task.active_run_id!==null||head.task_state!=='doing'||task.task_version!==Number(head.task_version)+1||task.latest_run_id!==a.consumed_run_id||a.consumed_run_id===null||!Array.isArray(JSON.parse(String(task.flags_json)))||!JSON.parse(String(task.flags_json)).includes('outcome_unknown'))return false;
 const rows=tx.all<Row>("SELECT * FROM events WHERE workspace_id=? AND resource_id=? AND task_version=? AND run_id=? AND type='task.expired' LIMIT 2",[task.workspace_id,task.id,task.task_version,a.consumed_run_id]);
 if(rows.length!==1)return false;const r=rows[0];
 const event={id:r.id,workspace_id:r.workspace_id,sequence:r.sequence,type:r.type,actor:JSON.parse(String(r.actor_json)),resource_type:r.resource_type,resource_id:r.resource_id,resource_version:r.resource_version,thread_id:r.thread_id,request_id:r.request_id,occurred_at:new Date(Number(r.occurred_at)).toISOString(),summary:r.summary,task_version:r.task_version,run_id:r.run_id,fence:r.fence} as Event;
 return event.fence===a.consumed_fence&&(isRestoreExpiryEvent(tx,event)||!!job&&isStagedRestoreExpiryEvent(tx,event,job));
}
/** Bounded per source row: indexed neighbors, at most 12 role edges, no history scan. */
export function verifyDecisionSourceRow(tx:WorkspaceTransaction,table:string,row:Row,job?:CurrentRestoreJob):void {
 if(!['tasks','decision_checkpoints','decision_proposals','approvals','decision_artifact_edges','decision_lifecycle_heads','decision_lifecycle_transitions','decision_notice_intents'].includes(table))return;
 try{
  if(table==='tasks'){
   if(row.approval_id===null)return;
   const a=one(tx,'SELECT * FROM approvals WHERE workspace_id=? AND task_id=? AND id=?',[row.workspace_id,row.id,row.approval_id]);
   if(row.proposal_version!==a.proposal_version)bad();return;
  }
  if(table==='decision_checkpoints'){
   const cp=checkpointSnapshot(JSON.parse(String(row.checkpoint_json)));if(!same(cp,JSON.parse(String(row.checkpoint_json))))bad();
   const run=one(tx,'SELECT * FROM runs WHERE workspace_id=? AND task_id=? AND id=?',[row.workspace_id,row.task_id,row.run_id]);
   if(run.status!=='paused'||run.ended_at!==row.created_at)bad();one(tx,'SELECT * FROM approvals WHERE workspace_id=? AND task_id=? AND checkpoint_id=?',[row.workspace_id,row.task_id,row.id]);return;
  }
  if(table==='decision_proposals'){
   const p=proposalSnapshot(JSON.parse(String(row.proposal_json))),b=parsePersistedBinding(String(row.binding_json)),anchor=parseSemanticAnchor(String(row.semantic_anchor_json));
   if(anchor.project_id!==b.projectId||b.workspaceId!==row.workspace_id||b.taskId!==row.task_id||b.taskProposalVersion+1!==row.proposal_version||b.proposalCanonicalJson!==row.proposal_json||canonicalJson(p)!==row.proposal_json||anchor.workspace_id!==row.workspace_id||anchor.id!==row.task_id)bad();one(tx,'SELECT * FROM approvals WHERE workspace_id=? AND task_id=? AND proposal_id=?',[row.workspace_id,row.task_id,row.id]);return;
  }
  if(table==='approvals'){
   if(row.expiry_hold_code!==null&&row.expiry_hold_code!=='DECISION_STATE_INVALID')bad();
   const p=proposal(tx,row),b=parsePersistedBinding(String(p.binding_json)),cp=one(tx,'SELECT * FROM decision_checkpoints WHERE workspace_id=? AND task_id=? AND id=?',[row.workspace_id,row.task_id,row.checkpoint_id]);
   if(row.expires_at!==decisionExpiry(Number(row.created_at),JSON.parse(b.policyCanonicalJson).expiry_seconds)||Number(row.created_at)<b.resolvedAt||Number(row.created_at)>=b.expiresAt)bad();
   const requester=parseDecisionActor(String(row.requested_by_json)),reviewers=parseReviewerIds(String(row.reviewer_ids_json));
   if(cp.run_id!==row.run_id||cp.created_at!==row.created_at||p.created_at!==row.created_at||p.proposal_version!==row.proposal_version||b.taskVersion!==row.task_version_at_request||b.checkpointCanonicalJson!==cp.checkpoint_json||!same(reviewers,b.reviewerIds)||requester.kind!=='agent'||requester.principal_id!==b.requestedBy.principalId||requester.agent_id!==requester.principal_id)bad();
   const run=one(tx,'SELECT * FROM runs WHERE workspace_id=? AND task_id=? AND id=?',[row.workspace_id,row.task_id,row.run_id]);
   if(run.agent_id!==requester.agent_id||run.credential_id!==b.requestedBy.credentialId||run.status!=='paused'||run.ended_at!==row.created_at)bad();
   if((row.consumed_run_id===null)!==(row.consumed_fence===null))bad();
   if(row.consumed_run_id!==null){const consumed=one(tx,'SELECT * FROM runs WHERE workspace_id=? AND task_id=? AND id=?',[row.workspace_id,row.task_id,row.consumed_run_id]);if(consumed.fence!==row.consumed_fence||consumed.id===row.run_id||!['approved','invalidated'].includes(String(row.status)))bad();one(tx,"SELECT * FROM decision_lifecycle_transitions WHERE workspace_id=? AND approval_id=? AND kind='claim' AND run_id=?",[row.workspace_id,row.id,row.consumed_run_id]);}
   if(row.decided_at!==null&&(Number(row.decided_at)<Number(row.created_at)||Number(row.decided_at)>=Number(row.expires_at)))bad();
   if(row.decided_by_json!==null){const actor=parseDecisionActor(String(row.decided_by_json));if(actor.kind!=='human'||!reviewers.includes(actor.principal_id)||row.decided_at===null)bad();}
   if(['approved','rejected'].includes(String(row.status))&&(row.decided_at===null||row.decided_by_json===null))bad();
   if(row.status==='pending'&&(row.decided_at!==null||row.decided_by_json!==null||row.consumed_run_id!==null))bad();
   const edges=tx.all<Row>('SELECT * FROM decision_artifact_edges WHERE workspace_id=? AND approval_id=? ORDER BY role,artifact_id LIMIT 12',[row.workspace_id,row.id]);
   const projected=edges.map(e=>[e.role,e.artifact_id,e.generation_id,e.artifact_version,e.sha256,e.byte_size]);
   const expected=b.artifactEdges.map(e=>[e.role,e.artifact.artifactId,e.artifact.generationId,e.artifact.artifactVersion,e.artifact.sha256,e.artifact.byteLength]);
   if(!same(projected.map(canonicalJson).sort(),expected.map(canonicalJson).sort()))bad();
   const notices=tx.all<Row>('SELECT * FROM decision_notice_intents WHERE workspace_id=? AND approval_id=? ORDER BY reviewer_principal_id LIMIT 65',[row.workspace_id,row.id]);if(!same(notices.map(n=>n.reviewer_principal_id),[...reviewers].sort())||new Set(notices.map(n=>n.event_id)).size!==1||notices.some(n=>n.created_at!==row.created_at))bad();
   one(tx,'SELECT * FROM decision_lifecycle_heads WHERE workspace_id=? AND approval_id=?',[row.workspace_id,row.id]);return;
  }
  if(table==='decision_artifact_edges'){
   const a=one(tx,'SELECT * FROM artifacts WHERE workspace_id=? AND id=?',[row.workspace_id,row.artifact_id]);
   const g=one(tx,'SELECT * FROM artifact_generations WHERE workspace_id=? AND artifact_id=? AND id=?',[row.workspace_id,row.artifact_id,row.generation_id]);
   if(a.status!=='committed'||a.committed_generation_id!==row.generation_id||a.active_generation_id!==row.generation_id||a.artifact_version!==row.artifact_version||a.sha256!==row.sha256||a.byte_size!==row.byte_size||g.state!=='committed'||g.observed_sha256!==row.sha256||g.observed_byte_size!==row.byte_size)bad();return;
  }
  if(table==='decision_notice_intents'){
   const a=one(tx,'SELECT * FROM approvals WHERE workspace_id=? AND id=?',[row.workspace_id,row.approval_id]),event=one(tx,'SELECT * FROM events WHERE workspace_id=? AND id=?',[row.workspace_id,row.event_id]);
   const run=one(tx,'SELECT * FROM runs WHERE workspace_id=? AND task_id=? AND id=?',[a.workspace_id,a.task_id,a.run_id]);
   if(!parseReviewerIds(String(a.reviewer_ids_json)).includes(String(row.reviewer_principal_id))||row.created_at!==a.created_at||event.type!=='task.decision_requested'||event.resource_type!=='task'||event.resource_id!==a.task_id||event.resource_version!==null||event.thread_id!==null||event.task_version!==Number(a.task_version_at_request)+1||event.run_id!==a.run_id||event.fence!==run.fence||event.occurred_at!==a.created_at||event.actor_json!==a.requested_by_json)bad();
   one(tx,"SELECT * FROM task_history WHERE workspace_id=? AND task_id=? AND event_id=? AND task_version=? AND run_id=? AND kind='task.decision_requested' AND created_at=?",[a.workspace_id,a.task_id,event.id,event.task_version,a.run_id,a.created_at]);return;
  }
  const a=one(tx,'SELECT * FROM approvals WHERE workspace_id=? AND task_id=? AND id=?',[row.workspace_id,row.task_id,row.approval_id]);
  if(table==='decision_lifecycle_heads'){
   const last=one(tx,'SELECT * FROM decision_lifecycle_transitions WHERE workspace_id=? AND approval_id=? AND id=?',[row.workspace_id,row.approval_id,row.last_transition_id]);
   if(last.task_id!==row.task_id||last.sequence!==row.transition_count||last.after_version!==row.task_version||last.after_state!==row.task_state||tx.one('SELECT 1 FROM decision_lifecycle_transitions WHERE workspace_id=? AND approval_id=? AND sequence>? LIMIT 1',[row.workspace_id,row.approval_id,row.transition_count]))bad();
   const task=one(tx,'SELECT * FROM tasks WHERE workspace_id=? AND id=?',[row.workspace_id,row.task_id]);
   if(task.approval_id===row.approval_id){const p=proposal(tx,a),anchor=parseSemanticAnchor(String(p.semantic_anchor_json));if(!same(anchor,Object.fromEntries(Object.keys(anchor).map(key=>[key,task[key]]))))bad();}
   if(task.approval_id===row.approval_id&&(task.task_version!==row.task_version||task.state!==row.task_state)&&!restoredHead(tx,task,row,a,job))bad();return;
  }
  if(!Number.isSafeInteger(row.sequence)||Number(row.sequence)<1||!Number.isSafeInteger(row.before_version)||!Number.isSafeInteger(row.after_version)||Number(row.after_version)!==Number(row.before_version)+1||!validDecisionTransition(String(row.kind),String(row.before_state),String(row.after_state)))bad();
  if(row.sequence===1){if(row.kind!=='request'||row.before_state!=='doing'||row.after_state!=='waiting'||row.before_version!==a.task_version_at_request||row.run_id!==a.run_id||row.created_at!==a.created_at)bad();}
  else{const previous=one(tx,'SELECT * FROM decision_lifecycle_transitions WHERE workspace_id=? AND approval_id=? AND sequence=?',[row.workspace_id,row.approval_id,Number(row.sequence)-1]);if(previous.task_id!==row.task_id||Number(previous.created_at)>Number(row.created_at))bad();if((previous.after_version!==row.before_version||previous.after_state!==row.before_state)&&!isRestoreDecisionCancellationGap(tx,a,previous,row,job))bad();}
 }catch{bad();}
}
