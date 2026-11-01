import {ProtectedCredentialProvider} from '../../cli/src/secret-store';
import {Deadline} from '../../client/src/transport';
import {createOwnerTransport} from './owner-transport';
import {runHook} from './main';
import type {InvocationContext} from './reporter';
export interface TrustedLaunch extends Omit<InvocationContext,'deadline'|'transportFactory'> {
 /** Existing private enrolled store, never initialized/imported by a hook. */
 readonly credentialDirectory:string;
 /** Trusted code-only transport injection, not hook JSON/CLI/environment. */
 readonly fetch?:typeof fetch;
}
/** Trusted operator integration API, not an installed hook or config discovery.
 * Default start=0 counts this Node process's startup/imports against the soft 2s
 * budget. Embedded callers pass performance.now() captured BEFORE preparation.
 * Blocking filesystem work is checked around calls, never claimed interruptible.
 * Executing this module unconfigured performs no reads, HTTP, or initialization.
 */
export async function runTrustedHook(prepare:()=>TrustedLaunch|null,input:ReadableStream<Uint8Array>,invocationStartedAt=0):Promise<0>{
 let provider:ProtectedCredentialProvider|undefined,deadline:Deadline|undefined;
 try{
  const now=performance.now();if(!Number.isFinite(invocationStartedAt)||invocationStartedAt<0||invocationStartedAt>now||now-invocationStartedAt>=2000)return 0;
  deadline=new Deadline(2000-(now-invocationStartedAt));deadline.check();const launch=prepare();deadline.check();if(!launch)return 0;
  // Capture primitive path and trusted callbacks before runHook's first await.
  const directory=launch.credentialDirectory,fetcher=launch.fetch??globalThis.fetch,currentBinding=launch.currentBinding;
  await runHook({...launch,deadline,transportFactory:()=>{deadline!.check();provider=new ProtectedCredentialProvider({directory,create:false});deadline!.check();return createOwnerTransport(provider,fetcher,currentBinding);}},input);
 }catch{}finally{try{provider?.close();}catch{}deadline?.dispose();}return 0;
}
