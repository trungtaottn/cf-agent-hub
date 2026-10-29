import {isAbsolute, normalize} from 'node:path';
import {isIP} from 'node:net';
const reject=()=>{throw Error('NATIVE_CONFIG_REJECTED');};
const object=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))reject();};
const id=value=>{if(typeof value!=='string'||!/^[-a-zA-Z0-9_]{1,128}$/.test(value))reject();};
const digest=(value,length=64)=>{if(typeof value!=='string'||!new RegExp(`^[a-f0-9]{${length}}$`).test(value))reject();};
const path=value=>{if(typeof value!=='string'||value.length>4096||!isAbsolute(value)||normalize(value)!==value||/[\x00-\x1f\x7f]/.test(value)||value==='/')reject();};
const integer=(value,min,max)=>{if(!Number.isSafeInteger(value)||value<min||value>max)reject();};
/** Structural validation only. HTTPS and a protected file do not authenticate isolation. */
export function validateNativeConfig(input){
 try{
  object(input,['version','candidate_sha','candidate_tree_sha','composition_sha256','node','build','origin','workspaces','actors','fixture_stores','fixture_directory','output_directory','authority_record_sha256','budgets']);
  if(input.version!==1)reject();digest(input.candidate_sha,40);digest(input.candidate_tree_sha,40);digest(input.composition_sha256);digest(input.authority_record_sha256);
  object(input.node,['path','sha256']);path(input.node.path);digest(input.node.sha256);
  object(input.build,['path','sha256']);path(input.build.path);if(!input.build.path.endsWith('.mjs'))reject();digest(input.build.sha256);
  if(typeof input.origin!=='string'||input.origin.length>2048)reject();
  const url=new URL(input.origin);
  if(url.protocol!=='https:'||url.origin!==input.origin||url.username||url.password||url.pathname!=='/'||url.search||url.hash||isIP(url.hostname.replace(/^\[|\]$/g,''))||url.hostname==='localhost'||url.hostname.endsWith('.localhost'))reject();
  object(input.workspaces,['primary','foreign']);id(input.workspaces.primary);id(input.workspaces.foreign);if(input.workspaces.primary===input.workspaces.foreign)reject();
  if(!Array.isArray(input.actors))reject();integer(input.actors.length,2,8);
  const unique=new Map(['id','principal_id','agent_id','state_directory'].map(k=>[k,new Set()]));
  for(const actor of input.actors){object(actor,['id','principal_id','agent_id','state_directory']);id(actor.id);id(actor.principal_id);id(actor.agent_id);path(actor.state_directory);if(actor.principal_id!==actor.agent_id)reject();for(const [key,set] of unique){if(set.has(actor[key]))reject();set.add(actor[key]);}}
  if(!Array.isArray(input.fixture_stores)||input.fixture_stores.length>4)reject();
  const fixtures=new Set();
  for(const item of input.fixture_stores){
   object(item,['fixture','actor_slot','principal_id','agent_id','state_directory']);
   if(!['swap-slot','swap-generation','swap-principal','server-foreign-workspace'].includes(item.fixture)||fixtures.has(item.fixture)||item.actor_slot!=='submitter'||!unique.get('id').has(item.actor_slot))reject();
   fixtures.add(item.fixture);id(item.principal_id);id(item.agent_id);path(item.state_directory);if(item.principal_id!==item.agent_id||unique.get('state_directory').has(item.state_directory))reject();unique.get('state_directory').add(item.state_directory);
  }
  path(input.fixture_directory);path(input.output_directory);
  const directories=[...unique.get('state_directory'),input.fixture_directory,input.output_directory];
  for(let i=0;i<directories.length;i++)for(let j=i+1;j<directories.length;j++)if(directories[i]===directories[j]||directories[i].startsWith(directories[j]+'/')||directories[j].startsWith(directories[i]+'/'))reject();
  object(input.budgets,['commands','mutations','artifact_bytes','duration_ms','output_bytes']);
  integer(input.budgets.commands,1,128);integer(input.budgets.mutations,1,input.budgets.commands);integer(input.budgets.artifact_bytes,0,10485760);integer(input.budgets.duration_ms,1,300000);integer(input.budgets.output_bytes,1,1048576);
  return structuredClone(input);
 }catch{return reject();}
}
