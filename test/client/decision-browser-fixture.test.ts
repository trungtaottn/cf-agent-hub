import {describe,it,expect,vi} from 'vitest';
import {configureDecisionBrowserFixture,parseDecisionFixtureControl,decisionEffectTables,boundedFixtureBytes} from '../helpers/decision-browser-fixture';
import {readFileSync} from 'node:fs';
import {fixture} from '../helpers/environment';
describe('private decision fixture boundaries',()=>{
 it('has only fixed closed bounded control actions',async()=>{
  expect(await parseDecisionFixtureControl(new Request('https://hub.fixture.example.invalid/__ui_fixture/control',{method:'POST',headers:{origin:'https://hub.fixture.example.invalid'},body:'{"action":"read-state"}'}))).toBe('read-state');
  for(const body of ['{"action":"arbitrary"}','{"action":"reset","action":"read-state"}','{"action":"reset","registry":[]}',JSON.stringify({action:'x'.repeat(1024)})])await expect(parseDecisionFixtureControl(new Request('https://hub.fixture.example.invalid/__ui_fixture/control',{method:'POST',headers:{origin:'https://hub.fixture.example.invalid'},body}))).rejects.toThrow();
  await expect(parseDecisionFixtureControl(new Request('https://hub.fixture.example.invalid/__ui_fixture/control',{method:'POST',headers:{origin:'https://other.invalid'},body:'{"action":"reset"}'}))).rejects.toThrow();
 });
 it('accounts for every decision table and durable command effect owner',()=>{const migration=readFileSync('src/storage/migrations/0019-decisions.sql','utf8');for(const table of [...migration.matchAll(/CREATE TABLE (\w+)/g)].map(m=>m[1]))expect(decisionEffectTables).toContain(table);for(const table of ['tasks','runs','task_history','events','outbox','idempotency_outcomes'])expect(decisionEffectTables).toContain(table);expect(new Set(decisionEffectTables).size).toBe(decisionEffectTables.length);});
 it('adds only isolated fixed synthetic policy and reviewer distinctions',async()=>{const input=await fixture('private-decision-test'),before=JSON.stringify(input.config);configureDecisionBrowserFixture(input.config);expect(JSON.stringify(input.config)).not.toBe(before);expect(input.config.workspace_policies[0].decision_policy?.actions[0]?.action_id).toBe('synthetic.task-review');expect(input.config.workspace_policies[0].decision_policy?.actions[0]?.reviewer_ids).toEqual(['human_operator']);expect(input.config.human_grants.find(g=>g.principal_id==='human_readonly')?.scopes).not.toContain('approvals:decide');expect(input.config.human_grants.find(g=>g.principal_id==='human_unassigned')?.scopes).toContain('approvals:decide');expect(input.config.workspace_policies[0].notification_destinations).toEqual([]);});
});

import {DecisionBrowserProbe} from '../helpers/decision-browser-fixture';
it('drops only a real successful decision after committed verification and retains digest-only replay facts',async()=>{
 const probe=new DecisionBrowserProbe();probe.armDrop();let checked=0;
 const request=()=>new Request('https://hub.fixture.example.invalid/v2/workspaces/ws_example/approvals/approval_a:approve',{method:'POST',headers:{'idempotency-key':'fixed-key'},body:'{"reason":"private reason"}'});
 await expect(probe.observe(request(),Response.json({data:{accepted:true}}),async()=>{checked++;})).rejects.toThrow('FIXTURE_DROP_COMMITTED_RESPONSE');expect(checked).toBe(1);probe.resumeDecisions();
 expect((await probe.observe(request(),Response.json({data:{accepted:true}}),async()=>{})).status).toBe(200);
 expect(probe.receipts).toHaveLength(2);expect(probe.receipts[0]?.bodySha256).toBe(probe.receipts[1]?.bodySha256);expect(JSON.stringify(probe.receipts)).not.toContain('private reason');expect(JSON.stringify(probe.receipts)).not.toContain('fixed-key');probe.reset();expect(probe.receipts).toEqual([]);
});
it('never drops a refusal and bounded held content can be released by disposal',async()=>{const probe=new DecisionBrowserProbe();probe.armDrop();const r=new Request('https://hub.fixture.example.invalid/v2/workspaces/ws_example/approvals/a:reject',{method:'POST',body:'{}'});expect((await probe.observe(r,new Response(null,{status:403}),async()=>{throw Error('should not verify refusal');})).status).toBe(403);probe.armContent();let complete=false;const held=probe.observe(new Request('https://hub.fixture.example.invalid/v2/workspaces/ws_example/artifacts/a/content'),new Response('private'),async()=>{}).then(()=>{complete=true;});await Promise.resolve();expect(complete).toBe(false);probe.reset();await held;expect(complete).toBe(true);});

it('does not let old response evidence enter a reset fixture generation',async()=>{const probe=new DecisionBrowserProbe(),generation=probe.generation;probe.reset();probe.armDrop();const response=Response.json({data:{accepted:true}});expect(await probe.observe(new Request('https://hub.fixture.example.invalid/v2/workspaces/ws_example/approvals/a:approve',{method:'POST',body:'{}'}),response,async()=>{throw Error('old verify');},generation)).toBe(response);expect(probe.receipts).toEqual([]);});

it('cancels unfinished control bytes at the fixed deadline without publishing partial JSON',async()=>{vi.useFakeTimers();try{let cancelled=false;const promise=boundedFixtureBytes(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}}),1024);const rejection=expect(promise).rejects.toThrow('FIXTURE_BODY_TIMEOUT');await vi.advanceTimersByTimeAsync(5000);await rejection;expect(cancelled).toBe(true);}finally{vi.useRealTimers();}});
it('bounds held content and cancels its actual body on timeout',async()=>{vi.useFakeTimers();try{const probe=new DecisionBrowserProbe();probe.armContent();let cancelled=false;const response=new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true;}}));const promise=probe.observe(new Request('https://hub.fixture.example.invalid/v2/workspaces/ws_example/artifacts/a/content'),response,async()=>{});const rejection=expect(promise).rejects.toThrow('FIXTURE_CONTENT_HOLD_TIMEOUT');await vi.advanceTimersByTimeAsync(5000);await rejection;expect(cancelled).toBe(true);probe.reset();}finally{vi.useRealTimers();}});

it('holds a fixed intent outage until explicit resume and refuses drift before dispatch',async()=>{
 const probe=new DecisionBrowserProbe();probe.armDrop();const send=vi.fn(async()=>Response.json({data:{accepted:true}})),verify=vi.fn(async()=>{});
 const request=(key='fixed-key',body='{"reason":"private reason"}',id='approval_a')=>new Request('https://hub.fixture.example.invalid/v2/workspaces/ws_example/approvals/'+id+':approve',{method:'POST',headers:{'idempotency-key':key},body});
 for(let i=0;i<3;i++)await expect(probe.dispatch(request(),send,verify)).rejects.toThrow('FIXTURE_DROP_COMMITTED_RESPONSE');
 expect(send).toHaveBeenCalledTimes(3);expect(verify).toHaveBeenCalledTimes(3);expect(probe.receipts.every(r=>r.dropped&&r.status===200)).toBe(true);
 for(const changed of [request('other'),request('fixed-key','{}'),request('fixed-key','{"reason":"private reason"}','approval_b')])await expect(probe.dispatch(changed,send,verify)).rejects.toThrow('FIXTURE_INTENT_DRIFT');
 expect(send).toHaveBeenCalledTimes(3);expect(probe.receipts).toHaveLength(3);
 probe.resumeDecisions();expect((await probe.dispatch(request(),send,verify)).status).toBe(200);expect(send).toHaveBeenCalledTimes(4);expect(probe.receipts.map(r=>r.dropped)).toEqual([true,true,true,false]);
 expect(new Set(probe.receipts.map(r=>r.keySha256+':'+r.bodySha256)).size).toBe(1);expect(JSON.stringify(probe.receipts)).not.toContain('private reason');expect(JSON.stringify(probe.receipts)).not.toContain('fixed-key');
});
it('bounds decision outage dispatches and does not resume or dispatch stale generations',async()=>{
 const probe=new DecisionBrowserProbe(),request=()=>new Request('https://hub.fixture.example.invalid/v2/workspaces/ws_example/approvals/a:approve',{method:'POST',body:'{}'}),send=vi.fn(async()=>Response.json({data:{accepted:true}}));
 expect(()=>probe.resumeDecisions()).toThrow('FIXTURE_NO_COMPLETED_DROP');probe.armDrop();expect(()=>probe.resumeDecisions()).toThrow('FIXTURE_NO_COMPLETED_DROP');
 for(let i=0;i<32;i++)await expect(probe.dispatch(request(),send,async()=>{})).rejects.toThrow('FIXTURE_DROP_COMMITTED_RESPONSE');
 await expect(probe.dispatch(request(),send,async()=>{})).rejects.toThrow('FIXTURE_RECEIPT_LIMIT');expect(send).toHaveBeenCalledTimes(32);
 const old=probe.generation;probe.reset();await expect(probe.dispatch(request(),send,async()=>{},old)).rejects.toThrow('FIXTURE_GENERATION_CHANGED');expect(send).toHaveBeenCalledTimes(32);expect(probe.receipts).toEqual([]);
});
it('reserves one attempt and refuses resume across unfinished response verification',async()=>{
 const probe=new DecisionBrowserProbe();probe.armDrop();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),send=vi.fn(async()=>{await gate;return Response.json({ok:true});}),verify=vi.fn(async()=>{});
 const request=()=>new Request('https://hub.fixture.example.invalid/v2/workspaces/ws_example/approvals/a:approve',{method:'POST',body:'{}'});
 const first=probe.dispatch(request(),send,verify),failure=expect(first).rejects.toThrow('FIXTURE_DROP_COMMITTED_RESPONSE');
 await expect(probe.dispatch(request(),send,verify)).rejects.toThrow('FIXTURE_DECISION_IN_FLIGHT');expect(()=>probe.resumeDecisions()).toThrow('FIXTURE_NO_COMPLETED_DROP');release();await failure;
 expect(send).toHaveBeenCalledOnce();probe.resumeDecisions();expect((await probe.dispatch(request(),async()=>Response.json({ok:true}),verify)).status).toBe(200);
});
it('reset during bounded preflight or old verification cannot dispatch or publish completion in a new generation',async()=>{
 const probe=new DecisionBrowserProbe();probe.armDrop();let finish!:(value:Uint8Array)=>void;
 const body=new ReadableStream<Uint8Array>({start(c){finish=value=>{c.enqueue(value);c.close();};}});
 const request=new Request('https://hub.fixture.example.invalid/v2/workspaces/ws_example/approvals/a:approve',{method:'POST',body,...{duplex:'half'}});
 const send=vi.fn(async()=>Response.json({ok:true})),first=probe.dispatch(request,send,async()=>{}),failure=expect(first).rejects.toThrow('FIXTURE_GENERATION_CHANGED');probe.reset();finish(new TextEncoder().encode('{}'));await failure;expect(send).not.toHaveBeenCalled();expect(probe.receipts).toEqual([]);
 probe.armDrop();let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>{release=r;}),waiting=new Promise<void>(r=>{started=r;});
 const second=probe.dispatch(new Request(request.url,{method:'POST',body:'{}'}),send,async()=>{started();await gate;}),old=expect(second).rejects.toThrow('FIXTURE_GENERATION_CHANGED');await waiting;expect(()=>probe.resumeDecisions()).toThrow('FIXTURE_NO_COMPLETED_DROP');probe.reset();release();await old;expect(probe.receipts).toEqual([]);expect(()=>probe.resumeDecisions()).toThrow('FIXTURE_NO_COMPLETED_DROP');
});
