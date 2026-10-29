/** Fixed protocol client; injected transport is composition-owned, not loaded from configuration. */
import {validateFixturePolicy,validateFixtureRequest,validateFixtureResponse,FIXTURE_RESPONSE_LIMITS} from './native-fixture-protocol.mjs';
import {createFixtureSession} from './native-fixture-session.mjs';
import {readFixtureJson,cancelFixtureBody} from './native-fixture-io.mjs';
export function createFixtureClient({policy:input,send}){
 const policy=validateFixturePolicy(input,Date.now()),session=createFixtureSession(policy);let sequence=0;
 if(typeof send!=='function')throw Error('FIXTURE_CLIENT_REJECTED');
 function call(operation,payload,options={}){return session.execute(options.signal,async(signal,admit,check)=>{
  const request=validateFixtureRequest({version:1,service_id:policy.service_id,run_id:policy.run.run_id,instance_id:policy.run.instance_id,sequence:++sequence,request_id:'request_'+sequence,operation,payload},policy);admit(request);
  const body=JSON.stringify(request);if(Buffer.byteLength(body)>4096)throw Error('FIXTURE_CLIENT_REJECTED');
  const response=await send(new Request(policy.origin+'/native-fixture/v1',{method:'POST',headers:{'content-type':'application/json'},body,signal,redirect:'error'}));try{check();}catch(error){cancelFixtureBody(response,session.track);throw error;}
  if(!(response instanceof Response)||response.status!==200||response.headers.get('content-type')!=='application/json'||response.redirected){cancelFixtureBody(response,session.track);throw Error('FIXTURE_CLIENT_REJECTED');}
  const parsed=await readFixtureJson(response,FIXTURE_RESPONSE_LIMITS[operation],signal,session.track);check();return validateFixtureResponse(parsed,request,policy,Date.now()).data;
 });}
 return Object.freeze({call,close:session.close,snapshot:session.snapshot});
}
