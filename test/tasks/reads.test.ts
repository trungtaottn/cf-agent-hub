import {it,expect} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {taskFixture,taskContext} from '../helpers/tasks';
import {withTransaction,type WorkspaceTransaction,type SqlValue} from '../../src/storage/transaction';
import {listTasks,TASK_STATES} from '../../src/tasks/reads';
import {listTaskResults,TASK_SCAN_LIMIT} from '../../src/tasks/history';
import {getTask} from '../../src/tasks/repository';
import type {CommandContext} from '../../src/workspace/context';
import type {CursorBinding,CursorPayload} from '../../src/http/cursors';
const id=(n:number)=>'read_task_'+String(n).padStart(6,'0');
const rid=(n:number)=>'read_result_'+String(n).padStart(6,'0');
function binding(ctx:CommandContext,operation:'tasks'|'task-results'):CursorBinding{return {workspaceId:'ws_example',principalId:ctx.actor.principalId,lane:'human',credentialId:null,sessionId:ctx.actor.sessionId,operation,queryHash:'a'.repeat(64)};}
function seedTask(s:DurableObjectStorage,n:number,project:string|null='project_a',state='backlog',workspace='ws_example'){
 s.sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,project_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES(?,?,?,'',?,1,0,?,0,2,'[]',1,1)",id(n),workspace,'Task '+n,state,project);
}
function seedRuntime(s:DurableObjectStorage){s.sql.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('read_runtime','ws_example','agent_research','credential_research_1',1,?,1,'Read','expired',1,1,2)",'a'.repeat(64));}
function seedResult(s:DurableObjectStorage,n:number,hidden=false){
 s.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at) VALUES(?,'ws_example',?,'agent_research','read_runtime','credential_research_1',1,'submitted',1,?,2,1,2)",'read_run_'+n,id(1),n);
 s.sql.exec("INSERT INTO task_results(id,workspace_id,task_id,run_id,submission_sequence,submitted_kind,submitted_principal_id,submitted_agent_id,summary,created_at) VALUES(?,'ws_example',?,?,?,'agent','agent_research','agent_research',?,2)",rid(n),id(1),'read_run_'+n,n,'Result '+n);
 if(hidden)seedArtifact(s,n,false);
}
function seedArtifact(s:DurableObjectStorage,n:number,committed:boolean,ordinal=0){
 const artifact='read_artifact_'+n+'_'+ordinal,run='read_run_'+n;
 s.sql.exec("INSERT INTO artifacts(id,workspace_id,task_id,run_id,owner_kind,owner_principal_id,authority_epoch,artifact_version,filename,media_type,byte_size,sha256,status,created_at,expires_at) VALUES(?,'ws_example',?,?,'human','synthetic',1,1,'a','text/plain',0,?,'staged',1,3)",artifact,id(1),run,'b'.repeat(64));
 s.sql.exec("INSERT INTO result_artifacts VALUES('ws_example',?,?,?)",rid(n),artifact,ordinal);
 if(committed){
  s.sql.exec("INSERT INTO artifact_generations(id,workspace_id,artifact_id,object_key,expected_sha256,expected_byte_size,observed_sha256,observed_byte_size,state,admission_epoch,admission_generation,expires_at,created_at,updated_at) VALUES(?,'ws_example',?,?,?,0,?,0,'committed',1,0,3,1,2)",'read_generation_'+n+'_'+ordinal,artifact,'read_key_'+n+'_'+ordinal,'b'.repeat(64),'b'.repeat(64));
  s.sql.exec("UPDATE artifacts SET status='committed',committed_at=2,expires_at=NULL,committed_generation_id=? WHERE id=?",'read_generation_'+n+'_'+ordinal,artifact);
  for(const [kind,resource]of [['task',id(1)],['run',run],['result',rid(n)]])s.sql.exec("INSERT INTO artifact_associations VALUES('ws_example',?,?,?)",artifact,kind,resource);
 }
}
function measured<T>(s:DurableObjectStorage,label:string,fn:(tx:WorkspaceTransaction)=>T){
 const samples=new Map<string,{calls:number;rowsRead:number;maxRowsRead:number;returned:number;maxReturned:number;plan:unknown[]}>();let rowsRead=0,queries=0;
 const query=<R>(sql:string,args:readonly SqlValue[]=[])=>{const cursor=s.sql.exec(sql,...args),rows=cursor.toArray() as R[];rowsRead+=cursor.rowsRead;queries++;let sample=samples.get(sql);if(!sample){sample={calls:0,rowsRead:0,maxRowsRead:0,returned:0,maxReturned:0,plan:s.sql.exec('EXPLAIN QUERY PLAN '+sql,...args).toArray()};samples.set(sql,sample);}sample.calls++;sample.rowsRead+=cursor.rowsRead;sample.maxRowsRead=Math.max(sample.maxRowsRead,cursor.rowsRead);sample.returned+=rows.length;sample.maxReturned=Math.max(sample.maxReturned,rows.length);return rows;};
 let data:T|undefined,error:unknown;const started=performance.now();
 try{data=s.transactionSync(()=>fn({all:query,one:<R>(sql:string,args?:readonly SqlValue[])=>query<R>(sql,args)[0]??null,exec:()=>{throw Error('READ_ONLY_STUDY');}}));}catch(e){error=e;}
 const elapsedMs=performance.now()-started;const plainStart=performance.now();let plainError:unknown;
 try{withTransaction(s,fn);}catch(e){plainError=e;}const plainElapsedMs=performance.now()-plainStart;
 expect(plainError instanceof Error?plainError.message:null).toBe(error instanceof Error?error.message:null);
 const entries=Array.from(samples,([sql,value])=>({sql,...value}));
 console.log('QUERY_INTEGRATED_JSON '+JSON.stringify({label,rowsRead,queries,elapsedMs,plainElapsedMs,error:error instanceof Error?{...error,message:error.message}:null,samples:entries}));
 return {data,error,rowsRead,queries,samples:entries};
}
it('task pages globally merge all seven states and hide foreign, null and forbidden projects at limit1',async()=>{
 const {stub}=await taskFixture('reads-task-interleaved');await runInDurableObject(stub,(_o,state)=>{
  const s=state.storage;seedRuntime(s);
  for(let n=1;n<=14;n++){
   const status=TASK_STATES[(n-1)%7];seedTask(s,n,n%2?'project_b':'project_a',status==='doing'?'ready':status);
   if(status==='doing'){s.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES(?,'ws_example',?,'agent_research','read_runtime','credential_research_1',1,'active',1,1,2,1)",'active_'+n,id(n));s.sql.exec("UPDATE tasks SET state='doing',active_run_id=? WHERE id=?",'active_'+n,id(n));}
  }
  seedTask(s,15,null);seedTask(s,16,'project_a','backlog','foreign');s.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\"]'");const ctx=taskContext(s);let cursor:CursorPayload|undefined;const found:string[]=[];
  do{const page=withTransaction(s,tx=>listTasks(tx,ctx,{limit:1,binding:binding(ctx,'tasks'),cursor}));expect(page.items).toHaveLength(1);found.push(page.items[0].id);expect(page.hasMore).toBe(found.length<7);expect(page.next?.lastScanned).toEqual(found.length<7?{createdAt:1,id:page.items[0].id}:undefined);cursor=page.next??undefined;}while(cursor);
  expect(found).toEqual([2,4,6,8,10,12,14].map(id));
  expect(()=>withTransaction(s,tx=>listTasks(tx,ctx,{limit:1,binding:binding(ctx,'tasks'),project_id:'project_b'}))).toThrowError(expect.objectContaining({status:403}));
 });
});
it('task cursor preserves highwater across restart and denies current rights loss',async()=>{
 const {stub}=await taskFixture('reads-task-restart');const first=await runInDurableObject(stub,(_o,state)=>{for(let n=1;n<=3;n++)seedTask(state.storage,n);const ctx=taskContext(state.storage);return withTransaction(state.storage,tx=>listTasks(tx,ctx,{limit:1,binding:binding(ctx,'tasks')}));});
 await evictDurableObject(stub);await runInDurableObject(stub,(_o,state)=>{const s=state.storage;seedTask(s,4);const ctx=taskContext(s),page=withTransaction(s,tx=>listTasks(tx,ctx,{limit:200,binding:binding(ctx,'tasks'),cursor:first.next!}));expect(page.items.map(t=>t.id)).toEqual([id(2),id(3)]);expect(page.hasMore).toBe(false);s.sql.exec("UPDATE human_grants SET scopes_json='[]'");expect(()=>withTransaction(s,tx=>listTasks(tx,ctx,{limit:1,binding:binding(ctx,'tasks'),cursor:first.next!}))).toThrow();});
});
it('retained history uses authorized lookahead, hides whole artifact results and current task result',async()=>{
 const {stub}=await taskFixture('reads-history-interleaved');await runInDurableObject(stub,(_o,state)=>{const s=state.storage;seedTask(s,1);seedRuntime(s);for(let n=1;n<=5;n++)seedResult(s,n,n%2===1);const ctx=taskContext(s),query={limit:1,binding:binding(ctx,'task-results')};
  const first=withTransaction(s,tx=>listTaskResults(tx,ctx,id(1),query));expect(first.items.map(x=>x.summary)).toEqual(['Result 2']);expect(first.hasMore).toBe(true);expect(first.next?.lastScanned).toBe(2);
  const second=withTransaction(s,tx=>listTaskResults(tx,ctx,id(1),{...query,cursor:first.next!}));expect(second.items.map(x=>x.summary)).toEqual(['Result 4']);expect(second.hasMore).toBe(false);expect(second.next).toBeNull();
  s.sql.exec('UPDATE tasks SET current_result_id=? WHERE id=?',rid(1),id(1));expect(()=>withTransaction(s,tx=>getTask(tx,ctx,id(1)))).toThrowError(expect.objectContaining({status:403}));expect(withTransaction(s,tx=>listTasks(tx,ctx,{limit:1,binding:binding(ctx,'tasks')})).items).toEqual([]);
  s.sql.exec('UPDATE tasks SET current_result_id=NULL WHERE id=?',id(1));seedResult(s,6);seedArtifact(s,6,true);const view=withTransaction(s,tx=>listTaskResults(tx,ctx,id(1),{limit:200,binding:binding(ctx,'task-results')}));expect(view.items.map(x=>x.summary)).toEqual(['Result 2','Result 4','Result 6']);
  s.sql.exec("UPDATE human_grants SET scopes_json='[\"tasks:read\"]'");expect(withTransaction(s,tx=>listTaskResults(tx,ctx,id(1),{limit:200,binding:binding(ctx,'task-results')})).items.map(x=>x.summary)).toEqual(['Result 2','Result 4']);
 });
});
it.each([128,512,2048,2049])('measures full task hidden-only physical budget at %i candidates',async n=>{
 const {stub}=await taskFixture('reads-task-budget-'+n);await runInDurableObject(stub,(_o,state)=>{const s=state.storage;s.transactionSync(()=>{for(let i=1;i<=n;i++)seedTask(s,i,'project_b');});s.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\"]'");const ctx=taskContext(s),m=measured(s,'tasks-hidden-'+n,tx=>listTasks(tx,ctx,{limit:1,binding:binding(ctx,'tasks')}));
  const seeks=m.samples.filter(x=>x.sql.includes('FROM tasks')&&x.sql.includes('LIMIT ?'));expect(seeks.reduce((sum,x)=>sum+x.returned,0)).toBeLessThanOrEqual(TASK_SCAN_LIMIT+TASK_STATES.length);expect(seeks.every(x=>x.maxRowsRead<=2&&!JSON.stringify(x.plan).includes('TEMP B-TREE'))).toBe(true);
  if(n>TASK_SCAN_LIMIT){expect(m.data).toBeUndefined();expect(m.error).toMatchObject({code:'DEPENDENCY_UNAVAILABLE',status:503});}else{expect(m.error).toBeUndefined();expect(m.data).toEqual({items:[],next:null,hasMore:false});}
 });
});
it.each([128,512,2048,2049])('measures full history hidden-only authorization work at %i candidates',async n=>{
 const {stub}=await taskFixture('reads-history-budget-'+n);await runInDurableObject(stub,(_o,state)=>{const s=state.storage;seedTask(s,1);seedRuntime(s);s.transactionSync(()=>{for(let i=1;i<=n;i++)seedResult(s,i,true);});const ctx=taskContext(s),m=measured(s,'history-hidden-'+n,tx=>listTaskResults(tx,ctx,id(1),{limit:1,binding:binding(ctx,'task-results')}));
  const seeks=m.samples.filter(x=>x.sql.includes('FROM task_results')&&x.sql.includes('LIMIT ?'));expect(seeks.reduce((sum,x)=>sum+x.returned,0)).toBeLessThanOrEqual(TASK_SCAN_LIMIT);expect(seeks.every(x=>x.maxRowsRead<=32&&!JSON.stringify(x.plan).includes('TEMP B-TREE'))).toBe(true);
  if(n>TASK_SCAN_LIMIT){expect(m.data).toBeUndefined();expect(m.error).toMatchObject({code:'DEPENDENCY_UNAVAILABLE',status:503});}else{expect(m.error).toBeUndefined();expect(m.data).toEqual({items:[],next:null,hasMore:false});}
 });
});
it('history highwater excludes later results and a budget failure never returns an authorized prefix',async()=>{
 const {stub}=await taskFixture('reads-history-highwater');await runInDurableObject(stub,(_o,state)=>{const s=state.storage;seedTask(s,1);seedRuntime(s);seedResult(s,1);seedResult(s,2);const ctx=taskContext(s),query={limit:1,binding:binding(ctx,'task-results')};const first=withTransaction(s,tx=>listTaskResults(tx,ctx,id(1),query));seedResult(s,3);const second=withTransaction(s,tx=>listTaskResults(tx,ctx,id(1),{...query,cursor:first.next!}));expect(second.items.map(x=>x.summary)).toEqual(['Result 2']);expect(second.hasMore).toBe(false);
  s.transactionSync(()=>{for(let i=4;i<=2052;i++)seedResult(s,i,true);});const m=measured(s,'history-authorized-prefix-budget',tx=>listTaskResults(tx,ctx,id(1),{limit:200,binding:binding(ctx,'task-results')}));expect(m.data).toBeUndefined();expect(m.error).toMatchObject({status:503});
 });
});

it.each([128,512,2048])('measures late fifth-artifact denial at %i results without repeated actor refresh',async n=>{
 const {stub}=await taskFixture('reads-history-late-artifact-'+n);await runInDurableObject(stub,(_o,state)=>{const s=state.storage;seedTask(s,1);seedRuntime(s);s.transactionSync(()=>{for(let i=1;i<=n;i++){seedResult(s,i);for(let ordinal=0;ordinal<5;ordinal++)seedArtifact(s,i,ordinal<4,ordinal);}});const ctx=taskContext(s),m=measured(s,'history-late-artifact-'+n,tx=>listTaskResults(tx,ctx,id(1),{limit:1,binding:binding(ctx,'task-results')}));
  expect(m.error).toBeUndefined();expect(m.data).toEqual({items:[],next:null,hasMore:false});
  const auth=m.samples.filter(x=>x.sql.includes('FROM sessions'));expect(auth.reduce((sum,x)=>sum+x.calls,0)).toBeLessThanOrEqual(2);
  const batches=m.samples.filter(x=>x.sql.includes('LEFT JOIN artifacts'));expect(batches).toHaveLength(1);const batch=batches[0];
  expect(batch.calls).toBe(n);expect(batch.maxReturned).toBe(5);expect(batch.returned).toBe(n*5);expect(batch.maxRowsRead).toBeLessThanOrEqual(27);
  expect(JSON.stringify(batch.plan)).not.toMatch(/SCAN|TEMP B-TREE/);expect(JSON.stringify(batch.plan).match(/SEARCH x USING COVERING INDEX/g)).toHaveLength(3);
  // Per candidate: numeric seek1 + ID point1 + result/task/run4 + association sum6 + bounded batched join27.
  expect(m.rowsRead).toBeLessThanOrEqual(n*39+32);expect(m.queries).toBeLessThanOrEqual(n*7+Math.ceil(n/32)+10);
 });
});

it.each([2048,2049])('counts all seven stream prefetches and terminal probes with %i hidden tasks',async n=>{
 const {stub}=await taskFixture('reads-seven-stream-budget-'+n);await runInDurableObject(stub,(_o,state)=>{const s=state.storage;seedRuntime(s);s.transactionSync(()=>{for(let i=1;i<=n;i++){const status=TASK_STATES[i%7];seedTask(s,i,'project_b',status==='doing'?'ready':status);if(status==='doing'){s.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES(?,'ws_example',?,'agent_research','read_runtime','credential_research_1',1,'active',1,1,2,1)",'seven_active_'+i,id(i));s.sql.exec("UPDATE tasks SET state='doing',active_run_id=? WHERE id=?",'seven_active_'+i,id(i));}}});s.sql.exec("UPDATE human_grants SET project_ids_json='[\"project_a\"]'");const ctx=taskContext(s),m=measured(s,'tasks-seven-stream-hidden-'+n,tx=>listTasks(tx,ctx,{limit:1,binding:binding(ctx,'tasks')}));
 const scans=m.samples.filter(x=>x.sql.includes('FROM tasks')&&x.sql.includes('LIMIT ?'));expect(scans.reduce((sum,x)=>sum+x.returned,0)).toBeLessThanOrEqual(TASK_SCAN_LIMIT+7);expect(scans.every(x=>x.maxRowsRead<=2&&!JSON.stringify(x.plan).includes('TEMP B-TREE'))).toBe(true);
 if(n===2048){expect(m.error).toBeUndefined();expect(m.data).toEqual({items:[],hasMore:false,next:null});}else{expect(m.data).toBeUndefined();expect(m.error).toMatchObject({status:503});}
 });
});

it.each(['tasks','task-results'] as const)('direct %s query rejects mismatched actor binding, operation and malformed cursor positions',async operation=>{
 const {stub}=await taskFixture('reads-direct-validation-'+operation);await runInDurableObject(stub,(_o,state)=>{const s=state.storage;seedTask(s,1);seedTask(s,2);seedRuntime(s);seedResult(s,1);seedResult(s,2);const ctx=taskContext(s),b=binding(ctx,operation);
 const query={limit:1,binding:b};
 const read=(q:typeof query&{cursor?:CursorPayload},context=ctx)=>withTransaction(s,tx=>operation==='tasks'?listTasks(tx,context,q):listTaskResults(tx,context,id(1),q));
 const first=read(query);expect(first.items).toHaveLength(1);expect(first.next).not.toBeNull();
 const badBindings:CursorBinding[]=[{...b,workspaceId:'foreign'},{...b,principalId:'different'},{...b,sessionId:'different'},{...b,credentialId:'credential_research_1'},{...b,lane:'agent'},{...b,operation:operation==='tasks'?'task-results':'tasks'}];
 for(const bad of badBindings){expect(()=>read({...query,binding:bad})).toThrowError(expect.objectContaining({code:'INVALID_REQUEST',status:400}));expect(()=>read({...query,cursor:{...first.next!,binding:bad}})).toThrowError(expect.objectContaining({code:'INVALID_REQUEST',status:400}));}
 expect(()=>read({...query,cursor:{...first.next!,binding:{...b,queryHash:'b'.repeat(64)}}})).toThrowError(expect.objectContaining({code:'INVALID_REQUEST',status:400}));
 expect(()=>read(query,{...ctx,actor:{...ctx.actor,principalId:'forged'}})).toThrow();
 expect(()=>read(query,{...ctx,actor:{...ctx.actor,sessionId:'unknown'}})).toThrow();
 for(const position of [-1,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,1.5]){
  const last=operation==='tasks'?{createdAt:position,id:id(1)}:position;
  expect(()=>read({...query,cursor:{...first.next!,lastScanned:last}})).toThrowError(expect.objectContaining({code:'INVALID_REQUEST',status:400}));
 }
 const wrongType=operation==='tasks'?1:{createdAt:1,id:id(1)};
 expect(()=>read({...query,cursor:{...first.next!,lastScanned:wrongType}})).toThrowError(expect.objectContaining({code:'INVALID_REQUEST',status:400}));
 expect(()=>read({...query,cursor:{...first.next!,expiresAt:ctx.nowMs}})).toThrowError(expect.objectContaining({code:'CURSOR_EXPIRED',status:410}));
 for(const limit of [0,201,1.5,NaN])expect(()=>read({...query,limit})).toThrowError(expect.objectContaining({code:'INVALID_REQUEST',status:400}));
 });
});

it('batched artifact joins retain all five authorized ordered references without row fanout',async()=>{
 const {stub}=await taskFixture('reads-five-visible-batch');await runInDurableObject(stub,(_o,state)=>{const s=state.storage;seedTask(s,1);seedRuntime(s);seedResult(s,1);for(let ordinal=0;ordinal<5;ordinal++)seedArtifact(s,1,true,ordinal);const ctx=taskContext(s),query={limit:1,binding:binding(ctx,'task-results')};const m=measured(s,'history-five-fully-visible',tx=>listTaskResults(tx,ctx,id(1),query));expect(m.error).toBeUndefined();expect(m.data?.items).toHaveLength(1);expect(m.data?.items[0].artifact_ids).toEqual([0,1,2,3,4].map(n=>'read_artifact_1_'+n));expect(m.data?.hasMore).toBe(false);
 const batch=m.samples.find(x=>x.sql.includes('LEFT JOIN artifacts'))!;expect(batch.maxReturned).toBe(5);expect(batch.maxRowsRead).toBeLessThanOrEqual(31);expect(JSON.stringify(batch.plan)).not.toMatch(/SCAN|TEMP B-TREE/);expect(JSON.stringify(batch.plan).match(/SEARCH x USING COVERING INDEX/g)).toHaveLength(3);
 s.sql.exec("DELETE FROM artifact_associations WHERE artifact_id='read_artifact_1_4' AND resource_kind='result'");expect(withTransaction(s,tx=>listTaskResults(tx,ctx,id(1),query))).toEqual({items:[],hasMore:false,next:null});
 });
});
