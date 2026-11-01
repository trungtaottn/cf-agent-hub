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
