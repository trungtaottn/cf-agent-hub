/** Fixed HTTPS sender. Authentication is an already installed local lookup, never OAuth or request configuration. */
import {request as httpsRequest} from 'node:https';
import {createHash} from 'node:crypto';
import {validateFixturePolicy,validateFixtureRequest,fixtureReservation,fixturePolicyDigest,FIXTURE_RESPONSE_LIMITS} from './native-fixture-protocol.mjs';
import {createFixtureSession} from './native-fixture-session.mjs';
import {readFixtureJson,cancelFixtureBody} from './native-fixture-io.mjs';
const rejected=()=>Error('FIXTURE_HTTPS_REJECTED');
const check=v=>{if(!v)throw rejected();};
function credential(value,policy){check(value&&Object.getPrototypeOf(value)===Object.prototype);const d=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(d).length===2&&['token','expires_at'].every(k=>d[k]?.enumerable&&Object.hasOwn(d[k],'value')));const token=d.token.value,expires=d.expires_at.value;check(typeof token==='string'&&token.length>0&&token.length<=2048&&/^[A-Za-z0-9._~+\/-]+=*$/.test(token)&&Number.isSafeInteger(expires)&&expires>Date.now()&&expires<=policy.expires_at);return {token,expires_at:expires};}
function headerBytes(raw){check(Array.isArray(raw)&&raw.length%2===0&&raw.length<=64);let total=2;for(let i=0;i<raw.length;i+=2){check(typeof raw[i]==='string'&&typeof raw[i+1]==='string'&&raw[i].length<=8192&&raw[i+1].length<=8192&&!/[\r\n]/.test(raw[i]+raw[i+1]));total+=Buffer.byteLength(raw[i])+Buffer.byteLength(raw[i+1])+4;check(total<=8192);}return total;}
export function createFixtureHttpsTransport(options){return createFixtureHttpsTransportCore(options,httpsRequest);}
/** Explicit source-test dependency seam; never loaded from a configuration/module path. Both factories enforce admission. */
export function createFixtureHttpsTransportCore(configuration,requestImplementation){
 check(configuration&&Object.getPrototypeOf(configuration)===Object.prototype);const descriptors=Object.getOwnPropertyDescriptors(configuration);check(Reflect.ownKeys(descriptors).length===2&&['policy','readAuthentication'].every(k=>descriptors[k]?.enumerable&&Object.hasOwn(descriptors[k],'value')));const input=descriptors.policy.value,readAuthentication=descriptors.readAuthentication.value;
 const policy=validateFixturePolicy(input,Date.now()),session=createFixtureSession(policy),reservation=fixtureReservation(policy);
 check(typeof readAuthentication==='function'&&typeof requestImplementation==='function'&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0');
 const transportReservation=Object.freeze({version:1,request_header_bytes:8192*reservation.calls,response_header_bytes:8192*reservation.calls,request_bytes:reservation.request_bytes+8192*reservation.calls,response_bytes:reservation.response_bytes+8192*reservation.calls});
 check(transportReservation.request_bytes<=786432&&transportReservation.response_bytes<=4718592);
 let requestBytes=0,responseBytes=0;
 function send(message){let outcome;try{outcome=session.execute(message?.signal,async(signal,admit,healthy)=>{
  check(message instanceof Request&&message.url===policy.origin+'/native-fixture/v1'&&message.method==='POST'&&message.headers.get('content-type')==='application/json'&&message.redirect==='error');
  check([...message.headers.keys()].every(k=>k==='content-type'));
  const parsed=validateFixtureRequest(await readFixtureJson(message,4096,signal,session.track),policy);admit(parsed);healthy();
  const body=JSON.stringify(parsed);check(Buffer.byteLength(body)<=4096);
  const context=Object.freeze({policy_sha256:fixturePolicyDigest(policy),request_sha256:createHash('sha256').update(body).digest('hex'),request:parsed,signal});
  const auth=credential(await readAuthentication(context),policy);healthy();
  const headers={'content-type':'application/json',accept:'application/json',authorization:'Bearer '+auth.token,'content-length':String(Buffer.byteLength(body)),connection:'close',host:new URL(policy.origin).host};
  const outgoing=Buffer.byteLength(body)+headerBytes(Object.entries(headers).flat());requestBytes+=outgoing;check(requestBytes<=transportReservation.request_bytes);
  return await new Promise((resolve,reject)=>{
   let req,res,socket,requestClosed=false,responseClosed=false,socketClosed=false,ended=false,failed=false,settled=false,size=0,headerSize=0,expectedLength=null,timer;
   const parts=[];
   const disposeLate=stream=>{if(!stream)return;const closed=new Promise(resolve=>{stream.once('close',resolve);stream.on('error',()=>{});});session.track(closed);stream.destroy();};
   const settle=()=>{if(settled||!requestClosed||(res&&!responseClosed)||(socket&&!socketClosed))return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(failed||!socket||!res||!ended||!res.complete||Date.now()>=auth.expires_at||signal.aborted){reject(rejected());return;}resolve(new Response(Buffer.concat(parts,size),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}}));};
   const fail=()=>{failed=true;req?.destroy();res?.destroy();socket?.destroy();settle();};
   const abort=()=>fail();signal.addEventListener('abort',abort,{once:true});
   const acceptResponse=response=>{
    if(settled||res){disposeLate(response);if(!settled)fail();return;}
    res=response;res.on('error',fail);res.on('aborted',fail);res.on('close',()=>{responseClosed=true;if(!ended)failed=true;settle();});
    try{
     check(!failed);healthy();check(Date.now()<auth.expires_at&&res.statusCode===200);headerSize=headerBytes(res.rawHeaders);
     const seen=new Set();for(let i=0;i<res.rawHeaders.length;i+=2){const name=res.rawHeaders[i].toLowerCase();check(!seen.has(name));seen.add(name);}
     check(res.headers['content-type']==='application/json'&&!res.headers['content-encoding']&&!res.headers.location&&!res.headers.trailer);
     if(res.headers['content-length']!==undefined){check(typeof res.headers['content-length']==='string'&&/^(0|[1-9][0-9]*)$/.test(res.headers['content-length']));expectedLength=Number(res.headers['content-length']);check(Number.isSafeInteger(expectedLength)&&expectedLength<=FIXTURE_RESPONSE_LIMITS[parsed.operation]);}
    }catch{fail();return;}
    res.on('data',chunk=>{try{healthy();check(Date.now()<auth.expires_at&&chunk instanceof Uint8Array&&chunk.byteLength>0&&size+chunk.byteLength<=FIXTURE_RESPONSE_LIMITS[parsed.operation]);size+=chunk.byteLength;parts.push(Buffer.from(chunk));}catch{fail();}});
    res.on('end',()=>{try{healthy();check(res.complete&&Array.isArray(res.rawTrailers)&&res.rawTrailers.length===0&&(expectedLength===null||expectedLength===size));ended=true;responseBytes+=headerSize+size;check(responseBytes<=transportReservation.response_bytes);}catch{failed=true;}if(failed)fail();settle();});
   };
   try{
    healthy();check(Date.now()<auth.expires_at&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0');
    req=requestImplementation(policy.origin+'/native-fixture/v1',{method:'POST',headers,agent:false,rejectUnauthorized:true,maxHeaderSize:8192},acceptResponse);
    req.on('error',fail);req.on('information',fail);const unexpected=(response,assigned)=>{disposeLate(response);if(assigned!==socket)disposeLate(assigned);fail();};req.on('upgrade',unexpected);req.on('connect',unexpected);
    req.on('socket',assigned=>{if(settled||socket){disposeLate(assigned);if(!settled)fail();return;}socket=assigned;socket.on('error',fail);socket.on('close',()=>{socketClosed=true;settle();});if(failed||signal.aborted)socket.destroy();});
    req.on('close',()=>{requestClosed=true;settle();});
    timer=setTimeout(abort,Math.max(1,Math.min(10000,auth.expires_at-Date.now(),policy.expires_at-Date.now())));
    if(signal.aborted){fail();return;}req.end(body);
   }catch{failed=true;if(req)fail();else{requestClosed=true;settle();}}
  });
 });}catch(error){if(message instanceof Request)cancelFixtureBody(message,session.track);throw error;}return outcome.catch(error=>{if(message instanceof Request)cancelFixtureBody(message,session.track);throw error;});}
 return Object.freeze({send,close:session.close,snapshot:()=>({...session.snapshot(),transportReservation,usage:{request_bytes:requestBytes,response_bytes:responseBytes}})});
}
