import type {ApiResult,BrowserComposeOperation,BrowserComposeRequest} from '../../../packages/client/src/types';
import {classifyWriteResult} from '../write-intent';
import {DraftStore,type DraftBinding,type DraftEntry,type DraftScope,type SubmitIntent} from './draft-store';
export interface ComposeBinding extends DraftScope {generation:number;}
export interface SubmitState {status:'inactive'|'ready'|'preparing'|'pending'|'confirmed'|'rejected'|'reconciliation-required'|'revalidation-required'|'storage-error';entry:DraftEntry|null;}
export interface SubmitOptions {
 draftId:string;store:DraftStore;currentBinding:()=>ComposeBinding|null;
 /** Trusted host reads current session/workspace and referenced resources. Saved records grant nothing. */
 revalidate:(operation:BrowserComposeOperation,body:unknown)=>Promise<boolean>;
 send:BrowserComposeRequest;newKey?:()=>string;
}
/** Durable browser intent owner. No automatic retry or guessed lookup-by-key reconciliation. */
export class SubmitController {
 #generation=0;#binding:DraftBinding|null=null;#context:ComposeBinding|null=null;#flight:Promise<void>|null=null;
 #state:SubmitState={status:'inactive',entry:null};
 constructor(private readonly options:SubmitOptions){}
 get state():Readonly<SubmitState>{return structuredClone(this.#state);}
 #same(generation:number,context:ComposeBinding):boolean{const now=this.options.currentBinding();return generation===this.#generation&&!!now&&now.workspaceId===context.workspaceId&&now.principalId===context.principalId&&now.generation===context.generation;}
 #show(entry:DraftEntry|null){const status=entry?.intent?.status;this.#state={entry,status:status==='uncertain'?'reconciliation-required':status==='confirmed'?'confirmed':status==='rejected'?'rejected':'ready'};}
 async open():Promise<void>{const generation=++this.#generation,context=this.options.currentBinding();this.#binding=null;this.#context=null;this.#state={status:'inactive',entry:null};if(!context)return;const stable={...context};try{const binding=await this.options.store.bind(stable);if(!this.#same(generation,stable))return;const entry=await this.options.store.load(binding,this.options.draftId);if(!this.#same(generation,stable))return;this.#binding=binding;this.#context=stable;this.#show(entry);}catch{if(this.#same(generation,stable))this.#state={status:'storage-error',entry:null};}}
 async save(operation:BrowserComposeOperation,body:unknown):Promise<void>{const b=this.#binding,c=this.#context,g=this.#generation;if(!b||!c||!this.#same(g,c))return;try{await this.options.store.save(b,this.options.draftId,operation,body);if(!this.#same(g,c))return;const entry=await this.options.store.load(b,this.options.draftId);if(this.#same(g,c)){if(this.#flight)this.#state={...this.#state,entry};else this.#show(entry);}}catch{if(this.#same(g,c))this.#state={...this.#state,status:'storage-error'};}}
 submit():Promise<void>{if(this.#flight)return this.#flight;const flight=this.#submit();this.#flight=flight.finally(()=>{this.#flight=null;});return this.#flight;}
 async #submit():Promise<void>{const b=this.#binding,c=this.#context,g=this.#generation;if(!b||!c||!this.#same(g,c))return;this.#state={...this.#state,status:'preparing'};
  try{
   const entry=await this.options.store.load(b,this.options.draftId);if(!this.#same(g,c))return;
   if(entry?.intent&&entry.intent.status!=='prepared'){this.#show(entry);return;}
   const intent=await this.options.store.admit(b,this.options.draftId,(this.options.newKey??(()=>crypto.randomUUID()))());if(!this.#same(g,c))return;
   const valid=await this.options.revalidate(intent.operation,JSON.parse(intent.bodyJson));if(!this.#same(g,c))return;
   if(!valid){const observed=await this.options.store.load(b,this.options.draftId);if(this.#same(g,c))this.#state={status:'revalidation-required',entry:observed};return;}
   if(!await this.options.store.claimDispatch(b,this.options.draftId,intent.key)){const observed=await this.options.store.load(b,this.options.draftId);if(this.#same(g,c))this.#show(observed);return;}
   if(!this.#same(g,c))return;const pending=await this.options.store.load(b,this.options.draftId);if(!this.#same(g,c))return;this.#state={status:'pending',entry:pending};
   let result:ApiResult<unknown>;try{result=await this.options.send(intent.operation,{body:JSON.parse(intent.bodyJson)},{idempotencyKey:intent.key});}catch{result={ok:false,status:null,error:{code:'NETWORK_ERROR',message:'Request outcome unknown',retryable:false},requestId:null};}
   if(!this.#same(g,c))return;
   const classification=classifyWriteResult(result);let status:'confirmed'|'rejected'|'uncertain'=classification==='succeeded'?'confirmed':classification==='uncertain'?'uncertain':'rejected';let entityId:string|null=null;
   if(result.ok){const data=result.data as Record<string,unknown>|null;if(!data||typeof data!=='object'||typeof data.id!=='string'||data.workspace_id!==c.workspaceId)status='uncertain';else entityId=data.id;}
   await this.options.store.settle(b,this.options.draftId,intent.key,status,entityId);if(!this.#same(g,c))return;const observed=await this.options.store.load(b,this.options.draftId);if(this.#same(g,c))this.#show(observed);
  }catch{if(this.#same(g,c))this.#state={...this.#state,status:'storage-error'};}
 }
 async discard():Promise<void>{const b=this.#binding,c=this.#context,g=this.#generation;if(!b||!c||!this.#same(g,c))return;try{await this.options.store.discard(b,this.options.draftId);const entry=await this.options.store.load(b,this.options.draftId);if(this.#same(g,c))this.#show(entry);}catch{if(this.#same(g,c))this.#state={...this.#state,status:'storage-error'};}}
 async reviewPrepared():Promise<void>{const b=this.#binding,c=this.#context,g=this.#generation;if(!b||!c||!this.#same(g,c)||this.#flight)return;try{const entry=await this.options.store.load(b,this.options.draftId);if(!this.#same(g,c)||!entry?.intent)return;await this.options.store.abandonPrepared(b,this.options.draftId,entry.intent.key);const observed=await this.options.store.load(b,this.options.draftId);if(this.#same(g,c))this.#show(observed);}catch{if(this.#same(g,c))this.#state={...this.#state,status:'reconciliation-required'};}}
 async acknowledge():Promise<void>{const b=this.#binding,c=this.#context,g=this.#generation;if(!b||!c||!this.#same(g,c)||this.#flight)return;try{await this.options.store.acknowledge(b,this.options.draftId);const entry=await this.options.store.load(b,this.options.draftId);if(this.#same(g,c))this.#show(entry);}catch{if(this.#same(g,c))this.#state={...this.#state,status:'reconciliation-required'};}}
 invalidate():void{++this.#generation;this.#binding=null;this.#context=null;this.#state={status:'inactive',entry:null};}
 /** Local erase cannot cancel a server write already dispatched. */
 async logout():Promise<void>{const b=this.#binding;this.invalidate();const g=this.#generation;if(b)try{await this.options.store.clearScope(b);}catch{if(g===this.#generation)this.#state={status:'storage-error',entry:null};}}
}
