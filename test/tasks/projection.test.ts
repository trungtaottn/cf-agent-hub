import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {identityFixture} from '../helpers/identity';
import {human} from '../helpers/settings';
import {resolveActor} from '../../src/auth/authorize';
import {withTransaction} from '../../src/storage/transaction';
import {projectTaskResult} from '../../src/tasks/results';
function seed(s:DurableObjectStorage){
 s.sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('task_result','ws_example','Task','','backlog',1,0,0,2,'[]',1,1)");
 s.sql.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('projection_runtime','ws_example','agent_research','credential_research_1',1,?,1,'Test','expired',1,1,2)",'a'.repeat(64));
 s.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at) VALUES('projection_run','ws_example','task_result','agent_research','projection_runtime','credential_research_1',1,'submitted',1,1,2,1,2)");
 s.sql.exec("INSERT INTO task_results(id,workspace_id,task_id,run_id,submission_sequence,submitted_kind,submitted_principal_id,submitted_agent_id,summary,created_at) VALUES('projection_result','ws_example','task_result','projection_run',1,'agent','agent_research','agent_research','Complete result',2)");
}
function artifact(s:DurableObjectStorage){
 s.sql.exec("INSERT INTO artifacts(id,workspace_id,task_id,run_id,owner_kind,owner_principal_id,owner_agent_id,authority_epoch,artifact_version,filename,media_type,byte_size,sha256,status,created_at,expires_at) VALUES('projection_artifact','ws_example','task_result','projection_run','agent','agent_research','agent_research',1,1,'file','text/plain',0,?,'staged',1,3)",'b'.repeat(64));
 s.sql.exec("INSERT INTO artifact_generations(id,workspace_id,artifact_id,object_key,expected_sha256,expected_byte_size,observed_sha256,observed_byte_size,state,admission_epoch,admission_generation,expires_at,created_at,updated_at) VALUES('projection_gen','ws_example','projection_artifact','synthetic-key',?,0,?,0,'committed',1,0,3,1,2)",'b'.repeat(64),'b'.repeat(64));
 s.sql.exec("UPDATE artifacts SET status='committed',committed_at=2,expires_at=NULL,committed_generation_id='projection_gen' WHERE id='projection_artifact'");
 s.sql.exec("INSERT INTO result_artifacts VALUES('ws_example','projection_result','projection_artifact',0)");
 for(const [kind,id] of [['task','task_result'],['run','projection_run'],['result','projection_result']])s.sql.exec("INSERT INTO artifact_associations VALUES('ws_example','projection_artifact',?,?)",kind,id);
}
it('projects exact retained result and hides whole result without artifact grant or committed provenance',async()=>{
 const {stub}=await identityFixture('result-projection');await runInDurableObject(stub,(_o,state)=>{
  const identity=human(state.storage);seed(state.storage);
  const read=()=>withTransaction(state.storage,tx=>projectTaskResult(tx,resolveActor(tx,identity,Date.now()),'task_result','projection_result'));
  expect(read()).toEqual({summary:'Complete result',artifact_ids:[],run_id:'projection_run',submitted_by:{kind:'agent',principal_id:'agent_research',agent_id:'agent_research'},submitted_at:'1970-01-01T00:00:00.002Z'});
  artifact(state.storage);expect(read()).toBeNull();
  state.storage.sql.exec("UPDATE human_grants SET scopes_json='[\"tasks:read\",\"artifacts:read\"]'");expect(read()?.artifact_ids).toEqual(['projection_artifact']);
  state.storage.sql.exec("DELETE FROM artifact_associations WHERE resource_kind='result'");expect(read()).toBeNull();
 });
});
it('rejects impossible huge retained result without returning partial contents',async()=>{
 const {stub}=await identityFixture('result-huge');await runInDurableObject(stub,(_o,state)=>{
  const identity=human(state.storage);seed(state.storage);state.storage.sql.exec('UPDATE task_results SET summary=?','x'.repeat(1048576));
  expect(()=>withTransaction(state.storage,tx=>projectTaskResult(tx,resolveActor(tx,identity,Date.now()),'task_result','projection_result'))).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));
 });
});
export {seed as seedResult,artifact as seedResultArtifact};
import {appendEvent,projectEvent,resourceEventVisibility} from '../../src/audit/events';
import {taskRecord,taskView} from '../../src/tasks/repository';
import {assertTaskItemFits,MAX_TASK_ITEM_BYTES,TASK_RESPONSE_BYTES,TASK_CURSOR_BYTES,TASK_REQUEST_ID_BYTES,jsonBytes} from '../../src/tasks/bounds';
import type {TaskResult,Task} from '../../src/http/dto';
import {assertTaskResultAdmissionFits} from '../../src/tasks/bounds';
import type {WorkspaceTransaction} from '../../src/storage/transaction';
const scopes=JSON.stringify(['tasks:read','artifacts:read','events:read']);
it('accepts task-only and unbound committed artifacts but always requires result association',async()=>{
 const {stub}=await identityFixture('result-unbound');await runInDurableObject(stub,(_o,state)=>{
  const s=state.storage,identity=human(s);seed(s);artifact(s);s.sql.exec('UPDATE human_grants SET scopes_json=?',scopes);
  const read=()=>withTransaction(s,tx=>projectTaskResult(tx,resolveActor(tx,identity,Date.now()),'task_result','projection_result'));
  expect(read()?.artifact_ids).toEqual(['projection_artifact']);
  s.sql.exec("UPDATE artifacts SET run_id=NULL WHERE id='projection_artifact'");s.sql.exec("DELETE FROM artifact_associations WHERE resource_kind='run'");expect(read()?.artifact_ids).toEqual(['projection_artifact']);
  s.sql.exec("UPDATE artifacts SET task_id=NULL WHERE id='projection_artifact'");s.sql.exec("DELETE FROM artifact_associations WHERE resource_kind='task'");expect(read()?.artifact_ids).toEqual(['projection_artifact']);
  s.sql.exec("DELETE FROM artifact_associations WHERE resource_kind='result'");expect(read()).toBeNull();
 });
});
it('denies wrong task or run provenance and every missing bound association',async()=>{
 const {stub}=await identityFixture('result-provenance');await runInDurableObject(stub,(_o,state)=>{
  const s=state.storage,identity=human(s);seed(s);artifact(s);s.sql.exec('UPDATE human_grants SET scopes_json=?',scopes);
  const read=()=>withTransaction(s,tx=>projectTaskResult(tx,resolveActor(tx,identity,Date.now()),'task_result','projection_result'));
  for(const [kind,id]of [['task','task_result'],['run','projection_run'],['result','projection_result']]){s.sql.exec('DELETE FROM artifact_associations WHERE resource_kind=?',kind);expect(read()).toBeNull();s.sql.exec("INSERT INTO artifact_associations VALUES('ws_example','projection_artifact',?,?)",kind,id);}
  s.sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES('other_task','ws_example','Other','','backlog',1,0,0,2,'[]',1,1)");
  s.sql.exec("UPDATE artifacts SET task_id='other_task',run_id=NULL");expect(read()).toBeNull();
  s.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at) SELECT 'other_run',workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,2,lease_expires_at,started_at,ended_at FROM runs WHERE id='projection_run'");
  s.sql.exec("UPDATE artifacts SET task_id='task_result',run_id='other_run'");expect(read()).toBeNull();
  s.sql.exec("UPDATE artifacts SET run_id='projection_run'");expect(read()?.artifact_ids).toEqual(['projection_artifact']);
 });
});
it('requires currently committed selected generation and matching observed digest and size',async()=>{
 const {stub}=await identityFixture('result-generation');await runInDurableObject(stub,(_o,state)=>{
  const s=state.storage,identity=human(s);seed(s);artifact(s);s.sql.exec('UPDATE human_grants SET scopes_json=?',scopes);
  const read=()=>withTransaction(s,tx=>projectTaskResult(tx,resolveActor(tx,identity,Date.now()),'task_result','projection_result'));
  for(const [change,restore] of [["UPDATE artifact_generations SET state='tombstoned'","UPDATE artifact_generations SET state='committed'"],["UPDATE artifacts SET sha256='"+'c'.repeat(64)+"'","UPDATE artifacts SET sha256='"+'b'.repeat(64)+"'"],["UPDATE artifacts SET byte_size=1","UPDATE artifacts SET byte_size=0"]]){s.sql.exec(change);expect(read()).toBeNull();s.sql.exec(restore);expect(read()?.artifact_ids).toEqual(['projection_artifact']);}
  s.sql.exec("UPDATE artifacts SET status='expired',committed_at=NULL");expect(read()).toBeNull();
 });
});
it('task events and current task responses hide a whole unreadable current result',async()=>{
 const {stub}=await identityFixture('result-event-access');await runInDurableObject(stub,(_o,state)=>{
  const s=state.storage,identity=human(s);seed(s);artifact(s);s.sql.exec("UPDATE tasks SET current_result_id='projection_result'");s.sql.exec('UPDATE human_grants SET scopes_json=?',scopes);
  withTransaction(s,tx=>{const actor=resolveActor(tx,identity,Date.now());appendEvent(tx,{id:'task_projection_event',type:'task.updated',resourceType:'task',resourceId:'task_result',resourceVersion:null,threadId:null,workspaceId:'ws_example',actor,requestId:'projection_request',nowMs:Date.now()});});
  expect(s.sql.exec("SELECT event_id,task_id,task_version FROM task_history WHERE event_id='task_projection_event'").one()).toEqual({event_id:'task_projection_event',task_id:'task_result',task_version:1});
  const read=()=>withTransaction(s,tx=>{const actor=resolveActor(tx,identity,Date.now());return projectEvent(tx,actor,'task_projection_event',Date.now(),resourceEventVisibility);});
  expect(read()).toMatchObject({resource_id:'task_result',resource_version:null,task_version:1});
  s.sql.exec('UPDATE human_grants SET scopes_json=?',JSON.stringify(['tasks:read','events:read']));expect(read()).toBeNull();
  expect(()=>withTransaction(s,tx=>{const actor=resolveActor(tx,identity,Date.now());return taskView(tx,actor,taskRecord(tx,actor.workspaceId,'task_result'),Date.now());})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  s.sql.exec('UPDATE human_grants SET scopes_json=?',scopes);expect(read()).not.toBeNull();
  s.sql.exec("UPDATE artifact_generations SET state='tombstoned'");expect(read()).toBeNull();
 });
});
it('preflights giant attribution and artifact identifiers before materializing their strings',async()=>{
 const {stub}=await identityFixture('result-giant-ids');await runInDurableObject(stub,(_o,state)=>{
  const s=state.storage,identity=human(s);seed(s);s.sql.exec('UPDATE human_grants SET scopes_json=?',scopes);
  const giant='g'.repeat(TASK_RESPONSE_BYTES);s.sql.exec('UPDATE task_results SET submitted_principal_id=?',giant);
  const queries:string[]=[];
  const read=()=>withTransaction(s,tx=>{const actor=resolveActor(tx,identity,Date.now());const traced:WorkspaceTransaction={exec:tx.exec,all:(sql,args)=>{queries.push(sql);return tx.all(sql,args);},one:(sql,args)=>{queries.push(sql);return tx.one(sql,args);}};return projectTaskResult(traced,actor,'task_result','projection_result');});
  expect(read).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));expect(queries.some(q=>q==='SELECT * FROM task_results WHERE workspace_id=? AND task_id=? AND id=?')).toBe(false);
  s.sql.exec("UPDATE task_results SET submitted_principal_id='agent_research'");
  s.sql.exec("INSERT INTO artifacts(id,workspace_id,owner_kind,owner_principal_id,authority_epoch,artifact_version,filename,media_type,byte_size,sha256,status,created_at,expires_at) VALUES(?,'ws_example','human','human_operator',1,1,'huge','text/plain',0,?,'staged',1,3)",giant,'c'.repeat(64));
  s.sql.exec("INSERT INTO result_artifacts VALUES('ws_example','projection_result',?,0)",giant);queries.length=0;expect(read).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));expect(queries.some(q=>q.startsWith('SELECT artifact_id FROM result_artifacts'))).toBe(false);
 });
});
it('serialized UTF-8 and escaping expansion obey the exact maximum continuation envelope',()=>{
 const base:TaskResult={summary:'',artifact_ids:[],run_id:'run',submitted_by:{kind:'agent',principal_id:'agent',agent_id:'agent'},submitted_at:'2026-10-27T00:00:00.000Z'};
 const remaining=MAX_TASK_ITEM_BYTES-jsonBytes(base),exact={...base,summary:'a'.repeat(remaining)};
 expect(assertTaskItemFits(exact)).toBe(MAX_TASK_ITEM_BYTES);
 const envelope={data:[exact],page:{next_cursor:'x'.repeat(TASK_CURSOR_BYTES),has_more:false},request_id:'x'.repeat(TASK_REQUEST_ID_BYTES)};
 expect(jsonBytes(envelope)).toBe(TASK_RESPONSE_BYTES);
 expect(()=>assertTaskItemFits({...exact,summary:exact.summary+'a'})).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));
 const escaped={...base,summary:'\u0000'.repeat(Math.floor(remaining/6)+1)};expect(new TextEncoder().encode(escaped.summary).byteLength).toBeLessThan(MAX_TASK_ITEM_BYTES);expect(()=>assertTaskItemFits(escaped)).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));
 const unicode={...base,summary:'界'.repeat(Math.floor(remaining/3)+1)};expect(unicode.summary.length).toBeLessThan(MAX_TASK_ITEM_BYTES);expect(()=>assertTaskItemFits(unicode)).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));
});
it('persisted escaped and multibyte summary overflow cannot return a partial result',async()=>{
 const {stub}=await identityFixture('result-encoded-overflow');await runInDurableObject(stub,(_o,state)=>{
  const s=state.storage,identity=human(s);seed(s);
  for(const summary of ['\u0000'.repeat(200000),'界'.repeat(400000)]){s.sql.exec('UPDATE task_results SET summary=?',summary);expect(()=>withTransaction(s,tx=>projectTaskResult(tx,resolveActor(tx,identity,Date.now()),'task_result','projection_result'))).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));}
 });
});

it('producer guard requires matching result and room in both history and embedded task envelopes',()=>{
 const result:TaskResult={summary:'Result',artifact_ids:[],run_id:'run',submitted_by:{kind:'agent',principal_id:'agent',agent_id:'agent'},submitted_at:'2026-10-27T00:00:00.000Z'};
 const task:Task={id:'task',workspace_id:'ws_example',title:'Title',description:'',state:'review',task_version:2,proposal_version:0,project_id:null,work_role_id:null,assigned_agent_id:null,active_run_id:null,latest_run_id:'run',approval_id:null,result,retry_count:0,retry_limit:2,flags:[],created_at:'2026-10-27T00:00:00.000Z',updated_at:'2026-10-27T00:00:00.000Z'};
 expect(()=>assertTaskResultAdmissionFits(result,task)).not.toThrow();
 expect(()=>assertTaskResultAdmissionFits(result,{...task,result:null})).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));
 expect(()=>assertTaskResultAdmissionFits(result,{...task,result:{...result,summary:'Different'}})).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));
 const reordered={artifact_ids:result.artifact_ids,run_id:result.run_id,submitted_at:result.submitted_at,summary:result.summary,submitted_by:result.submitted_by};
 expect(()=>assertTaskResultAdmissionFits(result,{...task,result:reordered})).not.toThrow();
 const empty={...result,summary:''},maximum={...empty,summary:'x'.repeat(MAX_TASK_ITEM_BYTES-jsonBytes(empty))};
 expect(()=>assertTaskItemFits(maximum)).not.toThrow();
 expect(()=>assertTaskResultAdmissionFits(maximum,{...task,result:maximum})).toThrowError(expect.objectContaining({code:'INTERNAL_ERROR'}));
});
