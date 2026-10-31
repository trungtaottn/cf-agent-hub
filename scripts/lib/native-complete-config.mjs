/** Structural complete-profile configuration only, never installation authority.
 * Kept separate from config1 to preserve its historical contract and verdicts.
 */
import {types} from 'node:util';
import {isAbsolute,normalize} from 'node:path';
import {isIP} from 'node:net';
import {validateCompleteBudget} from './native-complete-profile.mjs';
import {selectCompleteProfile} from './native-profile-selection.mjs';
const fail=()=>{throw Error('NATIVE_COMPLETE_CONFIG_REJECTED');};
function snapshot(input){
 let nodes=0,bytes=0;
 const charge=n=>{bytes+=n;if(bytes>65536)fail();};
 function copy(v,depth=0){
  if(++nodes>1024||depth>8)fail();
  if(v===null||typeof v==='boolean'){charge(5);return v;}
  if(typeof v==='number'){if(!Number.isSafeInteger(v)||Object.is(v,-0))fail();charge(24);return v;}
  if(typeof v==='string'){if(v.length>4096)fail();charge(Buffer.byteLength(JSON.stringify(v)));return v;}
  if(!v||typeof v!=='object'||types.isProxy(v))fail();
  if(Array.isArray(v)){
   if(Object.getPrototypeOf(v)!==Array.prototype)fail();
   const length=Object.getOwnPropertyDescriptor(v,'length')?.value;
   if(!Number.isSafeInteger(length)||length>8)fail();
   if(Reflect.ownKeys(v).length!==length+1)fail();
   charge(length+2);const out=[];
   for(let i=0;i<length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out.push(copy(d.value,depth+1));}return out;
  }
  if(Object.getPrototypeOf(v)!==Object.prototype)fail();
  const keys=Reflect.ownKeys(v);if(keys.length>32||keys.some(k=>typeof k!=='string'))fail();
  charge(2);const out={};
  for(const key of keys){if(key.length>128||key==='__proto__')fail();const d=Object.getOwnPropertyDescriptor(v,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();charge(Buffer.byteLength(JSON.stringify(key))+2);out[key]=copy(d.value,depth+1);}return out;
 }
 return copy(input);
}
const keys=(v,expected)=>{if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).sort().join(',')!==expected.split(' ').sort().join(','))fail();};
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(v))fail();};
const digest=(v,n=64)=>{if(typeof v!=='string'||!(new RegExp(`^[a-f0-9]{${n}}$`)).test(v))fail();};
const path=v=>{if(typeof v!=='string'||v.length>4096||v==='/'||!isAbsolute(v)||normalize(v)!==v||/[\x00-\x1f\x7f]/.test(v))fail();};
export function validateCompleteConfig(input){
 try{
  const c=snapshot(input),selected=selectCompleteProfile(c.profile),p=selected.profile,commitments=selected.commitments;
  keys(c,'version profile fixture_sha256 family_ledger_sha256 candidate_sha candidate_tree_sha composition_sha256 node build origin workspaces actors fixture_stores fixture_directory output_directory authority_record_sha256 budgets');
  if(c.version!==2||c.profile!==p.profile||c.fixture_sha256!==commitments.fixture_sha256||c.family_ledger_sha256!==commitments.family_ledger_sha256)fail();
  digest(c.candidate_sha,40);digest(c.candidate_tree_sha,40);digest(c.composition_sha256);digest(c.authority_record_sha256);
  for(const field of ['node','build']){keys(c[field],'path sha256');path(c[field].path);digest(c[field].sha256);}
  if(!c.build.path.endsWith('.mjs'))fail();
  if(typeof c.origin!=='string'||c.origin.length>128||/[^\x21-\x7e]/.test(c.origin))fail();
  const url=new URL(c.origin),host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(url.protocol!=='https:'||url.origin!==c.origin||url.username||url.password||url.pathname!=='/'||url.search||url.hash||isIP(host)||host==='localhost'||host.endsWith('.localhost'))fail();
  keys(c.workspaces,'primary foreign');id(c.workspaces.primary);id(c.workspaces.foreign);if(c.workspaces.primary===c.workspaces.foreign)fail();
  if(!Array.isArray(c.actors)||c.actors.length!==2)fail();
  for(const [i,role] of ['submitter','reviewer'].entries()){
   const actor=c.actors[i];keys(actor,'id principal_id agent_id state_directory');
   if(actor.id!==role||actor.principal_id!==actor.agent_id)fail();id(actor.agent_id);path(actor.state_directory);
  }
  const [submitter,reviewer]=c.actors;if(submitter.agent_id===reviewer.agent_id)fail();
  if(!Array.isArray(c.fixture_stores)||c.fixture_stores.length!==1)fail();
  const foreign=c.fixture_stores[0];keys(foreign,'fixture actor_slot principal_id agent_id state_directory');
  if(foreign.fixture!=='server-foreign-workspace'||foreign.actor_slot!=='submitter'||foreign.agent_id!==submitter.agent_id||foreign.principal_id!==submitter.principal_id)fail();path(foreign.state_directory);
  path(c.fixture_directory);path(c.output_directory);
  const dirs=[submitter.state_directory,reviewer.state_directory,foreign.state_directory,c.fixture_directory,c.output_directory];
  for(let i=0;i<dirs.length;i++)for(let j=i+1;j<dirs.length;j++)if(dirs[i]===dirs[j]||dirs[i].startsWith(dirs[j]+'/')||dirs[j].startsWith(dirs[i]+'/'))fail();
  if(['native-r2-complete-prepared-v1','native-r2-complete-schema17-v1'].includes(p.profile))c.budgets=validateCompleteBudget(c.budgets);
  else{
   keys(c.budgets,'commands mutations artifact_bytes output_bytes duration_ms');
   for(const [k,value] of Object.entries(p.reservation))if(c.budgets[k]!==value)fail();
   const duration=c.budgets.duration_ms;if(!Number.isSafeInteger(duration)||duration<1||duration>300000)fail();
   c.budgets=Object.freeze({...c.budgets});
  }return c;
 }catch{fail();}
}
