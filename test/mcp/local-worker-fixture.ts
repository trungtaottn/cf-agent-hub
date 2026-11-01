/// <reference path="../../worker-configuration.d.ts" />
/** Test-only local workerd composition. Never a production entry or frozen native roster. */
import worker,{WorkspaceDO} from '../../src/index';
import {fixture,operator} from '../helpers/environment';
import {claimSetup} from '../helpers/claims';
import {syntheticPolicy} from '../helpers/decision-policy';
import {canonicalJson,sha256,prepareBootstrap} from '../../src/config/bootstrap';
export class McpFixtureDO extends WorkspaceDO {
 async seed(origin:string,token:string){
  const raw=await fixture('mcp_local');raw.config.authentication.allowed_origins=[origin];for(const redirect of raw.config.authentication.redirect_uris)redirect.redirect_uri=origin+'/v2/workspaces/ws_example/auth/callback';
  raw.config.human_grants[0].scopes.push('tasks:read','tasks:create','tasks:edit','tasks:schedule','artifacts:read','approvals:read','approvals:decide');
  raw.config.human_grants.push({...raw.config.human_grants[0],principal_id:'human_reviewer',subject:'synthetic-reviewer-subject'});
  Object.assign(raw.config.workspace_policies[0],{decision_policy:structuredClone(syntheticPolicy)});
  const credential={...raw.config.static_credential_refs[0],scopes:['workspace:read','events:read','tasks:read','tasks:claim','tasks:execute','runtimes:manage','artifacts:read','artifacts:write'] as typeof raw.config.static_credential_refs[0]['scopes']};
  raw.config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_other',display_name:'Synthetic other'});raw.config.static_credential_refs=[credential,{...credential,credential_id:'credential_research_2'},{...credential,credential_id:'credential_other',agent_id:'agent_other'}];
  raw.bundle.credentials[0].token_sha256=await sha256(token);raw.bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_research_2',token_sha256:'2'.repeat(64)},{workspace_id:'ws_example',credential_id:'credential_other',token_sha256:'3'.repeat(64)});
  raw.config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:2,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research','agent_other']}],replay_safety_rules:[]};
  raw.bundle.config_digest=await sha256(canonicalJson(raw.config));await this.reconcileConfiguration(operator(),await prepareBootstrap(raw.config,raw.bundle,'ws_example'));
  claimSetup(this.ctx.storage);
  return raw.config;
 }
 async snapshot(){return Object.fromEntries(['tasks','runs','approvals','decision_proposals','decision_checkpoints','decision_artifact_edges','decision_lifecycle_heads','decision_lifecycle_transitions','decision_notice_intents','task_history','idempotency_outcomes','events','outbox'].map(table=>[table,this.ctx.storage.sql.exec('SELECT * FROM '+table+' ORDER BY rowid').toArray()]));}
 async revoke(){this.ctx.storage.sql.exec("UPDATE native_credentials SET revoked_at=1 WHERE credential_id='credential_research_1'");}
}
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url),stub=env.WORKSPACE.getByName('mcp_local') as unknown as McpFixtureDO;
  if(url.pathname==='/__fixture/seed'){const input=await request.json() as {origin:string;token:string};return Response.json(await stub.seed(input.origin,input.token));}
  if(url.pathname==='/__fixture/snapshot')return Response.json(await stub.snapshot());
  if(url.pathname==='/__fixture/revoke'){await stub.revoke();return new Response(null,{status:204});}
  return worker.fetch(request,env);
 }
};
