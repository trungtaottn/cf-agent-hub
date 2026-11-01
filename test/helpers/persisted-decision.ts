import {claimSetup,descriptor,proposal} from './decision-policy';
import {artifactContext,stage,bytes} from './artifacts';
import {claimContext,PROOF_A} from './claims';
import {uploadArtifactContent,commitArtifact} from '../../src/artifacts/content';
import {sha256} from '../../src/config/bootstrap';
import {executeCommand} from '../../src/workspace/commands';
import {claimTaskCommand} from '../../src/tasks/claim';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import type {TaskRequestDecisionRequest} from '../../src/http/dto';
export async function setup(storage:DurableObjectStorage,name:string,inputTaskId='task_a'){
 const c=claimSetup(storage),claim=await claimContext(storage,name,c.body,'initial_claim',c.now);
 executeCommand(claim,c.identity,claimTaskCommand('task_a','run_initial',PROOF_A),c.body);
 const ctx=artifactContext(storage,name,'decision_input',c.now),content='{"task_id":"task_a","task_version":3}',hash=await sha256(content);
 await stage(ctx,'input_a',{task_id:inputTaskId,media_type:'application/json',byte_size:37,sha256:hash});
 await uploadArtifactContent({...ctx,idempotencyKey:'upload'},'input_a',bytes(content),'upload');await commitArtifact({...ctx,idempotencyKey:'commit'},'input_a',{expected_artifact_version:2});
 const body:TaskRequestDecisionRequest={expected_version:3,run_id:'run_initial',fence:1,checkpoint:{summary:'Checkpoint',artifact_ids:['input_a']},proposal:proposal(hash)};
 const execution={...claim,workspace:ctx.workspace,idempotencyKey:'decision',fingerprint:await fingerprintRequest('POST','/request-decision',{},body)};
 return {ctx,body,execution,identity:c.identity,now:c.now};
}

import {createDecisionCommands} from '../../src/approvals/commands-source';
import {human} from './settings';
export async function admitted(storage:DurableObjectStorage,name:string){
 const x=await setup(storage,name),commands=createDecisionCommands([descriptor]);
 executeCommand(x.execution,x.identity,await commands.prepareRequestTaskDecision({...x.ctx,idempotencyKey:'decision'},'task_a',x.body,PROOF_A,{approvalId:'approval_a',checkpointId:'checkpoint_a',proposalId:'proposal_a'}),x.body);
 return {...x,humanContext:{...x.ctx,identity:human(storage)}};
}
/** Additional actual source admission; no fabricated approval/history rows. */
export async function admittedAdditional(storage:DurableObjectStorage,name:string,now:number,suffix:string,createTaskRow=true){
 const {withTransaction}=await import('../../src/storage/transaction'),{resolveActor}=await import('../../src/auth/authorize'),{createTask,readyTask}=await import('../../src/tasks/commands');
 const taskId='task_'+suffix,inputId='input_'+suffix,runId='run_'+suffix,approvalId='approval_'+suffix,identity=human(storage),ctx=artifactContext(storage,name,'decision_'+suffix,now);
 if(createTaskRow)withTransaction(storage,tx=>{const c={actor:resolveActor(tx,identity,now),nowMs:now,requestId:'create_'+suffix,idempotencyKey:'create_'+suffix};createTask(tx,{...c,taskId},{title:'Synthetic additional decision',description:''});readyTask(tx,c,taskId,{expected_version:1});});
 const claimBody={expected_version:2,runtime_instance_id:'runtime_a'},claim=await claimContext(storage,name,claimBody,'claim_'+suffix,now,taskId);
 executeCommand(claim,ctx.identity,claimTaskCommand(taskId,runId,PROOF_A),claimBody);
 const content=JSON.stringify({task_id:taskId,task_version:3}),hash=await sha256(content);
 await stage(ctx,inputId,{task_id:taskId,media_type:'application/json',byte_size:new TextEncoder().encode(content).length,sha256:hash});
 await uploadArtifactContent({...ctx,idempotencyKey:'upload_'+suffix},inputId,bytes(content),'upload_'+suffix);await commitArtifact({...ctx,idempotencyKey:'commit_'+suffix},inputId,{expected_artifact_version:2});
 const body:TaskRequestDecisionRequest={expected_version:3,run_id:runId,fence:1,checkpoint:{summary:'Additional checkpoint',artifact_ids:[inputId]},proposal:{...proposal(hash),scope:{project_id:null,resource_ids:[taskId]},inputs:{artifact_id:inputId,sha256:hash}}},key='decision_'+suffix;
 const command=await createDecisionCommands([descriptor]).prepareRequestTaskDecision({...ctx,idempotencyKey:key},taskId,body,PROOF_A,{approvalId,checkpointId:'checkpoint_'+suffix,proposalId:'proposal_'+suffix});
 executeCommand({...claim,workspace:ctx.workspace,idempotencyKey:key,fingerprint:await fingerprintRequest('POST','/request-decision/'+taskId,{},body)},ctx.identity,command,body);
 return {taskId,approvalId};
}
