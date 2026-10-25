import {encodeHeader} from '../../../src/recovery/encoding';
import {parseOperatorPolicy,operatorOperation,type OperatorBindings} from '../../../src/recovery/operator';
import {AuthError} from '../../../src/auth/context';
const headers={'cache-control':'no-store','content-type':'application/json','x-content-type-options':'nosniff'};
export default {
 async fetch(request:Request,env:OperatorBindings):Promise<Response>{
  const requestId=crypto.randomUUID();
  try{
   const policy=parseOperatorPolicy(env.OPERATOR_POLICY),url=new URL(request.url);
   if(url.origin!==policy.origin||url.pathname!=='/operator/recovery'||url.search||request.method!=='POST')return Response.json({error:{code:'NOT_FOUND',request_id:requestId}},{status:404,headers});
   const result=await operatorOperation(request,env,policy,requestId);
   if('chunk' in result&&result.chunk)return new Response(result.chunk.bytes,{headers:{'cache-control':'no-store','x-content-type-options':'nosniff','content-type':'application/octet-stream','X-CFHub-Recovery-Chunk':encodeHeader(result.chunk.metadata)}});
   return Response.json({request_id:requestId,data:result.data},{headers});
  }catch(error){
   const conflict=error instanceof Error&&['CAS_CONFLICT','STALE_EPOCH','EPOCH_CONFLICT','OPERATION_CONFLICT','CREDENTIAL_IMMUTABLE','RETIREMENT_REQUIRED','ADMISSION_CLOSED','NONADVANCING_INSTALL'].includes(error.message);
   const status=error instanceof AuthError?error.status:conflict?409:400;
   const code=error instanceof AuthError?error.code:conflict?'CONFLICT':'INVALID_REQUEST';
   return Response.json({error:{code,message:'Operator request denied',retryable:false,request_id:requestId}},{status,headers});
  }
 }
} satisfies ExportedHandler<OperatorEnv>;
