import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {claimFixture,claimSetup} from '../helpers/claims';
it('indexed_threshold_probe_bounds_WIP_work_without_ignoring_expired_active_rows',async()=>{
 const {stub}=await claimFixture('claim-wip-study',{wip:100});
 const measurement=await runInDurableObject(stub,(_o,state)=>{
  const {now}=claimSetup(state.storage),sql=state.storage.sql;
  // Query experiment only: 100 supported active slots plus 1000 terminal attempts.
  // Explicit fixture records do not implement or claim a settlement transition.
  for(let i=0;i<1100;i++){
   const active=i<100,id='study_'+i,run='run_'+id;
   sql.exec("INSERT INTO tasks(id,workspace_id,title,description,state,task_version,proposal_version,retry_count,retry_limit,flags_json,created_at,updated_at) VALUES(?,'ws_example','Study','','backlog',1,0,0,2,'[]',?,?)",id,now,now);
   sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at) VALUES(?,'ws_example',?,'agent_research','runtime_a','credential_research_1',1,?,1,1,?,?,?)",run,id,active?'active':'failed',now-1,now-60001,active?null:now-1);
   if(active)sql.exec("UPDATE tasks SET state='doing',active_run_id=?,latest_run_id=?,next_fence=2 WHERE id=?",run,run,id);
  }
  const count=sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM runs WHERE workspace_id=? AND agent_id=? AND status='active'",'ws_example','agent_research');expect(count.one().n).toBe(100);const countRows=count.rowsRead;
  const samples=[];
  for(const limit of [1,10,100]){
   const query=sql.exec("SELECT 1 AS occupied FROM runs WHERE workspace_id=? AND agent_id=? AND status='active' LIMIT ?",'ws_example','agent_research',limit);expect(query.toArray()).toHaveLength(limit);expect(query.rowsRead).toBeLessThanOrEqual(limit);samples.push({limit,rowsRead:query.rowsRead});
  }
  const wrong=sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM runs WHERE workspace_id=? AND agent_id=? AND status='active' AND lease_expires_at>?",'ws_example','agent_research',now).one().n;expect(wrong).toBe(0);
  const plan=sql.exec("EXPLAIN QUERY PLAN SELECT 1 AS occupied FROM runs WHERE workspace_id=? AND agent_id=? AND status='active' LIMIT ?",'ws_example','agent_research',1).toArray();expect(JSON.stringify(plan)).toContain('runs_agent_status');
  expect(countRows).toBeGreaterThan(samples[0].rowsRead);
  expect(sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
  return {active:100,terminal:1000,countRows,samples,expiredTimeFilteredCount:wrong,plan};
 });
 console.log('WIP_QUERY_STUDY '+JSON.stringify(measurement));
});
