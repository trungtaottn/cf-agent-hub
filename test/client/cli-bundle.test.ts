import {beforeAll,afterEach,describe,it,expect} from 'vitest';
import {execFileSync,spawnSync,spawn} from 'node:child_process';
import {Journal} from '../../packages/cli/src/journal';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,lstatSync} from 'node:fs';
import {join,dirname} from 'node:path';
const binary=join(process.cwd(),'dist/cli/agenthub.mjs');
const roots:string[]=[];
beforeAll(()=>{execFileSync(process.execPath,['scripts/build-cli.mjs'],{cwd:process.cwd(),stdio:'pipe'});});
afterEach(()=>{for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(dirname(process.cwd()),'cli-binary-'));roots.push(root);return {root,state:join(root,'state')};}
function invoke(args:string[],env:NodeJS.ProcessEnv={},preload?:string){return spawnSync(process.execPath,[...(preload?['--import',preload]:[]),binary,...args],{encoding:'utf8',env:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,...env}});}
describe('built native CLI subprocess',()=>{
 it('builds a runnable node ESM executable with shebang',()=>{expect(readFileSync(binary,'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);expect(lstatSync(binary).isFile()).toBe(true);});
 it('rejects unknown arguments without a server-shaped success',()=>{const result=invoke(['tasks','list','--all']);expect(result.status).toBe(2);expect(result.stdout).toBe('');expect(result.stderr).toContain('rejected');});
 it('provides exact standalone static help without reading credentials or context',()=>{const result=invoke(['--help'],{CF_AGENT_HUB_TOKEN:'SECRET_HELP_CANARY'});expect(result.status).toBe(0);expect(result.stdout).toContain('--state-dir');expect(result.stdout+result.stderr).not.toContain('SECRET_HELP_CANARY');expect(invoke(['--help','--all']).status).toBe(2);});
 it('uses explicit synthetic protected import then emits native read envelope in separate process',()=>{
  const f=fixture();expect(invoke(['state','init','--state-dir',f.state]).status).toBe(0);const token='S'.repeat(43);const imported=invoke(['credential','import','--state-dir',f.state],{CF_AGENT_HUB_TOKEN:token});expect(imported.status,imported.stderr).toBe(0);expect(imported.stdout+imported.stderr).not.toContain(token);
  const preload=join(f.root,'mock.mjs');writeFileSync(preload,`globalThis.fetch=async (_url,init)=>{if(new Headers(init.headers).get('authorization')!==${JSON.stringify('Bearer '+token)})throw Error('wrong credential');return Response.json({data:{config_epoch:1,profile_revision:1,preferences_revision:0,allowed_user_overrides:[],enabled_features:['workspace']},request_id:'binary_fixture'});};`);
  const result=invoke(['workspace','configuration','--state-dir',f.state,'--origin','https://hub.example.invalid','--workspace','ws','--json'],{},preload);expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({request_id:'binary_fixture',data:{config_epoch:1}});expect(result.stdout+result.stderr).not.toContain(token);
 });
});

// A broken stdout pipe is presentation failure, not permission to repeat an effect.
it('keeps the settled heartbeat outcome when executable stdout fails after dispatch',async()=>{
 const f=fixture(),token='S'.repeat(43),proof='P'.repeat(43),calls=join(f.root,'calls');
 expect(invoke(['state','init','--state-dir',f.state]).status).toBe(0);expect(invoke(['credential','import','--state-dir',f.state],{CF_AGENT_HUB_TOKEN:token}).status).toBe(0);
 const runtime={id:'runtime_pipe',workspace_id:'ws',agent_id:'agent_pipe',runtime_version:1,label:'Synthetic',status:'online',last_seen_at:'2026-10-27T00:00:00Z',presence_expires_at:'2026-10-27T00:01:30Z',created_at:'2026-10-27T00:00:00Z'};
 const preload=join(f.root,'pipe.mjs'),input=join(f.root,'input.json');writeFileSync(preload,`import {appendFileSync} from 'node:fs';globalThis.fetch=async url=>{appendFileSync(${JSON.stringify(calls)},String(url)+'\\n');const heartbeat=String(url).endsWith(':heartbeat');return Response.json({data:heartbeat?{...${JSON.stringify(runtime)},runtime_version:2}:{runtime:${JSON.stringify(runtime)},runtime_token:${JSON.stringify(proof)},revealed:true},request_id:'pipe_fixture'},{status:heartbeat?200:201});};`);
 const context=['--state-dir',f.state,'--origin','https://hub.example.invalid','--workspace','ws'];writeFileSync(input,JSON.stringify({label:'Synthetic'}));const enrolled=invoke(['runtime','register',...context,'--input',input,'--idempotency-key','enroll'],{},preload);expect(enrolled.status,enrolled.stderr).toBe(0);writeFileSync(input,JSON.stringify({expected_runtime_version:1}));
 const result=await new Promise<{status:number|null;stderr:string}>((resolve,reject)=>{const child=spawn(process.execPath,['--import',preload,binary,'runtime','heartbeat',runtime.id,...context,'--input',input,'--idempotency-key','heartbeat'],{env:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>{stderr+=b.toString();});child.stdout.destroy();child.on('error',reject);child.on('close',status=>resolve({status,stderr}));});
 expect(result.status,result.stderr).toBe(5);expect(result.stderr).not.toContain(proof);expect(readFileSync(calls,'utf8').trim().split('\n')).toHaveLength(2);const journal=new Journal({directory:join(f.state,'journal'),authority:()=>false});try{expect(journal.someValidatedSync(entry=>entry.request.operation==='heartbeatRuntime'&&entry.replayState==='settled')).toBe(true);}finally{journal.close();}
});
