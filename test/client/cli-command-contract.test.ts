import {describe,it,expect} from 'vitest';
import {parseCommand,nativeCommandMap} from '../../packages/cli/src/commands';
import {resolveContext} from '../../packages/cli/src/context';
import {formatResult,classifyResult} from '../../packages/cli/src/output';
import {clientOperations} from '../../src/http/generated/client-operations';
describe('CLI command contract',()=>{
 it('covers exactly the generated native inventory',()=>expect(Object.values(nativeCommandMap).map(x=>x.operation).sort()).toEqual(Object.entries(clientOperations).filter(([,v])=>v.native).map(([k])=>k).sort()));
 it('maps false and exact integer lexemes',()=>{expect(parseCommand(['inbox','list','--acknowledged','false','--limit','20']).input.query).toEqual({acknowledged:false,limit:20});});
 it.each(['1e2','+2','02','2.0',' 2','9007199254740992'])('rejects invalid numeric %s',n=>expect(()=>parseCommand(['events','list','--limit',n])).toThrow('CLI_ARGUMENT_REJECTED'));
 it.each([['tasks','list','--all'],['tasks','list','--limit','1','--limit','2'],['tasks','list','--token','secret-canary'],['tasks','show'],['tasks','show','a','b'],['artifacts','upload','a'],['artifacts','upload','a','--file','f','--content-id','c'],['events','list','--cursor','x','--after-sequence','1']].map(args=>({args})))('rejects unsupported shell input',({args})=>expect(()=>parseCommand(args)).toThrow('CLI_ARGUMENT_REJECTED'));
 it('does not leak parser input in errors',()=>{try{parseCommand(['--secret-canary']);}catch(e){expect(String(e)).not.toContain('secret-canary');}});
 it('resolves explicit context and rejects disagreement',()=>{expect(resolveContext({stateDir:'/private/state',origin:'https://example.test',workspace:'w',json:false},{},true)).toEqual({stateDirectory:'/private/state',origin:'https://example.test',workspaceId:'w'});expect(()=>resolveContext({stateDir:'/private/state',origin:'https://example.test',workspace:'w',json:false},{CF_AGENT_HUB_WORKSPACE:'other'},true)).toThrow('CLI_CONTEXT_REJECTED');});
 it.each([200,401,403,409])('prioritizes uncertainty over status %i',status=>expect(classifyResult({ok:false,status,requestId:null,error:{code:'INVALID_RESPONSE',message:'unsafe',retryable:false}})).toBe(5));
 it('classifies dependency unavailability as uncertain even without retryable flag',()=>expect(classifyResult({ok:false,status:400,requestId:'r',error:{code:'DEPENDENCY_UNAVAILABLE',message:'x',retryable:false}})).toBe(5));
 it('projects canonical envelopes without transport fields',()=>expect(JSON.parse(formatResult({ok:true,status:200,requestId:'r',data:[],page:{next_cursor:null,has_more:false}}).stdout)).toEqual({data:[],request_id:'r',page:{next_cursor:null,has_more:false}}));
 it('suppressed enrollment correlation is stderr only',()=>{const output=formatResult({ok:false,status:401,requestId:null,error:{code:'UNAUTHENTICATED',message:'unsafe-canary',retryable:false}},{enrollment:true});expect(output.exitCode).toBe(3);expect(output.stdout).toBe('');expect(output.stderr).not.toContain('unsafe-canary');});
 it('fails closed if protected provider detects a secret in output',()=>{const output=formatResult({ok:true,status:200,requestId:'secret',data:{}},{assertNoSecrets:()=>{throw Error('secret');}});expect(output.exitCode).toBe(5);expect(output.stdout).toBe('');expect(output.stderr).not.toContain('secret');});
});

// Independent expected shell vectors, not generated from the implementation table.
const commands=[
 ['workspace show','getWorkspace'],['workspace configuration','getConfiguration'],['workspace profile','getProfile'],
 ['tasks list','listTasks'],['tasks create --input body.json','createTask'],['tasks show t','getTask','task_id'],['tasks update t --input body.json','patchTask','task_id'],['tasks ready t --input body.json','readyTask','task_id'],['tasks claim t --input body.json','claimTask','task_id'],['tasks submit-result t --input body.json','submitTaskResult','task_id'],['tasks accept-result t --input body.json','acceptTaskResult','task_id'],['tasks fail t --input body.json','failTask','task_id'],['tasks cancel t --input body.json','cancelTask','task_id'],['tasks requeue t --input body.json','requeueTask','task_id'],['tasks results t','listTaskResults','task_id'],
 ['runs show t','getRun','run_id'],['runs heartbeat t --input body.json','heartbeatRun','run_id'],['agents list','listAgents'],['agents show t','getAgent','agent_id'],['runtime register --input body.json','createRuntime'],['runtime heartbeat t --input body.json','heartbeatRuntime','runtime_instance_id'],['messages send --input body.json','createMessage'],['messages ack --input body.json','ackMessages'],['inbox list','getInbox'],['threads show t','getThread','thread_id'],['artifacts list','listArtifacts'],['artifacts stage --content-id c --input body.json','stageArtifact'],['artifacts show t','getArtifact','artifact_id'],['artifacts upload t --file content','uploadArtifactContent','artifact_id'],['artifacts download t --output content','downloadArtifactContent','artifact_id'],['artifacts commit t --input body.json','commitArtifact','artifact_id'],['events list','listEvents'],['search --query hello','searchWorkspace']
];
describe('CLI complete shell vectors',()=>{
 it.each(commands)('%s maps to %s',(shell,operation,path)=>{const value=parseCommand(shell.split(' '));expect(value.operation).toBe(operation);expect(value.input.path).toEqual(path?{[path]:'t'}:undefined);expect(value.options.inputFile).toBe(shell.includes('--input')?'body.json':undefined);});
 it.each(['state init','credential import','state cleanup','artifacts retain --file content','artifacts inspect-content local-id','intent inspect local-id','intent dispatch local-id','artifacts inspect-upload local-id','artifacts dispatch-upload local-id'])('maps local control %s',shell=>expect(parseCommand(shell.split(' ')).kind).toBe('local'));
 it('maps all supported query spellings without coercion',()=>{
  expect(parseCommand(['tasks','list','--project-id','p','--state','ready','--cursor','cursor','--limit','10']).input.query).toEqual({project_id:'p',state:'ready',cursor:'cursor',limit:10});
  expect(parseCommand(['artifacts','list','--task-id','t']).input.query).toEqual({task_id:'t'});
  expect(parseCommand(['events','list','--after-sequence','0']).input.query).toEqual({after_sequence:0});
  expect(parseCommand(['search','--query','hello world','--kind','task']).input.query).toEqual({q:'hello world',kind:'task'});
 });
 it.each(['http://example.test','https://example.test/','https://u:p@example.test','https://example.test/path','https://example.test?query','https://example.test#hash'])('rejects noncanonical origin %s',origin=>expect(()=>resolveContext({origin,workspace:'w',stateDir:'/private/state',json:false},{},true)).toThrow('CLI_CONTEXT_REJECTED'));
 it('accepts matching environment context only',()=>expect(resolveContext({origin:'https://example.test',workspace:'w',stateDir:'/private/state',json:false},{CF_AGENT_HUB_URL:'https://example.test',CF_AGENT_HUB_WORKSPACE:'w'},true).workspaceId).toBe('w'));
 it('redacts enrollment and preserves error details shape',()=>{
  expect(JSON.parse(formatResult({ok:true,status:201,requestId:'r',data:{runtime_id:'rt'}},{enrollment:true}).stdout).data).toEqual({runtime:{runtime_id:'rt'},runtime_token:null,revealed:false});
  expect(JSON.parse(formatResult({ok:false,status:409,requestId:'r',error:{code:'VERSION_CONFLICT',message:'malicious',retryable:false,details:{current_version:2}}}).stdout)).toEqual({error:{code:'VERSION_CONFLICT',message:'Resource version changed',retryable:false,request_id:'r',details:{current_version:2}}});
 });
});
