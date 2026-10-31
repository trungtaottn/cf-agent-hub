import {it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {migrate} from '../../src/storage/migrations';
import {inspectRegistry,TABLE_REGISTRY} from '../../src/recovery/table-registry';
import {withTransaction} from '../../src/storage/transaction';

it('observes pinned engine alarm metadata identity and rejects application access',async()=>{
 await runInDurableObject(env.WORKSPACE.getByName('recovery_engine_metadata_observation'),async(_instance,state)=>{
  migrate(state.storage);
  await state.storage.setAlarm(Date.now()+3600000);
  await state.storage.deleteAlarm();
  const rows=state.storage.sql.exec("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name='_cf_METADATA'").toArray();
  console.log('ENGINE_METADATA_OBSERVATION',JSON.stringify(rows));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.sql).toBe('CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )');
  expect(rows[0]).toMatchObject({type:'table',name:'_cf_METADATA',tbl_name:'_cf_METADATA'});
  for(const sql of ['SELECT * FROM _cf_METADATA','CREATE TABLE _cf_spoof (key INTEGER PRIMARY KEY,value BLOB)','DROP TABLE _cf_METADATA'])expect(()=>state.storage.sql.exec(sql)).toThrow();
  expect(withTransaction(state.storage,tx=>inspectRegistry(tx,17)).tables).toBe(TABLE_REGISTRY.length+1);
  try{console.log('ENGINE_METADATA_COLUMNS',JSON.stringify(state.storage.sql.exec('PRAGMA table_info("_cf_METADATA")').toArray()));}catch(error){console.log('ENGINE_METADATA_COLUMNS_DENIED',String(error));}
 });
});
