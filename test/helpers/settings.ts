import {env} from 'cloudflare:workers';
import {fixture,operator} from './environment';
import {prepareBootstrap} from '../../src/config/bootstrap';
import {withTransaction} from '../../src/storage/transaction';
import {resolveActor} from '../../src/auth/authorize';
import {fingerprintRequest} from '../../src/workspace/idempotency';
import type {AuthWorkspace} from '../../src/auth/context';
import type {VerifiedIdentity} from '../../src/workspace/context';
export async function settingsFixture(name:string){
 const raw=await fixture(name),input=await prepareBootstrap(raw.config,raw.bundle,'ws_example'),stub=env.WORKSPACE.getByName(name);
 await stub.reconcileConfiguration(operator(),input);return {stub,name,input};
}
export function owned(storage:DurableObjectStorage,name:string):AuthWorkspace{return {storage,workspaceId:'ws_example',objectName:name,secrets:{CSRF_SECRET:'synthetic-csrf-fixture-secret-value-long-enough'},clock:{nowMs:()=>Date.now()},entropy:{bytes:n=>crypto.getRandomValues(new Uint8Array(n))}};}
export function human(storage:DurableObjectStorage,other=false):VerifiedIdentity{
 const now=Date.now(),id=other?'session_other':'session_settings',principal=other?'human_other':'human_operator',subject=other?'other-subject':'synthetic-subject';
 withTransaction(storage,tx=>{
  if(other)tx.exec("INSERT OR IGNORE INTO human_grants SELECT ?,workspace_id,issuer,?,scopes_json,project_ids_json,enabled,config_epoch FROM human_grants WHERE principal_id='human_operator'",[principal,subject]);
  tx.exec('INSERT OR IGNORE INTO sessions (id,workspace_id,principal_id,token_digest,csrf_digest,issuer,subject,created_at,expires_at,revoked_at,auth_epoch) VALUES (?,?,?,?,?,?,?,?,?,NULL,1)',[id,'ws_example',principal,'digest_'+id,'csrf_'+id,'https://identity.example.invalid',subject,now,now+1000000]);
 });
 return {kind:'human',workspaceId:'ws_example',issuer:'https://identity.example.invalid',subject,sessionId:id};
}
export function actor(storage:DurableObjectStorage,identity:VerifiedIdentity){return withTransaction(storage,tx=>resolveActor(tx,identity,Date.now()));}
export async function commandContext(storage:DurableObjectStorage,name:string,body:unknown,key:string){
 return {workspace:owned(storage,name),requestId:'request_'+key,idempotencyKey:key,fingerprint:await fingerprintRequest('PUT','/settings',{},body),admissionGeneration:storage.sql.exec<{generation:number}>('SELECT generation FROM maintenance_state WHERE id=1').one().generation,admissionEpoch:storage.sql.exec<{config_epoch:number}>('SELECT config_epoch FROM workspace_metadata').one().config_epoch};
}
export const snapshot=(storage:DurableObjectStorage)=>Object.fromEntries(['profiles','preferences','events','idempotency_outcomes'].map(t=>[t,storage.sql.exec('SELECT * FROM '+t).toArray()]));
export const preference={contract_revision:'0.1',theme:'system',density:'comfortable',default_view:'overview'} as const;
