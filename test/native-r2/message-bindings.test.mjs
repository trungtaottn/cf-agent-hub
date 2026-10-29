import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeBindingRegistry} from '../../scripts/lib/native-r2-bindings.mjs';
import {advance,references,carrier,replaceData} from './bindings-fixtures.mjs';
const create=()=>createNativeBindingRegistry({workspaceId:'workspace-a',submitter:{principalId:'agent-a',agentId:'agent-a'},reviewer:{principalId:'agent-b',agentId:'agent-b'}});
test('message lineage reaches reviewer ACK and same thread without body custody claim',()=>{const r=create(),out=advance(r);assert.equal(out.bindings.message.id,'message-main');assert.equal(out.bindings.messageAcknowledged,true);assert.equal(out.messageThreadBindings,'source-consistent-output-lineage');assert.equal(out.requestBodyCustody,'pending');assert.equal(out.issue48Complete,false);});
const cases={
 'create foreign workspace':['success/createMessage',v=>v.data.workspace_id='workspace-b'],
 'create wrong sender':['success/createMessage',v=>v.data.sender={kind:'agent',principal_id:'agent-b',agent_id:'agent-b'}],
 'create wrong recipient':['success/createMessage',v=>v.data.recipient_agent_ids=['agent-a']],
 'create wrong task':['success/createMessage',v=>v.data.refs[0].id='other-task'],
 'create preack':['success/createMessage',v=>v.data.acknowledged_at='2026-10-29T00:01:00.000Z'],
 'inbox changed body':['success/getInbox',v=>v.data[0].body='substituted'],
 'inbox wrong thread':['success/getInbox',v=>v.data[0].thread_id='other-thread'],
 'inbox absent even paginated':['success/getInbox',v=>{v.data=[];v.page={has_more:true,next_cursor:'cursor'};}],
 'inbox duplicate':['success/getInbox',v=>v.data.push({...v.data[0]})],
 'ACK foreign message':['success/ackMessages',v=>v.data.acknowledged_ids=['other-message']],
 'ACK already done':['success/ackMessages',v=>{v.data.already_acknowledged_ids=v.data.acknowledged_ids;v.data.acknowledged_ids=[];}],
 'ACK duplicate':['success/ackMessages',v=>v.data.acknowledged_ids.push(v.data.acknowledged_ids[0])],
 'thread missing ACK':['success/getThread',v=>v.data[0].acknowledged_at=null],
 'thread changed creation':['success/getThread',v=>v.data[0].created_at='2026-10-28T00:00:00.000Z'],
 'thread foreign member':['success/getThread',v=>v.data.push({...v.data[0],id:'other-message',thread_id:'other-thread'})],
 'thread absent even paginated':['success/getThread',v=>{v.data=[];v.page={has_more:true,next_cursor:'cursor'};}]
};
for(const [name,[id,change]]of Object.entries(cases))test('message output rejects '+name,()=>{const r=create(),p=advance(r,id),t=r.prepare(id,references(p.step,p.state));assert.throws(()=>r.completeProcess(t,replaceData(carrier(p.step,p.state,p.index),change)));assert.equal(r.readSummary().completedSteps,p.index);assert.equal(r.readSummary().status,'incomplete');});
test('foreign thread path rejects before process dispatch',()=>{const r=create(),p=advance(r,'success/getThread'),refs=references(p.step,p.state);refs.thread_id='other-thread';assert.throws(()=>r.prepare(p.step.id,refs));assert.equal(r.readSummary().completedSteps,p.index);});
for(const [name,id,change] of [
 ['unrelated acknowledged inbox row','success/getInbox',v=>v.data.push({...v.data[0],id:'other-message',acknowledged_at:'2026-10-29T00:01:00.000Z'})],
 ['foreign-recipient inbox row','success/getInbox',v=>v.data.push({...v.data[0],id:'other-message',recipient_agent_ids:['agent-a']})],
 ['foreign-workspace thread row','success/getThread',v=>v.data.push({...v.data[0],id:'other-message',workspace_id:'workspace-b'})],
 ['duplicate thread row','success/getThread',v=>v.data.push({...v.data[0]})],
 ['malformed envelope','success/createMessage',v=>delete v.request_id]
])test('message boundary rejects '+name,()=>{const r=create(),p=advance(r,id),t=r.prepare(id,references(p.step,p.state));assert.throws(()=>r.completeProcess(t,replaceData(carrier(p.step,p.state,p.index),change)));});
test('valid target-containing continuation and participant thread history are allowed',()=>{const r=create(),out=advance(r,null,(step,c)=>{if(['success/getInbox','success/getThread'].includes(step.id)){const changed=replaceData(c,v=>{v.page={has_more:true,next_cursor:'continuation'};v.data.push({...v.data[0],id:'other-message',recipient_agent_ids:step.operation==='getThread'?['agent-a']:['agent-b'],acknowledged_at:null});});Object.assign(c,changed);}});assert.equal(out.messageThreadBindings,'source-consistent-output-lineage');assert.equal(out.completedSteps,68);});
