import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

// Import inside tests so a missing verifier produces collected red assertions.
const verifier=async()=>{
 // @ts-expect-error Standalone Node contract tooling has no product TypeScript dependency.
 return await import('../../scripts/verify-r2-catalog-contract.mjs');
};
const plan=()=>JSON.parse(readFileSync(new URL('../../examples/http/r2-catalog-contracts.json',import.meta.url),'utf8')).fixtures.find((entry:any)=>entry.schema==='#/components/schemas/CatalogPlanResponse').value.data;
const issuedAtMs=Date.parse('2026-10-26T15:00:00Z');
const context=()=>({issuedAtMs,nowMs:issuedAtMs});
const issues=async(value:unknown=plan(),time:unknown=context())=>(await verifier()).catalogPlanIssues(value,time);

describe('static catalog plan semantics; hypothetical clock is not production authority',()=>{
 it('accepts the canonical example with explicit hypothetical issuance and observation times',async()=>expect(await issues()).toEqual([]));
 for(const [tasks,agents,accepted]of [[200,0,true],[0,200,true],[100,100,true],[100,101,false],[201,0,false]] as const)
  it(`combined affected count ${tasks}+${agents}`,async()=>{
   const value={...plan(),affected_task_ids:Array.from({length:tasks},(_,i)=>'task_'+i),affected_agent_ids:Array.from({length:agents},(_,i)=>'agent_'+i)};
   expect((await issues(value)).length===0).toBe(accepted);
   if(tasks===100&&agents===101)expect(await issues(value)).toContain('affected_entities_limit');
  });
 for(const key of ['affected_task_ids','affected_agent_ids'])it(`rejects duplicate ${key}`,async()=>expect(await issues({...plan(),[key]:['id_a','id_a']})).toContain('invalid_shape'));
 for(const [name,patch]of Object.entries({unknown:{surprise:true},wrong_revision:{profile_revision:0},bad_date:{expires_at:'not-a-time'},open_record:{changes:[{kind:'project',id:'project_a',operation:'archive',before:null,after:{id:'project_a',display_name:'A',description:'',archived:true,version:2}}]}}))
  it(`validates canonical closed schema: ${name}`,async()=>expect(await issues({...plan(),...patch})).toContain('invalid_shape'));
 it('rejects a missing required field',async()=>{const value=plan();delete value.profile_revision;expect(await issues(value)).toContain('invalid_shape');});
 for(const value of [null,[],{},'plan'])it(`rejects non-plan ${JSON.stringify(value)}`,async()=>expect(await issues(value)).toContain('invalid_shape'));
 for(const offset of [-1,1])it(`rejects expiry duration offset ${offset}ms`,async()=>expect(await issues({...plan(),expires_at:new Date(issuedAtMs+900000+offset).toISOString()})).toContain('expiry_duration'));
 it('accepts immediately before expiry',async()=>expect(await issues(plan(),{issuedAtMs,nowMs:issuedAtMs+899999})).toEqual([]));
 for(const offset of [900000,900001])it(`rejects expiry at observation +${offset}ms`,async()=>expect(await issues(plan(),{issuedAtMs,nowMs:issuedAtMs+offset})).toContain('expired'));
 it('rejects observation before issuance',async()=>expect(await issues(plan(),{issuedAtMs,nowMs:issuedAtMs-1})).toContain('time_order'));
 for(const field of ['issuedAtMs','nowMs'])for(const value of [undefined,null,'2026-10-26T15:00:00Z',NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER])
  it(`fails closed on invalid ${field} ${String(value)}`,async()=>expect(await issues(plan(),{...context(),[field]:value})).toContain('invalid_time_context'));
 it('fails closed on omitted context',async()=>expect((await verifier()).catalogPlanIssues(plan())).toContain('invalid_time_context'));
 for(const value of [null,[],{}, {...context(),trusted:true}])it(`rejects unknown context ${JSON.stringify(value)}`,async()=>expect(await issues(plan(),value)).toContain('invalid_time_context'));
 it('does not silently truncate sub-millisecond expiry',async()=>expect(await issues({...plan(),expires_at:'2026-10-26T15:15:00.0001Z'})).toContain('expiry_duration'));
 it('does not mutate the plan or time context',async()=>{const value=plan(),time=context(),before=structuredClone({value,time});await issues(value,time);expect({value,time}).toEqual(before);});
 it('runs the standalone fixture check as static evidence only',async()=>expect((await verifier()).run()).toEqual({scope:'static-catalog-contract',plans:1,clock:'explicit-hypothetical-fixture-times'}));
});
