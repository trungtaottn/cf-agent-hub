import type {ApiResult,ProfileWriteRequest,PreferencesWriteRequest} from '../../packages/client/src/types';
export type WriteOperation='previewProfile'|'putProfile'|'putPreferences';
export type WriteInput=ProfileWriteRequest|PreferencesWriteRequest;
export type WriteTransport<T=unknown>=(operation:WriteOperation,input:WriteInput,options:{idempotencyKey:string})=>Promise<ApiResult<T>>;
export interface WriteIntent{operation:WriteOperation;input:WriteInput;key:string;serializedBody:string;}
export interface WriteState<T>{status:'idle'|'pending'|'uncertain'|'conflict'|'rejected'|'succeeded';intent:WriteIntent|null;result:ApiResult<T>|null;}
/** Shared response classification only; durability/replay permission remain with each owner. */
export function classifyWriteResult(result:ApiResult<unknown>):'succeeded'|'rejected'|'conflict'|'uncertain'{
 const knownPreflight=!result.ok&&result.status===null&&['INVALID_REQUEST','CSRF_REQUIRED','OPERATION_UNAVAILABLE'].includes(result.error.code);
 return result.ok?'succeeded':knownPreflight?'rejected':result.error.code==='VERSION_CONFLICT'?'conflict':result.status===null||result.error.code==='INVALID_RESPONSE'||result.status>=500?'uncertain':'rejected';
}
/** A deliberate intent owns one immutable key/body until its outcome is known. */
export class IntentWriter<T=unknown>{
 #generation=0;#state:WriteState<T>={status:'idle',intent:null,result:null};
 constructor(private readonly transport:WriteTransport<T>){}
 get state():Readonly<WriteState<T>>{return this.#state;}
 async begin(operation:WriteOperation,input:WriteInput,key:string):Promise<ApiResult<T>|null>{
  if(this.#state.status==='pending'||this.#state.status==='uncertain')throw Error('Reconcile the original write before changing intent');
  if(this.#state.status==='conflict')throw Error('Review the current revision before changing intent');
  const serializedBody=JSON.stringify(input),snapshot=JSON.parse(serializedBody) as WriteInput;
  this.#state={status:'pending',intent:{operation,input:snapshot,key,serializedBody},result:null};
  return this.#send();
 }
 async replay():Promise<ApiResult<T>|null>{
  if(this.#state.status!=='uncertain'||!this.#state.intent)throw Error('No uncertain write to reconcile');
  this.#state={...this.#state,status:'pending'};return this.#send();
 }
 async #send():Promise<ApiResult<T>|null>{
  const generation=++this.#generation,intent=this.#state.intent!;
  // Reconstruct from frozen bytes so even a transport cannot mutate the retained intent.
  let result:ApiResult<T>;
  try{result=await this.transport(intent.operation,JSON.parse(intent.serializedBody) as WriteInput,{idempotencyKey:intent.key});}
  catch{result={ok:false,status:null,error:{code:'NETWORK_ERROR',message:'Network request failed',retryable:true},requestId:null};}
  if(generation!==this.#generation)return null;
  const status=classifyWriteResult(result);
  this.#state={status,intent:result.ok?null:intent,result};return result;
 }
 reviewed():void{if(this.#state.status==='pending'||this.#state.status==='uncertain')throw Error('Reconcile the original write first');this.invalidate();}
 invalidate():void{++this.#generation;this.#state={status:'idle',intent:null,result:null};}
}
