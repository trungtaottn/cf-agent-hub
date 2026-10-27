import {env} from 'cloudflare:workers';
import {fixture,operator} from './environment';
import {prepareBootstrap,canonicalJson,sha256} from '../../src/config/bootstrap';
import {human} from './settings';
import {resolveActor} from '../../src/auth/authorize';
import {withTransaction} from '../../src/storage/transaction';
import {neutralProfile} from '../../src/config/profile';
import type {CommandContext} from '../../src/workspace/context';
export async function taskFixture(name:string,policy=true){
 const raw=await fixture(name);
 raw.config.human_grants[0].scopes=[...raw.config.human_grants[0].scopes,'tasks:read','tasks:create','tasks:edit','tasks:schedule','artifacts:read'];
 raw.config.static_credential_refs[0].scopes=[...raw.config.static_credential_refs[0].scopes,'tasks:read','tasks:claim','tasks:execute','tasks:create','tasks:edit','tasks:schedule'];
 if(policy)raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']},{project_id:'project_a',work_role_id:'role_a',eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
 raw.bundle.config_digest=await sha256(canonicalJson(raw.config));const input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),input);return {stub,name,input};
}
export function taskContext(storage:DurableObjectStorage):CommandContext{
 const identity=human(storage),nowMs=Date.now();return withTransaction(storage,tx=>({actor:resolveActor(tx,identity,nowMs),nowMs,requestId:'request_task',idempotencyKey:'task_domain'}));
}
export function taskProfile(storage:DurableObjectStorage):void{
 const profile={...neutralProfile,projects:[{id:'project_a',display_name:'A',description:'',archived:false},{id:'project_b',display_name:'B',description:'',archived:false}],work_roles:[{id:'role_a',display_name:'A',description:'',archived:false}]};
 storage.sql.exec("INSERT INTO profiles(workspace_id,version,document_json,updated_at,updated_by) VALUES('ws_example',1,?,1,'human_operator')",JSON.stringify(profile));
}
export const taskInput={title:'Synthetic task',description:'Metadata test'};
export function taskCounts(storage:DurableObjectStorage){return Object.fromEntries(['tasks','events','task_history','idempotency_outcomes'].map(table=>[table,storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM '+table).one().n]));}
