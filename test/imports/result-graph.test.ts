import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {importFixture,importBatch,applyBody} from './helpers';
import {seedSearchArtifact,seedSearchMessage} from '../helpers/r2-isolation';
// Synthetic durable result graph, not import-authorized execution or an R3 approval.
function resultGraph(s:DurableObjectStorage,taskId:string){
 s.sql.exec("INSERT INTO runs(id,workspace_id,task_id,agent_id,runtime_instance_id,credential_id,authority_epoch,status,run_version,fence,lease_expires_at,started_at,ended_at) SELECT 'run_import_graph',workspace_id,?,agent_id,id,credential_id,authority_epoch,'submitted',1,1,9999999999999,1,2 FROM runtimes WHERE credential_id='credential_research_1' LIMIT 1",taskId);
 s.sql.exec("INSERT INTO task_results VALUES('result_import_graph','ws_example',?,'run_import_graph',1,'agent','agent_research','agent_research','Private retained result',2)",taskId);
 seedSearchArtifact(s,'artifact_import_graph',2,{taskId});
 s.sql.exec("INSERT INTO result_artifacts VALUES('ws_example','result_import_graph','artifact_import_graph',0)");
 s.sql.exec("INSERT INTO artifact_associations VALUES('ws_example','artifact_import_graph','result','result_import_graph')");
 s.sql.exec("UPDATE tasks SET state='review',task_version=task_version+1,latest_run_id='run_import_graph',current_result_id='result_import_graph',next_result_sequence=2 WHERE id=?",taskId);
}
it.each(['scope','status','result-edge','hidden-message'])('current result graph %s protects previews retained reports replays and import events',async mutation=>{
 const f=await importFixture('imports-result-'+mutation);await f.grant(['imports:manage','tasks:read','tasks:create','artifacts:read','messages:read','events:read']);const first=await f.preview(importBatch(),'preview-first'),report=await f.apply(first,false,'apply-first');
 await runInDurableObject(f.a.stub,(_o,{storage:s})=>resultGraph(s,report.rows[0].task_id!));
 const unchanged=await f.preview(importBatch(),'preview-unchanged');expect(unchanged.rows[0].disposition).toBe('unchanged');await f.apply(unchanged,false,'apply-unchanged');
 expect((await f.send('imports/'+first.id)).status).toBe(200);
 await runInDurableObject(f.a.stub,(_o,{storage:s})=>{if(mutation==='scope')s.sql.exec("UPDATE human_grants SET scopes_json=?",JSON.stringify(['imports:manage','tasks:read','tasks:create','messages:read','events:read']));if(mutation==='status')s.sql.exec("UPDATE artifacts SET status='expired',committed_at=NULL WHERE id='artifact_import_graph'");if(mutation==='result-edge')s.sql.exec("DELETE FROM artifact_associations WHERE resource_kind='result'");if(mutation==='hidden-message'){seedSearchMessage(s,'hidden_import_message',3,{participant:'agent_other'});s.sql.exec("INSERT INTO message_artifacts VALUES('ws_example','hidden_import_message','artifact_import_graph',0)");s.sql.exec("INSERT INTO artifact_associations VALUES('ws_example','artifact_import_graph','message','hidden_import_message')");}});
 for(const plan of [first,unchanged]){expect((await f.send('imports/'+plan.id)).status).toBe(404);expect((await f.send('imports/'+plan.id+':apply',applyBody(plan),plan===first?'apply-first':'apply-unchanged')).status).toBe(404);expect((await f.send('imports:preview',importBatch(),plan===first?'preview-first':'preview-unchanged')).status).toBe(404);}
 const fresh=await f.preview();expect(fresh.rows[0]).toMatchObject({disposition:'rejected',external_id:null,task_id:null,code:'INVALID_REFERENCE'});
 const events=await f.send('events');expect(events.status).toBe(200);const body=await events.json() as {data:{resource_id:string}[]};expect(body.data.some(x=>x.resource_id===first.id||x.resource_id===unchanged.id)).toBe(false);
});
