import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {prepareBootstrap,sha256,canonicalJson} from '../../src/config/bootstrap';
import {createCompleteSelectedState,decodeCompleteRows,completePhaseReservation} from '../../workers/native-fixture/selected-state';
const bindings={W:'ws_example',C:'cred_research',human:'human_owner',principal:'agent_research',operation:'domain.createTask',target:'ws_example',key:'r2_'+ '1'.repeat(32)};
async function workspace(name:string){
 const {config,bundle}=await fixture(name);
 // HG now observes every workspace grant; install the admitted narrow fixture
 // through normal configuration rather than hiding the broad example grant.
 config.human_grants[0].scopes=['credentials:manage','workspace:read'];
 bundle.config_digest=await sha256(canonicalJson(config));
 const stub=env.WORKSPACE.getByName(name);await stub.reconcileConfiguration(operator(),await prepareBootstrap(config,bundle,'ws_example'));return stub;
}
it('captures actual source SQLite phase within its atomic reservation, without authority claims',async()=>{
 const stub=await workspace('complete-selected-source');
 await runInDurableObject(stub,(_instance,state)=>{
  const reader=createCompleteSelectedState(state.storage,bindings);
  const result=reader.readPhase({stepId:'success/getWorkspace',phase:'before'});
  expect(result.scope).toBe('private-selected-state');expect(result.installedAuthority).toBe(false);
  expect(result.originals.find(x=>x.selector==='S')?.canonical).toBe(JSON.stringify(Array.from({length:16},(_,i)=>({version:i+1}))));
  expect(result.originals.find(x=>x.selector==='M')?.canonical).toContain('ws_example');
  const budget=completePhaseReservation('success/getWorkspace','before');
  expect(reader.snapshot().reserved).toEqual(budget);expect(reader.snapshot().actualQueries).toBe(result.originals.length);
  expect(()=>reader.readPhase({stepId:'success/getWorkspace',phase:'before'})).toThrow('COMPLETE_SELECTED_STATE_REJECTED');
  expect(reader.snapshot().failed).toBe(true);
 });
});
it('rejects a one-below full phase budget atomically before actual SQL',async()=>{
 const stub=await workspace('complete-selected-budget');
 await runInDurableObject(stub,(_instance,state)=>{
  const limits=completePhaseReservation('success/getWorkspace','before');limits.queries--;
  const reader=createCompleteSelectedState(state.storage,bindings,limits);
  expect(()=>reader.readPhase({stepId:'success/getWorkspace',phase:'before'})).toThrow();
  expect(reader.snapshot().actualQueries).toBe(0);expect(reader.snapshot().reserved.queries).toBe(0);
 });
});
it('retained local artifact and unknown phases cannot invent server observations',async()=>{
 const stub=await workspace('complete-selected-local');
 await runInDurableObject(stub,(_instance,state)=>{
  for(const stepId of ['prepare/retain-artifact','arbitrary/sql','control/prepare-swap-slot']){
   const reader=createCompleteSelectedState(state.storage,bindings);
   expect(()=>reader.readPhase({stepId,phase:'before'})).toThrow();expect(reader.snapshot().actualQueries).toBe(0);
  }
 });
});
it('rejects invalid SQL guard, overflow, extra fields and accessors without executing getters',()=>{
 expect(()=>decodeCompleteRows('S',[{__valid:0,version:null}])).toThrow();
 expect(()=>decodeCompleteRows('S',Array.from({length:17},(_,i)=>({__valid:1,version:i+1})))).toThrow();
 expect(()=>decodeCompleteRows('S',[{__valid:1,version:1,extra:1}])).toThrow();
 let calls=0;const row={__valid:1,get version(){calls++;return 1;}};
 expect(()=>decodeCompleteRows('S',[row])).toThrow();expect(calls).toBe(0);
});
it('enforces actual canonical fixture cap rather than generic sixteen KiB',()=>{
 expect(decodeCompleteRows('P',[]).canonical).toBe('[]');
 expect(()=>decodeCompleteRows('P',[{__valid:1,workspace_id:'ws_example',version:1,document_json:'{}',updated_at:1,updated_by:'a'}])).toThrow();
});
it('runs the complete literal inventory and keyed effect selectors against real SQLite',async()=>{
 const stub=await workspace('complete-selected-inventory');
 await runInDurableObject(stub,(_instance,state)=>{
  const reader=createCompleteSelectedState(state.storage,bindings);
  const baseline=reader.readPhase({stepId:'control/provision',phase:'primary'});
  const keyed=reader.readPhase({stepId:'success/createTask',phase:'before'});
  const selectors=new Set([...baseline.originals,...keyed.originals].map(x=>x.selector));
  expect(selectors.size).toBe(34);
  expect(baseline.originals.find(x=>x.selector==='IW')?.canonical).toBe('[]');
  expect(keyed.originals.find(x=>x.selector==='I')?.canonical).toBe('[]');
  expect(reader.snapshot().installedAuthority).toBe(false);
 });
});
it('actual SQLite lookahead overflow poisons the reader and keeps its reservation spent',async()=>{
 const stub=await workspace('complete-selected-overflow');
 await runInDurableObject(stub,(_instance,state)=>{
  state.storage.sql.exec('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)',17,1);
  const reader=createCompleteSelectedState(state.storage,bindings);
  expect(()=>reader.readPhase({stepId:'success/getWorkspace',phase:'before'})).toThrow();
  expect(reader.snapshot().reserved).toEqual(completePhaseReservation('success/getWorkspace','before'));
  expect(reader.snapshot().actualQueries).toBe(1);
  expect(()=>reader.readPhase({stepId:'success/getWorkspace',phase:'after'})).toThrow();
 });
});
it('accepts exact canonical fixture bound and rejects exactly one byte over',()=>{
 const row=(version:number)=>({__valid:1,version});
 const exact=[...Array.from({length:13},()=>row(Number.MAX_SAFE_INTEGER)),row(1),row(1),row(10000)];
 expect(decodeCompleteRows('S',exact).byteSize).toBe(424);
 expect(()=>decodeCompleteRows('S',[...exact.slice(0,-1),row(100000)])).toThrow();
});
it('rejects sparse/custom arrays and invalid primitive types',()=>{
 const sparse=new Array(1);expect(()=>decodeCompleteRows('S',sparse)).toThrow();
 const custom=[{__valid:1,version:1}];Object.setPrototypeOf(custom,{});expect(()=>decodeCompleteRows('S',custom)).toThrow();
 for(const version of [NaN,Infinity,-0,1.5,'1',null])expect(()=>decodeCompleteRows('S',[{__valid:1,version}])).toThrow();
 expect(()=>decodeCompleteRows('not-a-selector',[])).toThrow();
});
it('close and malformed prepared bindings cannot issue SQL',async()=>{
 const stub=await workspace('complete-selected-close');
 await runInDurableObject(stub,(_instance,state)=>{
  const reader=createCompleteSelectedState(state.storage,bindings);reader.close();
  expect(()=>reader.readPhase({stepId:'success/getWorkspace',phase:'before'})).toThrow();expect(reader.snapshot().actualQueries).toBe(0);
  expect(()=>createCompleteSelectedState(state.storage,{...bindings,sql:'SELECT 1'})).toThrow();
  expect(()=>createCompleteSelectedState(state.storage,{...bindings,key:'arbitrary'})).toThrow();
  let getters=0;expect(()=>createCompleteSelectedState(state.storage,{...bindings,get W(){getters++;return 'ws_example';}})).toThrow();expect(getters).toBe(0);
 });
});
it('discovers every selected idempotency tuple independently and executes its literal I lookup',async()=>{
 const stub=await workspace('complete-selected-index');
 await runInDurableObject(stub,(_instance,state)=>{
  for(let i=0;i<28;i++)state.storage.sql.exec('INSERT INTO idempotency_outcomes(workspace_id,principal_id,operation,target,key,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',bindings.W,bindings.principal,bindings.operation,bindings.target,'r2_'+i.toString(16).padStart(32,'0'),'f'.repeat(64),201,'{}','req_'+i,null,1,86400001);
  const reader=createCompleteSelectedState(state.storage,bindings),result=reader.readPhase({stepId:'control/provision',phase:'primary'});
  expect(result.originals.filter(x=>x.selector==='I')).toHaveLength(28);
  expect(reader.snapshot().actualQueries).toBe(completePhaseReservation('control/provision','primary').queries);
  expect(result.originals.filter(x=>x.selector==='I').every(x=>JSON.parse(x.canonical).length===1)).toBe(true);
 });
});
it('source-fake reentry poisons before later SQL and cannot clear the owning active flag',async()=>{
 const stub=await workspace('complete-selected-reentry');
 await runInDurableObject(stub,(_instance,state)=>{
  let reader:ReturnType<typeof createCompleteSelectedState>,calls=0,activeAfterNested=false;
  // Explicit source-fake callback wrapper, not a claim that SQLite reenters itself.
  const owned={sql:{exec:(sql:string,...args:SqlStorageValue[])=>{calls++;return state.storage.sql.exec(sql,...args);}},transactionSync:(callback:()=>unknown)=>state.storage.transactionSync(()=>{
   try{reader.readPhase({stepId:'success/getWorkspace',phase:'after'});}catch{/* owner observes poison */}
   activeAfterNested=reader.snapshot().active;return callback();
  })} as unknown as DurableObjectStorage;
  reader=createCompleteSelectedState(owned,bindings);
  expect(()=>reader.readPhase({stepId:'success/getWorkspace',phase:'before'})).toThrow();
  expect(activeAfterNested).toBe(true);expect(calls).toBe(0);expect(reader.snapshot().failed).toBe(true);
 });
});
it('source-fake swallowed poison during cursor acquisition stops before the next actual SELECT',async()=>{
 const stub=await workspace('complete-selected-cursor-poison');
 await runInDurableObject(stub,(_instance,state)=>{
  let reader:ReturnType<typeof createCompleteSelectedState>,calls=0;
  const owned={sql:{exec:(sql:string,...args:SqlStorageValue[])=>{
   calls++;const cursor=state.storage.sql.exec(sql,...args);
   try{reader.readPhase({stepId:'success/getWorkspace',phase:'after'});}catch{/* source-fake */}
   return cursor;
  }},transactionSync:(callback:()=>unknown)=>state.storage.transactionSync(callback)} as unknown as DurableObjectStorage;
  reader=createCompleteSelectedState(owned,bindings);
  expect(()=>reader.readPhase({stepId:'success/getWorkspace',phase:'before'})).toThrow();
  expect(calls).toBe(1);expect(reader.snapshot().actualQueries).toBe(1);expect(reader.snapshot().failed).toBe(true);
 });
});
