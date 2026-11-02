/// <reference path="../../worker-configuration.d.ts" />
/** Private synthetic two-workspace composition; no product route or grant changes. */
import worker from '../../src/index';
import {ParityFixtureDO} from './native-worker-parity-fixture';
import {fixture,operator} from '../helpers/environment';
import {canonicalJson,sha256,prepareBootstrap} from '../../src/config/bootstrap';
import type {VerificationBundle} from '../../src/config/generated/validators.js';
import type {DeploymentConfig} from '../../src/config/deployment';

const workspaces=['ws_example','ws_peer'] as const;
type WorkspaceId=typeof workspaces[number];
const objectName=(id:WorkspaceId)=>'mcp_read_'+id;
export class WorkspaceReadParityDO extends ParityFixtureDO {
 async install(config:DeploymentConfig,bundle:VerificationBundle,id:WorkspaceId){
  await this.reconcileConfiguration({...operator(),workspaceId:id},await prepareBootstrap(config,bundle,id));
 }
}
export default {async fetch(request:Request,env:Env):Promise<Response>{
 const url=new URL(request.url);
 const stub=(id:WorkspaceId)=>env.WORKSPACE.getByName(objectName(id)) as unknown as WorkspaceReadParityDO;
 if(url.pathname==='/__fixture/seed'&&request.method==='POST'){
  const {config,bundle}=await fixture(objectName('ws_example'));
  config.workspace_policies[0].notification_destinations=[];
  config.static_credential_refs[0].scopes=['workspace:read','tasks:read','tasks:create','runtimes:manage'];
  config.workspace_policies[0].execution_policy={policy_version:1,agent_wip_limit:2,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
  config.workspace_catalog.push({workspace_id:'ws_peer',object_name:objectName('ws_peer')});
  config.authentication.redirect_uris.push({workspace_id:'ws_peer',redirect_uri:'https://hub.example.invalid/v2/workspaces/ws_peer/auth/callback'});
  config.static_participants.push({...structuredClone(config.static_participants[0]),workspace_id:'ws_peer'});
  config.human_grants.push({...structuredClone(config.human_grants[0]),workspace_id:'ws_peer'});
  config.static_credential_refs.push({...structuredClone(config.static_credential_refs[0]),workspace_id:'ws_peer'});
  config.workspace_policies.push({...structuredClone(config.workspace_policies[0]),workspace_id:'ws_peer'});
  // Fixed public canaries are synthetic fixture inputs, never operator credentials.
  bundle.credentials[0].token_sha256=await sha256('B'.repeat(42)+'A');
  bundle.credentials.push({...structuredClone(bundle.credentials[0]),workspace_id:'ws_peer',token_sha256:await sha256('C'.repeat(42)+'A')});
  bundle.config_digest=await sha256(canonicalJson(config));
  for(const id of workspaces)await stub(id).install(config,bundle,id);
  return Response.json(config);
 }
 if(url.pathname==='/__fixture/settle'&&request.method==='POST'){
  for(const id of workspaces)await stub(id).repairSchedule();
  return new Response(null,{status:204});
 }
 if(url.pathname==='/__fixture/snapshot'&&request.method==='GET'){
  return Response.json(Object.fromEntries(await Promise.all(workspaces.map(async id=>[id,await stub(id).snapshot()]))));
 }
 if(url.pathname.startsWith('/__fixture/'))return new Response(null,{status:404});
 return worker.fetch(request,env);
}};
