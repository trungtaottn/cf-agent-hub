// Local isolated Workers SQLite observation. No deployment or capacity assertion.
import {createTestHarness} from 'wrangler';
import {CURRENT_SCHEMA_VERSION} from '../../../../src/storage/schema-version.ts';
const harness=createTestHarness({workers:[{configPath:'./wrangler.jsonc',env:'test'}]});
try{
 await harness.listen();const worker=harness.getWorker(),bindings=await worker.getEnv(),name='r2_index_observation';
 try{
  await bindings.WORKSPACE.getByName(name).command({workspaceId:'ws_example',objectName:name,requestId:'index_observation',operation:'readiness'});
  const storage=await worker.getDurableObjectStorage('WORKSPACE',{name});
  const queries=[
   "SELECT id FROM tasks WHERE workspace_id='ws_example' AND state='ready' ORDER BY created_at,id LIMIT 20",
   "SELECT id FROM runs WHERE workspace_id='ws_example' AND status='active' AND lease_expires_at<100 ORDER BY lease_expires_at,id LIMIT 20",
   "SELECT id FROM artifacts WHERE workspace_id='ws_example' AND status='staged' AND expires_at<100 ORDER BY expires_at,id LIMIT 20",
   "SELECT id FROM task_results WHERE workspace_id='ws_example' AND task_id='task_one' AND submission_sequence>0 ORDER BY submission_sequence LIMIT 20"
  ];
  const observations=[];
  for(const query of queries){const scan=query.replace(/FROM (\w+) WHERE/,'FROM $1 NOT INDEXED WHERE');observations.push({query,indexed:await storage.exec('EXPLAIN QUERY PLAN '+query),forced_scan:await storage.exec('EXPLAIN QUERY PLAN '+scan)});}
  console.log(JSON.stringify({environment:'local isolated Workers SQLite',schema:CURRENT_SCHEMA_VERSION,fixture_rows:0,observations,limitation:'Empty-table query planning only; not latency, throughput, scaling, authority or deployed acceptance.'},null,2));
 }finally{bindings[Symbol.dispose]?.();}
}finally{await harness.close();}
