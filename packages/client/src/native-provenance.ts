/** INTERNAL trusted-adapter bridge. Not a public import/restore authority API.
 * Kept Node-free for browser/Workers consumers. The concrete protected provider
 * validates the OS-owned store and actual lease; caller labels are never registered.
 * Malicious same-process module imports are outside this local storage threat model.
 */
import type {CredentialDispatchLease,VerifiedPrincipalBinding} from './types';
import {ClientFault} from './transport';
export interface ProtectedAssociation {binding:Readonly<VerifiedPrincipalBinding>;runtimeId:string;}
const providers=new WeakMap<object,(lease:CredentialDispatchLease)=>ProtectedAssociation|null>();
const pending=new WeakMap<CredentialDispatchLease,ProtectedAssociation&{provider:object;proof:string}>();
const keys=['origin','workspaceId','principalId','slotId','slotGeneration','provenanceId'] as const;
export function samePrincipalBinding(a:Readonly<VerifiedPrincipalBinding>,b:Readonly<VerifiedPrincipalBinding>):boolean{return keys.every(key=>a[key]===b[key]);}
export function registerProtectedProvider(provider:object,verify:(lease:CredentialDispatchLease)=>ProtectedAssociation|null):void {
 if(providers.has(provider))throw new ClientFault('CREDENTIAL_CHANGED');providers.set(provider,verify);
}
export function protectedAssociationFor(provider:object,lease:CredentialDispatchLease):ProtectedAssociation|null {
 const value=providers.get(provider)?.(lease)??null;
 if(value&&(value.binding.slotId!==lease.slotId||value.binding.slotGeneration!==lease.slotGeneration||!lease.isCurrent()))throw new ClientFault('CREDENTIAL_CHANGED');
 return value;
}
export function beginPendingCapture(provider:object,binding:Readonly<VerifiedPrincipalBinding>,lease:CredentialDispatchLease,proof:string,runtimeId:string):void {
 if(pending.has(lease))throw new ClientFault('CREDENTIAL_CHANGED');pending.set(lease,{provider,binding,runtimeId,proof});
}
export function clearPendingCapture(lease:CredentialDispatchLease):void {pending.delete(lease);}
/** Read/validate only: never mints a receipt from supplied metadata. */
export function assertPendingCapture(provider:object,binding:Readonly<VerifiedPrincipalBinding>,lease:CredentialDispatchLease,proof:string,runtimeId:string):void {
 const value=pending.get(lease);
 if(!value||value.provider!==provider||!samePrincipalBinding(value.binding,binding)||value.runtimeId!==runtimeId||value.proof!==proof||!lease.isCurrent()||lease.slotId!==binding.slotId||lease.slotGeneration!==binding.slotGeneration)throw new ClientFault('CREDENTIAL_CHANGED');
}

const finalChecks=new WeakMap<CredentialDispatchLease,{provider:object;check:()=>void}>();
/** INTERNAL: trusted CLI clock adapter only, not a public caller-supplied hook. */
export function registerFinalClockCheck(provider:object,lease:CredentialDispatchLease,check:()=>void):void {
 if(typeof check!=='function'||finalChecks.has(lease)||!protectedAssociationFor(provider,lease))throw new ClientFault('CREDENTIAL_CHANGED');
 finalChecks.set(lease,{provider,check});
}
/** Runs after every potentially blocking provider/journal operation. No store access. */
export function runFinalClockCheck(provider:object,lease:CredentialDispatchLease):void {
 const pending=finalChecks.get(lease);if(!pending)return;finalChecks.delete(lease);
 if(pending.provider!==provider)throw new ClientFault('CREDENTIAL_CHANGED');
 const value=pending.check();void Promise.resolve(value).catch(()=>{});if(value!==undefined)throw new ClientFault('INVALID_REQUEST');
}
export function clearFinalClockCheck(lease:CredentialDispatchLease):void {finalChecks.delete(lease);}
