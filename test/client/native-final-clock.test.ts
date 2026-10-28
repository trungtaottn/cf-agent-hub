import {describe,it,expect,vi} from 'vitest';
import {registerProtectedProvider,registerFinalClockCheck,runFinalClockCheck,clearFinalClockCheck} from '../../packages/client/src/native-provenance';
import {createNativeClient} from '../../packages/client/src/native-client';
import type {CredentialDispatchLease,CredentialProvider} from '../../packages/client/src/types';
function fixture(){
 const binding=Object.freeze({origin:'https://hub.example.invalid',workspaceId:'ws',principalId:'agent_clock',slotId:'slot_clock',slotGeneration:0,provenanceId:'provenance_clock'}),leases=new WeakSet<object>(),order:string[]=[];
 const provider:CredentialProvider={acquire:async()=>{const lease:CredentialDispatchLease={slotId:binding.slotId,slotGeneration:0,provenance:null,isCurrent:()=>{order.push('current');return true;},use:fn=>fn('K'.repeat(43)),release(){}};leases.add(lease);return lease;}};
 registerProtectedProvider(provider,lease=>leases.has(lease)?{binding,runtimeId:'runtime_clock'}:null);return {provider,binding,order};
}
describe('internal final-clock capability',()=>{
 it('rejects unregistered, swapped or copied lease registration and duplicate binding',async()=>{
  const a=fixture(),b=fixture(),lease=await a.provider.acquire(null),check=vi.fn();
  expect(()=>registerFinalClockCheck({},lease,check)).toThrow('CREDENTIAL_CHANGED');expect(()=>registerFinalClockCheck(b.provider,lease,check)).toThrow('CREDENTIAL_CHANGED');expect(()=>registerFinalClockCheck(a.provider,{...lease},check)).toThrow('CREDENTIAL_CHANGED');
  registerFinalClockCheck(a.provider,lease,check);expect(()=>registerFinalClockCheck(a.provider,lease,check)).toThrow('CREDENTIAL_CHANGED');expect(()=>runFinalClockCheck(b.provider,lease)).toThrow('CREDENTIAL_CHANGED');expect(check).not.toHaveBeenCalled();
 });
 it('runs once or clears without invoking an abandoned checker',async()=>{
  const f=fixture(),lease=await f.provider.acquire(null),check=vi.fn();registerFinalClockCheck(f.provider,lease,check);runFinalClockCheck(f.provider,lease);runFinalClockCheck(f.provider,lease);expect(check).toHaveBeenCalledTimes(1);
  registerFinalClockCheck(f.provider,lease,check);clearFinalClockCheck(lease);runFinalClockCheck(f.provider,lease);expect(check).toHaveBeenCalledTimes(1);
 });
 it('runs clock after public guard and final provider access immediately before fetch',async()=>{
  const f=fixture(),fetch=vi.fn(async()=>{f.order.push('fetch');return Response.json({error:{code:'FORBIDDEN',message:'Denied',retryable:false,request_id:'synthetic'}},{status:403});});
  const client=createNativeClient({origin:f.binding.origin,workspaceId:'ws',credentialProvider:f.provider,fetch});
  expect(await client.call('createTask',{body:{title:'Synthetic',description:''}},{idempotencyKey:'clock',dispatchGuard:c=>{registerFinalClockCheck(f.provider,c.lease,()=>{f.order.push('clock');});return ()=>{f.order.push('guard');};}})).toMatchObject({ok:false,status:403});
  const index=f.order.indexOf('fetch');expect(f.order.slice(index-3,index+1)).toEqual(['guard','current','clock','fetch']);
 });
});
