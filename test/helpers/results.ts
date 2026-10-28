import {claimFixture,claimSetup,claimContext,claimSnapshot,PROOF_A} from './claims';
import {human,owned} from './settings';
import {sha256} from '../../src/config/bootstrap';
import {taskRoutes} from '../../src/http/task-routes';
import {claimTaskCommand} from '../../src/tasks/claim';
import {executeCommand} from '../../src/workspace/commands';
import {withTransaction} from '../../src/storage/transaction';
import type {SessionRecord} from '../../src/auth/authorize';
import {csrfToken} from '../../src/auth/csrf';
export const token='A'.repeat(43),other='B'.repeat(42)+'A',rotated='C'.repeat(42)+'A',proof='D'.repeat(42)+'A',sessionToken='E'.repeat(43);
const scopes=['workspace:read','events:read','tasks:read','tasks:claim','tasks:execute','tasks:review','runtimes:manage','artifacts:read','artifacts:write','messages:read','messages:send'] as const;
export async function reviewFixture(name:string){return claimFixture(name,{humanCancel:true,humanReview:true,scopes:[...scopes]});}
export const reviewSnapshot=(s:DurableObjectStorage)=>({...claimSnapshot(s),...Object.fromEntries(['task_results','result_artifacts','task_acceptances','artifact_associations','artifacts','artifact_generations'].map(t=>[t,s.sql.exec('SELECT * FROM '+t+' ORDER BY rowid').toArray()]))});
export async function setupReview(s:DurableObjectStorage,name:string){
 const start=claimSetup(s);executeCommand(await claimContext(s,name,start.body,'claim',start.now),start.identity,claimTaskCommand('task_a','run_a',PROOF_A),start.body);
 // Bind known synthetic test secrets to already-authorized fixture identities.
 for(const [id,value] of [['credential_research_1',token],['credential_other',other],['credential_research_2',rotated]])s.sql.exec('UPDATE native_credentials SET token_sha256=? WHERE credential_id=?',await sha256(value),id);
 s.sql.exec("UPDATE runtimes SET proof_sha256=? WHERE id='runtime_a'",await sha256(proof));
 human(s);s.sql.exec("UPDATE sessions SET token_digest=? WHERE id='session_settings'",await sha256(sessionToken));
 return start.now;
}
export async function client(s:DurableObjectStorage,name:string,now:number){
 const workspace={...owned(s,name),clock:{nowMs:()=>now}},csrf=await csrfToken(workspace,withTransaction(s,tx=>tx.one<SessionRecord>("SELECT * FROM sessions WHERE id='session_settings'")!));
 return (action:string,body:unknown,key=action,lane:'owner'|'other'|'rotated'|'human'='owner',runtime:string|undefined=proof)=>taskRoutes(new Request('https://hub.example.invalid/v2/workspaces/ws_example/tasks/task_a:'+action,{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,...(lane==='human'?{cookie:'cfhub_session='+sessionToken,origin:'https://hub.example.invalid','x-csrf-token':csrf}:{authorization:'Bearer '+(lane==='other'?other:lane==='rotated'?rotated:token)}),...(runtime?{'x-runtime-token':runtime}:{})},body:JSON.stringify(body)}),workspace);
}
export const submission=(ids:string[]=[])=>({expected_version:3,run_id:'run_a',fence:1,result:{summary:'Durable result 日本語',artifact_ids:ids}});

import {artifactContext,stage,bytes} from './artifacts';
import {uploadArtifactContent,commitArtifact} from '../../src/artifacts/content';
export async function committedEvidence(storage:DurableObjectStorage,name:string,now:number,id='artifact_a',taskId:string|null='task_a',runId:string|null='run_a'){
 const ctx={...artifactContext(storage,name,'result-evidence',now),proofHash:await sha256(proof)};
 await stage(ctx,id,{task_id:taskId,run_id:runId});
 await uploadArtifactContent({...ctx,idempotencyKey:'upload_'+id},id,bytes(),'upload_'+id);
 return commitArtifact({...ctx,idempotencyKey:'commit_'+id},id,{expected_artifact_version:2});
}
