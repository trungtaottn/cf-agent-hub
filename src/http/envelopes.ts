import type {Error as ErrorEnvelope} from './dto';
import type {CommandOutcome} from '../workspace/commands';
import {validateError} from './generated/auth-validators.js';
import {httpFieldNames} from './generated/http-schemas';
import {AuthError} from '../auth/context';
export const securityHeaders={
 'cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
 'referrer-policy':'no-referrer','x-content-type-options':'nosniff'
};
export type ErrorCode=ErrorEnvelope['error']['code'];
export type ErrorDetails=NonNullable<ErrorEnvelope['error']['details']>;
export class HttpError extends Error{
 constructor(readonly code:ErrorCode,readonly status:number,readonly details?:ErrorDetails){super(code);}
}
const messages:Record<ErrorCode,string>={
 INVALID_REQUEST:'Invalid request',UNAUTHENTICATED:'Authentication required',FORBIDDEN:'Access denied',NOT_FOUND:'Resource unavailable',
 VERSION_CONFLICT:'Resource version changed',IDEMPOTENCY_CONFLICT:'Idempotency key conflicts with original intent',INVALID_STATE:'Invalid resource state',
 STALE_RUN:'Run is stale',APPROVAL_EXPIRED:'Approval expired',CURSOR_EXPIRED:'Cursor expired',LIMIT_EXCEEDED:'Request limit exceeded',
 RATE_LIMITED:'Request rate exceeded',DEPENDENCY_UNAVAILABLE:'Dependency unavailable',INTERNAL_ERROR:'Internal request failure'
};
/** Only typed server categories survive. Never reflect exception messages, URLs or validation errors. */
export function describeError(error:unknown):{code:ErrorCode;status:number;retryable:boolean;message:string;details?:ErrorDetails}{
 const known=error instanceof HttpError?error:error instanceof AuthError?new HttpError(error.status===413?'LIMIT_EXCEEDED':error.code==='AUTH_UNAVAILABLE'?'DEPENDENCY_UNAVAILABLE':error.code,error.status):new HttpError('INTERNAL_ERROR',500);
 const code=Object.hasOwn(messages,known.code)?known.code:'INTERNAL_ERROR';
 const status=Number.isInteger(known.status)&&known.status>=400&&known.status<=599?known.status:500;
 const safe:ErrorEnvelope={error:{code,message:messages[code],retryable:status===429||status===503,request_id:'validation'}};
 const details:ErrorDetails={};
 if(known.details){
  // Arbitrary reason/resource strings are deliberately never reflected. Field segments must be canonical schema names.
  const field=known.details.field;
  if(typeof field==='string'&&field.length<=256&&field.startsWith('/')&&field.slice(1).split('/').every(x=>(httpFieldNames as readonly string[]).includes(x)||/^[0-9]{1,5}$/.test(x)))details.field=field;
  for(const key of ['current_version','current_proposal_version','current_revision','retry_after_seconds','feature'] as const){
   const value=known.details[key];if(value===undefined)continue;
   const candidate={...details,[key]:value};
   safe.error.details=candidate;
   // Canonical schema decides numeric minima/ranges, including future revision-zero amendments.
   if(validateError(safe))Object.assign(details,{[key]:value});
  }
 }
 return {code,status,message:messages[code],retryable:safe.error.retryable,...(Object.keys(details).length?{details}:{})};
}
export function toHttpError(error:unknown,requestId:string,headers:HeadersInit=securityHeaders):Response{
 const {status,...safe}=describeError(error);
 const envelope:ErrorEnvelope={error:{...safe,request_id:requestId}};
 return Response.json(envelope,{status,headers});
}
export function toHttpResponse<T>(outcome:CommandOutcome<T>,requestId:string,headers:HeadersInit=securityHeaders):Response{
 return Response.json({data:outcome.data,request_id:requestId},{status:outcome.status,headers});
}
