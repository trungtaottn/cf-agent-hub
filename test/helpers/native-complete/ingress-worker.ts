/** Test-only subclass. Calls actual superclass fetch/native readers; no core mock. */
import {CompleteFixtureService} from '../../../workers/native-fixture/complete-service';
export {RequiredFixtureController,WorkspaceDO} from '../../../workers/native-fixture/complete-service';
function gate(){let resolve!:()=>void,reject!:(error:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
export class IngressFixtureService extends CompleteFixtureService{
 async claimPresent(){return (await this.ctx.storage.get('complete-service-run-claim'))!==undefined;}
 async preflightAttempt(mode:string){
  if(!['valid','wrong-signature'].includes(mode))throw Error('TEST_MODE_REJECTED');
  const env=this.env as unknown as Record<string,string>,pre=JSON.parse(env.TEST_PREFLIGHT),before=await this.claimPresent();
  if(mode==='wrong-signature'){const k='x-native-client-signature',old=pre.options.headers[k];pre.options.headers[k]=(old[0]==='A'?'B':'A')+old.slice(1);}
  const response=await super.fetch(new Request(pre.url,pre.options));return {before,status:response.status,after:await this.claimPresent()};
 }

 async scenario(mode:string){
  if(!['concurrent','delayed-cancel','failed-cancel','timeout'].includes(mode))throw Error('TEST_MODE_REJECTED');
  const env=this.env as unknown as Record<string,string>,pre=JSON.parse(env.TEST_PREFLIGHT),close=JSON.parse(env.TEST_CLOSE),preflight=await super.fetch(new Request(pre.url,pre.options));
  if(preflight.status!==200)return {preflight:preflight.status};
  const preflightReady=(await preflight.json() as any).data?.status==='ready';
  const claim=(await this.ctx.storage.get('complete-service-run-claim'))!==undefined;
  const bodyGate=gate(),cancelGate=gate(),cancelStarted=gate(),readStarted=gate(),cancelSettled=gate(),pullSettled=gate();
  const stats={firstReaders:0,firstReads:0,firstCancels:0,firstCancelResolved:0,firstCancelRejected:0,firstReleases:0,firstReleaseFailures:0,secondReaders:0,secondCancels:0,finalReaders:0,latePullSettled:false};
  const watch=(request:Request,role:'first'|'second'|'final')=>{
   const body=request.body!,acquire=body.getReader.bind(body);
   Object.defineProperty(body,'getReader',{value(){
    if(role==='first')stats.firstReaders++;else if(role==='second')stats.secondReaders++;else stats.finalReaders++;
    const reader=acquire(),read=reader.read.bind(reader),cancel=reader.cancel.bind(reader),release=reader.releaseLock.bind(reader);
    Object.defineProperties(reader,{
     read:{value(){if(role==='first'){stats.firstReads++;readStarted.resolve();}return read();}},
     cancel:{value(reason:unknown){
      if(role==='first')stats.firstCancels++;else if(role==='second')stats.secondCancels++;
      const actual=cancel(reason);
      if(role==='first')void actual.then(()=>{stats.firstCancelResolved++;cancelSettled.resolve();},()=>{stats.firstCancelRejected++;cancelSettled.resolve();});
      return actual;
     }},
     releaseLock:{value(){try{release();if(role==='first')stats.firstReleases++;}catch(error){if(role==='first')stats.firstReleaseFailures++;throw error;}}}
    });return reader;
   }});return request;
  };
  const abort=new AbortController();
  const stream=new ReadableStream<Uint8Array>({async pull(controller){await bodyGate.promise;try{if(mode==='concurrent'){controller.enqueue(new TextEncoder().encode(close.options.body));controller.close();}}finally{stats.latePullSettled=true;pullSettled.resolve();}},cancel(){cancelStarted.resolve();return cancelGate.promise;}});
  const first=super.fetch(watch(new Request(close.url,{method:'POST',headers:close.options.headers,body:stream,signal:abort.signal}),'first'));
  await readStarted.promise;
  if(mode==='concurrent'){
   const second=await super.fetch(watch(new Request(close.url,close.options),'second'));const before={firstCancels:stats.firstCancels,secondReaders:stats.secondReaders,secondCancels:stats.secondCancels};bodyGate.resolve();const accepted=await first;await pullSettled.promise;
   return {preflight:preflight.status,preflightReady,claim,first:accepted.status,closed:accepted.status===200&&(await accepted.json() as any).data?.status==='closed',second:second.status,before,...stats};
  }
  if(mode!=='timeout')abort.abort();
  const rejected=await first;await cancelStarted.promise;
  const second=await super.fetch(watch(new Request(close.url,close.options),'second'));const before={cancelResolved:stats.firstCancelResolved,cancelRejected:stats.firstCancelRejected,secondReaders:stats.secondReaders,secondCancels:stats.secondCancels};
  if(mode==='failed-cancel')cancelGate.reject(Error('TEST_CANCEL_FAILED'));else cancelGate.resolve();
  await cancelSettled.promise;await Promise.resolve();await Promise.resolve();bodyGate.resolve();await pullSettled.promise;
  const final=await super.fetch(watch(new Request(close.url,close.options),'final'));
  return {preflight:preflight.status,preflightReady,claim,first:rejected.status,second:second.status,final:final.status,closed:final.status===200&&(await final.json() as any).data?.status==='closed',before,...stats};
 }
}
export default {async fetch(request:Request,env:any){const mode=new URL(request.url).pathname.slice(1),stub=env.COMPLETE_SERVICE.getByName('complete-fixture-service');if(mode==='claim')return Response.json(await stub.claimPresent());if(mode==='attempt-valid'||mode==='attempt-wrong-signature')return Response.json(await stub.preflightAttempt(mode.slice(8)));return Response.json(await stub.scenario(mode));}};
