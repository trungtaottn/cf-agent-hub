import { afterEach,it,expect } from 'vitest';
import { mkdtempSync,writeFileSync,readFileSync,openSync,closeSync,chmodSync,statSync,existsSync,readdirSync,symlinkSync,rmSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import example from '../../examples/config/deployment.example.json';
const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const canonical=(x:any):string=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'cfhub-provision-'));dirs.push(dir);chmodSync(dir,0o700);
 const key={key_id:'fixture_key',key_base64:randomBytes(32).toString('base64')};
 const put=(name:string,value:unknown)=>{const path=join(dir,name);writeFileSync(path,JSON.stringify(value),{mode:0o600,flag:'wx'});return path;};
 const keyPath=put('key.json',key);
 const config=(epoch:number)=>{const c=structuredClone(example);c.config_epoch=epoch;c.static_credential_refs[0].expires_at=new Date(Date.now()+30*86400000).toISOString();return c;};
 const invoke=(args:string[],output='token-'+randomBytes(5).toString('hex'),mode=0o600,extraEnv:Record<string,string>={})=>{
  const secretPath=join(dir,output),secretFd=openSync(secretPath,existsSync(secretPath)?'r+':'wx',mode),keyFd=openSync(keyPath,'r');
  try {const result=spawnSync(process.execPath,[resolve('scripts/provision-static-credential.mjs'),...args],{encoding:'utf8',env:{...process.env,...extraEnv},stdio:['ignore','pipe','pipe',secretFd,keyFd]});
   return {status:result.status,stdout:result.stdout??'',stderr:result.stderr??'',secretPath,token:readFileSync(secretPath,'utf8')};}
  finally{closeSync(secretFd);closeSync(keyFd);}
 };
 const create=(c:ReturnType<typeof config>,prior?:{config:string;bundle:string},credential=c.static_credential_refs.at(-1)!,name='bundle-'+c.config_epoch+'.json')=>{
  const configPath=put('config-'+c.config_epoch+'-'+randomBytes(3).toString('hex')+'.json',c),bundle=join(dir,name);
  const args=['create',...(prior?['--prior-config',prior.config,'--prior-bundle',prior.bundle]:['--initialize']),'--config',configPath,'--workspace',credential.workspace_id,'--agent',credential.agent_id,'--credential-id',credential.credential_id,'--expires-at',credential.expires_at,'--secret-output-fd','3','--integrity-key-fd','4','--bundle-output',bundle];
  return {...invoke(args),config:configPath,bundle,args};
 };
 return {dir,key,keyPath,put,config,invoke,create};
}
function green(result:{status:number|null}){expect(result.status).toBe(0);}
function read(path:string){return JSON.parse(readFileSync(path,'utf8'));}
it('hash_bundle_never_contains_raw_token',()=>{
 const f=setup(),out=f.create(f.config(1));green(out);
 const b=read(out.bundle),token=out.token.trim();
 expect(/^[A-Za-z0-9_-]{43}$/.test(token)).toBe(true);
 expect(statSync(out.secretPath).mode&0o777).toBe(0o600);expect(statSync(out.bundle).mode&0o777).toBe(0o600);
 expect(b.credentials[0].token_sha256===createHash('sha256').update(token).digest('hex')).toBe(true);
 expect(JSON.stringify(b).includes(token)||out.stdout.includes(token)||out.stderr.includes(token)).toBe(false);
 const {tag,...auth}=b.auth,material={...b,auth};
 expect(tag===createHmac('sha256',Buffer.from(f.key.key_base64,'base64')).update(canonical(material)).digest('hex')).toBe(true);
 expect(out.stdout.includes(b.credentials[0].token_sha256)||out.stdout.includes(f.key.key_base64)).toBe(false);
});
it('two_participants_preserve_first_hash',()=>{
 const f=setup(),c1=f.config(1),one=f.create(c1);green(one);
 const c2=structuredClone(c1);c2.config_epoch=2;c2.static_participants.push({workspace_id:'ws_example',agent_id:'agent_writer',display_name:'Writer'});
 c2.static_credential_refs.push({...c1.static_credential_refs[0],agent_id:'agent_writer',credential_id:'credential_writer_1'});
 const two=f.create(c2,one);green(two);
 const a=read(one.bundle),b=read(two.bundle);
 expect(b.credentials.length).toBe(2);expect(b.credentials.find((x:any)=>x.credential_id==='credential_research_1').token_sha256===a.credentials[0].token_sha256).toBe(true);
 expect(two.token.trim()!==one.token.trim()).toBe(true);
});
it('overlapping_rotation_preserves_predecessor',()=>{
 const f=setup(),c1=f.config(1),one=f.create(c1);green(one);
 const c2=structuredClone(c1);c2.config_epoch=2;c2.static_credential_refs.push({...c1.static_credential_refs[0],credential_id:'credential_research_2'});
 const two=f.create(c2,one);green(two);expect(read(two.bundle).credentials.length).toBe(2);
 expect(read(two.bundle).credentials.find((x:any)=>x.credential_id==='credential_research_1').token_sha256===read(one.bundle).credentials[0].token_sha256).toBe(true);
});
it('retire_then_config_only_epoch_preserves_tombstone',()=>{
 const f=setup(),c1=f.config(1),one=f.create(c1);green(one);
 const c2=structuredClone(c1);c2.config_epoch=2;c2.static_credential_refs=[];
 const p2=f.put('retired-config.json',c2),b2=join(f.dir,'retired-bundle.json');
 green(f.invoke(['assemble','--prior-config',one.config,'--prior-bundle',one.bundle,'--config',p2,'--retire','credential_research_1','--integrity-key-fd','4','--bundle-output',b2]));
 const c3=structuredClone(c2);c3.config_epoch=3;c3.static_participants[0].display_name='Renamed';
 const p3=f.put('next-config.json',c3),b3=join(f.dir,'next-bundle.json');
 green(f.invoke(['assemble','--prior-config',p2,'--prior-bundle',b2,'--config',p3,'--integrity-key-fd','4','--bundle-output',b3]));
 const retired=read(b3).retired_credentials;expect(retired.length).toBe(1);expect(retired[0].retired_at_epoch).toBe(2);
 expect(retired[0].token_sha256===read(one.bundle).credentials[0].token_sha256).toBe(true);expect(read(b3).credentials).toEqual([]);
 const revive=structuredClone(c1);revive.config_epoch=4;const revived=f.create(revive,{config:p3,bundle:b3});expect(revived.status).not.toBe(0);expect(revived.token.length).toBe(0);expect(existsSync(revived.bundle)).toBe(false);
});
it('lost_reveal_requires_new_credential',()=>{
 const f=setup(),c1=f.config(1),one=f.create(c1);green(one);
 const c2=structuredClone(c1);c2.config_epoch=2;
 const reused=f.create(c2,one);expect(reused.status).not.toBe(0);expect(reused.token.length).toBe(0);expect(existsSync(reused.bundle)).toBe(false);
 c2.static_credential_refs.push({...c1.static_credential_refs[0],credential_id:'credential_replacement'});
 const replacement=f.create(c2,one);green(replacement);expect(replacement.token.trim()!==one.token.trim()).toBe(true);
});
it('prior_bundle_signature_or_digest_mismatch_denied',()=>{
 for(const mutation of ['signature','digest']){
  const f=setup(),c1=f.config(1),one=f.create(c1);green(one);const b=read(one.bundle);
  if(mutation==='signature')b.auth.tag='f'.repeat(64);else {
   b.config_digest='f'.repeat(64);const {tag:_,...auth}=b.auth;
   b.auth.tag=createHmac('sha256',Buffer.from(f.key.key_base64,'base64')).update(canonical({...b,auth})).digest('hex');
  }
  const bad=f.put('bad-bundle.json',b),c2=structuredClone(c1);c2.config_epoch=2;c2.static_credential_refs.push({...c1.static_credential_refs[0],credential_id:'credential_second'});
  const before=readFileSync(one.bundle,'utf8'),out=f.create(c2,{config:one.config,bundle:bad});expect(out.status).not.toBe(0);expect(out.token.length).toBe(0);expect(existsSync(out.bundle)).toBe(false);
  expect(readFileSync(one.bundle,'utf8')===before).toBe(true);
 }
});
it('existing_id_actor_change_denied_and_omitted_retirement_denied',()=>{
 for(const mutation of ['actor','omit']){
  const f=setup(),c1=f.config(1),one=f.create(c1);green(one);const c2=structuredClone(c1);c2.config_epoch=2;
  if(mutation==='actor'){c2.static_participants.push({workspace_id:'ws_example',agent_id:'agent_second',display_name:'Second'});c2.static_credential_refs[0].agent_id='agent_second';}else c2.static_credential_refs=[];
  const config=f.put('next.json',c2),bundle=join(f.dir,'next-bundle.json'),out=f.invoke(['assemble','--prior-config',one.config,'--prior-bundle',one.bundle,'--config',config,'--integrity-key-fd','4','--bundle-output',bundle]);
  expect(out.status).not.toBe(0);expect(existsSync(bundle)).toBe(false);
 }
});
it('existing_file_refusal_permissions_symlinks_and_stdout_stderr_redaction',()=>{
 const f=setup(),c=f.config(1),one=f.create(c);green(one);const prior=readFileSync(one.bundle,'utf8');
 const again=f.invoke(one.args);expect(again.status).not.toBe(0);expect(again.token.length).toBe(0);expect(readFileSync(one.bundle,'utf8')===prior).toBe(true);
 const config=f.put('mode.json',c);chmodSync(config,0o644);
 const args=[...one.args];args[args.indexOf('--config')+1]=config;args[args.indexOf('--bundle-output')+1]=join(f.dir,'denied.json');
 const insecure=f.invoke(args);expect(insecure.status).not.toBe(0);expect(insecure.token.length).toBe(0);
 chmodSync(config,0o600);const link=join(f.dir,'symlink.json');symlinkSync(config,link);args[args.indexOf('--config')+1]=link;
 const symlink=f.invoke(args);expect(symlink.status).not.toBe(0);expect(symlink.token.length).toBe(0);
 args[args.indexOf('--config')+1]=config;const weakOutput=f.invoke(args,'weak-output',0o644);expect(weakOutput.status).not.toBe(0);
 const wrongOwnerMode=f.invoke(args,'read-only-output',0o400);expect(wrongOwnerMode.status).not.toBe(0);
 const stdout=[...args];stdout[stdout.indexOf('--secret-output-fd')+1]='1';expect(f.invoke(stdout).status).not.toBe(0);
 const nonempty=join(f.dir,'existing-token');writeFileSync(nonempty,'do not replace',{mode:0o600});expect(f.invoke(args,'existing-token').status).not.toBe(0);expect(readFileSync(nonempty,'utf8')).toBe('do not replace');
 expect(readdirSync(f.dir).some(x=>x.includes('.tmp-'))).toBe(false);
 for(const result of [again,insecure,symlink,weakOutput])expect(result.stdout.includes(one.token.trim())||result.stderr.includes(one.token.trim())||result.stderr.includes(f.key.key_base64)).toBe(false);
});
it('assemble_forbids_token_arguments_and_create_validates_exact_reference',()=>{
 const f=setup(),c=f.config(1),one=f.create(c);green(one);
 const c2=structuredClone(c);c2.config_epoch=2;const config=f.put('second.json',c2),out=join(f.dir,'second-bundle.json');
 const args=['assemble','--prior-config',one.config,'--prior-bundle',one.bundle,'--config',config,'--integrity-key-fd','4','--bundle-output',out,'--secret-output-fd','3'];
 expect(f.invoke(args).status).not.toBe(0);expect(existsSync(out)).toBe(false);
 const bad=[...one.args];bad[bad.indexOf('--expires-at')+1]=new Date(Date.now()+91*86400000).toISOString();bad[bad.indexOf('--bundle-output')+1]=out;
 expect(f.invoke(bad).status).not.toBe(0);expect(existsSync(out)).toBe(false);
});

import {spawn} from 'node:child_process';
import {operatorCliHarness} from '../helpers/operator-cli-harness';
function asyncCli(args:string[],extra:Record<string,string>){
 return new Promise<{status:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,[resolvePath('scripts/provision-static-credential.mjs'),...args],{env:{...process.env,...extra},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>{stdout+=x;});child.stderr.on('data',x=>{stderr+=x;});
  child.once('error',reject);child.once('exit',status=>resolve({status,stdout,stderr}));
 });
}
const resolvePath=resolve;
it('actual_cli_install_uses_authenticated_gateway_and_current_durable_authority',async()=>{
 const f=setup(),harness=await operatorCliHarness(f.dir);
 try{
  writeFileSync(f.keyPath,JSON.stringify(harness.key));
  const network={NODE_OPTIONS:'--import '+resolve('test/helpers/operator-cli-network.mjs'),CFHUB_TEST_OPERATOR_PORT:String(harness.port),CFHUB_TEST_OPERATOR_CERT:harness.certificate};
  const legacy='a'.repeat(64),modern='cfast_'+'b'.repeat(48);harness.secrets.add(legacy);harness.secrets.add(modern);
  const c1=f.config(3);c1.workspace_catalog[0].object_name='operator-fixture-workspace';const one=f.create(c1);green(one);
  const operator=(operation_id:string,expected_authority_epoch:number,secret=legacy)=>({origin:'https://operator.example.invalid',environment_id:'fixture',workspace_id:'ws_example',allowed_workspace_ids:['ws_example'],service:{client_id:'fixture-client.access',client_secret:secret,principal_id:'operator_fixture'},integrity_key:harness.key,operation_id,expected_authority_epoch,reason:'Synthetic install verification'});
  const install=async(item:{config:string;bundle:string},op:ReturnType<typeof operator>)=>{
   const path=f.put('operator-'+randomBytes(6).toString('hex')+'.json',op);
   return asyncCli(['install','--operator-config',path,'--config',item.config,'--bundle',item.bundle],network);
  };
  const first=await install(one,operator('install_first',0));green(first);
  const receipt=JSON.parse(first.stdout).receipt;expect(receipt.epoch).toBe(3);
  const b1=read(one.bundle),expectedDigest=createHash('sha256').update(canonical({config:c1,credentials:b1.credentials,retired_credentials:[]})).digest('hex');
  expect(receipt.installation_digest===expectedDigest).toBe(true);expect(receipt.operator_principal_id).toBe('operator_fixture');
  expect(harness.calls.secretFormat).toBe('legacy');
  const replay=await install(one,operator('install_first',0,modern));green(replay);
  expect(JSON.stringify(JSON.parse(replay.stdout).receipt)===JSON.stringify(receipt)).toBe(true);expect(harness.calls.secretFormat).toBe('new');
  const denied=await install(one,operator('different_operation',3));expect(denied.status).not.toBe(0);
  const changed=await install(one,{...operator('install_first',0),reason:'changed'});expect(changed.status).not.toBe(0);
  const c2=structuredClone(c1);c2.config_epoch=4;c2.static_credential_refs.push({...c1.static_credential_refs[0],credential_id:'credential_research_2'});
  const two=f.create(c2,one);green(two);green(await install(two,operator('install_rotation',3)));
  const c3=structuredClone(c2);c3.config_epoch=5;c3.static_credential_refs=c3.static_credential_refs.filter(x=>x.credential_id!=='credential_research_1');
  const config=f.put('retire-installed.json',c3),bundle=join(f.dir,'retire-installed-bundle.json');
  green(f.invoke(['assemble','--prior-config',two.config,'--prior-bundle',two.bundle,'--config',config,'--retire','credential_research_1','--integrity-key-fd','4','--bundle-output',bundle]));
  const retired=await install({config,bundle},operator('install_retirement',4));green(retired);expect(JSON.parse(retired.stdout).receipt.epoch).toBe(5);
  const state=await harness.authority();
  expect(state.epoch).toBe(5);expect(state.active).toBe(1);expect(state.retired).toBe(1);expect(state.receipts).toBe(3);expect(state.events).toBe(3);
  // Authenticated synthetic material exercises install directly, bypassing create/assemble.
  const signed=(config:typeof c1,b:any)=>{
   b.config_epoch=config.config_epoch;b.config_digest=createHash('sha256').update(canonical(config)).digest('hex');
   const {tag:_,...auth}=b.auth;
   b.auth.tag=createHmac('sha256',Buffer.from(harness.key.key_base64,'base64')).update(canonical({...b,auth})).digest('hex');
   return {config:f.put('reviewed-'+randomBytes(5).toString('hex')+'.json',config),bundle:f.put('signed-'+randomBytes(5).toString('hex')+'.json',b)};
  };
  const c4=structuredClone(c3);c4.config_epoch=6;
  const orphan=read(bundle);orphan.retired_credentials[0].agent_id='missing_agent';
  let beforeInvalid=harness.calls.count;
  const orphanDenied=await install(signed(c4,orphan),operator('orphan_retired_participant',5));
  expect(orphanDenied.status).not.toBe(0);expect(harness.calls.count).toBe(beforeInvalid);
  expect(await harness.authority()).toEqual(state);
  const dropped=structuredClone(c4);dropped.static_credential_refs=[];dropped.static_participants=[];dropped.workspace_policies[0].notification_destinations=[];
  const droppedBundle=read(bundle),remaining=droppedBundle.credentials.pop();
  droppedBundle.retired_credentials.push({...remaining,agent_id:'agent_research',retired_at_epoch:6});
  beforeInvalid=harness.calls.count;
  const droppedDenied=await install(signed(dropped,droppedBundle),operator('drop_retired_participant',5));
  expect(droppedDenied.status).not.toBe(0);expect(harness.calls.count).toBe(beforeInvalid);
  expect(await harness.authority()).toEqual(state);
  const omitted=read(bundle);omitted.credentials=[];omitted.retired_credentials=[];
  const omittedDenied=await install(signed(dropped,omitted),operator('omit_stored_retirement',5));
  expect(omittedDenied.status).not.toBe(0);expect(harness.calls.count).toBe(beforeInvalid+1);
  expect(await harness.authority()).toEqual(state);
  const retained=await install(signed(c4,read(bundle)),operator('valid_retained_history',5));green(retained);
  expect(await harness.authority()).toEqual({...state,epoch:6,receipts:4,events:4});
  const invalidTlsOperator=f.put('operator-tls-negative.json',operator('tls_negative',6));
  const beforeTls=harness.calls.count;
  const tlsDenied=await asyncCli(['install','--operator-config',invalidTlsOperator,'--config',config,'--bundle',bundle],{...network,CFHUB_TEST_OPERATOR_CERT:harness.untrustedCertificate});
  expect(tlsDenied.status).not.toBe(0);expect(harness.calls.count).toBe(beforeTls);
  const before=harness.calls.count,badBundle=f.put('tampered-install.json',{...read(bundle),config_digest:'f'.repeat(64)});
  expect((await install({config,bundle:badBundle},operator('tampered',5))).status).not.toBe(0);expect(harness.calls.count).toBe(before);
  harness.calls.mode='redirect';expect((await install({config,bundle},operator('redirect',5))).status).not.toBe(0);expect(harness.calls.count).toBe(before+1);
  harness.calls.mode='human';expect((await install({config,bundle},operator('human',5))).status).not.toBe(0);
  for(const result of [first,replay,denied,changed,retired])expect(result.stdout.includes(one.token.trim())||result.stderr.includes(one.token.trim())||result.stdout.includes(legacy)||result.stderr.includes(modern)||result.stdout.includes(harness.key.key_base64)).toBe(false);
 }finally{await harness.close();}
},60000);

it('short_writes_complete_and_write_errors_leave_no_published_bundle',()=>{
 const f=setup(),c=f.config(1),config=f.put('short-config.json',c),bundle=join(f.dir,'short-bundle.json');
 const args=['create','--initialize','--config',config,'--workspace','ws_example','--agent','agent_research','--credential-id','credential_research_1','--expires-at',c.static_credential_refs[0].expires_at,'--secret-output-fd','3','--integrity-key-fd','4','--bundle-output',bundle];
 const fault={NODE_OPTIONS:'--import '+resolve('test/helpers/operator-short-write.mjs')};
 const completed=f.invoke(args,'short-token',0o600,fault);green(completed);
 expect(completed.token.trim().length).toBe(43);
 let valid=false;try{const value=read(bundle);valid=value.credentials[0].token_sha256===createHash('sha256').update(completed.token.trim()).digest('hex');}catch{}
 expect(valid).toBe(true);
 const failedPath=join(f.dir,'failed-write.json'),failedArgs=[...args];failedArgs[failedArgs.indexOf('--bundle-output')+1]=failedPath;
 const failed=f.invoke(failedArgs,'failed-token',0o600,{...fault,CFHUB_TEST_WRITE_FAILURE:'1'});
 expect(failed.status).not.toBe(0);expect(existsSync(failedPath)).toBe(false);
 expect(readdirSync(f.dir).some(x=>x.includes('.tmp-'))).toBe(false);
});
it('canonical deployment validation is directly importable by the supported Node CLI',()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',"await import('./src/config/deployment.ts');"],{encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);
});
it('operator provisioning preserves explicit execution policy in the signed configuration digest',()=>{
 const f=setup(),config=f.config(1),policy={policy_version:1,agent_wip_limit:1,task_retry_limit:2,artifact_upload_ttl_seconds:900,eligibility_rules:[{project_id:null,work_role_id:null,eligible_agent_ids:['agent_research']}],replay_safety_rules:[]};
 Object.assign(config.workspace_policies[0],{execution_policy:policy});const out=f.create(config);green(out);
 expect(read(out.config).workspace_policies[0].execution_policy).toEqual(policy);
 expect(read(out.bundle).config_digest).toBe(createHash('sha256').update(canonical(config)).digest('hex'));
 const invalid=f.config(2);Object.assign(invalid.workspace_policies[0],{execution_policy:{...policy,eligibility_rules:[policy.eligibility_rules[0],policy.eligibility_rules[0]]}});
 const denied=f.create(invalid,out);expect(denied.status).not.toBe(0);expect(denied.token).toBe('');expect(existsSync(denied.bundle)).toBe(false);
});
