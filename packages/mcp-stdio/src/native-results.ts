import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {ApiResult} from '../../client/src/types';
import {formatResult} from '../../cli/src/output';
const unavailable=():CallToolResult=>({isError:true,content:[{type:'text',text:'Outcome requires reconciliation. Retain the original intent; no automatic retry.'}]});
/** Existing formatter preserves canonical native envelopes and suppresses local
 * faults/correlation absence. Fixed text never doubles potentially large data. */
export function toToolResult(result:ApiResult<unknown>,assertNoSecrets:(serialized:string)=>void):CallToolResult {
 try{
  const formatted=formatResult(result,{assertNoSecrets});if(!formatted.stdout)return unavailable();
  const structuredContent=JSON.parse(formatted.stdout) as Record<string,unknown>;
  const output:CallToolResult={isError:!result.ok,content:[{type:'text',text:result.ok?'Native request completed. Current state still governs execution.':'Native request denied or failed.'}],structuredContent};
  assertNoSecrets(JSON.stringify(output));return output;
 }catch{return unavailable();}
}
