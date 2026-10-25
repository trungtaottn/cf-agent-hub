import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,openSync,closeSync,chmodSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {verifyDeployment,parseDeploymentConfig,readProtectedFd,loadProtectedInputs,writeEvidenceExclusive,RESPONSE_LIMIT,EVIDENCE_LIMIT} from '../../scripts/verify-r1-deployment.mjs';
const now=Date.parse('2026-10-25T06:00:00Z'),iso=new Date(now).toISOString();
const base={format_version:1,environment_class:'isolated',environment_id:'fixture',target:{origin:'https://hub.example.invalid',workspace_id:'ws_probe',object_name:'workspace_probe',authority_epoch:2,human_principal_id:'human_probe',native_principal_id:'agent_probe',native_agent_id:'agent_probe',foreign_origin:'https://foreign.example.invalid',alternative_origins:['https://preview.example.invalid']},candidate:{revision:'a'.repeat(40),tree_sha256:'b'.repeat(64),bundle_sha256:'c'.repeat(64),deployment_id:'deployment_fixture',worker_version:'version_fixture',schema_version:7},credentials:{allowed_session_fd:4,forbidden_session_fd:5,native_bearer_fd:6},external_receipts:[]};
const credentials={allowedSession:'A'.repeat(43),forbiddenSession:'F'.repeat(43),nativeBearer:'N'.repeat(43)};
const config=()=>structuredClone(base);
const gate=(evidence,name)=>evidence.gates.find(item=>item.name===name);
const sha=value=>createHash('sha256').update(value).digest('hex');
const actor=kind=>({kind,principal_id:kind==='human'?'human_probe':'agent_probe',agent_id:kind==='human'?null:'agent_probe'});
const workspace=kind=>({request_id:'request_fixture',data:{id:'ws_probe',display_name:'Synthetic test workspace',contract_revision:'0.1',actor:actor(kind),effective_scopes:['workspace:read',...(kind==='human'?['operations:read']:[])]}});
const session=()=>({request_id:'request_fixture',data:{actor:actor('human'),csrf_token:'synthetic_csrf',expires_at:new Date(now+60000).toISOString()}});
const ready=()=>({observed_at:iso,ready:true,checks:[...['schema','configuration','authentication_keys','cursor_key','recovery_binding','admission','storage_probe','scheduler_probe','scheduler','delivery'].map(name=>({name,status:'pass',code:name.endsWith('_probe')?'PROBE_CONFIRMED':'OBSERVED',checked_at:iso})),{name:'r2_artifacts',status:'unknown',code:'CAPABILITY_UNAVAILABLE_R1',checked_at:null}]});
const error=(status,code)=>Response.json({error:{code,message:'Synthetic denial',retryable:false,request_id:'request_fixture'}},{status});
function transport(overrides={}){
 const calls=[];const fetchImpl=async(raw,init)=>{
  const url=new URL(raw),headers=new Headers(init.headers);calls.push({url:String(raw),init,headers});
  assert.equal(init.redirect,'manual');assert.ok(init.signal instanceof AbortSignal);
  if(overrides.request){const changed=await overrides.request(url,init,headers);if(changed)return changed;}
  if(url.origin!==base.target.origin){assert.equal(headers.has('cookie'),false);assert.equal(headers.has('authorization'),false);return new Response('Denied by edge',{status:403});}
  if(url.pathname==='/health/live')return Response.json({status:'alive'});
  if(headers.has('cookie')&&headers.has('authorization'))return error(400,'INVALID_REQUEST');
  if(headers.get('cookie')==='cfhub_session='+credentials.forbiddenSession)return error(401,'UNAUTHENTICATED');
  const human=headers.get('cookie')==='cfhub_session='+credentials.allowedSession,native=headers.get('authorization')==='Bearer '+credentials.nativeBearer;
  if(!human&&!native)return error(401,'UNAUTHENTICATED');
  if(headers.get('origin')===base.target.foreign_origin)return error(403,'FORBIDDEN');
  if(url.pathname.endsWith('/auth/logout'))return error(403,'FORBIDDEN');
  if(url.pathname.endsWith('/auth/session'))return Response.json(session());
  if(url.pathname.endsWith('/readiness'))return native?error(403,'FORBIDDEN'):Response.json({request_id:'request_fixture',data:ready()});
  if(url.pathname.endsWith('/operations'))return Response.json({request_id:'request_fixture',data:{observed_at:iso,config_epoch:2,schema_version:7,readiness:ready(),outbox:{pending_count:0,in_flight_count:0,failed_count:0,suppressed_count:0,oldest_due_at:null,next_due_at:null},scheduler:{last_run_at:null,last_error_code:null}}});
  return Response.json(workspace(human?'human':'agent'));
 };return {calls,fetchImpl};
}
function run(input=config(),secrets=credentials,adapter=transport(),extra={}){return verifyDeployment(input,secrets,{now:()=>now,fetchImpl:adapter.fetchImpl,...extra});}

test('records actual typed liveness while missing credential and external workflows remain pending',async()=>{
 const input=config();input.credentials={allowed_session_fd:null,forbidden_session_fd:null,native_bearer_fd:null};const t=transport(),result=await run(input,{},t);
 assert.equal(gate(result,'liveness').status,'pass');assert.equal(result.status,'pending');assert.equal(result.exit_code,2);assert.ok(t.calls.length>0);
 assert.equal(gate(result,'human_workspace').status,'pending');assert.equal(gate(result,'oidc_provider_journey').status,'pending');
});
test('passes only the observed HTTP subset and never treats supplied cookies as provider or revocation proof',async()=>{
 const t=transport(),result=await run(config(),credentials,t);
 assert.equal(result.http_subset,'pass');assert.equal(result.status,'pending');assert.equal(result.exit_code,2);
 assert.equal(result.gates.filter(g=>g.group==='workflow').length,4);assert.ok(result.gates.filter(g=>g.group==='workflow').every(g=>g.status==='pending'));
 assert.ok(t.calls.every(x=>x.init.redirect==='manual'));assert.ok(t.calls.some(x=>x.url.startsWith(base.target.alternative_origins[0])));
 const serialized=JSON.stringify(result);for(const privateValue of [...Object.values(credentials),base.target.origin,base.target.workspace_id,base.target.human_principal_id,'synthetic_csrf',base.candidate.deployment_id])assert.equal(serialized.includes(privateValue),false);
 assert.ok(Buffer.byteLength(serialized)<EVIDENCE_LIMIT);assert.ok(result.observations.every(x=>x.url_sha256.length===64));
});
test('rejects a 200 workspace response for a different workspace or actor',async()=>{
 for(const wrong of ['workspace','actor']){
  const t=transport({request:(url,_init,headers)=>{if(url.pathname==='/v2/workspaces/ws_probe'&&headers.get('cookie')==='cfhub_session='+credentials.allowedSession&&!headers.has('authorization')){const body=workspace('human');if(wrong==='workspace')body.data.id='ws_other';else body.data.actor.principal_id='human_other';return Response.json(body);}}});
  const result=await run(config(),credentials,t);assert.equal(gate(result,'human_workspace').status,'fail');assert.equal(result.exit_code,1);
 }
});
test('requires exactly 400 for cookie and bearer conflict and 403 for native diagnostics',async()=>{
 const t=transport({request:(url,_init,headers)=>{if(headers.has('cookie')&&headers.has('authorization'))return error(403,'FORBIDDEN');if(url.pathname.endsWith('/readiness')&&headers.has('authorization'))return error(401,'UNAUTHENTICATED');}});
 const result=await run(config(),credentials,t);assert.equal(gate(result,'cookie_bearer_conflict_denied').status,'fail');assert.equal(gate(result,'native_readiness_denied').status,'fail');
});
test('a login challenge, missing named readiness check, stale probe or false ready cannot pass readiness',async()=>{
 for(const flaw of ['redirect','missing','stale','false']){
  const t=transport({request:(url,_init,headers)=>{if(url.pathname.endsWith('/readiness')&&headers.has('cookie')){if(flaw==='redirect')return new Response(null,{status:302,headers:{location:'https://identity.example.invalid/login'}});const data=ready();if(flaw==='missing')data.checks=data.checks.filter(x=>x.name!=='schema');if(flaw==='stale')data.checks.find(x=>x.name==='storage_probe').checked_at=new Date(now-300001).toISOString();if(flaw==='false')data.ready=false;return Response.json({request_id:'r',data});}}});
  const result=await run(config(),credentials,t);assert.equal(gate(result,'human_readiness').status,'fail');assert.equal(t.calls.some(x=>x.url.includes('identity.example.invalid')),false);
 }
});
test('404 and malformed JSON cannot masquerade as product authorization denials',async()=>{
 for(const response of [()=>error(404,'NOT_FOUND'),()=>new Response('challenge',{status:401,headers:{'content-type':'text/html'}}),()=>Response.json({passed:true},{status:401})]){
  const t=transport({request:(url,_init,headers)=>{if(url.pathname==='/v2/workspaces/ws_probe'&&!headers.has('cookie')&&!headers.has('authorization'))return response();}});
  assert.equal(gate(await run(config(),credentials,t),'unauthenticated_workspace').status,'fail');
 }
});
test('streamed bytes are bounded and network diagnostics never echo private error messages',async()=>{
 let cancelled=false;const t=transport({request:url=>{if(url.pathname==='/health/live')return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(RESPONSE_LIMIT+1));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});if(url.pathname.endsWith('/auth/session'))throw Error('private '+credentials.allowedSession+' '+base.target.origin);}});
 const result=await run(config(),credentials,t),observation=result.observations.find(x=>x.name==='liveness');assert.equal(observation.code,'RESPONSE_BYTES_LIMIT');assert.equal(observation.byte_size,RESPONSE_LIMIT+1);assert.equal(observation.sha256,null);assert.equal(cancelled,true);assert.equal(JSON.stringify(result).includes('private '),false);assert.equal(JSON.stringify(result).includes(credentials.allowedSession),false);
});
test('closed config rejects caller success flags, unsafe hosts and duplicate descriptors before transport',async()=>{
 for(const change of [x=>x.passed=true,x=>x.target.origin='http://hub.example.invalid',x=>x.target.origin='https://user@hub.example.invalid',x=>x.target.origin='https://127.0.0.1',x=>x.target.origin='https://hub.example.invalid/path',x=>x.credentials.native_bearer_fd=4,x=>x.external_receipts=[{kind:'operator_recovery',fd:9,sha256:'a'.repeat(64),passed:true}]]){
  const input=config();change(input);assert.throws(()=>parseDeploymentConfig(input));let calls=0;await assert.rejects(verifyDeployment(input,credentials,{fetchImpl:async()=>{calls++;throw Error();}}));assert.equal(calls,0);
 }
});
test('binding receipt bytes does not authenticate a supplied workflow success claim',async()=>{
 const input=config(),bytes=Buffer.from('{"passed":true,"status":"complete"}');input.external_receipts=[{kind:'operator_recovery',fd:9,sha256:sha(bytes)}];
 const result=await run(input,credentials,transport(),{receiptBytes:new Map([['operator_recovery',bytes]])});assert.equal(gate(result,'receipt_bytes_operator_recovery').status,'pass');assert.equal(gate(result,'actual_operator_recovery').status,'pending');assert.equal(gate(result,'actual_operator_recovery').code,'EXTERNAL_WORKFLOW_REVIEW_REQUIRED');assert.equal(result.exit_code,2);
 const mismatch=await run(input,credentials,transport(),{receiptBytes:new Map([['operator_recovery',Buffer.from('changed')]])});assert.equal(gate(mismatch,'receipt_bytes_operator_recovery').status,'fail');assert.equal(mismatch.exit_code,1);
});
test('protected FD reads reject shared permissions and evidence output is exclusive 0600',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'r1-deployment-test-'));let descriptor;
 try{const path=join(dir,'input');writeFileSync(path,'fixture',{mode:0o600});descriptor=openSync(path,'r');assert.equal(readProtectedFd(descriptor,20).toString(),'fixture');assert.throws(()=>readProtectedFd(descriptor,3),/INPUT_FILE_NOT_PROTECTED/);chmodSync(path,0o644);assert.throws(()=>readProtectedFd(descriptor,20),/INPUT_FILE_NOT_PROTECTED/);closeSync(descriptor);descriptor=undefined;
  const evidence=await run(),output=join(dir,'result.json'),digest=writeEvidenceExclusive(output,evidence);assert.equal(statSync(output).mode&0o777,0o600);assert.equal(sha(readFileSync(output)),digest);assert.throws(()=>writeEvidenceExclusive(output,evidence),/EVIDENCE_WRITE_FAILED/);
 }finally{if(descriptor!==undefined)closeSync(descriptor);rmSync(dir,{recursive:true,force:true});}
});
test('missing real target configuration produces immutable pending evidence and nonzero CLI exit',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r1-deployment-cli-'));try{const output=join(dir,'blocked.json');const child=spawnSync(process.execPath,['scripts/verify-r1-deployment.mjs','--output',output],{encoding:'utf8'});assert.equal(child.status,2);const summary=JSON.parse(child.stdout),evidence=JSON.parse(readFileSync(output,'utf8'));assert.equal(summary.status,'pending');assert.equal(evidence.requested_candidate,null);assert.equal(evidence.target_sha256,null);assert.equal(evidence.observations.length,0);assert.ok(evidence.missing_inputs.includes('protected_config_fd'));assert.ok(evidence.gates.filter(g=>g.group==='workflow').every(g=>g.status==='pending'));assert.equal(summary.evidence_sha256,sha(readFileSync(output)));
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test('loads the exact declared protected credential FDs and rejects reuse of the config descriptor',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r1-deployment-fds-')),fds=[];
 try{
  const input=config();for(const [field,key]of [['allowed_session_fd','allowedSession'],['forbidden_session_fd','forbiddenSession'],['native_bearer_fd','nativeBearer']]){const path=join(dir,key);writeFileSync(path,credentials[key]+'\n',{mode:0o600});const descriptor=openSync(path,'r');fds.push(descriptor);input.credentials[field]=descriptor;}
  const configPath=join(dir,'config');writeFileSync(configPath,JSON.stringify(input),{mode:0o600});const configFd=openSync(configPath,'r');fds.push(configFd);
  const loaded=loadProtectedInputs(configFd);assert.deepEqual(loaded.credentials,credentials);assert.equal(loaded.receiptBytes.size,0);
  input.credentials.allowed_session_fd=configFd;writeFileSync(configPath,JSON.stringify(input));assert.throws(()=>loadProtectedInputs(configFd),/DUPLICATE_INPUT_FD/);
 }finally{for(const descriptor of fds)closeSync(descriptor);rmSync(dir,{recursive:true,force:true});}
});
test('a response arriving after the request deadline cannot change the recorded failed observation',async()=>{
 let release;const late=new Promise(resolve=>release=resolve);const t=transport({request:url=>url.pathname==='/health/live'?late:undefined});
 const result=await run(config(),credentials,t);const observation=result.observations.find(x=>x.name==='liveness');assert.equal(observation.outcome,'fail');assert.equal(observation.code,'NETWORK_UNAVAILABLE');
 release(Response.json({status:'alive'}));await Promise.resolve();await Promise.resolve();assert.equal(observation.outcome,'fail');assert.equal(gate(result,'liveness').status,'fail');assert.equal(result.exit_code,1);
});
