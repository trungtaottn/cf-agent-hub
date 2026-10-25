import {it,expect,vi} from 'vitest';
import {HttpError,toHttpError,toHttpResponse} from '../../src/http/envelopes';
import {securityLog} from '../../src/audit/redact';
const secret='canary_cookie_bearer_private_endpoint_digest_stack_message';
it('secret_strings_absent_from_all_log_and_error_sinks',async()=>{
 const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  for(const error of [new Error(secret),Object.assign(new Error(secret),{code:secret,status:401,details:{reason:secret,field:secret}}),new HttpError('INVALID_REQUEST',400,{field:'/body',reason:secret} as never)]){
   const response=toHttpError(error,'req_server');securityLog(error,'req_server');
   const text=await response.text();expect(text).not.toContain(secret);expect(text).not.toContain('stack');expect(text.length).toBeLessThan(1000);
   expect(JSON.parse(text).error.request_id).toBe('req_server');
  }
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  expect(log.mock.calls.every(call=>String(call[0]).length<1024)).toBe(true);
 }finally{log.mockRestore();}
});
it('exact_baseline_error_envelope_and_allowlisted_details',async()=>{
 const response=toHttpError(new HttpError('VERSION_CONFLICT',409,{current_revision:1,field:'/preferences/theme'}),'req_1');
 expect(response.status).toBe(409);expect(await response.json()).toEqual({error:{code:'VERSION_CONFLICT',message:'Resource version changed',retryable:false,request_id:'req_1',details:{current_revision:1,field:'/preferences/theme'}}});
});
it('outcome_response_correlation_is_fresh_and_not_part_of_domain_data',async()=>{
 const outcome={status:201,data:{id:'message_1'}};
 expect(await toHttpResponse(outcome,'req_new').json()).toEqual({data:{id:'message_1'},request_id:'req_new'});
 expect(outcome).toEqual({status:201,data:{id:'message_1'}});
});
