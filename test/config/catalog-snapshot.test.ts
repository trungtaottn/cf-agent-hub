import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {catalogFixture,catalogProfile} from '../helpers/catalog';
import {taskContext} from '../helpers/tasks';
import {withTransaction} from '../../src/storage/transaction';
import {storedProfile,applyProfile} from '../../src/config/profile';
import {createAgent} from '../../src/agents/commands';
import {previewCatalogChange,applyCatalogChange} from '../../src/config/catalog-commands';
it('version_snapshot_does_not_duplicate_all_role_metadata_for_each_affected_agent',async()=>{
 const {stub}=await catalogFixture('catalog-compact-snapshot');await runInDurableObject(stub,(_o,state)=>{
  const s=state.storage;catalogProfile(s);const ctx=taskContext(s),roles=Array.from({length:64},(_,i)=>'r'+String(i).padStart(3,'0')+'x'.repeat(124));
  const current=withTransaction(s,tx=>storedProfile(tx,ctx.actor));withTransaction(s,tx=>applyProfile(tx,ctx,{expected_profile_revision:1,profile:{...current.profile,work_roles:[...current.profile.work_roles,...roles.map((id,i)=>({id,display_name:'Role '+i,description:'',archived:false}))]}}));
  for(let i=0;i<10;i++)withTransaction(s,tx=>createAgent(tx,{...ctx,agentId:'large_'+i},{display_name:'Large '+i,description:'',work_role_ids:['role_a',...roles]}));
  const plan=withTransaction(s,tx=>previewCatalogChange(tx,{...ctx,planId:'compact_plan'},{expected_profile_revision:2,kind:'work_role',id:'role_a',operation:'remap',replacement_id:'role_b',reason:'Reviewed'}));expect(plan.affected_agent_ids).toHaveLength(10);
  const snapshot=s.sql.exec<{touched_versions_json:string}>('SELECT touched_versions_json FROM catalog_plans').one().touched_versions_json;expect(new TextEncoder().encode(snapshot).byteLength).toBeLessThan(8192);
  withTransaction(s,tx=>applyCatalogChange(tx,ctx,{preview_id:plan.id,expected_profile_revision:2}));for(const row of s.sql.exec<{work_role_ids_json:string;agent_version:number}>("SELECT work_role_ids_json,agent_version FROM static_agents WHERE agent_id LIKE 'large_%'").toArray()){expect(JSON.parse(row.work_role_ids_json)).toEqual(['role_b',...roles]);expect(row.agent_version).toBe(2);}
 });
});
