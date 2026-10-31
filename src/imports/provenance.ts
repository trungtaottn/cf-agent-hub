import type {WorkspaceTransaction} from '../storage/transaction';
import type {ImportProvenance} from '../http/dto';
import {getTask} from '../tasks/repository';
import {getImport,importHuman,type ImportContext} from './repository';
/** One known immutable attempt, at most100 rows; not an unbounded task-history API. */
export function getTaskProvenance(tx:WorkspaceTransaction,ctx:ImportContext,importId:string,taskId:string):readonly ImportProvenance[]{
 const actor=importHuman(tx,ctx);getTask(tx,{...ctx,actor},taskId);
 const saved=getImport(tx,{...ctx,actor},importId);
 return saved.import_version===1?[]:saved.rows.filter(row=>row.task_id===taskId&&row.provenance!==null).map(row=>row.provenance!);
}
