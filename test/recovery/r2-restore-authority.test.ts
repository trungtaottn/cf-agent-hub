import {describe,it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {artifactFixture,claimSetup} from '../helpers/artifacts';
import {prepareBootstrap,canonicalJson,sha256,restoreAuthorityOverlay} from '../../src/config/bootstrap';
import {prepareRestoreAuthority,transformRestoredAuthorityRow,restoreAuthorityAdditions,assertRestoreAddition,type RestoreAuthorityTable,type AuthorityRow} from '../../src/config/restore-authority';
import {withTransaction} from '../../src/storage/transaction';
const tables:RestoreAuthorityTable[]=['human_grants','static_agents','native_credentials','runtimes'];
const pk={human_grants:'principal_id',static_agents:'agent_id',native_credentials:'credential_id',runtimes:'id'};
describe('bounded restore overlay retains canonical bootstrap semantics',()=>{
 it('matches existing overlay per row including static retirement, dynamic revocation, additions and archive preservation',async()=>{
  const f=await artifactFixture('restore_authority_shared');
  await runInDurableObject(f.stub,(_instance,state)=>withTransaction(state.storage,tx=>{
   claimSetup(state.storage);
   for(const [id,status] of [['agent_dynamic','active'],['agent_archived','archived']])tx.exec("INSERT INTO static_agents (agent_id,workspace_id,display_name,config_epoch,origin,status) VALUES (?,'ws_example','Synthetic',1,'human_managed',?)",[id,status]);
   tx.exec("INSERT INTO native_credentials (credential_id,workspace_id,agent_id,token_sha256,scopes_json,project_ids_json,expires_at,enabled,config_epoch,origin) VALUES ('credential_dynamic','ws_example','agent_dynamic',?,'[]','null',?,1,1,'human_managed')",['d'.repeat(64),Date.now()+86400000]);
  }));
  const config=structuredClone(f.input.config),bundle=structuredClone(f.input.bundle),now=Date.now();config.config_epoch=2;bundle.config_epoch=2;
  config.static_participants[0].display_name='Updated synthetic name';
  const removed=config.static_credential_refs.find(r=>r.credential_id==='credential_research_2')!;
  const hash=bundle.credentials.find(r=>r.credential_id===removed.credential_id)!;
  config.static_credential_refs=config.static_credential_refs.filter(r=>r.credential_id!==removed.credential_id);bundle.credentials=bundle.credentials.filter(r=>r.credential_id!==removed.credential_id);
  bundle.retired_credentials.push({...hash,agent_id:removed.agent_id,retired_at_epoch:2});
  config.static_participants.push({workspace_id:'ws_example',agent_id:'agent_new',display_name:'New synthetic'});
  config.static_credential_refs.push({...config.static_credential_refs[0],agent_id:'agent_new',credential_id:'credential_new',expires_at:new Date(now+86400000).toISOString()});
  bundle.credentials.push({workspace_id:'ws_example',credential_id:'credential_new',token_sha256:'e'.repeat(64)});
  config.static_credential_refs[0].enabled=false;
  bundle.config_digest=await sha256(canonicalJson(config));const input=await prepareBootstrap(config,bundle,'ws_example'),p=prepareRestoreAuthority(input,now);
  await runInDurableObject(f.stub,(_instance,state)=>withTransaction(state.storage,tx=>{
   const expected=new Map<RestoreAuthorityTable,AuthorityRow[]>();
   for(const table of tables){const source=tx.all<AuthorityRow>('SELECT * FROM '+table),rows=source.map(row=>transformRestoredAuthorityRow(p,table,row));const ids=new Set(source.map(row=>row[pk[table]]));for(const row of restoreAuthorityAdditions(p,table,0).rows)if(!ids.has(row[pk[table]])){assertRestoreAddition(p,table,row);rows.push(row);}expected.set(table,rows);}
   tx.exec("UPDATE workspace_metadata SET config_epoch=2,installation_digest=?,admission_state='maintenance' WHERE id=1",[input.installationDigest]);
   restoreAuthorityOverlay(tx,input,now);
   for(const table of tables){const sort=(rows:readonly AuthorityRow[])=>[...rows].sort((a,b)=>String(a[pk[table]]).localeCompare(String(b[pk[table]])));expect(sort(tx.all<AuthorityRow>('SELECT * FROM '+table))).toEqual(sort(expected.get(table)!));}
  }));
 });
});
