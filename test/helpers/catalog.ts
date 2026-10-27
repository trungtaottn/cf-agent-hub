import {env} from 'cloudflare:workers';
import {fixture,operator} from './environment';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import {neutralProfile} from '../../src/config/profile';
export async function catalogFixture(name:string){
 const raw=await fixture(name);
 raw.config.human_grants[0].scopes=[...raw.config.human_grants[0].scopes,'tasks:read','tasks:create','tasks:edit','agents:read','agents:manage'];
 raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[],replay_safety_rules:[]};
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));
 const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),input);return {stub,name,input};
}
export function catalogProfile(storage:DurableObjectStorage):void{
 const entry=(id:string)=>({id,display_name:id,description:'',archived:false});
 const profile={...neutralProfile,projects:['project_a','project_b'].map(entry),work_roles:['role_a','role_b'].map(entry)};
 storage.sql.exec("INSERT INTO profiles(workspace_id,version,document_json,updated_at,updated_by) VALUES('ws_example',1,?,1,'human_operator')",JSON.stringify(profile));
}
export function catalogSnapshot(storage:DurableObjectStorage){return Object.fromEntries(['profiles','tasks','static_agents','catalog_plans','events','task_history','idempotency_outcomes','scheduler_state','outbox'].map(table=>[table,storage.sql.exec('SELECT * FROM '+table).toArray()]));}
