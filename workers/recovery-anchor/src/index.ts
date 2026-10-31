import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {AnchorStore} from './store';
import {parsePolicy,authorize,identity,canonical,reject} from './policy';
import type {Identity,Capability} from './types';
export interface AnchorEnv {ANCHORS:DurableObjectNamespace<RecoveryAnchorDO>;ANCHOR_POLICY:string;}
const resource=(value:any):Identity=>({workspace_id:value?.workspace_id,environment_id:value?.environment_id,object_name:value?.object_name});
// RPC result objects carry lifecycle disposers even when their payload is plain data.
async function consume<T>(call:PromiseLike<T>):Promise<T>{
 let result:T|undefined;
 try{result=await call;return JSON.parse(JSON.stringify(result)) as T;}
 finally{const symbol=(Symbol as unknown as {dispose:symbol}).dispose;const value=result as any;if(value&&typeof value[symbol]==='function')value[symbol]();const pending=call as any;if(typeof pending[symbol]==='function')pending[symbol]();}
}
function store(env:AnchorEnv,input:unknown,role:'read'|Capability){const id=resource(input);authorize(parsePolicy(env.ANCHOR_POLICY),id,role);return env.ANCHORS.get(env.ANCHORS.idFromName(canonical(id)));}
/** Namespace capability stays private to this Worker, not its consumers. */
export class RecoveryAnchorDO extends DurableObject<AnchorEnv> {
 private store:AnchorStore;
 constructor(ctx:DurableObjectState,env:AnchorEnv){super(ctx,env);this.store=new AnchorStore(ctx.storage);}
 async current(input:Identity){authorize(parsePolicy(this.env.ANCHOR_POLICY),input,'read');return this.store.current(input);}
 async publish(input:unknown,role:Capability){if(role!=='rotation'&&role!=='bootstrap')reject();authorize(parsePolicy(this.env.ANCHOR_POLICY),resource(input),role);return this.store.publish(input,role);}
}
/** No publish/create method exists on the read-only binding. */
export default class RecoveryAnchorReader extends WorkerEntrypoint<AnchorEnv> {
 async fetch(request:Request):Promise<Response>{
  try{
   const url=new URL(request.url);if(request.method!=='POST'||url.pathname!=='/current'||url.search||url.hash||request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return new Response(null,{status:404});
   if(!request.body)return new Response(null,{status:400});const reader=request.body.getReader();let size=0;const parts:Uint8Array[]=[];
   try{for(;;){const {value,done}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||value.length===0){await reader.cancel();return new Response(null,{status:400});}size+=value.length;if(size>2048){await reader.cancel();return new Response(null,{status:413});}parts.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let pos=0;for(const part of parts){bytes.set(part,pos);pos+=part.length;}
   const input:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));identity(input);
   const anchor=await consume(store(this.env,input,'read').current(input));if(!anchor)return new Response(null,{status:503});
   return new Response(canonical(anchor),{headers:{'content-type':'application/json','cache-control':'no-store'}});
  }catch{return new Response(null,{status:403});}
 }
}
/** Role identity is the deployment-owned named binding, not a request assertion. */
export class RecoveryAnchorWriter extends WorkerEntrypoint<AnchorEnv> {
 async publish(input:unknown){return await consume(store(this.env,input,'rotation').publish(input,'rotation'));}
}
/** Bootstrap is separately grantable and cannot overwrite existing state. */
export class RecoveryAnchorBootstrap extends WorkerEntrypoint<AnchorEnv> {
 async create(input:unknown){return await consume(store(this.env,input,'bootstrap').publish(input,'bootstrap'));}
}
