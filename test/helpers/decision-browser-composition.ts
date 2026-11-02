/** PRIVATE TEST BUILD ONLY. Never import from a production entrypoint. */
import {canonicalJson,sha256} from '../../src/config/bootstrap';
import {createDecisionCommands} from '../../src/approvals/commands-source';
export const syntheticSchema={type:'object',additionalProperties:false,required:['task_id','task_version'],properties:{task_id:{type:'string'},task_version:{type:'integer',minimum:1}}};
export const schemaSha256=await sha256(canonicalJson(syntheticSchema));
export const descriptor=Object.freeze({
 actionId:'synthetic.task-review',schemaVersion:1,schemaSha256,semanticRevision:'synthetic-task-review@2',resourceKinds:Object.freeze(['task']),
 actorScopes:Object.freeze(['tasks:read','tasks:execute','artifacts:read']),reviewerScopes:Object.freeze(['tasks:read','artifacts:read']),
 extractInputTargets(value:import('../../src/approvals/contracts').ReadonlyDecisionJson){const v=value as {task_id:string;task_version:number};return [{kind:'task',id:v.task_id,version:v.task_version}];},
 validateInput(value:unknown):boolean{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='task_id,task_version'&&typeof (value as {task_id:unknown}).task_id==='string'&&Number.isSafeInteger((value as {task_version:unknown}).task_version)&&Number((value as {task_version:unknown}).task_version)>0;},
});
export const {prepareRequestTaskDecision,prepareApprovalDecision}=createDecisionCommands(Object.freeze([descriptor]));
export type {DecisionPreparationContext,DecisionIds} from '../../src/approvals/commands-source';
