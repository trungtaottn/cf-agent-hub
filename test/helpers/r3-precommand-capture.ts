/** Worker-only bounded readback. Never imported by deployed entrypoints or the host codec. */
import {runInDurableObject} from 'cloudflare:test';
import {canonicalJson,sha256,type ValidatedBootstrap} from '../../src/config/bootstrap';
import {descriptor} from './decision-policy';
import {J1_PRECOMMAND_TABLES,encodeJ1PrecommandContext,j1PlannedHuman,type J1PrecommandPacket} from './r3-precommand-context';
import type {R3JourneyCase} from './r3-journey-observation';
type Prepared={name:string;input:ValidatedBootstrap};
type Source=Prepared&{stub:DurableObjectStub<import('../../src/workspace/workspace-do').WorkspaceDO>};
const invalid=():never=>{throw Error('J1_PRECOMMAND_CAPTURE_INVALID');};
const MAX_CONFIG_BYTES=1048576;
const utf8=new TextEncoder();
function prepared(value:Prepared){
 const input=value.input,configText=canonicalJson(input.config);if(utf8.encode(configText).byteLength>MAX_CONFIG_BYTES)invalid();
 const config=JSON.parse(configText) as ValidatedBootstrap['config'];
 const mapping=config.workspace_catalog.filter(x=>x.workspace_id===input.workspaceId);
 if(mapping.length!==1||mapping[0].object_name!==value.name)invalid();
 return {name:value.name,workspaceId:input.workspaceId,epoch:config.config_epoch,configText,configDigest:input.bundle.config_digest,installationDigest:input.installationDigest,config};
}
function policy(config:ValidatedBootstrap['config'],workspaceId:string){
 const matches=config.workspace_policies.filter(x=>x.workspace_id===workspaceId);if(matches.length!==1||!matches[0].decision_policy)invalid();return matches[0].decision_policy!;
}
/** Snapshots all prepared primitives before first await; raw config never leaves source callback. */
export async function captureJ1PrecommandContext(caseId:R3JourneyCase,source:Source,target?:Prepared):Promise<J1PrecommandPacket>{
 const expected=prepared(source),targetExpected=target?prepared(target):null,stub=source.stub;
 const action={action_id:descriptor.actionId,schema_version:descriptor.schemaVersion,schema_sha256:descriptor.schemaSha256,semantic_revision:descriptor.semanticRevision};
 const targetPolicyText=targetExpected?canonicalJson(policy(targetExpected.config,targetExpected.workspaceId)):null;
 if(await sha256(expected.configText)!==expected.configDigest||targetExpected&&await sha256(targetExpected.configText)!==targetExpected.configDigest)invalid();
 const targetProjection=targetExpected?{workspace_id:targetExpected.workspaceId,object_name:targetExpected.name,config_epoch:targetExpected.epoch,config_sha256:targetExpected.configDigest,installation_sha256:targetExpected.installationDigest,decision_policy_sha256:await sha256(targetPolicyText!),preparation:'prepared-not-installed' as const}:null;
 const context=await runInDurableObject(stub,async(_o,state)=>{
  const sql=state.storage.sql;
  const bound=sql.exec<{bytes:number}>('SELECT length(cast(config_json AS BLOB)) AS bytes FROM workspace_metadata WHERE id=1').one();
  if(!Number.isSafeInteger(bound.bytes)||bound.bytes<1||bound.bytes>MAX_CONFIG_BYTES)invalid();
  const m=sql.exec<{workspace_id:string;object_name:string;config_epoch:number;config_digest:string;installation_digest:string;admission_state:string;config_json:string}>('SELECT workspace_id,object_name,config_epoch,config_digest,installation_digest,admission_state,config_json FROM workspace_metadata WHERE id=1').one();
  const maintenance=sql.exec<{state:string;authority_epoch:number}>('SELECT state,authority_epoch FROM maintenance_state WHERE id=1').one();
  if(m.workspace_id!==expected.workspaceId||m.object_name!==expected.name||m.config_epoch!==expected.epoch||m.config_digest!==expected.configDigest||m.installation_digest!==expected.installationDigest||m.config_json!==expected.configText||m.admission_state!=='installed'||maintenance.state!=='open'||maintenance.authority_epoch!==m.config_epoch)invalid();
  const empty_domain_counts=Object.fromEntries(J1_PRECOMMAND_TABLES.map(t=>{const n=sql.exec<{n:number}>('SELECT count(*) AS n FROM (SELECT 1 FROM "'+t+'" LIMIT 1)').one().n;if(n!==0)invalid();return [t,0];}));
  const config=JSON.parse(m.config_json) as ValidatedBootstrap['config'],selected=policy(config,m.workspace_id),policyText=canonicalJson(selected),rules=selected.actions.filter(x=>x.action_id===action.action_id&&x.schema_version===action.schema_version&&x.schema_sha256===action.schema_sha256);
  if(rules.length!==1)invalid();const reviewerIds=[...rules[0].reviewer_ids].sort();
  if(config.static_participants.filter(x=>x.workspace_id===m.workspace_id&&x.agent_id==='agent_research').length!==1||sql.exec<{n:number}>('SELECT count(*) AS n FROM static_agents WHERE workspace_id=? AND agent_id=? AND config_epoch=?',m.workspace_id,'agent_research',m.config_epoch).one().n!==1)invalid();
  for(const principal of reviewerIds){if(config.human_grants.filter(x=>x.workspace_id===m.workspace_id&&x.principal_id===principal&&x.enabled).length!==1||sql.exec<{n:number}>('SELECT count(*) AS n FROM human_grants WHERE workspace_id=? AND principal_id=? AND enabled=1 AND config_epoch=?',m.workspace_id,principal,m.config_epoch).one().n!==1)invalid();}
  const human=j1PlannedHuman(caseId);if(human&&!reviewerIds.includes('human_operator'))invalid();
  // All SQL/config projection is complete before hashing awaits. No raw fields are returned.
  return {format_version:1,stage:'pre-command-source-fixture-context',origin:'local-workers-synthetic-fixture',acceptance_eligible:false,provenance_authenticated:false,case_id:caseId,chronology:'before-domain-setup',source:{workspace_id:m.workspace_id,object_name:m.object_name,config_epoch:m.config_epoch,config_sha256:m.config_digest,installation_sha256:m.installation_digest,admission_state:'installed',maintenance_state:'open'},target:targetProjection,descriptor:action,policy:{version:selected.policy_version,sha256:await sha256(policyText),configured_reviewer_ids:reviewerIds},configured_principals:{requester:{kind:'agent',principal_id:'agent_research'},planned_human:human?{kind:'human',principal_id:'human_operator'}:null},empty_domain_counts};
 });
 return encodeJ1PrecommandContext(context);
}
