/** J2-only full private snapshots; never exported as evidence. J1 bounds stay untouched. */
import {R3_CONSUMED_TABLES,consumedRowLimit} from './r3-consumed-journey-observation';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry';
type Row=Record<string,string|number|null>;
type Snapshot=Record<typeof R3_CONSUMED_TABLES[number],Row[]>;
const q=(name:string)=>'"'+name+'"'; // Pinned registry identifiers only.
const fail=():never=>{throw Error('J2_PRIVATE_SNAPSHOT_BUDGET');};
export function captureR3ConsumedSnapshot(storage:DurableObjectStorage,_stage:'command'|'source_source'|'target_target'|'capture_source'|'restore_target'='command'):Snapshot{
 let total=0;
 // Complete schema and raw byte preflight before materializing any private row.
 for(const name of R3_CONSUMED_TABLES){
  const table=TABLE_REGISTRY.find(t=>t.name===name);if(!table)fail();
  const columns=storage.sql.exec<{name:string;type:string;pk:number}>('PRAGMA table_info('+q(name)+')').toArray();
  if(columns.length!==table!.columns.length||columns.some((c,i)=>c.name!==table!.columns[i].name||c.type!==table!.columns[i].type||c.pk!==table!.columns[i].pk))fail();
  const size=table!.columns.map(c=>'coalesce(length(cast('+q(c.name)+' AS BLOB)),0)').join('+'),limit=consumedRowLimit(name);
  const b=storage.sql.exec<{count:number;max_bytes:number;total_bytes:number}>('SELECT count(*) AS count,coalesce(max(bytes),0) AS max_bytes,coalesce(sum(bytes),0) AS total_bytes FROM (SELECT '+size+' AS bytes FROM '+q(name)+' LIMIT '+(limit+1)+')').one();
  total+=b.total_bytes;if(b.count>limit||b.max_bytes>65536||total>2097152)fail();
 }
 const result={} as Snapshot;
 for(const name of R3_CONSUMED_TABLES){const table=TABLE_REGISTRY.find(t=>t.name===name)!,limit=consumedRowLimit(name);
  const rows=storage.sql.exec<Row>('SELECT '+table.columns.map(c=>q(c.name)).join(',')+' FROM '+q(name)+' ORDER BY '+table.primaryKey.map(q).join(',')+' LIMIT '+(limit+1)).toArray();
  if(rows.length>limit||rows.some(row=>Object.values(row).some(v=>v!==null&&typeof v!=='string'&&typeof v!=='number')))fail();
  result[name]=rows;
 }
 return result;
}
