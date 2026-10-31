import {describe,it,expect,vi} from 'vitest';
import {TaskReads,taskStates} from '../../src/ui/task-reads';
import type {BrowserReadRequest,ApiResult} from '../../packages/client/src/types';
import type {Task,TaskState} from '../../src/http/dto';
const task=(id='task_one',state:TaskState='ready'):Task=>({id,workspace_id:'ws',title:'Synthetic '+id,description:'Synthetic',state,task_version:2,proposal_version:0,project_id:null,work_role_id:null,assigned_agent_id:null,active_run_id:null,latest_run_id:null,approval_id:null,result:null,retry_count:0,retry_limit:2,flags:[],created_at:'2026-10-27T00:00:00Z',updated_at:'2026-10-27T00:00:00Z'});
const ok=<T>(data:T,cursor:string|null=null):ApiResult<T>=>({ok:true,status:200,data,requestId:'synthetic',page:{next_cursor:cursor,has_more:cursor!==null}});
const bad=(status=404,code='NOT_FOUND'):ApiResult<never>=>({ok:false,status,requestId:'synthetic_error',error:{code,message:'Synthetic failure',retryable:false}});
const deferred=<T>()=>{let resolve!:(value:T)=>void;return {promise:new Promise<T>(done=>resolve=done),resolve:(value:T)=>resolve(value)};};
function setup(handler:(op:string,input:any)=>Promise<ApiResult<any>>=async()=>ok([])){
 const request=vi.fn(handler),changed=vi.fn();const model=new TaskReads({workspaceId:'ws',request:request as BrowserReadRequest,changed});
 model.setCapabilities({tasks:true,events:true,artifacts:true});return {model,request,changed};
}
describe('bounded authorized task read controller',()=>{
 it('loads seven independent canonical state pages of twenty only',async()=>{
  const {model,request}=setup(async(_op,input)=>ok([task('task_'+input.query.state,input.query.state)]));
  await model.refreshBoard();expect(request).toHaveBeenCalledTimes(7);
  for(const state of taskStates){expect(request).toHaveBeenCalledWith('listTasks',{query:{state,limit:20}});expect(model.columns[state].read.state.data).toHaveLength(1);}
 });
 it('keeps successful unrelated columns when one section fails',async()=>{
  const {model}=setup(async(_op,input)=>input.query.state==='ready'?bad(503,'DEPENDENCY_UNAVAILABLE'):ok([task('task_'+input.query.state,input.query.state)]));
  await model.refreshBoard();expect(model.columns.ready.read.state.status).toBe('error');expect(model.columns.doing.read.state.status).toBe('ready');
 });
 it('next page replaces instead of growing a stale prefix and refresh resets cursor',async()=>{
  const {model,request}=setup(async(_op,input)=>ok([task(input.query.cursor?'second':'first',input.query.state)],input.query.cursor?null:'opaque'));
  await model.refreshBoard();await model.nextColumn('ready');expect(model.columns.ready.read.state.data?.map(x=>x.id)).toEqual(['second']);
  await model.refreshBoard();expect(model.columns.ready.read.state.data?.map(x=>x.id)).toEqual(['first']);expect(request.mock.calls.at(-6)?.[1].query.cursor).toBeUndefined();
 });
 it('does not read scopes absent from a currently observed capability set',async()=>{
  const {model,request}=setup(async(op)=>op==='getTask'?ok(task()):ok([]));model.setCapabilities({tasks:true,events:false,artifacts:false});
  await model.select('task_one');expect(request.mock.calls.map(x=>x[0])).toEqual(['getTask','listTaskResults']);expect(model.events.read.state.status).toBe('unavailable');expect(model.artifacts.state.status).toBe('unavailable');
  model.setCapabilities({tasks:false,events:false,artifacts:false});await model.refreshBoard();expect(model.task.state.data).toBeNull();expect(request).toHaveBeenCalledTimes(2);
 });
 it('404 removes selected task from cached columns and ignores a late page without erasing unrelated records',async()=>{
  const late=deferred<ApiResult<Task[]>>();let lateMode=false;
  const {model}=setup(async(op,input)=>op==='getTask'?bad():input.query.state==='ready'?(lateMode?late.promise:ok([task(),task('unrelated')])):ok([]));
  await model.refreshBoard();lateMode=true;const pending=model.refreshBoard();await model.select('task_one');late.resolve(ok([task()]));await pending;
  expect(model.columns.ready.read.state.data?.map(x=>x.id)).toEqual(['unrelated']);expect(model.task.state).toMatchObject({status:'unavailable',data:null});expect(model.events.read.state.data).toBeNull();
 });
 it('selection generations ignore old detail and old dependent reads',async()=>{
  const late=deferred<ApiResult<Task>>();const {model}=setup(async(op,input)=>op==='getTask'&&input.path.task_id==='old'?late.promise:op==='getTask'?ok(task(input.path.task_id)):ok([]));
  const pending=model.select('old');await model.select('new');late.resolve(ok(task('old')));await pending;expect(model.task.state.data?.id).toBe('new');
 });
 it('fresh detail authorization clears children before refresh and denies late child success after invalidation',async()=>{
  const history=deferred<ApiResult<any[]>>();const {model}=setup(async op=>op==='getTask'?ok(task()):op==='listTaskResults'?history.promise:ok([]));
  const pending=model.select('task_one');await Promise.resolve();await Promise.resolve();model.invalidate('FORBIDDEN');history.resolve(ok([{summary:'private'}]));await pending;
  expect(model.task.state.data).toBeNull();expect(model.results.read.state.data).toBeNull();expect(model.columns.ready.read.state.data).toBeNull();
 });
 it('rejects wrong workspace/state/task and run relationship responses',async()=>{
  const {model}=setup(async op=>op==='listTasks'?ok([{...task(),workspace_id:'foreign'}]):op==='getTask'?ok({...task(),latest_run_id:'run_one'}):op==='getRun'?ok({id:'run_one',workspace_id:'ws',task_id:'other'}):ok([]));
  await model.refreshBoard();expect(model.columns.ready.read.state.errorCode).toBe('INVALID_RESPONSE');await model.select('task_one');expect(model.run.state.errorCode).toBe('INVALID_RESPONSE');
 });
 it('retains independent history and task when latest run fails; no fabricated presence fetch',async()=>{
  const {model,request}=setup(async op=>op==='getTask'?ok({...task(),latest_run_id:'run_one'}):op==='getRun'?bad(503,'DEPENDENCY_UNAVAILABLE'):ok([]));
  await model.select('task_one');expect(model.task.state.status).toBe('ready');expect(model.results.read.state.status).toBe('empty');expect(model.run.state.status).toBe('error');expect(request.mock.calls.some(([op])=>op.toLowerCase().includes('runtime'))).toBe(false);
 });
 it('events retain only task-related evidence but cursor reports workspace page boundaries',async()=>{
  const related={workspace_id:'ws',resource_type:'task',resource_id:'task_one',run_id:null};const {model}=setup(async op=>op==='getTask'?ok(task()):op==='listEvents'?ok([related,{resource_type:'task',resource_id:'foreign',run_id:null}],'more'):ok([]));
  await model.select('task_one');expect(model.events.read.state.data).toEqual([related]);expect(model.events.page?.has_more).toBe(true);
 });
});
it('accepts canonical unbound artifact metadata and rejects a mismatched non-null run',async()=>{
 const result={summary:'Synthetic result',artifact_ids:['artifact_one'],run_id:'run_one',submitted_by:{kind:'agent',principal_id:'agent_one',agent_id:'agent_one'},submitted_at:'2026-10-27T00:00:00Z'};
 let runId:string|null=null;
 const {model}=setup(async op=>op==='getTask'?ok({...task(),result}):op==='getArtifact'?ok({id:'artifact_one',workspace_id:'ws',task_id:null,run_id:runId,status:'committed'}):ok([]));
 await model.select('task_one');expect(model.artifacts.state.status).toBe('ready');runId='foreign_run';await model.refreshTask();expect(model.artifacts.state.errorCode).toBe('INVALID_RESPONSE');
});
it('retains only selected task and observed run events with matching workspace',async()=>{
 const taskEvent={workspace_id:'ws',resource_type:'task',resource_id:'task_one',run_id:null};
 const runEvent={workspace_id:'ws',resource_type:'run',resource_id:'run_one',run_id:'run_one'};
 const {model}=setup(async op=>op==='getTask'?ok({...task(),latest_run_id:'run_one'}):op==='getRun'?bad():op==='listEvents'?ok([taskEvent,runEvent,{...runEvent,resource_id:'other',run_id:'other'}]):ok([]));
 await model.select('task_one');expect(model.events.read.state.data).toEqual([taskEvent,runEvent]);
});
it('retained-results 404 purges selected task and every dependent late response',async()=>{
 const history=deferred<ApiResult<any[]>>(),artifact=deferred<ApiResult<any>>();
 const result={summary:'Private',artifact_ids:['artifact_one'],run_id:'run_one',submitted_by:{kind:'agent',principal_id:'agent_one',agent_id:'agent_one'},submitted_at:'2026-10-27T00:00:00Z'};
 const {model,request}=setup(async(op,input)=>op==='listTasks'?ok(input.query.state==='ready'?[task()]:[]):op==='getTask'?ok({...task(),result}):op==='listTaskResults'?history.promise:op==='getArtifact'?artifact.promise:ok([]));
 await model.refreshBoard();const pending=model.select('task_one');await vi.waitFor(()=>expect(request.mock.calls.some(([op])=>op==='getArtifact')).toBe(true));
 history.resolve(bad());artifact.resolve(ok({id:'artifact_one',workspace_id:'ws',task_id:null,run_id:null,status:'committed'}));await pending;
 expect(model.task.state).toMatchObject({status:'unavailable',data:null});expect(model.columns.ready.read.state.data).toEqual([]);expect(model.artifacts.state.data).toBeNull();
});
it('next history page 404 purges task but an older selection 404 cannot purge the new task',async()=>{
 let fail=false;const late=deferred<ApiResult<any[]>>();const {model}=setup(async(op,input)=>op==='getTask'?ok(task(input.path.task_id)):op==='listTaskResults'&&input.path.task_id==='old'?late.promise:op==='listTaskResults'?(fail?bad():ok([],'more')):ok([]));
 await model.select('task_one');fail=true;await model.nextResults();expect(model.task.state.data).toBeNull();
 fail=false;const old=model.select('old');await Promise.resolve();await Promise.resolve();await model.select('new');late.resolve(bad());await old;expect(model.task.state.data?.id).toBe('new');
});
it('a command preparation 404 redacts the target from board pages without clearing another selected task',async()=>{
 const {model}=setup(async(op,input)=>op==='listTasks'?ok(input.query.state==='ready'?[task('missing'),task('other')]:[]):op==='getTask'?ok(task(input.path.task_id)):ok([]));
 await model.refreshBoard();await model.select('other');model.forgetTask('missing','missing-request');
 expect(model.columns.ready.read.state.data?.map(row=>row.id)).toEqual(['other']);expect(model.task.state.data?.id).toBe('other');
 model.forgetTask('other','other-request');expect(model.task.state.data).toBeNull();expect(model.columns.ready.read.state.data).toEqual([]);
});
