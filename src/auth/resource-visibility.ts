import type {WorkspaceTransaction} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {MessageReference} from '../http/dto';
import {HttpError} from '../http/envelopes';
import {canonicalJson} from '../config/bootstrap';
import {taskRecord,taskVisible} from '../tasks/repository';
import {artifactRecord,committedGeneration,artifactAssociationReferences,ATTACHMENT_MAX_BYTES} from '../artifacts/repository';
/** Eligibility data, deliberately not an ActorContext/authentication proof. */
export type RelationshipGrant=Pick<ActorContext,'workspaceId'|'scopes'|'projectIds'>;
export interface ResourceGrant extends RelationshipGrant {kind:'human'|'agent';id:string;}
export interface ReferenceBudget {remaining:number;}
export const referenceBudget=():ReferenceBudget=>({remaining:16384});
export function spendReferenceWork(budget:ReferenceBudget,amount=1):void{
 budget.remaining-=amount;if(budget.remaining<0)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
}
const unavailable=():never=>{throw new HttpError('NOT_FOUND',404);};
const bytes=(value:unknown)=>new TextEncoder().encode(canonicalJson(value)).byteLength;
export function referenceArtifacts(refs:readonly MessageReference[],ids:readonly string[]):string[]{
 if(!Array.isArray(refs)||!Array.isArray(ids)||refs.some(ref=>!ref||typeof ref!=='object'||Object.keys(ref).length!==2||!['task','artifact','message'].includes(ref.kind)||typeof ref.id!=='string'||!ref.id)||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length||new Set(refs.map(ref=>canonicalJson([ref.kind,ref.id]))).size!==refs.length)throw new HttpError('INVALID_REQUEST',400);
 const artifacts=[...new Set([...ids,...refs.filter(ref=>ref.kind==='artifact').map(ref=>ref.id)])];
 if(bytes(refs)>8192||bytes(ids)>8192||artifacts.length>5)throw new HttpError('LIMIT_EXCEEDED',413);
 return artifacts;
}
export function messageArtifactIds(tx:WorkspaceTransaction,workspaceId:string,id:string):string[]{
 const rows=tx.all<{artifact_id:string;ordinal:number}>('SELECT artifact_id,ordinal FROM message_artifacts WHERE workspace_id=? AND message_id=? ORDER BY ordinal LIMIT 6',[workspaceId,id]);
 if(rows.length>5||rows.some((row,i)=>row.ordinal!==i))return unavailable();
 return rows.map(row=>row.artifact_id);
}
function directReferences(refs:readonly MessageReference[],ids:readonly string[]):readonly MessageReference[]{
 referenceArtifacts(refs,ids);return [...refs,...ids.map(id=>({kind:'artifact' as const,id}))];
}
/** Iterative conjunction: every node passes local access before its edges are traversed.
 * A visited node only deduplicates work; it never replaces membership or grants. */
export function assertResourceReferences(tx:WorkspaceTransaction,grant:ResourceGrant,roots:readonly MessageReference[],budget=referenceBudget()):void{
 const pending:MessageReference[]=[],seen=new Set<string>(),artifactSizes=new Map<string,number>(),attachmentGroups:string[][]=[];let edges=0;
 const enqueue=(refs:readonly MessageReference[])=>{edges+=refs.length;spendReferenceWork(budget,refs.length);if(edges>4096)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);pending.push(...refs);};
 enqueue(roots);
 while(pending.length){
  const ref=pending.pop()!,key=canonicalJson([ref.kind,ref.id]);if(seen.has(key))continue;
  seen.add(key);spendReferenceWork(budget);if(seen.size>256)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);
  if(ref.kind==='task'){if(!taskVisible(grant,taskRecord(tx,grant.workspaceId,ref.id)))unavailable();continue;}
  if(ref.kind==='artifact'){
   if(!grant.scopes.has('artifacts:read'))unavailable();const row=artifactRecord(tx,grant.workspaceId,ref.id);committedGeneration(tx,row);artifactSizes.set(ref.id,row.byte_size);
   enqueue(artifactAssociationReferences(tx,grant,row));continue;
  }
  if(ref.kind!=='message'||!grant.scopes.has('messages:read')||grant.projectIds!==null)unavailable();
  const size=tx.one<{bytes:number}>('SELECT length(CAST(refs_json AS BLOB)) AS bytes FROM messages WHERE id=? AND workspace_id=?',[ref.id,grant.workspaceId]);if(!size||size.bytes>8192)unavailable();
  const row=tx.one<{thread_id:string;refs_json:string}>('SELECT m.thread_id,m.refs_json FROM messages m JOIN threads t ON t.id=m.thread_id AND t.workspace_id=m.workspace_id WHERE m.id=? AND m.workspace_id=?',[ref.id,grant.workspaceId]);
  if(!row||!(grant.kind==='human'&&grant.scopes.has('messages:review'))&&!tx.one('SELECT thread_id FROM thread_participants WHERE thread_id=? AND participant_kind=? AND participant_id=?',[row!.thread_id,grant.kind,grant.id]))unavailable();
  const ids=messageArtifactIds(tx,grant.workspaceId,ref.id);
  for(const id of ids)if(!tx.one("SELECT artifact_id FROM artifact_associations WHERE workspace_id=? AND artifact_id=? AND resource_kind='message' AND resource_id=?",[grant.workspaceId,id,ref.id]))unavailable();
  let refs:MessageReference[];try{refs=JSON.parse(row!.refs_json) as MessageReference[];}catch{return unavailable();}
  try{attachmentGroups.push(referenceArtifacts(refs,ids));enqueue(directReferences(refs,ids));}catch(error){if(error instanceof HttpError&&(error.code==='INVALID_REQUEST'||error.code==='LIMIT_EXCEEDED'))unavailable();throw error;}
 }
 // All graph authorization precedes any metadata-dependent aggregate rejection.
 for(const ids of attachmentGroups)if(ids.reduce((sum,id)=>sum+artifactSizes.get(id)!,0)>ATTACHMENT_MAX_BYTES)unavailable();
}
export function assertDirectReferences(tx:WorkspaceTransaction,grant:ResourceGrant,refs:readonly MessageReference[],ids:readonly string[],budget=referenceBudget()):void{
 const artifacts=referenceArtifacts(refs,ids);assertResourceReferences(tx,grant,directReferences(refs,ids),budget);
 if(artifacts.reduce((sum,id)=>sum+artifactRecord(tx,grant.workspaceId,id).byte_size,0)>ATTACHMENT_MAX_BYTES)throw new HttpError('LIMIT_EXCEEDED',413);
}
export function actorResourceGrant(actor:ActorContext):ResourceGrant{return {workspaceId:actor.workspaceId,scopes:actor.scopes,projectIds:actor.projectIds,kind:actor.kind,id:actor.kind==='agent'?actor.agentId!:actor.principalId};}
