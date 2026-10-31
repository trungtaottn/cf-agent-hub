import type {ApiResult} from '../../client/src/types';
export type CliExitCode=0|2|3|4|5|6;
export interface CliOutput {exitCode:CliExitCode;stdout:string;stderr:string;}
const remoteMessages:Readonly<Record<string,string>>={INVALID_REQUEST:'Invalid request',UNAUTHENTICATED:'Authentication required',FORBIDDEN:'Access denied',NOT_FOUND:'Resource unavailable',VERSION_CONFLICT:'Resource version changed',IDEMPOTENCY_CONFLICT:'Idempotency key conflicts with original intent',INVALID_STATE:'Invalid resource state',STALE_RUN:'Run is stale',APPROVAL_EXPIRED:'Approval expired',CURSOR_EXPIRED:'Cursor expired',LIMIT_EXCEEDED:'Request limit exceeded',RATE_LIMITED:'Request rate exceeded',DEPENDENCY_UNAVAILABLE:'Dependency unavailable',INTERNAL_ERROR:'Internal request failure'};
/** Non-server faults take precedence over a carried HTTP status. No status-null
 * result proves that a request was never sent; only main may report local exit2. */
export function classifyResult(result:ApiResult<unknown>):CliExitCode {
 if(result.ok)return 0;
 if(!Object.hasOwn(remoteMessages,result.error.code)||result.status===null)return 5;
 if(result.status===401||result.status===403)return 3;
 if(['VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','INVALID_STATE','STALE_RUN'].includes(result.error.code))return 4;
 if(result.error.retryable||result.error.code==='DEPENDENCY_UNAVAILABLE'||result.status>=500)return 5;
 return 6;
}
const localMessages={completed:'Local action completed.',rejected:'Local input or configuration rejected; no request sent.',uncertain:'Outcome requires reconciliation; retain the original intent. No automatic retry.',outputFailed:'Output could not be safely presented; retain the original intent for reconciliation.'} as const;
export function localOutput(kind:keyof typeof localMessages):CliOutput {return {exitCode:kind==='completed'?0:kind==='rejected'?2:5,stdout:'',stderr:localMessages[kind]+'\n'};}
/** Only validated client results enter here. Binary transfers pass the validated
 * metadata result only AFTER verified durable publication, never a binary receipt.
 * No raw exception or remote-provided message is printed. */
export function formatResult(result:ApiResult<unknown>,options:{enrollment?:boolean;assertNoSecrets?:(serialized:string)=>void}={}):CliOutput {
 try{
  const exitCode=classifyResult(result);
  if(!result.ok){
   if(!Object.hasOwn(remoteMessages,result.error.code)||result.requestId===null||options.enrollment){return {exitCode,stdout:'',stderr:(Object.hasOwn(remoteMessages,result.error.code)?remoteMessages[result.error.code]:localMessages.uncertain)+'\n'};}
   const envelope={error:{code:result.error.code,message:remoteMessages[result.error.code],retryable:result.error.retryable,request_id:result.requestId,...(result.error.details?{details:result.error.details}:{})}};
   const stdout=JSON.stringify(envelope)+'\n';options.assertNoSecrets?.(stdout);return {exitCode,stdout,stderr:''};
  }
  if(typeof result.requestId!=='string'||!result.requestId.length)return localOutput('outputFailed');
  const data=options.enrollment?{runtime:result.data,runtime_token:null,revealed:false}:result.data;
  const stdout=JSON.stringify({data,request_id:result.requestId,...(result.page?{page:result.page}:{})})+'\n';options.assertNoSecrets?.(stdout);return {exitCode,stdout,stderr:''};
 }catch{return localOutput('outputFailed');}
}
