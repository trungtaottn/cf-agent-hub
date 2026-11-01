import {it,expect} from 'vitest';
import {parseConfig} from '../../packages/mcp-stdio/src/config';
import {toToolResult} from '../../packages/mcp-stdio/src/native-results';
it('config requires explicit origin workspace absolute state directory and never tool credentials',()=>{
 expect(parseConfig(['--origin','https://hub.example.invalid','--workspace','ws','--state-dir','/tmp/synthetic-state'])).toEqual({origin:'https://hub.example.invalid',workspaceId:'ws',stateDirectory:'/tmp/synthetic-state',initialize:false});
 for(const args of [[],['--origin','http://hub.invalid','--workspace','ws','--state-dir','/tmp/state'],['--origin','https://hub.example.invalid','--workspace','ws','--state-dir','relative'],['--token','synthetic'],['--origin','https://hub.example.invalid','--origin','https://other.invalid','--workspace','ws','--state-dir','/tmp/state']])expect(()=>parseConfig(args)).toThrow('MCP_CONFIG_REJECTED');
});
it('explicit local initialization needs only absolute root and no native origin',()=>expect(parseConfig(['--init-journal','--state-dir','/tmp/synthetic-state'])).toEqual({stateDirectory:'/tmp/synthetic-state',initialize:true}));
it('native structured output preserves page request correlation and complete data',()=>{
 const data={fence:8,task_version:9};const result=toToolResult({ok:true,status:200,data,requestId:'correlation',page:{has_more:true,next_cursor:'opaque'}},()=>{});expect(result.structuredContent).toEqual({data,request_id:'correlation',page:{has_more:true,next_cursor:'opaque'}});expect(result.isError).toBe(false);expect(JSON.stringify(result)).not.toContain('"status"');
});
it('domain errors retain native envelope while remote message text is sanitized',()=>{
 const result=toToolResult({ok:false,status:403,error:{code:'FORBIDDEN',message:'untrusted secret',retryable:false,details:{resource:'synthetic'}},requestId:'correlation'},()=>{});expect(result.isError).toBe(true);expect(result.structuredContent).toEqual({error:{code:'FORBIDDEN',message:'Access denied',retryable:false,request_id:'correlation',details:{resource:'synthetic'}}});expect(JSON.stringify(result)).not.toContain('untrusted secret');
});
it('uncertain failures never invent native correlation or structured success',()=>{const result=toToolResult({ok:false,status:null,error:{code:'NETWORK_ERROR',message:'sensitive',retryable:false},requestId:null},()=>{});expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();expect(JSON.stringify(result)).not.toContain('sensitive');});
it('secret-bearing response is suppressed in every output field',()=>{const result=toToolResult({ok:true,status:200,data:{value:'SYNTHETIC_SECRET'},requestId:'correlation'},serialized=>{if(serialized.includes('SYNTHETIC_SECRET'))throw Error();});expect(result.isError).toBe(true);expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');});
