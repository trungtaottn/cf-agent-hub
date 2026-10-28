import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandContext} from '../workspace/context';
import type {SearchHit} from '../http/dto';
import type {PageData} from '../contracts/r2';
import {refreshActor} from '../auth/authorize';
import {getTask} from '../tasks/repository';
import {getArtifact} from '../artifacts/repository';
import {projectMessage,assertCursorRetained} from '../messages/reads';
import {validateTaskPage,type TaskPageQuery} from '../tasks/history';
import {MAX_TASK_ITEM_BYTES,jsonBytes} from '../tasks/bounds';
import {comparePosition,type MessagePosition} from '../http/cursors';
import {HttpError} from '../http/envelopes';
export const SEARCH_CANDIDATE_LIMIT=2000;
export type SearchKind=SearchHit['kind'];
export interface SearchQuery extends TaskPageQuery {q:string;kind?:SearchKind;}
type Context=Pick<CommandContext,'actor'|'nowMs'>;
type Candidate=MessagePosition&{kind:SearchKind};
/** Private ephemeral proof: never a public envelope or a persistent cursor store. */
export interface PreparedSearch {page:PageData<SearchHit>;candidates:readonly Candidate[];highWater:MessagePosition|null;exhausted:boolean;}
const kinds:readonly SearchKind[]=['task','message','artifact'];
const tables={task:'tasks',message:'messages',artifact:'artifacts'} as const;
const unavailable=():never=>{throw new HttpError('DEPENDENCY_UNAVAILABLE',503);};
export function normalizeSearchQuery(q:unknown):string{
 if(typeof q!=='string'||q.length===0)throw new HttpError('INVALID_REQUEST',400);
 const encoder=new TextEncoder();if(encoder.encode(q).byteLength>2048)throw new HttpError('LIMIT_EXCEEDED',413);
 const normalized=q.normalize('NFC');if(encoder.encode(normalized).byteLength>2048)throw new HttpError('LIMIT_EXCEEDED',413);return normalized;
}
function access(tx:WorkspaceTransaction,ctx:Context,query:SearchQuery):Context{
 const actor=refreshActor(tx,ctx.actor,ctx.nowMs);if(!actor.scopes.has('search:read'))throw new HttpError('FORBIDDEN',403);
 validateTaskPage(query,ctx.nowMs,actor);
 if(query.binding.operation!=='search'||query.kind!==undefined&&!kinds.includes(query.kind))throw new HttpError('INVALID_REQUEST',400);
 if(query.kind===undefined||query.kind==='message')assertCursorRetained(tx,query.cursor);
 return {actor,nowMs:ctx.nowMs};
}
function hit(tx:WorkspaceTransaction,ctx:Context,row:Candidate,q:string):SearchHit|null{
 let title:string,fields:string[],createdAt:string;
 try{
  if(row.kind==='task'){const task=getTask(tx,ctx,row.id);title=task.title;fields=[task.title,task.description];createdAt=task.created_at;}
  else if(row.kind==='message'){const message=projectMessage(tx,ctx.actor,row.id,ctx.nowMs);if(!message)return null;title='Message';fields=[message.body];createdAt=message.created_at;}
  else {const artifact=getArtifact(tx,ctx,row.id);if(artifact.status!=='committed')return null;title=artifact.filename;fields=[artifact.filename,artifact.media_type];createdAt=artifact.created_at;}
 }catch(error){if(error instanceof HttpError&&['FORBIDDEN','NOT_FOUND'].includes(error.code))return null;throw error;}
 if(Date.parse(createdAt)!==row.createdAt)return unavailable();
 const normalized=fields.map(value=>value.normalize('NFC')),matched=normalized.find(value=>value.includes(q));if(matched===undefined)return null;
 return {kind:row.kind,id:row.id,title:title.normalize('NFC'),snippet:Array.from(matched).slice(0,256).join(''),created_at:createdAt};
}
function collector(tx:WorkspaceTransaction,ctx:Context,query:SearchQuery,highWater:MessagePosition,q:string){
 const items:SearchHit[]=[];let bytes=0,last:MessagePosition|undefined;
 return {
  add(row:Candidate):boolean{
   const value=hit(tx,ctx,row,q);if(!value)return false;
   const size=jsonBytes(value)+(items.length?1:0);if(size>MAX_TASK_ITEM_BYTES)return unavailable();
   if(items.length===query.limit||bytes+size>MAX_TASK_ITEM_BYTES){if(!last)return unavailable();return true;}
   items.push(value);bytes+=size;last={createdAt:row.createdAt,id:row.id};return false;
  },
  page(more:boolean):PageData<SearchHit>{return {items,hasMore:more,next:more&&last?{version:1,binding:query.binding,highWater,lastScanned:last,expiresAt:query.cursor?.expiresAt??ctx.nowMs+3600000}:null};}
 };
}
/** Exactly one bounded discovery pass. Indexed heads count even if prefetched but never projected.
 * Three constant ceiling probes are distinct from candidate admission, not hidden unbounded scans. */
export function prepareSearchWorkspace(tx:WorkspaceTransaction,ctx:Context,query:SearchQuery):PreparedSearch{
 const q=normalizeSearchQuery(query.q),current=access(tx,ctx,query);
 const cursorHigh=query.cursor?.highWater,last=query.cursor?.lastScanned;
 if(typeof cursorHigh==='number'||typeof last==='number')throw new HttpError('INVALID_REQUEST',400);
 const selected=query.kind?[query.kind]:kinds;
 const streams=selected.map(kind=>{
  const where=`workspace_id=?${kind==='artifact'?" AND status='committed'":''}`;
  const peak=tx.one<MessagePosition>(`SELECT created_at AS createdAt,CASE WHEN length(CAST(id AS BLOB))<=? THEN id ELSE NULL END AS id FROM ${tables[kind]} WHERE ${where}${cursorHigh?' AND (created_at,id)<=(?,?)':''} ORDER BY ${tables[kind]}.created_at DESC,${tables[kind]}.id DESC LIMIT 1`,[MAX_TASK_ITEM_BYTES,current.actor.workspaceId,...(cursorHigh?[cursorHigh.createdAt,cursorHigh.id]:[])]);
  if(peak?.id===null)return unavailable();
  return {kind,where,peak,after:last,head:null as Candidate|null,ended:!peak||!!last&&comparePosition(last,peak)>=0};
 });
 const highWater=cursorHigh??streams.flatMap(s=>s.peak?[s.peak]:[]).sort(comparePosition).at(-1)??null;
 if(!highWater)return {page:{items:[],next:null,hasMore:false},candidates:[],highWater:null,exhausted:true};
 const candidates:Candidate[]=[];let ledgerBytes=0;
 const collect=collector(tx,current,query,highWater,q);
 const done=(more:boolean):PreparedSearch=>({page:collect.page(more),candidates,highWater,exhausted:!more});
 for(;;){
  for(const stream of streams){
   if(stream.head||stream.ended)continue;
   if(stream.after&&comparePosition(stream.after,stream.peak!)>=0){stream.ended=true;continue;}
   if(candidates.length===SEARCH_CANDIDATE_LIMIT)return unavailable();
   const after=stream.after;
   const row=tx.one<MessagePosition>(`SELECT created_at AS createdAt,CASE WHEN length(CAST(id AS BLOB))<=? THEN id ELSE NULL END AS id FROM ${tables[stream.kind]} WHERE ${stream.where} AND (created_at,id)<=(?,?)${after?' AND (created_at,id)>(?,?)':''} ORDER BY ${tables[stream.kind]}.created_at,${tables[stream.kind]}.id LIMIT 1`,[MAX_TASK_ITEM_BYTES,current.actor.workspaceId,highWater.createdAt,highWater.id,...(after?[after.createdAt,after.id]:[])]);
   if(!row){stream.ended=true;continue;}
   if(row.id===null)return unavailable();
   const candidate={...row,kind:stream.kind},size=jsonBytes(candidate)+1;if(ledgerBytes+size>MAX_TASK_ITEM_BYTES)return unavailable();
   ledgerBytes+=size;candidates.push(candidate);stream.head=candidate;
  }
  const available=streams.filter(s=>s.head!==null);if(!available.length)return done(false);
  available.sort((a,b)=>comparePosition(a.head!,b.head!));
  // Searchable IDs are globally distinct. Fail closed on corrupt cross-kind ties.
  if(available.length>1&&comparePosition(available[0].head!,available[1].head!)===0)return unavailable();
  const stream=available[0],row=stream.head!;stream.head=null;stream.after=row;
  if(collect.add(row))return done(true);
 }
}
/** Recheck only the admitted IDs after crypto, with original proof supplied by transport.
 * No new stream/ceiling query: bounded repeated graph work is not another discovery pass. */
export function revalidateSearchWorkspace(tx:WorkspaceTransaction,ctx:Context,query:SearchQuery,prepared:PreparedSearch):PageData<SearchHit>{
 const current=access(tx,ctx,query),q=normalizeSearchQuery(query.q);
 if(query.kind===undefined||query.kind==='message')assertCursorRetained(tx,prepared.page.next??undefined);
 if(prepared.page.next&&prepared.page.next.expiresAt<=ctx.nowMs)throw new HttpError('CURSOR_EXPIRED',410);
 if(!prepared.highWater)return {items:[],next:null,hasMore:false};
 const collect=collector(tx,current,query,prepared.highWater,q);
 for(const row of [...prepared.candidates].sort(comparePosition))if(collect.add(row))return collect.page(true);
 if(!prepared.exhausted)return unavailable();return collect.page(false);
}
export function searchWorkspace(tx:WorkspaceTransaction,ctx:Context,query:SearchQuery):PageData<SearchHit>{return prepareSearchWorkspace(tx,ctx,query).page;}
