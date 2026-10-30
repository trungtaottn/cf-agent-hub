import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {messageFixture,messageInput,owned,commandContext} from '../helpers/messages';
import {executeCommand} from '../../src/workspace/commands';
import {messageCommand} from '../../src/messages/commands';
import {withTransaction} from '../../src/storage/transaction';
import {claimDue} from '../../src/outbox/repository';
import {DeliveryDispatcher,signNotification} from '../../src/outbox/dispatcher';
it('archive_revocation_and_epoch_between_signing_and_dispatch_block_external_send',async()=>{
 for(const mutation of ['archive','revoke','epoch']){
  const name='identity-delivery-'+mutation,f=await messageFixture(name);
  await runInDurableObject(f.stub,async(_o,state)=>{
   const body=messageInput();executeCommand(await commandContext(state.storage,name,body,'send'),f.identity,messageCommand(owned(state.storage,name)),body);
   const now=state.storage.sql.exec<{next_due_at:number}>('SELECT next_due_at FROM outbox').one().next_due_at;
   const attempt=withTransaction(state.storage,tx=>claimDue(tx,now,25))[0];expect(attempt).toBeDefined();let sent=false;
   const workspace={...owned(state.storage,name),clock:{nowMs:()=>now},secrets:{NOTIFICATION_SIGNING_KEY:'SYNTHETIC-notification-signing-fixture-only-123456789'}};
   const result=await new DeliveryDispatcher(workspace,{sign:async(...args)=>{
    const headers=await signNotification(...args);
    if(mutation==='archive')state.storage.sql.exec("UPDATE static_agents SET status='archived'");
    if(mutation==='revoke')state.storage.sql.exec('UPDATE native_credentials SET revoked_at=?',now);
    if(mutation==='epoch')state.storage.sql.exec('UPDATE workspace_metadata SET config_epoch=config_epoch+1');
    return headers;
   },fetch:async()=>{sent=true;return new Response(null,{status:204});}}).dispatchAttempt(attempt);
   expect(sent).toBe(false);expect(result.kind).not.toBe('delivered');
  });
 }
});
