import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {identityFixture} from '../helpers/identity';

/** Research-only actual SQLite comparison. Experimental indexes are test-local, not migrations. */
it.each([1000,10000])('measures catalog reference query work with %i unrelated rows',async n=>{
 const {stub}=await identityFixture('catalog-query-study-'+n);
 const measurements=await runInDurableObject(stub,(_object,state)=>{
  const sql=state.storage.sql,rows:Record<string,unknown>[]=[];
  const id=(i:number)=>'catalog_study_'+String(i).padStart(6,'0');
  state.storage.transactionSync(()=>{
   for(let i=1;i<=n;i++){
    sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,project_id,work_role_id,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES(?,'ws_example','Study','','backlog',1,0,'unrelated','unrelated',0,0,'[]',?,0)",id(i),i);
    sql.exec("INSERT INTO static_agents(agent_id,workspace_id,display_name,config_epoch,work_role_ids_json) VALUES(?,'ws_example','Study',1,'[\"unrelated\"]')",id(i));
   }
  });
  function measure(label:string,query:string,args:(string|number)[],references:number){
   const plan=sql.exec('EXPLAIN QUERY PLAN '+query,...args).toArray();
   const start=performance.now(),cursor=sql.exec(query,...args),data=cursor.toArray();
   const result={n,references,label,rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten,returned:data.length,elapsedMs:performance.now()-start,plan};rows.push(result);return result;
  }
  for(const phase of ['schema8','experimental-index']){
   if(phase==='experimental-index')for(const column of ['project_id','work_role_id']){
    const start=performance.now(),cursor=sql.exec(`CREATE INDEX catalog_study_${column} ON tasks(workspace_id,${column},id)`);cursor.toArray();
    rows.push({n,label:'index construction '+column,rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten,elapsedMs:performance.now()-start});
   }
   for(const references of [0,1,201]){
    sql.exec("UPDATE tasks SET project_id='unrelated',work_role_id='unrelated'");
    sql.exec("UPDATE static_agents SET work_role_ids_json='[\"unrelated\"]' WHERE agent_id LIKE 'catalog_study_%'");
    if(references){
     // Put all matching rows after the unrelated prefix, exercising worst-case filtering.
     sql.exec("UPDATE tasks SET project_id='target',work_role_id='target' WHERE id>?",id(n-references));
     sql.exec("UPDATE static_agents SET work_role_ids_json='[\"target\"]' WHERE agent_id>? AND agent_id LIKE 'catalog_study_%'",id(n-references));
    }
    for(const column of ['project_id','work_role_id']){
     const r=measure(phase+' filtered '+column,`SELECT id,task_version,${column} FROM tasks WHERE workspace_id=? AND ${column}=? ORDER BY id LIMIT 201`,['ws_example','target'],references);
     expect(r.returned).toBe(references);
     if(phase==='experimental-index')expect(r.rowsRead).toBeLessThanOrEqual(403);
    }
    if(phase==='schema8'){
     const r=measure('capped state scan 1001','SELECT id,task_version,project_id,work_role_id FROM tasks INDEXED BY tasks_state_order WHERE workspace_id=? AND state=? ORDER BY created_at,id LIMIT 1001',['ws_example','backlog'],references);
     expect(r.returned).toBe(Math.min(n,1001));expect(r.rowsRead).toBeLessThanOrEqual(2002);
     const a=measure('agent filtered JSON','SELECT agent_id,agent_version FROM static_agents WHERE workspace_id=? AND EXISTS(SELECT 1 FROM json_each(work_role_ids_json) WHERE value=?) ORDER BY agent_id LIMIT 201',['ws_example','target'],references);
     expect(a.returned).toBe(references);
     const b=measure('agent capped scan 1001','SELECT agent_id,agent_version,work_role_ids_json FROM static_agents INDEXED BY agents_workspace_identity WHERE workspace_id=? ORDER BY agent_id LIMIT 1001',['ws_example'],references);
     expect(b.returned).toBe(1001);expect(b.rowsRead).toBeLessThanOrEqual(2002);
    }
   }
  }
  expect(sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  return rows;
 });
 console.log('CATALOG_QUERY_STUDY_JSON '+JSON.stringify(measurements));
},120000);
