import {describe, expect, it} from 'vitest';
import type {ApiResult} from '../../packages/client/src/types';
import {ReadModel, summarizeReadStates} from '../../src/ui/read-state';

const firstObserved = '2026-10-25T04:00:00.000Z';
const secondObserved = '2026-10-25T04:05:00.000Z';
const ready = <T>(data:T, requestId='request-1'):ApiResult<T> => ({ok:true,status:200,data,requestId});
const failure = (status:number|null, code:string, requestId:string|null='request-error'):ApiResult<never> => ({
  ok:false,status,error:{code,message:'Read failed',retryable:status===null||status===503},requestId
});
function deferred<T>() {
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
function model(now=()=>Date.parse(firstObserved)) {
  return new ReadModel<string[]>({isEmpty:data=>data.length===0,now});
}

describe('truthful independent read states',()=>{
  it('has no fabricated records or observed timestamp before an actual read',()=>{
    const read=model();
    expect(read.state.status).toBe('loading');
    expect(read.state.data).toBeNull();
    expect(read.state.observedAt).toBeNull();
    expect(read.state.requestId).toBeNull();
  });

  it('shows empty only after a successful empty response',async()=>{
    const read=model();
    await read.refresh(async()=>ready([]));
    expect(read.state).toMatchObject({status:'empty',data:[],observedAt:firstObserved,requestId:'request-1',errorCode:null});
  });

  it('does not turn a failed first read into zero or empty data',async()=>{
    const read=model();
    await read.refresh(async()=>failure(503,'DEPENDENCY_UNAVAILABLE'));
    expect(read.state).toMatchObject({status:'error',data:null,observedAt:null,requestId:'request-error',errorCode:'DEPENDENCY_UNAVAILABLE'});
  });

  it('preserves the original observation time when a cached read fails',async()=>{
    let now=Date.parse(firstObserved);
    const read=model(()=>now);
    await read.refresh(async()=>ready(['persisted message']));
    now=Date.parse(secondObserved);
    await read.refresh(async()=>failure(503,'DEPENDENCY_UNAVAILABLE','failed-refresh'));
    expect(read.state).toMatchObject({status:'stale',data:['persisted message'],observedAt:firstObserved,requestId:'failed-refresh',errorCode:'DEPENDENCY_UNAVAILABLE'});
  });

  it('marks cached data stale while a new request is pending',async()=>{
    const read=model();
    await read.refresh(async()=>ready(['persisted message']));
    const next=deferred<ApiResult<string[]>>();
    const running=read.refresh(()=>next.promise);
    expect(read.state).toMatchObject({status:'stale',data:['persisted message'],observedAt:firstObserved});
    next.resolve(ready(['new message'],'new-request'));
    await running;
    expect(read.state).toMatchObject({status:'ready',data:['new message'],requestId:'new-request'});
  });

  it('distinguishes no-connection from a successful empty result',async()=>{
    const read=model();
    await read.refresh(async()=>failure(null,'NETWORK_ERROR',null));
    expect(read.state).toMatchObject({status:'disconnected',data:null,observedAt:null,errorCode:'NETWORK_ERROR'});
  });

  it('retains cached records as stale after connection loss',async()=>{
    const read=model();
    await read.refresh(async()=>ready(['persisted message']));
    read.disconnect();
    expect(read.state).toMatchObject({status:'stale',data:['persisted message'],observedAt:firstObserved,errorCode:'NETWORK_ERROR'});
  });

  it.each([401,403])('clears sensitive cached data on HTTP %s even with a malformed error envelope',async(status)=>{
    const read=model();
    await read.refresh(async()=>ready(['sensitive message']));
    await read.refresh(async()=>failure(status,'INVALID_RESPONSE'));
    expect(read.state).toMatchObject({
      status:'forbidden',data:null,observedAt:null,requestId:'request-error',
      errorCode:status===401?'UNAUTHENTICATED':'FORBIDDEN'
    });
  });

  it('cannot repopulate sensitive data from a response pending before revocation',async()=>{
    const read=model();
    await read.refresh(async()=>ready(['sensitive message']));
    const next=deferred<ApiResult<string[]>>();
    const running=read.refresh(()=>next.promise);
    read.invalidate('UNAUTHENTICATED','revoked-request');
    next.resolve(ready(['late sensitive message'],'late-request'));
    await running;
    expect(read.state).toMatchObject({status:'forbidden',data:null,observedAt:null,requestId:'revoked-request',errorCode:'UNAUTHENTICATED'});
  });

  it('does not let an older response overwrite a newer successful read',async()=>{
    const read=model();
    const older=deferred<ApiResult<string[]>>();
    const running=read.refresh(()=>older.promise);
    await read.refresh(async()=>ready(['newest message'],'newest-request'));
    older.resolve(ready(['older message'],'older-request'));
    await running;
    expect(read.state).toMatchObject({status:'ready',data:['newest message'],requestId:'newest-request'});
  });

  it('publishes pagination metadata only with the accepted read generation',async()=>{
    const read=model(),older=deferred<ApiResult<string[]>>(),accepted:string[]=[];
    const running=read.refresh(()=>older.promise,result=>accepted.push(result.requestId!));
    await read.refresh(async()=>ready(['newest message'],'newest-request'),result=>accepted.push(result.requestId!));
    older.resolve(ready(['older message'],'older-request'));await running;
    expect(read.state.data).toEqual(['newest message']);expect(accepted).toEqual(['newest-request']);
  });

  it('resource reset clears the previous cache and discards its pending metadata',async()=>{
    const read=model(),older=deferred<ApiResult<string[]>>(),accepted:string[]=[];
    await read.refresh(async()=>ready(['resource A']));
    const running=read.refresh(()=>older.promise,result=>accepted.push(result.requestId!));
    read.reset();expect(read.state).toEqual({status:'loading',data:null,observedAt:null,requestId:null,errorCode:null});
    await read.refresh(async()=>failure(503,'DEPENDENCY_UNAVAILABLE','resource-B-error'));
    older.resolve(ready(['late resource A'],'late-A'));await running;
    expect(read.state).toMatchObject({status:'error',data:null,requestId:'resource-B-error'});expect(accepted).toEqual([]);
  });

  it('offline invalidation also prevents late pagination metadata publication',async()=>{
    const read=model(),next=deferred<ApiResult<string[]>>(),accepted:string[]=[];
    const running=read.refresh(()=>next.promise,result=>accepted.push(result.requestId!));
    read.disconnect();next.resolve(ready(['late message']));await running;
    expect(accepted).toEqual([]);expect(read.state.data).toBeNull();
  });

  it('does not restore an in-flight response after the connection is explicitly lost',async()=>{
    const read=model();
    const next=deferred<ApiResult<string[]>>();
    const running=read.refresh(()=>next.promise);
    read.disconnect();
    next.resolve(ready(['late message']));
    await running;
    expect(read.state).toMatchObject({status:'disconnected',data:null,observedAt:null});
  });

  it('ages both populated and empty successful observations without inventing a new time',async()=>{
    for(const records of [[],['message']]) {
      const read=model();
      await read.refresh(async()=>ready(records));
      read.markStale(Date.parse(firstObserved)+59_999,60_000);
      expect(read.state.status).toBe(records.length?'ready':'empty');
      read.markStale(Date.parse(firstObserved)+60_000,60_000);
      expect(read.state).toMatchObject({status:'stale',data:records,observedAt:firstObserved,errorCode:null});
    }
  });

  it('does not classify a mixed successful and failed dashboard as fully ready or empty',async()=>{
    const activity=model(), operations=model();
    await activity.refresh(async()=>ready(['message']));
    await operations.refresh(async()=>failure(503,'DEPENDENCY_UNAVAILABLE'));
    expect(summarizeReadStates([activity.state,operations.state])).toBe('partial');
    expect(activity.state).toMatchObject({status:'ready',data:['message']});
    expect(operations.state).toMatchObject({status:'error',data:null});
  });

  it('summarizes real empty sections separately from mixed populated sections',async()=>{
    const one=model(),two=model();
    await one.refresh(async()=>ready([]));
    await two.refresh(async()=>ready([]));
    expect(summarizeReadStates([one.state,two.state])).toBe('empty');
    await two.refresh(async()=>ready(['message']));
    expect(summarizeReadStates([one.state,two.state])).toBe('ready');
    expect(summarizeReadStates([])).toBe('loading');
  });

  it.each(['REQUEST_ABORTED','INVALID_REQUEST'])('does not label %s as a disconnected network',async(code)=>{
    const read=model();
    await read.refresh(async()=>failure(null,code,null));
    expect(read.state).toMatchObject({status:'error',data:null,observedAt:null,errorCode:code});
  });

  it('recovers from a failed read only after a new successful observation',async()=>{
    let now=Date.parse(firstObserved);
    const read=model(()=>now);
    await read.refresh(async()=>failure(503,'DEPENDENCY_UNAVAILABLE'));
    now=Date.parse(secondObserved);
    await read.refresh(async()=>ready(['recovered message'],'recovered-request'));
    expect(read.state).toMatchObject({status:'ready',data:['recovered message'],observedAt:secondObserved,requestId:'recovered-request',errorCode:null});
  });

  it('reports unexpected read failures without claiming the network is disconnected or exposing exception text',async()=>{
    const read=model();
    await read.refresh(async()=>{throw new Error('sensitive internal address');});
    expect(read.state).toMatchObject({status:'error',data:null,errorCode:'READ_ERROR'});
    expect(JSON.stringify(read.state)).not.toContain('sensitive');
  });
});

it('clears cached resource on not-found and rejects an older pending observation',async()=>{
 const read=model();await read.refresh(async()=>ready(['private title']));
 const late=deferred<ApiResult<string[]>>(),pending=read.refresh(()=>late.promise);
 await read.refresh(async()=>failure(404,'NOT_FOUND'));
 expect(read.state).toMatchObject({status:'unavailable',data:null,observedAt:null,errorCode:'NOT_FOUND'});
 late.resolve(ready(['private title']));await pending;expect(read.state.data).toBeNull();
});
it('redacts a revoked record without hiding unrelated cached success and invalidates old page',async()=>{
 const read=model();await read.refresh(async()=>ready(['revoked','allowed']));
 const late=deferred<ApiResult<string[]>>(),pending=read.refresh(()=>late.promise);
 read.redact(items=>items.filter(item=>item!=='revoked'));
 expect(read.state).toMatchObject({status:'stale',data:['allowed'],observedAt:firstObserved});
 late.resolve(ready(['revoked','allowed']));await pending;expect(read.state.data).toEqual(['allowed']);
});
it('explicit unavailable differs from empty and resets pending data',async()=>{
 const read=model();const late=deferred<ApiResult<string[]>>(),pending=read.refresh(()=>late.promise);
 read.unavailable('CAPABILITY_UNAVAILABLE');late.resolve(ready(['hidden']));await pending;
 expect(read.state).toMatchObject({status:'unavailable',data:null,errorCode:'CAPABILITY_UNAVAILABLE'});
});
it('uncached redaction cancels the observation without leaving a phantom loading state',async()=>{
 const read=model(),late=deferred<ApiResult<string[]>>(),pending=read.refresh(()=>late.promise);read.redact(items=>items);
 expect(read.state).toMatchObject({status:'unavailable',data:null,errorCode:'OBSERVATION_INVALIDATED'});
 late.resolve(ready(['old']));await pending;expect(read.state.data).toBeNull();
});
