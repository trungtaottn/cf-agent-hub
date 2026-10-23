#!/usr/bin/env node
import {randomBytes,createHash} from 'node:crypto';
import {parseDeployment} from '../src/config/deployment.ts';
import {canonicalJson,prepareBootstrap,sha256} from '../src/config/bootstrap.ts';
import {readProtectedJson,readProtectedFdJson,descriptor,validateRevealFd,publishBundle,fail} from './lib/protected-io.mjs';
import {integrityKey,authenticateBundle,signBundle} from './lib/bundle-integrity.mjs';

function argumentsFor(argv) {
 const operation=argv.shift();if(!['create','assemble','install'].includes(operation))fail();
 const options={},retire=[];
 for(let i=0;i<argv.length;i++){
  const name=argv[i];if(!name.startsWith('--'))fail();
  if(name==='--initialize'){if(options[name])fail();options[name]=true;continue;}
  const value=argv[++i];if(!value||value.startsWith('--'))fail();
  if(name==='--retire'){retire.push(value);continue;}
  if(Object.hasOwn(options,name))fail();options[name]=value;
 }
 const common=['--config','--prior-config','--prior-bundle','--initialize','--integrity-key-fd','--bundle-output'];
 const fresh=['--workspace','--agent','--credential-id','--expires-at','--secret-output-fd'];
 const allowed=operation==='install'?['--operator-config','--config','--bundle']:operation==='create'?[...common,...fresh]:common;
 if(Object.keys(options).some(x=>!allowed.includes(x))||operation==='install'&&retire.length)fail();
 for(const name of operation==='install'?allowed:operation==='create'?['--config','--integrity-key-fd','--bundle-output',...fresh]:['--config','--integrity-key-fd','--bundle-output'])if(!options[name])fail();
 if(operation!=='install'){
  if(options['--initialize']?(options['--prior-config']||options['--prior-bundle']||retire.length):(!options['--prior-config']||!options['--prior-bundle']))fail();
  if(new Set(retire).size!==retire.length)fail();
 }
 return {operation,options,retire};
}
const id=x=>JSON.stringify([x.workspace_id,x.credential_id]);
function material(config,bundle) {
 const current=new Map(bundle.credentials.map(x=>[id(x),x])),retired=new Map(bundle.retired_credentials.map(x=>[id(x),x]));
 if(current.size!==bundle.credentials.length||retired.size!==bundle.retired_credentials.length||current.size!==config.static_credential_refs.length)fail();
 for(const ref of config.static_credential_refs)if(!current.has(id(ref))||retired.has(id(ref)))fail();
 for(const tombstone of retired.values())if(!config.workspace_catalog.some(x=>x.workspace_id===tombstone.workspace_id)||!config.static_participants.some(x=>x.workspace_id===tombstone.workspace_id&&x.agent_id===tombstone.agent_id)||tombstone.retired_at_epoch>config.config_epoch)fail();
 return {current,retired};
}
async function assemble(operation,options,retire) {
 const keyFd=descriptor(options['--integrity-key-fd']),key=integrityKey(readProtectedFdJson(keyFd));
 const config=parseDeployment(readProtectedJson(options['--config']));
 let previous=null;
 if(!options['--initialize']){
  const priorConfig=parseDeployment(readProtectedJson(options['--prior-config'])),priorBundle=readProtectedJson(options['--prior-bundle']);
  authenticateBundle(priorBundle,key);
  await prepareBootstrap(priorConfig,priorBundle,priorConfig.workspace_catalog[0].workspace_id);
  material(priorConfig,priorBundle);
  if(config.config_epoch<=priorConfig.config_epoch)fail();
  for(const mapping of priorConfig.workspace_catalog){const next=config.workspace_catalog.find(x=>x.workspace_id===mapping.workspace_id);if(!next||next.object_name!==mapping.object_name)fail();}
  previous={config:priorConfig,bundle:priorBundle};
 }
 const credentials=structuredClone(previous?.bundle.credentials??[]),retired=structuredClone(previous?.bundle.retired_credentials??[]);
 for(const name of retire){
  const candidates=credentials.filter(x=>x.credential_id===name);if(candidates.length!==1)fail();
  const credential=candidates[0],prior=previous.config.static_credential_refs.find(x=>id(x)===id(credential));
  if(config.static_credential_refs.some(x=>id(x)===id(credential)))fail();
  credentials.splice(credentials.indexOf(credential),1);
  retired.push({...credential,agent_id:prior.agent_id,retired_at_epoch:config.config_epoch});
 }
 for(const old of previous?.config.static_credential_refs??[]){
  const next=config.static_credential_refs.find(x=>id(x)===id(old));
  if(next&&next.agent_id!==old.agent_id)fail();
  if(!next&&!retired.some(x=>id(x)===id(old)))fail();
 }
 let reveal,credential;
 if(operation==='create'){
  const fd=descriptor(options['--secret-output-fd']);if(fd===keyFd)fail();validateRevealFd(fd);
  credential=config.static_credential_refs.find(x=>x.workspace_id===options['--workspace']&&x.credential_id===options['--credential-id']);
  if(!credential||credential.agent_id!==options['--agent']||credential.expires_at!==options['--expires-at']||credentials.some(x=>id(x)===id(credential))||retired.some(x=>id(x)===id(credential)))fail();
  const now=Date.now(),expires=Date.parse(credential.expires_at);if(expires<=now||expires>now+90*86400000)fail();
  const token=randomBytes(32).toString('base64url');
  credentials.push({workspace_id:credential.workspace_id,credential_id:credential.credential_id,token_sha256:createHash('sha256').update(token).digest('hex')});
  reveal={fd,token};
 }
 const bundle=signBundle({contract_revision:'0.1',config_epoch:config.config_epoch,config_digest:await sha256(canonicalJson(config)),credentials,retired_credentials:retired},key);
 material(config,bundle);
 await prepareBootstrap(config,bundle,config.workspace_catalog[0].workspace_id);
 publishBundle(options['--bundle-output'],canonicalJson(bundle)+'\n',reveal);
 process.stdout.write(JSON.stringify({operation,config_epoch:config.config_epoch,...(credential?{workspace_id:credential.workspace_id,credential_id:credential.credential_id}:{})})+'\n');
}
try {
 const {operation,options,retire}=argumentsFor(process.argv.slice(2));
 if(operation==='install'){
  const {install}=await import('./lib/operator-install.mjs');await install(options);
 }else await assemble(operation,options,retire);
}catch{
 process.stderr.write('Operator command failed; no credential or protected input is included in diagnostics.\n');process.exitCode=1;
}
