import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {TaskResult} from '../http/dto';
import {validateTaskResult} from '../http/generated/auth-validators.js';
import {HttpError} from '../http/envelopes';
import {assertStoredScalarBytes,assertTaskItemFits} from './bounds';
export interface TaskResultRow {id:string;workspace_id:string;task_id:string;run_id:string;submission_sequence:number;submitted_kind:'human'|'agent'|'system';submitted_principal_id:string;submitted_agent_id:string|null;summary:string;created_at:number;}
/** Caller supplies one freshly resolved coherent grant inside this synchronous transaction.
 * No actor construction, refresh per artifact, network access or artifact bytes. */
export function projectTaskResult(tx:WorkspaceTransaction,actor:ActorContext,taskId:string,resultId:string):TaskResult|null {
 const size=tx.one<{bytes:number}>(`SELECT length(CAST(id AS BLOB))+length(CAST(workspace_id AS BLOB))+length(CAST(task_id AS BLOB))+length(CAST(run_id AS BLOB))+length(CAST(submitted_principal_id AS BLOB))+coalesce(length(CAST(submitted_agent_id AS BLOB)),0)+length(CAST(summary AS BLOB)) AS bytes FROM task_results WHERE workspace_id=? AND task_id=? AND id=?`,[actor.workspaceId,taskId,resultId]);
 if(!size)return null;assertStoredScalarBytes(size.bytes);
 const binding=tx.one<Pick<TaskResultRow,'run_id'>>('SELECT run_id FROM task_results WHERE workspace_id=? AND task_id=? AND id=?',[actor.workspaceId,taskId,resultId])!;
 const task=tx.one<{project_id:string|null}>('SELECT project_id FROM tasks WHERE workspace_id=? AND id=?',[actor.workspaceId,taskId]);
 if(!task||actor.projectIds!==null&&(task.project_id===null||!actor.projectIds.includes(task.project_id)))return null;
 if(!tx.one('SELECT id FROM runs WHERE workspace_id=? AND task_id=? AND id=?',[actor.workspaceId,taskId,binding.run_id]))return null;
 const lengths=tx.one<{bytes:number}>('SELECT coalesce(sum(length(CAST(artifact_id AS BLOB))),0) AS bytes FROM result_artifacts WHERE workspace_id=? AND result_id=?',[actor.workspaceId,resultId]);assertStoredScalarBytes(lengths?.bytes);
 const refs=tx.all<{artifact_id:string;visible:number}>(`SELECT ra.artifact_id,
  CASE WHEN a.status='committed' AND a.committed_at IS NOT NULL AND a.expires_at IS NULL
   AND (a.task_id IS NULL OR a.task_id=?) AND (a.run_id IS NULL OR a.run_id=?)
   AND g.state='committed' AND g.observed_sha256=a.sha256 AND g.expected_sha256=a.sha256
   AND g.observed_byte_size=a.byte_size AND g.expected_byte_size=a.byte_size
   AND (a.task_id IS NULL OR EXISTS(SELECT 1 FROM artifact_associations x WHERE x.workspace_id=ra.workspace_id AND x.artifact_id=ra.artifact_id AND x.resource_kind='task' AND x.resource_id=?))
   AND (a.run_id IS NULL OR EXISTS(SELECT 1 FROM artifact_associations x WHERE x.workspace_id=ra.workspace_id AND x.artifact_id=ra.artifact_id AND x.resource_kind='run' AND x.resource_id=?))
   AND EXISTS(SELECT 1 FROM artifact_associations x WHERE x.workspace_id=ra.workspace_id AND x.artifact_id=ra.artifact_id AND x.resource_kind='result' AND x.resource_id=?)
  THEN 1 ELSE 0 END AS visible
  FROM result_artifacts ra
  LEFT JOIN artifacts a ON a.workspace_id=ra.workspace_id AND a.id=ra.artifact_id
  LEFT JOIN artifact_generations g ON g.workspace_id=a.workspace_id AND g.artifact_id=a.id AND g.id=a.committed_generation_id
  WHERE ra.workspace_id=? AND ra.result_id=? ORDER BY ra.ordinal LIMIT 6`,[taskId,binding.run_id,taskId,binding.run_id,resultId,actor.workspaceId,resultId]);
 // The outer indexed relation has at most five schema-constrained ordinal rows.
 // Visibility is a projection, never a filter that can scan unbounded hidden rows.
 if(refs.length>5)throw new HttpError('INTERNAL_ERROR',500);
 if(refs.length&&!actor.scopes.has('artifacts:read')||refs.some(ref=>ref.visible!==1))return null;
 const row=tx.one<TaskResultRow>('SELECT * FROM task_results WHERE workspace_id=? AND task_id=? AND id=?',[actor.workspaceId,taskId,resultId])!;
 const result:TaskResult={summary:row.summary,artifact_ids:refs.map(x=>x.artifact_id),run_id:row.run_id,submitted_by:{kind:row.submitted_kind,principal_id:row.submitted_principal_id,agent_id:row.submitted_agent_id},submitted_at:new Date(row.created_at).toISOString()};
 if(!validateTaskResult(result))throw new HttpError('INTERNAL_ERROR',500);assertTaskItemFits(result);return result;
}
