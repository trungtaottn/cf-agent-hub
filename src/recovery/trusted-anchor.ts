import {canonicalBytes,closed,isSlug} from './encoding';
import type {LedgerAnchor} from './protocol';

/** Deployment-owned service binding, never a body/header/manifest-selected URL. */
export interface TrustedAnchorCapability {
 bindingId:string;
 binding:{fetch(request:Request):Promise<Response>};
}
export interface TrustedAnchorWorkspace {
 workspaceId:string;environmentId:string;objectName:string;trustedAnchor?:TrustedAnchorCapability;
}
export interface TrustedAnchorSnapshot {
 bindingId:string;workspaceId:string;environmentId:string;objectName:string;
 authorityEpoch:number;sha256:string;generation:number;
}
export const TRUSTED_ANCHOR_RESPONSE_LIMIT=2048;
export const TRUSTED_ANCHOR_TIMEOUT_MS=2000;
const endpoint='https://recovery-anchor.invalid/current';
const hash=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const positive=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>0;
function validSnapshot(value:unknown):value is TrustedAnchorSnapshot {
 return closed(value,['bindingId','workspaceId','environmentId','objectName','authorityEpoch','sha256','generation'])&&
  [value.bindingId,value.workspaceId,value.environmentId,value.objectName].every(isSlug)&&positive(value.authorityEpoch)&&positive(value.generation)&&hash(value.sha256);
}
/** A fresh, bounded authoritative observation. A mocked provider proves only this controller contract. */
export async function readTrustedAnchor(w:TrustedAnchorWorkspace,ctx:{ledgerAnchor:LedgerAnchor|null},admitted?:TrustedAnchorSnapshot,assertLocal:()=>void=()=>{}):Promise<TrustedAnchorSnapshot>{
 const capability=w.trustedAnchor,binding=capability?.binding,bindingId=capability?.bindingId;
 if(!binding||typeof binding.fetch!=='function'||!isSlug(bindingId)||!ctx.ledgerAnchor)throw Error('RECOVERY_ANCHOR_UNAVAILABLE');
 if(admitted!==undefined&&!validSnapshot(admitted))throw Error('RECOVERY_ANCHOR_MISMATCH');
 const admittedSnapshot=admitted===undefined?undefined:{...admitted},fetcher=binding.fetch;
 const identity={workspaceId:w.workspaceId,environmentId:w.environmentId,objectName:w.objectName};
 if(!Object.values(identity).every(isSlug)||!positive(ctx.ledgerAnchor.authorityEpoch)||!hash(ctx.ledgerAnchor.sha256))throw Error('RECOVERY_ANCHOR_MISMATCH');
 const anchor={...ctx.ledgerAnchor},abort=new AbortController();let expired=false,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const check=()=>{
  if(expired)throw Error('RECOVERY_ANCHOR_UNAVAILABLE');
  if(w.trustedAnchor!==capability||w.trustedAnchor.binding!==binding||w.trustedAnchor.bindingId!==bindingId||binding.fetch!==fetcher)throw Error('RECOVERY_ANCHOR_BINDING_CHANGED');
  if(w.workspaceId!==identity.workspaceId||w.environmentId!==identity.environmentId||w.objectName!==identity.objectName||ctx.ledgerAnchor?.authorityEpoch!==anchor.authorityEpoch||ctx.ledgerAnchor.sha256!==anchor.sha256)throw Error('RECOVERY_ANCHOR_MISMATCH');
  assertLocal();
 };
 let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;abort.abort();void reader?.cancel().catch(()=>{});reject(Error('RECOVERY_ANCHOR_UNAVAILABLE'));},TRUSTED_ANCHOR_TIMEOUT_MS);});
 const work=async()=>{
  check();
  const response=await fetcher.call(binding,new Request(endpoint,{method:'POST',redirect:'manual',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({workspace_id:identity.workspaceId,environment_id:identity.environmentId,object_name:identity.objectName}),signal:abort.signal}));
  try{check();}catch(error){void response.body?.cancel().catch(()=>{});throw error;}
  if(response.status!==200||response.redirected||(response.url!==''&&response.url!==endpoint)||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||!response.body){void response.body?.cancel().catch(()=>{});throw Error('RECOVERY_ANCHOR_UNAVAILABLE');}
  reader=response.body.getReader();const bytes=new Uint8Array(TRUSTED_ANCHOR_RESPONSE_LIMIT);let size=0;
  try{
   for(;;){check();const part=await reader.read();check();if(part.done)break;if(!(part.value instanceof Uint8Array)||part.value.length===0||size+part.value.length>bytes.length)throw Error('RECOVERY_ANCHOR_RESPONSE_LIMIT');bytes.set(part.value,size);size+=part.value.length;}
   const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes.subarray(0,size)));check();
   if(!closed(value,['workspace_id','environment_id','object_name','authority_epoch','ledger_sha256','generation'])||canonicalBytes(value).length>TRUSTED_ANCHOR_RESPONSE_LIMIT||value.workspace_id!==identity.workspaceId||value.environment_id!==identity.environmentId||value.object_name!==identity.objectName||!positive(value.authority_epoch)||!positive(value.generation)||!hash(value.ledger_sha256)||value.authority_epoch!==anchor.authorityEpoch||value.ledger_sha256!==anchor.sha256)throw Error('RECOVERY_ANCHOR_MISMATCH');
   const result:TrustedAnchorSnapshot={bindingId,...identity,authorityEpoch:value.authority_epoch,sha256:value.ledger_sha256,generation:value.generation};
   if(admittedSnapshot&&Object.keys(result).some(key=>result[key as keyof TrustedAnchorSnapshot]!==admittedSnapshot[key as keyof TrustedAnchorSnapshot]))throw Error('RECOVERY_ANCHOR_MISMATCH');
   check();return result;
  }catch(error){void reader.cancel().catch(()=>{});throw error;}finally{try{reader.releaseLock();}catch{/* A timed-out read may still be pending; no retry or success. */}}
 };
 try{return await Promise.race([work(),timeout]);}finally{if(timer!==undefined)clearTimeout(timer);}
}
