import {assertAdmissionOpen} from '../recovery/maintenance';
import {canonicalJson,sha256} from '../config/bootstrap';
import type {WorkspaceTransaction} from '../storage/transaction';
import type {CommandOutcome} from './commands';
import {HttpError} from '../http/envelopes';
export const OUTCOME_RETENTION_MS=86400000;
/** Only semantic, validated intent supplied by the trusted route is fingerprinted. No authority/correlation. */
export function canonicalJsonValue(value:unknown):string{
 const active=new Set<object>();
 const check=(node:unknown):void=>{
  if(node===null||typeof node==='string'||typeof node==='boolean'||typeof node==='number'&&Number.isFinite(node))return;
  if(typeof node!=='object'||active.has(node))throw Error('NON_JSON_VALUE');
  active.add(node);
  if(Array.isArray(node)){for(let i=0;i<node.length;i++){if(!Object.hasOwn(node,i))throw Error('NON_JSON_VALUE');check(node[i]);}}
  else{if(Object.getPrototypeOf(node)!==Object.prototype&&Object.getPrototypeOf(node)!==null)throw Error('NON_JSON_VALUE');for(const item of Object.values(node))check(item);}
  active.delete(node);
 };check(value);return canonicalJson(value);
}
export async function fingerprintRequest(method:string,path:string,query:unknown,body:unknown):Promise<string>{
 let canonical:string;try{canonical=canonicalJsonValue({method:method.toUpperCase(),path,query,body});}catch{throw new HttpError('INVALID_REQUEST',400);}
 return sha256(canonical);
}
export interface StoredOutcome {fingerprint:string;status:number;outcome_json:string;original_request_id:string;event_id:string|null;}
export function findOutcome(tx:WorkspaceTransaction,principalId:string,operation:string,target:string,key:string,workspaceId:string):StoredOutcome|null{
 return tx.one<StoredOutcome>('SELECT fingerprint,status,outcome_json,original_request_id,event_id FROM idempotency_outcomes WHERE principal_id=? AND operation=? AND target=? AND key=? AND workspace_id=?',[principalId,'domain.'+operation,target,key,workspaceId]);
}
export function readOutcome<T>(prior:StoredOutcome,fingerprint:string):CommandOutcome<T>{
 if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT',409);
 return {status:prior.status,data:JSON.parse(prior.outcome_json) as T};
}
export function storeOutcome<T>(tx:WorkspaceTransaction,input:{principalId:string;operation:string;target:string;key:string;workspaceId:string;fingerprint:string;outcome:CommandOutcome<T>;requestId:string;eventId:string;nowMs:number}):void{
 const i=input;
 tx.exec('INSERT INTO idempotency_outcomes (principal_id,operation,target,key,workspace_id,fingerprint,status,outcome_json,original_request_id,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[i.principalId,'domain.'+i.operation,i.target,i.key,i.workspaceId,i.fingerprint,i.outcome.status,canonicalJson(i.outcome.data),i.requestId,i.eventId,i.nowMs,i.nowMs+OUTCOME_RETENTION_MS]);
}
/** Explicit domain-only GC, strictly after the retention boundary. Never a claim about external effects. */
export function cleanupCompletedOutcomes(tx:WorkspaceTransaction,workspaceId:string,nowMs:number):void{
 assertAdmissionOpen(tx);
 tx.exec("DELETE FROM idempotency_outcomes WHERE workspace_id=? AND operation LIKE 'domain.%' AND expires_at<?",[workspaceId,nowMs]);
}
