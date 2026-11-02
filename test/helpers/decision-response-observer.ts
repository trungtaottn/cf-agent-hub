/** Test-init-script only. Never imported by a production entry or worker. */
export interface DecisionBodyReceipt {path:string;method:'POST';bodySha256:string;keySha256:string;status:number;text:string;}
export interface DecisionResponseObserver {arm(path:string):void;take():Promise<DecisionBodyReceipt>;verify():void;dispose():void;}
export interface DecisionObserverHost {fetch:typeof fetch;crypto:Pick<Crypto,'subtle'>;location:{origin:string};__decisionResponseObserver?:DecisionResponseObserver;}
/** Self-contained so Playwright serializes the exact implementation before app construction. */
export function installDecisionResponseObserver(host:DecisionObserverHost):void;
export function installDecisionResponseObserver():void;
export function installDecisionResponseObserver(host:DecisionObserverHost=globalThis):void{
 const origin='https://hub.fixture.example.invalid';if(host.location.origin!==origin)return;
 const original=host.fetch.bind(host);let generation=0,inFlight=0;
 type Capture={generation:number;path:string;matched:number;error:Error|null;complete:boolean;reader:ReadableStreamDefaultReader<Uint8Array>|null;timer:ReturnType<typeof setTimeout>;promise:Promise<DecisionBodyReceipt>;resolve:(value:DecisionBodyReceipt)=>void;reject:(error:Error)=>void;};
 let active:Capture|null=null;
 const current=(c:Capture)=>active===c&&generation===c.generation&&!c.error;
 function fail(c:Capture,code:string){if(!current(c))return;c.error=Error(code);clearTimeout(c.timer);void c.reader?.cancel().catch(()=>{});c.reject(c.error);}
 const check=(c:Capture)=>{if(!current(c))throw Error('DECISION_OBSERVER_STALE');};
 host.__decisionResponseObserver={
  arm(path){if(active||inFlight)throw Error('DECISION_OBSERVER_BUSY');if(!/^\/v2\/workspaces\/ws_example\/approvals\/[A-Za-z0-9_-]{1,128}:(approve|reject)$/.test(path))throw Error('DECISION_OBSERVER_PATH');
   let resolve!:(value:DecisionBodyReceipt)=>void,reject!:(error:Error)=>void;const promise=new Promise<DecisionBodyReceipt>((yes,no)=>{resolve=yes;reject=no;});void promise.catch(()=>{});
   const c:Capture={generation:++generation,path,matched:0,error:null,complete:false,reader:null,timer:setTimeout(()=>{fail(c,'DECISION_OBSERVER_TIMEOUT');},30000),promise,resolve,reject};active=c;
  },
  async take(){const c=active;if(!c)throw Error('DECISION_OBSERVER_NOT_ARMED');const receipt=await c.promise;check(c);return receipt;},
  verify(){const c=active;if(!c||!current(c)||!c.complete||c.matched!==1)throw Error('DECISION_OBSERVER_INCOMPLETE');},
  dispose(){const c=active;if(c){fail(c,'DECISION_OBSERVER_DISPOSED');clearTimeout(c.timer);}active=null;++generation;}
 };
 host.fetch=function(input,init){
  const c=active;let captured=false,body='',key='',shape=true;
  if(c&&current(c)){
   try{const url=new URL(input instanceof Request?input.url:String(input),origin),method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(url.origin===origin&&url.pathname===c.path&&!url.search&&method==='POST'){
     ++c.matched;if(c.matched!==1)fail(c,'DECISION_OBSERVER_DUPLICATE');else{
      captured=true;++inFlight;shape=!(input instanceof Request)&&typeof init?.body==='string';
      if(shape){body=init!.body as string;key=new Headers(init?.headers).get('idempotency-key')??'';shape=key.length>0&&new TextEncoder().encode(body).length<=65536;}
      if(!shape)fail(c,'DECISION_OBSERVER_REQUEST_SHAPE');
     }
    }
   }catch{fail(c,'DECISION_OBSERVER_REQUEST_SHAPE');}
  }
  // Return the original promise exactly; all observation errors stay off its path.
  let pending:Promise<Response>;try{pending=original(input,init);}catch(error){if(c&&captured){--inFlight;fail(c,'DECISION_OBSERVER_FETCH_FAILED');}throw error;}
  if(c&&captured){
   const work=pending.then(async response=>{
    if(!current(c)||!shape)return;
    // Clone BEFORE hashing/awaiting: app receives the untouched original immediately.
    const clone=response.clone(),reader=clone.body?.getReader();if(!reader)throw Error('DECISION_OBSERVER_BODY');c.reader=reader;
    const chunks:Uint8Array[]=[];let bytes:Uint8Array<ArrayBuffer>|null=null,requestBytes:Uint8Array<ArrayBuffer>|null=null,keyBytes:Uint8Array<ArrayBuffer>|null=null;
    try{
     if(clone.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw Error('DECISION_OBSERVER_MEDIA');
     const length=clone.headers.get('content-length'),encoding=clone.headers.get('content-encoding');
     if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||!Number.isSafeInteger(Number(length))))throw Error('DECISION_OBSERVER_LENGTH');
     let count=0;for(;;){const part=await reader.read();check(c);if(part.done)break;if(!(part.value instanceof Uint8Array)||part.value.length===0||count+part.value.length>1048576)throw Error('DECISION_OBSERVER_LIMIT');count+=part.value.length;chunks.push(part.value.slice());}
     if(length!==null&&(!encoding||encoding.toLowerCase()==='identity')&&Number(length)!==count)throw Error('DECISION_OBSERVER_LENGTH');
     bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
     const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);requestBytes=new TextEncoder().encode(body);keyBytes=new TextEncoder().encode(key);body='';key='';
     const hex=(value:ArrayBuffer)=>[...new Uint8Array(value)].map(x=>x.toString(16).padStart(2,'0')).join('');
     const bodySha256=hex(await host.crypto.subtle.digest('SHA-256',requestBytes));check(c);const keySha256=hex(await host.crypto.subtle.digest('SHA-256',keyBytes));check(c);
     c.complete=true;clearTimeout(c.timer);c.resolve({path:c.path,method:'POST',bodySha256,keySha256,status:response.status,text});
    }finally{body='';key='';for(const chunk of chunks)chunk.fill(0);bytes?.fill(0);requestBytes?.fill(0);keyBytes?.fill(0);void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}if(c.reader===reader)c.reader=null;}
   });
   void work.catch(()=>{fail(c,'DECISION_OBSERVER_CAPTURE_FAILED');}).finally(()=>{body='';key='';--inFlight;});
  }
  return pending;
 };
}
