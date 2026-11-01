import {HttpError} from '../http/envelopes';
/** Separate per-object diagnostic lane. No domain heartbeat or DO-wide I/O lock. */
export class ObservationWorkPool{
 #active=0;
 acquire():ObservationWork{
  if(this.#active>=4)throw new HttpError('RATE_LIMITED',429);
  this.#active++;return new ObservationWork(()=>{this.#active--;});
 }
}
const pools=new WeakMap<DurableObjectStorage,ObservationWorkPool>();
export function observationWorkPool(storage:DurableObjectStorage):ObservationWorkPool{let pool=pools.get(storage);if(!pool){pool=new ObservationWorkPool();pools.set(storage,pool);}return pool;}
export class ObservationWork{
 readonly #deadline=Date.now()+5000;readonly #abort=new AbortController();readonly #timer:ReturnType<typeof setTimeout>;
 #pendingCrypto=0;#finished=false;#released=false;
 constructor(readonly release:()=>void){this.#timer=setTimeout(()=>this.#abort.abort(),5000);}
 check():void{if(this.#finished||this.#abort.signal.aborted||Date.now()>=this.#deadline)throw new HttpError('DEPENDENCY_UNAVAILABLE',503);}
 async wait<T>(promise:Promise<T>,cryptoWork=false):Promise<T>{
  this.check();if(cryptoWork)this.#pendingCrypto++;
  const tracked=promise.finally(()=>{if(cryptoWork){this.#pendingCrypto--;this.#maybeRelease();}});
  let listener:()=>void=()=>{};
  const timeout=new Promise<never>((_resolve,reject)=>{listener=()=>reject(new HttpError('DEPENDENCY_UNAVAILABLE',503));this.#abort.signal.addEventListener('abort',listener,{once:true});});
  try{const value=await Promise.race([tracked,timeout]);this.check();return value;}finally{this.#abort.signal.removeEventListener('abort',listener);}
 }
 cancel():void{this.#abort.abort();}
 finish():void{this.#finished=true;clearTimeout(this.#timer);this.#maybeRelease();}
 #maybeRelease():void{if(this.#finished&&!this.#released&&this.#pendingCrypto===0){this.#released=true;this.release();}}
}
