/** Synthetic test harness. Not a production GC caller or a domain/Workers substitute. */
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {createNativeClient} from '../../packages/client/src/native-client';
import {prepareNativeOperation} from '../../packages/client/src/native-request';
import {ProtectedCredentialProvider} from '../../packages/cli/src/secret-store';
import {DurableMutations} from '../../packages/cli/src/durable-mutations';
import type {WorkspaceTransaction,SqlValue} from '../../src/storage/transaction';
import {fingerprintRequest,storeOutcome} from '../../src/workspace/idempotency';

export const origin='https://hub.example.invalid',workspace='ws',syntheticToken='K'.repeat(43),syntheticProof='R'.repeat(43),serverNow=1_000_000;
export const runtime={id:'runtime_durable_integration',workspace_id:workspace,agent_id:'agent_durable_integration',runtime_version:1,label:'Synthetic integration',status:'online' as const,last_seen_at:'2026-10-27T00:00:00Z',presence_expires_at:'2026-10-27T00:01:30Z',created_at:'2026-10-27T00:00:00Z'};
export const cases=[
 {operation:'createTask',path:'/v2/workspaces/ws/tasks',input:{body:{title:'Synthetic durable task',description:'Exact retained task body'}}},
 {operation:'createMessage',path:'/v2/workspaces/ws/messages',input:{body:{recipient_agent_ids:['agent_recipient'],body:'Exact retained message body',refs:[],artifact_ids:[]}}},
 {operation:'stageArtifact',path:'/v2/workspaces/ws/artifacts',input:{body:{task_id:null,run_id:null,filename:'synthetic.txt',media_type:'text/plain',byte_size:4,sha256:'a'.repeat(64)}}}
] as const;
export type IntegrationCase=typeof cases[number];

/** Opaque imported token does not authorize until a real native capture commits.
 * EnrollmentAttempt is durably recorded/keyed, and consumed by the exact dispatch lease. */
export async function enrollProtected(provider:ProtectedCredentialProvider){
 const input={body:{label:'Synthetic integration'}},lease=await provider.acquire(null);
 const {request:_input,...semantic}=prepareNativeOperation(origin,workspace,'createRuntime',input);
 const intent=provider.recordEnrollmentIntent(semantic,lease);lease.release();
 const attempt=provider.attachEnrollmentKey(intent.id,'synthetic-enrollment-'+intent.id);
 const urls:string[]=[];
 const client=createNativeClient({origin,workspaceId:workspace,credentialProvider:provider,fetch:async(url,init)=>{
  urls.push(String(url));if(String(url)!==origin+'/v2/workspaces/ws/runtimes'||init?.method!=='POST'||new Headers(init.headers).get('authorization')!=='Bearer '+syntheticToken)throw Error('SYNTHETIC_ENROLLMENT_REQUEST_REJECTED');
  return Response.json({data:{runtime,runtime_token:syntheticProof,revealed:true},request_id:'synthetic_enroll'},{status:201});
 }});
 const result=await client.enrollRuntime(input,{idempotencyKey:attempt.key!,dispatchGuard:context=>provider.authorizeEnrollmentDispatch(attempt.id,context.request,context.lease),captureRuntime:capture=>provider.captureRuntime(capture)});
 if(!result.ok)throw Error('SYNTHETIC_ENROLLMENT_FAILED');
 return {attempt:provider.getEnrollmentAttempt(attempt.id),binding:provider.runtimeBinding()!,urls,result};
}
const values=(bindings:readonly SqlValue[]):SQLInputValue[]=>bindings.map(value=>value instanceof ArrayBuffer?new Uint8Array(value):value);
/** Test adapter executes actual SQL; it does not stub the idempotency helper. */
export function sqlTransaction(db:DatabaseSync):WorkspaceTransaction{return {
 all:<T>(sql:string,bindings:readonly SqlValue[]=[])=>db.prepare(sql).all(...values(bindings)) as T[],
 one:<T>(sql:string,bindings:readonly SqlValue[]=[])=>db.prepare(sql).get(...values(bindings)) as T|undefined??null,
 exec:(sql:string,bindings:readonly SqlValue[]=[])=>{if(bindings.length)db.prepare(sql).run(...values(bindings));else db.exec(sql);}
};}
export function commit<T>(db:DatabaseSync,body:(tx:WorkspaceTransaction)=>T):T{
 db.exec('BEGIN IMMEDIATE');try{const result=body(sqlTransaction(db));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
}
export function createSyntheticReceiver(path:string):DatabaseSync{
 writeFileSync(path,'',{flag:'wx',mode:0o600});const db=new DatabaseSync(path);db.exec('PRAGMA synchronous=EXTRA; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL)');
 const migrations=join(process.cwd(),'src/storage/migrations');
 commit(db,()=>{for(const file of readdirSync(migrations).filter(file=>/^\d{4}-.+\.sql$/.test(file)).sort()){db.exec(readFileSync(join(migrations,file),'utf8'));db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(Number(file.slice(0,4)),serverNow);}
  db.exec("INSERT INTO workspace_metadata(id,workspace_id,object_name,config_epoch,config_digest,installation_digest,config_json,bundle_json,installed_at,admission_state) VALUES(1,'ws','synthetic_receiver',1,'synthetic','synthetic','{}','{}',1000000,'installed'); CREATE TABLE synthetic_effects(id INTEGER PRIMARY KEY AUTOINCREMENT,operation TEXT NOT NULL,path TEXT NOT NULL,body TEXT NOT NULL,key TEXT NOT NULL)");
 });return db;
}
/** Transparent synthetic receiver: append-only effect and REAL storeOutcome commit
 * atomically, then deliberately lose the response. It does not emulate domain ACLs. */
export function lostResponseReceiver(db:DatabaseSync,scenario:IntegrationCase,nowMs:number,onFetch:()=>void):typeof fetch{return async(url,init)=>{
 onFetch();if(String(url)!==origin+scenario.path||init?.method!=='POST'||typeof init.body!=='string'||new Headers(init.headers).get('authorization')!=='Bearer '+syntheticToken)throw Error('SYNTHETIC_MUTATION_REQUEST_REJECTED');
 const headers=new Headers(init.headers),key=headers.get('idempotency-key');if(!key||scenario.operation==='stageArtifact'&&headers.get('x-runtime-token')!==syntheticProof)throw Error('SYNTHETIC_MUTATION_BINDING_REJECTED');
 const fingerprint=await fingerprintRequest('POST',scenario.path,{},JSON.parse(init.body));
 commit(db,tx=>{
  tx.exec('INSERT INTO synthetic_effects(operation,path,body,key) VALUES (?,?,?,?)',[scenario.operation,scenario.path,init.body as string,key]);
  storeOutcome(tx,{principalId:runtime.agent_id,operation:scenario.operation,target:scenario.path,key,workspaceId:workspace,fingerprint,outcome:{status:201,data:{synthetic_effect:true}},requestId:'synthetic_lost_request',eventId:'synthetic_event',nowMs});
 });throw Error('SYNTHETIC_RESPONSE_LOST_AFTER_COMMIT');
};}

async function childMain(mode:string,root:string,operation?:string):Promise<void>{
 const provider=new ProtectedCredentialProvider({directory:join(root,'secrets'),create:true});provider.importCredential(syntheticToken);
 const importedUnbound=provider.binding()===null,enrollment=await enrollProtected(provider);
 if(mode==='capture')process.send?.({stage:'active',importedUnbound,binding:enrollment.binding,attemptId:enrollment.attempt.id,attemptConsumed:enrollment.attempt.consumed,enrollmentUrls:enrollment.urls,runtimeHasCredentialId:Object.hasOwn(runtime,'credential_id')});
 else{
  const scenario=cases.find(item=>item.operation===operation);if(!scenario)throw Error('SYNTHETIC_SCENARIO_REJECTED');
  const db=createSyntheticReceiver(join(root,'receiver.sqlite'));let requests=0;
  const mutations=new DurableMutations({origin,workspaceId:workspace,provider,journalDirectory:join(root,'journal'),create:true,fetch:lostResponseReceiver(db,scenario,serverNow,()=>{requests++;})});
  const intent=await mutations.prepare(scenario.operation,scenario.input as never,{idempotencyKey:'synthetic-lost-'+scenario.operation}),result=await mutations.dispatch(intent.id);
  process.send?.({stage:'response-lost',importedUnbound,binding:enrollment.binding,intent,requests,result,serverNow,enrollmentUrls:enrollment.urls});
 }
 setInterval(()=>{},1000);
}
if(process.env.CF_DURABLE_INTEGRATION_FIXTURE==='1')childMain(process.argv[2],process.argv[3],process.argv[4]).catch(()=>{process.stderr.write('SYNTHETIC_INTEGRATION_FIXTURE_FAILED\n');process.exitCode=1;process.disconnect?.();});
