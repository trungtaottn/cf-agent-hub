import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandContext} from '../workspace/context';
import type {Artifact} from '../http/dto';
import type {PageData} from '../contracts/r2';
import {validateTaskPage,TASK_SCAN_LIMIT,TASK_SCAN_CHUNK,type TaskPageQuery} from '../tasks/history';
import {MAX_TASK_ITEM_BYTES,jsonBytes} from '../tasks/bounds';
import type {MessagePosition} from '../http/cursors';
import {HttpError} from '../http/envelopes';
import {artifactActor,getArtifact} from './repository';
import {taskAccess} from '../tasks/repository';
export interface ArtifactListQuery extends TaskPageQuery {task_id?:string;}
/** Trusted binding/query hash comes from the HTTP owner, not a caller-supplied plaintext cursor. */
export function listArtifacts(tx:WorkspaceTransaction,ctx:Pick<CommandContext,'actor'|'nowMs'>,query:ArtifactListQuery):PageData<Artifact>{
 const actor=artifactActor(tx,ctx,'artifacts:read');validateTaskPage(query,ctx.nowMs,actor);
 if(query.binding.operation!=='artifacts'||query.task_id!==undefined&&!query.task_id)throw new HttpError('INVALID_REQUEST',400);
 if(query.task_id!==undefined)taskAccess(tx,actor,'tasks:read',query.task_id,ctx.nowMs);
 const filter=query.task_id===undefined?'':' AND task_id=?',bindings=query.task_id===undefined?[]:[query.task_id];
 const high=query.cursor?.highWater??tx.one<MessagePosition>(`SELECT created_at AS createdAt,CASE WHEN length(CAST(id AS BLOB))<=? THEN id ELSE NULL END AS id FROM artifacts WHERE workspace_id=? AND status='committed'${filter} ORDER BY artifacts.created_at DESC,artifacts.id DESC LIMIT 1`,[MAX_TASK_ITEM_BYTES,actor.workspaceId,...bindings]);
 if(!high)return {items:[],next:null,hasMore:false};
 if(typeof high==='number'||high.id===null||typeof query.cursor?.lastScanned==='number')throw new HttpError('INVALID_REQUEST',400);
 let position=query.cursor?.lastScanned as MessagePosition|undefined,lastReturned=position,scanned=0,bytes=0;
 const items:Artifact[]=[];
 const page=(more:boolean):PageData<Artifact>=>({items,hasMore:more,next:more&&lastReturned?{version:1,binding:query.binding,highWater:high,lastScanned:lastReturned,expiresAt:query.cursor?.expiresAt??ctx.nowMs+3600000}:null});
 for(;;){
  const cap=Math.min(TASK_SCAN_CHUNK,TASK_SCAN_LIMIT-scanned);if(cap===0)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  const rows=tx.all<MessagePosition>(`SELECT created_at AS createdAt,CASE WHEN length(CAST(id AS BLOB))<=? THEN id ELSE NULL END AS id FROM artifacts WHERE workspace_id=? AND status='committed'${filter} AND (created_at,id)<=(?,?)${position?' AND (created_at,id)>(?,?)':''} ORDER BY artifacts.created_at,artifacts.id LIMIT ?`,[MAX_TASK_ITEM_BYTES,actor.workspaceId,...bindings,high.createdAt,high.id,...(position?[position.createdAt,position.id]:[]),cap]);
  for(const row of rows){
   scanned++;if(row.id===null)throw new HttpError('INTERNAL_ERROR',500);position=row;
   let artifact:Artifact;try{artifact=getArtifact(tx,{actor,nowMs:ctx.nowMs},row.id);}catch(error){if(error instanceof HttpError&&['FORBIDDEN','NOT_FOUND'].includes(error.code))continue;throw error;}
   const size=jsonBytes(artifact)+(items.length?1:0);if(items.length===query.limit||bytes+size>MAX_TASK_ITEM_BYTES)return page(true);
   items.push(artifact);bytes+=size;lastReturned=row;
  }
  if(rows.length<cap||position&&position.createdAt===high.createdAt&&position.id===high.id)return page(false);
 }
}
