// Test-only native transport. Real protected provider/client/journal and SDK process.
import {parseConfig} from '../../packages/mcp-stdio/src/config';
import {openMcpHost} from '../../packages/mcp-stdio/src/host';
import {startStdio} from '../../packages/mcp-stdio/src/server';
const config=parseConfig(process.argv.slice(2));if(config.initialize)throw Error();
const host=openMcpHost(config,async(url)=>{
 const path=new URL(String(url)).pathname;
 if(path.endsWith('/ws'))return Response.json({data:{id:'ws',display_name:'Synthetic',contract_revision:'0.1',actor:{kind:'agent',principal_id:'agent',agent_id:'agent'},effective_scopes:['workspace:read']},request_id:'synthetic'});
 if(path.endsWith('/search'))throw Error('SYNTHETIC_NETWORK_FAILURE');
 return Response.json({error:{code:'FORBIDDEN',message:'Access denied',retryable:false,request_id:'synthetic'}},{status:403});
});
const session=await startStdio(host);await session.finished;
