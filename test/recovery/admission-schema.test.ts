import {describe,expect,it} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {messageFixture,messageInput} from '../helpers/messages';
import {TABLE_REGISTRY} from '../../src/recovery/table-registry';

describe('ordinary admission rejects live authority mismatch without SQL effects',()=>{
 it.each(['unknown_migration','missing_migration','disabled_grant'] as const)('%s',async mismatch=>{
  const {stub}=await messageFixture('recovery_admission_'+mismatch);
  await runInDurableObject(stub,async(instance,state)=>{
   if(mismatch==='unknown_migration')state.storage.sql.exec('INSERT INTO schema_migrations (version,applied_at) VALUES (999,1)');
   else if(mismatch==='missing_migration')state.storage.sql.exec('DELETE FROM schema_migrations WHERE version=4');
   else state.storage.sql.exec('UPDATE native_credentials SET enabled=0');
   const snapshot=()=>Object.fromEntries(TABLE_REGISTRY.map(table=>[table.name,state.storage.sql.exec('SELECT * FROM '+table.name).toArray()]));
   const before=snapshot();
   const response=await instance.fetch(new Request('https://hub.example.invalid/v2/workspaces/ws_example/messages',{method:'POST',headers:{authorization:'Bearer '+'A'.repeat(43),'content-type':'application/json','idempotency-key':'mismatched-authority'},body:JSON.stringify(messageInput())}));
   expect([401,503]).toContain(response.status);await response.text();
   expect(snapshot()).toEqual(before);
  });
 });
});
