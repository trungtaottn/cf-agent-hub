import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {identityFixture} from '../helpers/identity';

/** Research-only SQL experiment. This is not task authorization or production budget enforcement. */
it.each([1000,10000])('measures actual schema8 SQLite query work with %i rows',async n=>{
 const {stub}=await identityFixture('query-work-study-'+n);
 const measurements=await runInDurableObject(stub,(_o,state)=>{
  const sql=state.storage.sql,states=['backlog','ready','doing','waiting','review','done','cancelled'];
  const principal=sql.exec<{agent_id:string;credential_id:string;config_epoch:number}>('SELECT agent_id,credential_id,config_epoch FROM native_credentials LIMIT 1').one();
  const id=(i:number)=>'study_'+String(i).padStart(6,'0');
  const resultId=(i:number)=>'result_'+String(i).padStart(6,'0');
  state.storage.transactionSync(()=>{
   sql.exec("INSERT INTO runtimes(id,workspace_id,agent_id,credential_id,authority_epoch,proof_sha256,runtime_version,label,status,created_at,last_seen_at,presence_expires_at) VALUES('study_runtime','ws_example',?,?,?, ?,1,'Study','online',0,0,90000)",principal.agent_id,principal.credential_id,principal.config_epoch,'0'.repeat(64));
   for(let i=1;i<=n;i++){
    sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,project_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES(?,'ws_example','Study','','backlog',1,0,?,0,0,'[]',?,0)",id(i),i===n?'visible':'hidden',Math.floor(i/100));
    sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at) VALUES(?,'ws_example',?,?, 'study_runtime',?,?,'submitted',1,?,100,0,1)",'history_run_'+i,id(1),principal.agent_id,principal.credential_id,principal.config_epoch,i);
    sql.exec("INSERT INTO task_results(id,workspace_id,task_id,run_id,submission_sequence,submitted_kind,submitted_principal_id,summary,created_at) VALUES(?,'ws_example',?,?,?,'human','synthetic',?,0)",resultId(i),id(1),'history_run_'+i,i,i===n?'visible':'hidden');
    sql.exec("INSERT INTO artifacts(id,workspace_id,owner_kind,owner_principal_id,authority_epoch,artifact_version,filename,media_type,byte_size,sha256,status,created_at,expires_at) VALUES(?,'ws_example','human','synthetic',1,1,'a','text/plain',0,?,'staged',0,100)",'artifact_'+i,'0'.repeat(64));
    sql.exec("INSERT INTO result_artifacts(workspace_id,result_id,artifact_id,ordinal) VALUES('ws_example',?,?,0)",resultId(i),'artifact_'+i);
    sql.exec("INSERT INTO artifact_associations(workspace_id,artifact_id,resource_kind,resource_id) VALUES('ws_example',?,'result',?)",'artifact_'+i,resultId(i));
    const taskState=states[i%7];
    if(taskState==='doing'){
     sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at) VALUES(?,'ws_example',?,?,'study_runtime',?,?,'active',1,?,100,0)",'active_'+i,id(i),principal.agent_id,principal.credential_id,principal.config_epoch,n+1);
     sql.exec('UPDATE tasks SET state=?,active_run_id=? WHERE id=?',taskState,'active_'+i,id(i));
    }else sql.exec('UPDATE tasks SET state=? WHERE id=?',taskState,id(i));
   }
  });
  for(let ordinal=1;ordinal<5;ordinal++){
   sql.exec("INSERT INTO result_artifacts(workspace_id,result_id,artifact_id,ordinal) VALUES('ws_example',?,?,?)",resultId(1),'artifact_'+(ordinal+1),ordinal);
  }
  const rows:Record<string,unknown>[]=[];
  function measure(label:string,query:string,args:(string|number)[]=[]){
   const plan=sql.exec('EXPLAIN QUERY PLAN '+query,...args).toArray();
   const start=performance.now(),cursor=sql.exec(query,...args),data=cursor.toArray();
   const measurement={n,label,query,args,plan,rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten,returned:data.length,elapsedMs:performance.now()-start};rows.push(measurement);return measurement;
  }
  function tasks(phase:string){
   measure(phase+' global highwater','SELECT created_at,id FROM tasks WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 1',['ws_example']);
   measure(phase+' unsafe filtered hidden-only','SELECT id FROM tasks WHERE workspace_id=? AND project_id=? ORDER BY created_at,id LIMIT 2',['ws_example','absent']);
   measure(phase+' unsafe filtered long-hidden-prefix','SELECT id FROM tasks WHERE workspace_id=? AND project_id=? ORDER BY created_at,id LIMIT 2',['ws_example','visible']);
   for(const position of [0,Math.floor(n/2),n]){
    const after=[Math.floor(position/100),position===0?'':id(position)];
    for(const cap of [2,65,201]){
     const r=measure(phase+' physical global '+position+' cap '+cap,'SELECT id,created_at,project_id FROM tasks WHERE workspace_id=? AND (created_at,id)>(?,?) ORDER BY created_at,id LIMIT ?',['ws_example',...after,cap]);
     expect(r.returned).toBeLessThanOrEqual(cap);if(phase==='experimental-index')expect(r.rowsRead).toBeLessThanOrEqual(cap+1);
    }
   }
  }
  tasks('schema8');
  for(const taskState of states){
   expect(measure('state highwater '+taskState,'SELECT id,created_at FROM tasks WHERE workspace_id=? AND state=? ORDER BY created_at DESC,id DESC LIMIT 1',['ws_example',taskState]).returned).toBeLessThanOrEqual(1);
   for(const position of [0,Math.floor(n/2),n])for(const cap of [2,65,201]){
    const r=measure('state seek '+taskState+' '+position+' cap '+cap,'SELECT id,created_at,project_id FROM tasks WHERE workspace_id=? AND state=? AND (created_at,id)>(?,?) ORDER BY created_at,id LIMIT ?',['ws_example',taskState,Math.floor(position/100),position===0?'':id(position),cap]);
    expect(r.returned).toBeLessThanOrEqual(cap);expect(r.rowsRead).toBeLessThanOrEqual(cap+1);
   }
  }
  measure('history highwater','SELECT submission_sequence FROM task_results WHERE workspace_id=? AND task_id=? ORDER BY submission_sequence DESC LIMIT 1',['ws_example',id(1)]);
  measure('unsafe history hidden-only','SELECT id FROM task_results WHERE workspace_id=? AND task_id=? AND summary=? ORDER BY submission_sequence LIMIT 2',['ws_example',id(1),'absent']);
  for(const position of [0,Math.floor(n/2),n])for(const cap of [2,65,201]){
   const r=measure('history seek '+position+' cap '+cap,'SELECT id,submission_sequence,summary FROM task_results WHERE workspace_id=? AND task_id=? AND submission_sequence>? AND submission_sequence<=? ORDER BY submission_sequence LIMIT ?',['ws_example',id(1),position,n,cap]);expect(r.returned).toBeLessThanOrEqual(cap);expect(r.rowsRead).toBeLessThanOrEqual(cap);
  }
  for(const position of [1,Math.floor(n/2),n,n+1]){
   expect(measure('result associations '+position,'SELECT artifact_id FROM result_artifacts WHERE workspace_id=? AND result_id=? ORDER BY ordinal LIMIT 6',['ws_example',resultId(position)]).rowsRead).toBeLessThanOrEqual(6);
   expect(measure('association point '+position,'SELECT artifact_id FROM artifact_associations WHERE workspace_id=? AND artifact_id=? AND resource_kind=? AND resource_id=?',['ws_example','artifact_'+position,'result',resultId(position)]).returned).toBeLessThanOrEqual(1);
   expect(measure('artifact point '+position,'SELECT status FROM artifacts WHERE workspace_id=? AND id=?',['ws_example','artifact_'+position]).returned).toBeLessThanOrEqual(1);
  }
  const start=performance.now(),index=sql.exec('CREATE INDEX study_tasks_global_order ON tasks(workspace_id,created_at,id)');index.toArray();
  rows.push({n,label:'experimental index construction',rowsRead:index.rowsRead,rowsWritten:index.rowsWritten,elapsedMs:performance.now()-start});
  tasks('experimental-index');
  sql.exec('UPDATE tasks SET created_at=1');
  for(const position of [0,Math.floor(n/2),n])for(const cap of [2,65,201]){
   for(const taskState of states){
    const r=measure('all tied state '+taskState+' '+position+' cap '+cap,'SELECT id,created_at,project_id FROM tasks INDEXED BY tasks_state_order WHERE workspace_id=? AND state=? AND (created_at,id)>(?,?) AND (created_at,id)<=(?,?) ORDER BY created_at,id LIMIT ?',['ws_example',taskState,1,position===0?'':id(position),1,id(n),cap]);expect(r.rowsRead).toBeLessThanOrEqual(cap+1);
   }
   const r=measure('all tied global '+position+' cap '+cap,'SELECT id,created_at,project_id FROM tasks WHERE workspace_id=? AND (created_at,id)>(?,?) AND (created_at,id)<=(?,?) ORDER BY created_at,id LIMIT ?',['ws_example',1,position===0?'':id(position),1,id(n),cap]);expect(r.rowsRead).toBeLessThanOrEqual(cap+1);
  }
  expect(sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  return rows;
 });
 console.log('QUERY_WORK_STUDY_JSON '+JSON.stringify(measurements));
},120000);
