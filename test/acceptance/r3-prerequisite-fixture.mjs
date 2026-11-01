/** Synthetic in-memory validator input only. Never materialize under validation/releases. */
import {createHash} from 'node:crypto';
export const hash=x=>createHash('sha256').update(x).digest('hex');
export const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
export const toolPairs=[['hub_workspace_get','getWorkspace'],['hub_agents_list','listAgents'],['hub_tasks_list','listTasks'],['hub_task_get','getTask'],['hub_task_create','createTask'],['hub_task_claim','claimTask'],['hub_run_get','getRun'],['hub_run_heartbeat','heartbeatRun'],['hub_task_request_decision','requestTaskDecision'],['hub_task_submit_result','submitTaskResult'],['hub_task_fail','failTask'],['hub_inbox_get','getInbox'],['hub_thread_get','getThread'],['hub_message_send','createMessage'],['hub_messages_ack','ackMessages'],['hub_artifact_get','getArtifact'],['hub_search','searchWorkspace']];
export const families=['composition','decision-domain','human-browser','native-parity','mcp-stdio','mcp-clients','recovery','independent-review','prior-round'];
export function prerequisiteFixture(){
 const files=new Map([['package-lock.json','{}'],['spec/policy.json','{"policy":1}'],['spec/action.json','{"action":1}']]);
 const sources=[...files].map(([path,body])=>({path,sha256:hash(body),byte_size:Buffer.byteLength(body),mode:'100644'})).sort((a,b)=>a.path.localeCompare(b.path));
 const prefix='validation/releases/synthetic_r3/';
 const artifact=(name,body)=>{const path=prefix+name;files.set(path,body);return {path,sha256:hash(body),byte_size:Buffer.byteLength(body)};};
 const build=artifact('build.mjs','// synthetic built bytes');
 const identity={revision:'a'.repeat(40),tree_sha256:hash(canonical(sources)),build_sha256:build.sha256,lock_sha256:hash('{}'),policy_sha256:hash(files.get('spec/policy.json')),action_schema_sha256:hash(files.get('spec/action.json')),action_semantic_revision:'fixture-v1',schema_version:18,environment_id:'isolated_example',workspace_id:'ws_example',deployment_id:'deployment_example',config_epoch:2};
 const clients=[{id:'fixture_client',name:'synthetic-client',version:'1.0.0',sdk_version:'1.0.0',configuration_sha256:hash('synthetic launch configuration')}];
 const expectedProducers=families.map(family=>({id:family+'_producer',family,case_ids:[family+'_synthetic_case']}));
 const producers=expectedProducers.map(p=>({id:p.id,family:p.family,artifact:artifact(p.family+'.json',JSON.stringify({format_version:1,record_type:'r3-prerequisite-producer',...p,identity,client_inventory_sha256:hash(canonical(clients)),started_at:1,ended_at:2,exit_code:0,selected_count:1,passed_count:1,failed_count:0,skipped_count:0,provenance:'synthetic'}))}));
 const input={format_version:1,round:'R3',stage:'prerequisites',release_id:'synthetic_r3',identity,sources,source_bindings:{lock:'package-lock.json',policy:'spec/policy.json',action_schema:'spec/action.json'},build,protocol_version:'2025-11-25',clients,tools:toolPairs.map(([name,operation])=>({name,operation})),producers};
 const expectedContext={identity:structuredClone(identity),clients:structuredClone(clients),producers:expectedProducers};
 return {input,files,expectedContext,options:{files,expectedContext,fixtureMode:true}};
}
export function rewriteProducer(f,index,mutate){const ref=f.input.producers[index].artifact;const body=JSON.parse(f.files.get(ref.path));mutate(body);const text=JSON.stringify(body);f.files.set(ref.path,text);ref.sha256=hash(text);ref.byte_size=Buffer.byteLength(text);}
