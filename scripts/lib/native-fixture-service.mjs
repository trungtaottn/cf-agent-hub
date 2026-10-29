/** Fixed service core. The injected verifier is installed by the trusted operator, never request configuration. */
import {createHash} from 'node:crypto';
import {validateFixturePolicy,validateFixtureClaims,validateFixtureRequest,validateFixtureResponse,fixturePolicyDigest,fixtureReservation,FIXTURE_CAPABILITIES,FIXTURE_RESPONSE_LIMITS} from './native-fixture-protocol.mjs';
import {createFixtureSession} from './native-fixture-session.mjs';
import {readFixtureJson,cancelFixtureBody} from './native-fixture-io.mjs';
export function createFixtureService({policy:input,verify,backend}){
 const policy=validateFixturePolicy(input,Date.now()),session=createFixtureSession(policy),digest=fixturePolicyDigest(policy);
 if(typeof verify!=='function'||typeof backend?.observe!=='function'||typeof backend?.disable!=='function'||!Array.isArray(backend.capabilities))throw Error('FIXTURE_SERVICE_REJECTED');
 for(const key of ['instance_id','workspace_id','object_name'])if(backend.identity?.[key]!==policy.run[key])throw Error('FIXTURE_SERVICE_REJECTED');
 const observe=backend.observe.bind(backend),disable=backend.disable.bind(backend),capabilities=[...backend.capabilities];if(new Set(capabilities).size!==capabilities.length||capabilities.some(x=>!FIXTURE_CAPABILITIES.includes(x)))throw Error('FIXTURE_SERVICE_REJECTED');
 async function handle(message){try{return await session.execute(message?.signal,async(signal,admit,check)=>{
  if(!(message instanceof Request)||message.url!==policy.origin+'/native-fixture/v1'||message.method!=='POST'||message.headers.get('content-type')!=='application/json')throw Error('FIXTURE_SERVICE_REJECTED');
  const request=validateFixtureRequest(await readFixtureJson(message,4096,signal,session.track),policy);admit(request);check();
  const authorization=validateFixtureClaims(await verify(message,Object.freeze({policy_sha256:digest,request_sha256:createHash('sha256').update(JSON.stringify(request)).digest('hex'),request,signal})),policy,Date.now());check();
  const granted=capabilities.filter(x=>authorization.capabilities.includes(x));if(!granted.includes(request.operation))throw Error('FIXTURE_SERVICE_REJECTED');
  let data;
  if(request.operation==='preflight'){
   if(!request.payload.required_capabilities.every(x=>granted.includes(x)))throw Error('FIXTURE_SERVICE_REJECTED');
   data={kind:'fixture-preflight',capabilities:granted,assurance:policy.assurance,scope:'partial-local-fixture',native_conformance:false,expires_at:authorization.expires_at,policy_sha256:digest,reservation:fixtureReservation(policy)};
  }else if(request.operation==='observe-selected-state')data=await observe(request.payload.selector,Object.freeze({signal,expires_at:authorization.expires_at}));
  else data=await disable(request.payload,Object.freeze({signal,expires_at:authorization.expires_at}));
  check();if(Date.now()>=authorization.expires_at)throw Error('FIXTURE_SERVICE_REJECTED');const {payload,...header}=request,response=validateFixtureResponse({...header,data},request,policy,Date.now()),body=JSON.stringify(response);
  if(Buffer.byteLength(body)>FIXTURE_RESPONSE_LIMITS[request.operation])throw Error('FIXTURE_SERVICE_REJECTED');
  return new Response(body,{headers:{'content-type':'application/json','cache-control':'no-store'}});
 });}catch{if(message instanceof Request)cancelFixtureBody(message,session.track);return new Response('{"error":{"code":"FIXTURE_REQUEST_REJECTED","retryable":false}}',{status:403,headers:{'content-type':'application/json','cache-control':'no-store'}});}}
 return Object.freeze({handle,close:session.close,snapshot:session.snapshot});
}
