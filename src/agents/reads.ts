import type {WorkspaceTransaction,SqlValue} from '../storage/transaction';
import type {ActorContext} from '../workspace/context';
import type {Agent,Credential} from '../http/dto';
import type {PageData} from '../contracts/r2';
import {HttpError} from '../http/envelopes';
import type {CursorBinding,CursorPayload,MessagePosition} from '../http/cursors';
import {agentAccess,agentView,type AgentRow} from './commands';
import {credentialAccess,credentialView,type CredentialRow} from '../auth/native-credentials';
export interface IdentityPageQuery{limit:number;nowMs:number;binding:CursorBinding;cursor?:CursorPayload;}
export function identityReadActor(tx:WorkspaceTransaction,actor:ActorContext,operation:'agents'|'credentials',nowMs:number):ActorContext{
 return operation==='agents'?agentAccess(tx,actor,'agents:read',nowMs):credentialAccess(tx,actor,nowMs);
}
function page<R,T>(tx:WorkspaceTransaction,query:IdentityPageQuery,table:'static_agents'|'native_credentials',id:'agent_id'|'credential_id',where:string,args:SqlValue[],project:(row:R)=>T):PageData<T>{
 if(!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>200)throw new HttpError('INVALID_REQUEST',400);
 if(query.cursor&&query.cursor.expiresAt<=query.nowMs)throw new HttpError('CURSOR_EXPIRED',410);
 const high=query.cursor?.highWater??tx.one<MessagePosition>(`SELECT created_at AS createdAt,${id} AS id FROM ${table} WHERE ${where} ORDER BY created_at DESC,${id} DESC LIMIT 1`,args);
 if(!high)return {items:[],next:null,hasMore:false};
 const last=query.cursor?.lastScanned;if(typeof high==='number'||typeof last==='number')throw new HttpError('INVALID_REQUEST',400);
 const bounds=`${where} AND (created_at,${id})<=(?,?)`+(last?` AND (created_at,${id})>(?,?)`:''),values=[...args,high.createdAt,high.id,...(last?[last.createdAt,last.id]:[])];
 const rows=tx.all<R & {created_at:number;agent_id?:string;credential_id?:string}>(`SELECT * FROM ${table} WHERE ${bounds} ORDER BY created_at,${id} LIMIT ?`,[...values,query.limit+1]);
 const selected=rows.slice(0,query.limit),end=selected.at(-1),hasMore=rows.length>query.limit;
 return {items:selected.map(project),hasMore,next:hasMore&&end?{version:1,binding:query.binding,highWater:high,lastScanned:{createdAt:end.created_at,id:end[id]!},expiresAt:query.cursor?.expiresAt??query.nowMs+3600000}:null};
}
export function listAgents(tx:WorkspaceTransaction,actor:ActorContext,query:IdentityPageQuery):PageData<Agent>{
 const live=identityReadActor(tx,actor,'agents',query.nowMs);
 return page<AgentRow,Agent>(tx,query,'static_agents','agent_id','workspace_id=?',[live.workspaceId],agentView);
}
export function listCredentials(tx:WorkspaceTransaction,actor:ActorContext,query:IdentityPageQuery):PageData<Credential>{
 const live=identityReadActor(tx,actor,'credentials',query.nowMs);
 // Filter the complete grant in SQL before limit/lookahead. Hidden rows never establish continuation.
 const where=`workspace_id=? AND NOT EXISTS (SELECT 1 FROM json_each(native_credentials.scopes_json) s WHERE NOT EXISTS (SELECT 1 FROM json_each(?) a WHERE a.value=s.value))`+
  (live.projectIds===null?'':` AND json_type(project_ids_json)='array' AND NOT EXISTS (SELECT 1 FROM json_each(native_credentials.project_ids_json) p WHERE NOT EXISTS (SELECT 1 FROM json_each(?) a WHERE a.value=p.value))`);
 const args:SqlValue[]=[live.workspaceId,JSON.stringify([...live.scopes]),...(live.projectIds===null?[]:[JSON.stringify(live.projectIds)])];
 return page<CredentialRow,Credential>(tx,query,'native_credentials','credential_id',where,args,row=>credentialView(row,query.nowMs));
}
