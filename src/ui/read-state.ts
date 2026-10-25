import type {ApiResult} from '../../packages/client/src/types';

export type ReadStatus='loading'|'ready'|'empty'|'stale'|'forbidden'|'error'|'disconnected';
export interface ReadState<T> {
  status:ReadStatus;
  data:T|null;
  observedAt:string|null;
  requestId:string|null;
  errorCode:string|null;
}

/** One authorized projection. The dashboard keeps one model per independent section. */
export class ReadModel<T> {
  #state:ReadState<T>={status:'loading',data:null,observedAt:null,requestId:null,errorCode:null};
  #generation=0;
  readonly #isEmpty:(data:T)=>boolean;
  readonly #now:()=>number;

  constructor(options:{isEmpty:(data:T)=>boolean;now?:()=>number}) {
    this.#isEmpty=options.isEmpty;
    this.#now=options.now??Date.now;
  }

  get state():Readonly<ReadState<T>> {return this.#state;}

  /** A new observation replaces only the request generation that started it. */
  async refresh(read:()=>Promise<ApiResult<T>>,onAccepted?:(result:Extract<ApiResult<T>,{ok:true}>)=>void):Promise<Readonly<ReadState<T>>> {
    const generation=++this.#generation;
    const previous=this.#state;
    const cached=previous.data!==null&&previous.observedAt!==null;
    this.#state={...previous,status:cached?'stale':'loading',errorCode:null};

    let result:ApiResult<T>;
    try {
      result=await read();
    } catch {
      result={ok:false,status:null,error:{code:'READ_ERROR',message:'Read failed',retryable:false},requestId:null};
    }
    if(generation!==this.#generation)return this.#state;

    if(result.ok) {
      this.#state={
        status:this.#isEmpty(result.data)?'empty':'ready',
        data:result.data,
        observedAt:new Date(this.#now()).toISOString(),
        requestId:result.requestId,
        errorCode:null
      };
      // Related presentation metadata (for example the page cursor) must be
      // published under the same request generation as the visible data.
      onAccepted?.(result);
    } else if(result.status===401||result.status===403) {
      // HTTP authority wins even when an intermediary returned an invalid error body.
      this.invalidate(result.status===401?'UNAUTHENTICATED':'FORBIDDEN',result.requestId);
    } else {
      this.#state={
        status:cached?'stale':result.error.code==='NETWORK_ERROR'?'disconnected':'error',
        data:cached?previous.data:null,
        observedAt:cached?previous.observedAt:null,
        requestId:result.requestId,
        errorCode:result.error.code
      };
    }
    return this.#state;
  }

  /** A different resource cannot inherit this resource's cache or pending read. */
  reset():void {
    ++this.#generation;
    this.#state={status:'loading',data:null,observedAt:null,requestId:null,errorCode:null};
  }

  /** Also invalidates pending responses when a shared session is revoked or logged out. */
  invalidate(reason:'UNAUTHENTICATED'|'FORBIDDEN',requestId:string|null=null):void {
    ++this.#generation;
    this.#state={status:'forbidden',data:null,observedAt:null,requestId,errorCode:reason};
  }

  disconnect():void {
    ++this.#generation;
    const cached=this.#state.data!==null&&this.#state.observedAt!==null;
    this.#state={
      ...this.#state,
      status:cached?'stale':'disconnected',
      requestId:null,
      errorCode:'NETWORK_ERROR'
    };
  }

  /** The caller owns the freshness policy; retain the actual observation timestamp. */
  markStale(nowMs:number,maxAgeMs:number):void {
    if((this.#state.status==='ready'||this.#state.status==='empty')&&this.#state.observedAt!==null&&
      nowMs-Date.parse(this.#state.observedAt)>=maxAgeMs) {
      this.#state={...this.#state,status:'stale'};
    }
  }
}

/** A partial page never upgrades a failed section to a successful empty read. */
export function summarizeReadStates(states:readonly ReadState<unknown>[]):ReadStatus|'partial' {
  if(states.length===0)return 'loading';
  const first=states[0]!.status;
  if(states.every(state=>state.status===first))return first;
  if(states.every(state=>state.status==='ready'||state.status==='empty'))return 'ready';
  return 'partial';
}
