/** Synthetic canonical requests and exact denial assertions; never an authority provider. */
import {expect} from 'vitest';
import type {TaskRequestDecisionRequest,ApprovalDecisionRequest} from '../../src/http/dto';
import {validateTaskRequestDecisionRequest,validateApprovalDecisionRequest,validateError} from '../../src/http/generated/auth-validators.js';
export function decisionRequest(taskId='task_fixture',version=1,runId='run_fixture',fence=1):TaskRequestDecisionRequest {
 const body={expected_version:version,run_id:runId,fence,checkpoint:{summary:'Synthetic checkpoint',artifact_ids:[]},proposal:{summary:'Synthetic proposal',action:'synthetic.task-review',scope:{project_id:null,resource_ids:[taskId]},artifact_ids:[],inputs:{artifact_id:'input_a',sha256:'a'.repeat(64)}}};
 expect(validateTaskRequestDecisionRequest(body)).toBe(true);return body;
}
export function approvalDecision():ApprovalDecisionRequest {const body={expected_version:1,expected_proposal_version:1,expected_approval_version:1,reason:'Synthetic boundary probe'};expect(validateApprovalDecisionRequest(body)).toBe(true);return body;}
export async function decisionError(response:Response,status:number,code:string):Promise<void>{const value=await response.json();expect(response.status).toBe(status);expect(validateError(value)).toBe(true);expect(value).toMatchObject({error:{code}});expect(value).not.toHaveProperty('data');expect(value).not.toHaveProperty('page');}
export function decisionEffects(storage:DurableObjectStorage){return Object.fromEntries(['tasks','runs','task_history','approvals','decision_checkpoints','decision_proposals','decision_artifact_edges','decision_lifecycle_heads','decision_lifecycle_transitions','decision_notice_intents','events','outbox','idempotency_outcomes','scheduler_state'].map(table=>[table,storage.sql.exec('SELECT * FROM '+table+' ORDER BY rowid').toArray()]));}
