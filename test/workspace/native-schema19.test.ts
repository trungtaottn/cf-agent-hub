import {it,expect} from 'vitest';
import * as selected from '../../workers/native-fixture/selected-state';
const labels=['preferences','outbox','catalog_plans','import_plans','decision_checkpoints','decision_proposals','approvals','decision_artifact_edges','decision_lifecycle_heads','decision_lifecycle_transitions','decision_notice_intents'];
it('schema19 exports a closed decoder separate from historical18',()=>{
 expect(typeof selected.decodeSchema19CompleteRows).toBe('function');
});
it('schema19 requires exact19 sequence and exact eleven zero labels',()=>{
 const decode=selected.decodeSchema19CompleteRows;
 const rows=labels.map(table_name=>({table_name,present:0}));
 expect(decode('Z',rows).byteSize).toBe(520);
 expect(decode('S',Array.from({length:19},(_,i)=>({version:i+1,__valid:1}))).rows).toHaveLength(19);
 for(const n of [18,20])expect(()=>decode('S',Array.from({length:n},(_,i)=>({version:i+1,__valid:1})))).toThrow();
 for(const value of [1,null,'0',false,0.5])for(let i=0;i<11;i++){const changed:unknown[]=structuredClone(rows);changed[i]={...rows[i],present:value};expect(()=>decode('Z',changed)).toThrow();}
 for(const rows2 of [rows.slice(1),[...rows,rows[0]],[rows[0],...rows.slice(0,10)],[...rows].reverse()])expect(()=>decode('Z',rows2)).toThrow();
 expect(()=>selected.decodeSchema18CompleteRows('Z',rows)).toThrow();
 expect(()=>selected.decodeSchema18CompleteRows('S',Array.from({length:19},(_,i)=>({version:i+1,__valid:1})))).toThrow();
 expect(selected.decodeSchema18CompleteRows('Z',rows.slice(0,4)).byteSize).toBe(163);
});
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {fixture,operator} from '../helpers/environment';
import {prepareBootstrap} from '../../src/config/bootstrap';
import catalog from '../../workers/native-fixture/complete-selectors-schema19.json';
it('actual current19 SQLite has every empty decision table in its bounded Z witness',async()=>{
 const name='schema19_zero_tables',f=await fixture(name),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),await prepareBootstrap(f.config,f.bundle,'ws_example'));
 await runInDurableObject(stub,(_instance,state)=>{
  const z=catalog.catalog.Z,rows=state.storage.sql.exec(z.sql,...z.parameters.map(()=> 'ws_example')).toArray();
  expect(rows).toEqual(labels.map(table_name=>({table_name,present:0})));
  expect(selected.decodeSchema19CompleteRows('Z',rows).byteSize).toBe(520);
 });
});
