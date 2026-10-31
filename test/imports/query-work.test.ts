import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {importFixture,importBatch,importRow,applyBody} from './helpers';
import {importRoutes} from '../../src/http/import-routes';
import {owned} from '../helpers/settings';
function instrument(storage:DurableObjectStorage){
 const samples=new Map<string,{calls:number;rowsRead:number;rowsWritten:number;maxRowsRead:number;returned:number;plan:unknown[]}>();
 const sql=new Proxy(storage.sql,{get(target,key){if(key==='exec')return (query:string,...args:SqlStorageValue[])=>{const cursor=target.exec(query,...args),rows=cursor.toArray();let sample=samples.get(query);if(!sample){sample={calls:0,rowsRead:0,rowsWritten:0,maxRowsRead:0,returned:0,plan:target.exec('EXPLAIN QUERY PLAN '+query,...args).toArray()};samples.set(query,sample);}sample.calls++;sample.rowsRead+=cursor.rowsRead;sample.rowsWritten+=cursor.rowsWritten;sample.returned+=rows.length;sample.maxRowsRead=Math.max(sample.maxRowsRead,cursor.rowsRead);return new Proxy(cursor,{get(c,k){if(k==='toArray')return ()=>rows;const v=Reflect.get(c,k);return typeof v==='function'?v.bind(c):v;}});};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
 return {storage:new Proxy(storage,{get(target,key){if(key==='sql')return sql;const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}}),report:()=>Array.from(samples,([query,value])=>({query,...value}))};
}
it.each([0,10000])('actual production import lookup stays indexed with %i unrelated mappings',async history=>{
 const f=await importFixture('imports-work-'+history),batch=importBatch(Array.from({length:100},(_,i)=>importRow('requested_'+i))),created=await f.apply(await f.preview(batch));expect(created.counts.created).toBe(100);
 await runInDurableObject(f.a.stub,async(_o,{storage:s})=>{
  // Synthetic unrelated key history isolates index scaling; not a claim of10000 imported HTTP attempts.
  if(history)s.sql.exec("WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n+1<?) INSERT INTO import_mappings SELECT workspace_id,namespace,'noise_'||n,task_id,source_sha256,mapping_version,source_version,import_id,json_set(provenance_json,'$.external_id','noise_'||n),created_at,updated_at FROM import_mappings CROSS JOIN seq WHERE external_id='requested_0'",history);
  const measured=instrument(s),workspace={...owned(measured.storage,f.a.name),secrets:env as unknown as Record<string,unknown>},start=performance.now(),response=await importRoutes(f.request('imports:preview',batch,'measured'),workspace),body=await response.json() as {data:import('../../src/http/dto').ImportPreview};expect(response.status).toBe(200);expect(body.data.counts.unchanged).toBe(100);
  const applied=await importRoutes(f.request('imports/'+body.data.id+':apply',applyBody(body.data),'measured-apply'),workspace);expect(applied.status).toBe(200);expect((await applied.json() as {data:{counts:{created:number;unchanged:number}}}).data.counts).toMatchObject({created:0,unchanged:100});
  const samples=measured.report(),lookups=samples.filter(x=>x.query.includes('FROM import_mappings WHERE workspace_id=? AND namespace=? AND external_id=?'));
  expect(lookups.length).toBe(2);expect(lookups.every(x=>x.maxRowsRead<=2&&!JSON.stringify(x.plan).includes('SCAN '))).toBe(true);
  const ids=batch.rows.map(row=>(row as {external_id:string}).external_id),alternatives:Record<string,{rows:number;rowsRead:number;statements:number;plan:unknown[]}>= {};
  const chunked={rows:0,rowsRead:0,statements:0,plan:[] as unknown[]};
  // Workers permits100 bindings: two scoped prefixes leave98 IDs per bounded batch.
  for(let offset=0;offset<ids.length;offset+=98){const chunk=ids.slice(offset,offset+98),query='SELECT external_id,task_id,source_sha256,mapping_version FROM import_mappings WHERE workspace_id=? AND namespace=? AND external_id IN ('+chunk.map(()=>'?').join(',')+')',args=['ws_example','source_example',...chunk],cursor=s.sql.exec(query,...args);chunked.rows+=cursor.toArray().length;chunked.rowsRead+=cursor.rowsRead;chunked.statements++;chunked.plan.push(...s.sql.exec('EXPLAIN QUERY PLAN '+query,...args).toArray());}
  alternatives['bounded-set']=chunked;
  const naiveQuery='SELECT * FROM import_mappings WHERE workspace_id=?',naive=s.sql.exec(naiveQuery,'ws_example');alternatives['materialize-workspace']={rows:naive.toArray().length,rowsRead:naive.rowsRead,statements:1,plan:s.sql.exec('EXPLAIN QUERY PLAN '+naiveQuery,'ws_example').toArray()};
  expect(alternatives['bounded-set'].rows).toBe(100);expect(alternatives['materialize-workspace'].rows).toBe(100+history);
  return {history,rows:100,elapsedMs:performance.now()-start,totalSqlRowsRead:samples.reduce((n,x)=>n+x.rowsRead,0),totalSqlStatements:samples.reduce((n,x)=>n+x.calls,0),lookups,alternatives};
 }).then(receipt=>console.log('IMPORT_WORK_JSON '+JSON.stringify(receipt)));
});
