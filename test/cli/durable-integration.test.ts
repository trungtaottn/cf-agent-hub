import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fork,type ChildProcess} from 'node:child_process';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {ProtectedCredentialProvider,type RuntimeProofBinding} from '../../packages/cli/src/secret-store';
import {DurableMutations} from '../../packages/cli/src/durable-mutations';
import {Journal} from '../../packages/cli/src/journal';
import {cleanupCompletedOutcomes,OUTCOME_RETENTION_MS} from '../../src/workspace/idempotency';
import {cases,commit,enrollProtected,lostResponseReceiver,origin,runtime,syntheticProof,syntheticToken,workspace} from './durable-integration-fixture';
import type {IntentHandle} from '../../packages/cli/src/durable-mutations';

const roots:string[]=[],handles:{close():void}[]=[];let fixtureDirectory:string,fixture:string;
const root=()=>{const path=mkdtempSync(join(dirname(process.cwd()),'cfhub-durable-integration-'));roots.push(path);return path;};
const track=<T extends {close():void}>(handle:T):T=>{handles.push(handle);return handle;};
beforeAll(async()=>{fixtureDirectory=mkdtempSync(join(dirname(process.cwd()),'cfhub-durable-integration-bundle-'));fixture=join(fixtureDirectory,'durable-integration-fixture.mjs');await build({entryPoints:[resolve('test/cli/durable-integration-fixture.ts')],outfile:fixture,bundle:true,format:'esm',platform:'node',target:'node24',logLevel:'silent'});});
afterEach(()=>{for(const handle of handles.splice(0))try{handle.close();}catch{}for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
afterAll(()=>rmSync(fixtureDirectory,{recursive:true,force:true}));
interface ChildReceipt {stage:string;importedUnbound:boolean;binding:RuntimeProofBinding;attemptId:string;attemptConsumed:boolean;enrollmentUrls:string[];runtimeHasCredentialId:boolean;intent:IntentHandle;requests:number;result:{ok:boolean;error?:{code:string}};serverNow:number;}
async function crashAtReceipt(directory:string,mode:string,operation?:string):Promise<{receipt:ChildReceipt;output:string}>{
 const child:ChildProcess=fork(fixture,[mode,directory,...(operation?[operation]:[])],{env:{...process.env,CF_DURABLE_INTEGRATION_FIXTURE:'1'},stdio:['ignore','pipe','pipe','ipc']});let output='';child.stdout!.on('data',bytes=>{output+=String(bytes);});child.stderr!.on('data',bytes=>{output+=String(bytes);});
 try{
  const receipt=await new Promise<ChildReceipt>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('SYNTHETIC_CHILD_TIMEOUT')),10000);
   child.once('message',value=>{clearTimeout(timer);resolve(value as ChildReceipt);});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error('SYNTHETIC_CHILD_EXIT_'+code));});
  });
  const exited=new Promise<void>(resolve=>child.once('exit',(_code,signal)=>{expect(signal).toBe('SIGKILL');resolve();}));child.kill('SIGKILL');await exited;return {receipt,output};
 }finally{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await exited;}}
}
const forbidden=()=>Response.json({error:{code:'FORBIDDEN',message:'Synthetic claim denied',retryable:false,request_id:'synthetic_claim_denied'}},{status:403});
const assertNoSecret=(value:unknown)=>{const text=typeof value==='string'?value:JSON.stringify(value);expect(text).not.toContain(syntheticToken);expect(text).not.toContain(syntheticProof);};

describe('durable enrollment capture to real journaled claim dispatch',()=>{
 it('opaque_import_explicit_durable_enrollment_SIGKILL_reopen_exact_binding_then_claim_without_admin_query',async()=>{
  const directory=root(),{receipt,output}=await crashAtReceipt(directory,'capture');expect(receipt.stage).toBe('active');expect(receipt.importedUnbound).toBe(true);expect(receipt.runtimeHasCredentialId).toBe(false);expect(receipt.attemptConsumed).toBe(true);expect(receipt.enrollmentUrls).toEqual([origin+'/v2/workspaces/ws/runtimes']);assertNoSecret(receipt);assertNoSecret(output);
  const provider=track(new ProtectedCredentialProvider({directory:join(directory,'secrets')}));expect(provider.runtimeBinding()).toEqual(receipt.binding);expect(provider.getEnrollmentAttempt(receipt.attemptId)).toMatchObject({slotId:receipt.binding.slotId,slotGeneration:receipt.binding.slotGeneration,consumed:true});
  const calls:{url:string;method:string|undefined;body:string;key:string|null;credentialMatched:boolean;proofMatched:boolean}[]=[];
  const fetcher:typeof fetch=async(url,init)=>{const headers=new Headers(init?.headers);calls.push({url:String(url),method:init?.method,body:String(init?.body),key:headers.get('idempotency-key'),credentialMatched:headers.get('authorization')==='Bearer '+syntheticToken,proofMatched:headers.get('x-runtime-token')===syntheticProof});return forbidden();};
  const mutations=track(new DurableMutations({origin,workspaceId:workspace,provider,journalDirectory:join(directory,'journal'),create:true,fetch:fetcher}));
  const intent=await mutations.prepare('claimTask',{path:{task_id:'task_synthetic'},body:{expected_version:1,runtime_instance_id:runtime.id}},{idempotencyKey:'synthetic-journaled-claim'});expect(calls).toHaveLength(0);
  expect(await mutations.dispatch(intent.id)).toMatchObject({ok:false,status:403,error:{code:'FORBIDDEN'}});
  expect(calls).toEqual([{url:origin+'/v2/workspaces/ws/tasks/task_synthetic:claim',method:'POST',body:'{"expected_version":1,"runtime_instance_id":"runtime_durable_integration"}',key:'synthetic-journaled-claim',credentialMatched:true,proofMatched:true}]);
  assertNoSecret(readFileSync(join(directory,'journal/journal.sqlite')).toString('utf8'));assertNoSecret(await mutations.inspect(intent.id));
  // Same raw opaque token and authenticated agent/runtime still do not make a
  // different protected provider/slot/provenance interchangeable.
  mutations.close();const foreign=track(new ProtectedCredentialProvider({directory:join(directory,'foreign-secrets'),create:true}));foreign.importCredential(syntheticToken);await enrollProtected(foreign);expect(foreign.binding()?.slotId).not.toBe(receipt.binding.slotId);
  let foreignFetches=0;const wrong=track(new DurableMutations({origin,workspaceId:workspace,provider:foreign,journalDirectory:join(directory,'journal'),fetch:async()=>{foreignFetches++;return forbidden();}}));expect((await wrong.dispatch(intent.id)).ok).toBe(false);expect(foreignFetches).toBe(0);
 });
 it('wrong_runtime_binding_on_journaled_claim_has_zero_outgoing_requests',async()=>{
  const directory=root(),{receipt}=await crashAtReceipt(directory,'capture');const provider=track(new ProtectedCredentialProvider({directory:join(directory,'secrets')}));expect(provider.runtimeBinding()).toEqual(receipt.binding);let fetches=0;
  const mutations=track(new DurableMutations({origin,workspaceId:workspace,provider,journalDirectory:join(directory,'journal'),create:true,fetch:async()=>{fetches++;return forbidden();}}));
  const intent=await mutations.prepare('claimTask',{path:{task_id:'task_synthetic'},body:{expected_version:1,runtime_instance_id:'runtime_wrong'}},{idempotencyKey:'synthetic-wrong-runtime'});expect((await mutations.dispatch(intent.id)).ok).toBe(false);expect(fetches).toBe(0);assertNoSecret(await mutations.inspect(intent.id));
 });
});

describe('lost success, explicit legal server GC and actual process restart',()=>{
 it.each(cases)('$operation: keeps original intent and never repeats receiver effect after 24h GC',async scenario=>{
  const directory=root(),{receipt,output}=await crashAtReceipt(directory,'lost',scenario.operation);expect(receipt.stage).toBe('response-lost');expect(receipt.requests).toBe(1);expect(receipt.result).toMatchObject({ok:false,error:{code:'NETWORK_ERROR'}});assertNoSecret(receipt);assertNoSecret(output);
  const server=track(new DatabaseSync(join(directory,'receiver.sqlite')));expect(server.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({n:15});
  const firstEffects=server.prepare('SELECT operation,path,body,key FROM synthetic_effects').all();expect(firstEffects).toHaveLength(1);expect(firstEffects[0]).toMatchObject({operation:scenario.operation,path:scenario.path,key:receipt.intent.key});expect(server.prepare('SELECT count(*) AS n FROM idempotency_outcomes').get()).toEqual({n:1});
  // Actual production cleanup helper + actual migrated SQL schema. This is an
  // explicitly invoked test GC, not evidence of a production alarm/GC caller.
  commit(server,tx=>cleanupCompletedOutcomes(tx,workspace,receipt.serverNow+OUTCOME_RETENTION_MS));expect(server.prepare('SELECT count(*) AS n FROM idempotency_outcomes').get()).toEqual({n:1});
  commit(server,tx=>cleanupCompletedOutcomes(tx,workspace,receipt.serverNow+OUTCOME_RETENTION_MS+1));expect(server.prepare('SELECT count(*) AS n FROM idempotency_outcomes').get()).toEqual({n:0});expect(server.prepare('SELECT operation,path,body,key FROM synthetic_effects').all()).toEqual(firstEffects);
  const provider=track(new ProtectedCredentialProvider({directory:join(directory,'secrets')}));expect(provider.runtimeBinding()).toEqual(receipt.binding);let secondFetches=0;
  const mutations=track(new DurableMutations({origin,workspaceId:workspace,provider,journalDirectory:join(directory,'journal'),fetch:lostResponseReceiver(server,scenario,receipt.serverNow+OUTCOME_RETENTION_MS+1,()=>{secondFetches++;})}));
  expect((await mutations.dispatch(receipt.intent.id)).ok).toBe(false);expect(secondFetches).toBe(0);expect(server.prepare('SELECT operation,path,body,key FROM synthetic_effects').all()).toEqual(firstEffects);expect(server.prepare('SELECT count(*) AS n FROM idempotency_outcomes').get()).toEqual({n:0});
  expect(await mutations.inspect(receipt.intent.id)).toMatchObject({id:receipt.intent.id,key:receipt.intent.key,operation:scenario.operation,replayState:'reconciliation-required'});mutations.close();
  const journal=track(new Journal({directory:join(directory,'journal'),authority:()=>false})),retained=await journal.get(receipt.intent.id);expect(retained?.request.canonicalBody).toBe(firstEffects[0].body);expect(retained?.request.path).toBe(scenario.path);expect(retained?.principal).toEqual(provider.binding());expect(retained?.key).toBe(receipt.intent.key);expect(retained?.firstDispatch).not.toBe(null);expect(await journal.pruneSettled()).toBe(0);expect(await journal.get(receipt.intent.id)).not.toBe(null);assertNoSecret(readFileSync(join(directory,'journal/journal.sqlite')).toString('utf8'));
 });
});
