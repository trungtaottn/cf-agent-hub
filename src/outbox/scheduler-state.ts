import type {WorkspaceTransaction} from '../storage/transaction';
/** SQL is authoritative. Task 9 arms alarms after commit and clears only its captured generation. */
export function markSchedulerDirty(tx:WorkspaceTransaction):number{
 tx.exec('INSERT INTO scheduler_state (id,dirty,generation) VALUES (1,1,1) ON CONFLICT(id) DO UPDATE SET dirty=1,generation=generation+1');
 return tx.one<{generation:number}>('SELECT generation FROM scheduler_state WHERE id=1')!.generation;
}
