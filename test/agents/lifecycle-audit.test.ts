import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {settingsFixture,human} from '../helpers/settings';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {appendEvent,projectEvent,resourceEventVisibility} from '../../src/audit/events';
import type {EventDraft} from '../../src/workspace/commands';
it('lifecycle_audit_is_closed_sanitized_and_currently_visible',async()=>{
 const {stub}=await settingsFixture('identity-audit');
 await runInDurableObject(stub,(_o,state)=>{
  const identity=human(state.storage);
  state.storage.sql.exec(`UPDATE human_grants SET scopes_json='["events:read","agents:read","credentials:manage"]'`);
  withTransaction(state.storage,tx=>{
   const actor=resolveActor(tx,identity,Date.now());
   for(const type of ['agent.created','agent.updated','agent.archived'] as const){
    appendEvent(tx,{id:type,type,resourceType:'agent',resourceId:'agent_research',resourceVersion:null,threadId:null,workspaceId:actor.workspaceId,actor,requestId:'audit_test',nowMs:Date.now()});
    const result=projectEvent(tx,actor,type,Date.now(),resourceEventVisibility);
    expect(result).toMatchObject({type,resource_type:'agent',resource_id:'agent_research'});
    expect(result?.summary).not.toContain('Research participant');
   }
   expect(()=>appendEvent(tx,{id:'wrong',type:'agent.created',resourceType:'credential',resourceId:'credential_research_1',resourceVersion:null,threadId:null,workspaceId:actor.workspaceId,actor,requestId:'audit_test',nowMs:Date.now()})).toThrow();
   expect(()=>appendEvent(tx,{id:'unknown',type:'agent.hacked' as EventDraft['type'],resourceType:'agent',resourceId:'agent_research',resourceVersion:null,threadId:null,workspaceId:actor.workspaceId,actor,requestId:'audit_test',nowMs:Date.now()})).toThrow();
   tx.exec(`UPDATE human_grants SET scopes_json='["events:read"]'`);
   expect(projectEvent(tx,actor,'agent.created',Date.now(),resourceEventVisibility)).toBeNull();
  });
 });
});
