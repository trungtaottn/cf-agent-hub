import test,{mock} from 'node:test';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {runOwnedProcess} from '../../scripts/lib/native-r2-process.mjs';
import {custodyDiagnostic} from '../helpers/native-custody-diagnostic.mjs';
test('owned process rejects absent closed input without leaking details',async()=>{
 for(const value of [undefined,null,{}, {nodePath:'private-secret'}])await assert.rejects(()=>runOwnedProcess(value),error=>error.message==='NATIVE_PROCESS_INPUT_REJECTED');
});
import {initialProcessLifecycle,reduceProcessLifecycle,PROCESS_LIMITS} from '../../scripts/lib/native-r2-process.mjs';
import {mkdtempSync,writeFileSync,readFileSync,lstatSync,readdirSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
function policy(options={}){return initialProcessLifecycle({timeoutMs:100,maxOutputBytes:8,...options},0);}
function event(state,type,fields={}){return reduceProcessLifecycle(state,{type,now:0,...fields});}
test('pure lifecycle combines stdout and stderr at exact bound without allocating output',()=>{
 let s=policy();let step=event(s,'data',{byteLength:5});s=step.state;assert.equal(step.retainBytes,5);
 step=event(s,'data',{byteLength:3});s=step.state;assert.equal(step.retainBytes,3);assert.equal(s.phase,'running');assert.equal(s.retainedBytes,8);
 step=event(s,'data',{byteLength:1});assert.equal(step.retainBytes,0);assert.equal(step.state.observedBytes,9);assert.equal(step.state.truncated,true);assert.deepEqual(step.actions,['SIGTERM']);
});
test('pure oversized single chunk retains only remaining combined budget',()=>{
 const step=event(policy(),'data',{byteLength:65536});assert.equal(step.retainBytes,8);assert.equal(step.state.retainedBytes,8);assert.equal(step.state.observedBytes,65536);
});
test('pure timeout TERM KILL drain expiry stays unknown without observed close',()=>{
 let step=event(policy(),'tick',{now:99});assert.deepEqual(step.actions,[]);
 step=event(step.state,'tick',{now:100});assert.deepEqual(step.actions,['SIGTERM']);assert.equal(step.state.status,null);
 step=event(step.state,'tick',{now:100+PROCESS_LIMITS.termGraceMs});assert.deepEqual(step.actions,['SIGKILL']);
 step=event(step.state,'tick',{now:100+PROCESS_LIMITS.termGraceMs+PROCESS_LIMITS.drainGraceMs});assert.deepEqual(step.actions,['abandon']);assert.equal(step.state.status,'unknown');assert.equal(step.state.closeObserved,false);
});
test('only observed close can establish terminal, including nonzero exit',()=>{
 for(const exitCode of [0,3,5,1]){const step=event(policy(),'close',{exitCode,signal:null});assert.equal(step.state.status,'terminal');assert.equal(step.state.exitCode,exitCode);assert.equal(step.state.closeObserved,true);}
});
test('timeout close reports terminal child but retains timeout reason',()=>{
 let s=event(policy(),'tick',{now:100}).state;const step=event(s,'close',{now:101,exitCode:null,signal:'SIGTERM'});
 assert.equal(step.state.status,'terminal');assert.equal(step.state.reason,'timeout');assert.equal(step.state.signal,'SIGTERM');
});
test('custody persistence failure stays unknown even after child close',()=>{
 let step=event(policy(),'custody-error');assert.deepEqual(step.actions,['SIGTERM']);
 step=event(step.state,'close',{exitCode:null,signal:'SIGTERM'});assert.equal(step.state.status,'unknown');assert.equal(step.state.reason,'custody-failure');
});
test('custody failure during existing timeout cannot be downgraded',()=>{
 let s=event(policy(),'tick',{now:100}).state;s=event(s,'custody-error',{now:101}).state;
 const step=event(s,'close',{now:102,exitCode:0,signal:null});assert.equal(step.state.status,'unknown');assert.equal(step.state.reason,'custody-failure');
});
test('spawn error without close becomes unknown instead of invented terminal',()=>{
 let s=event(policy(),'spawn-error').state;s=event(s,'tick',{now:100}).state;s=event(s,'tick',{now:200}).state;assert.equal(s.status,'unknown');assert.equal(s.reason,'spawn-error');
});
test('terminal and unknown states do not absorb later evidence or retry actions',()=>{
 for(const s of [event(policy(),'close',{exitCode:0,signal:null}).state,{...policy(),phase:'finished',status:'unknown'}]){
  const next=event(s,'data',{byteLength:65536});assert.deepEqual(next.state,s);assert.deepEqual(next.actions,[]);assert.equal(next.retainBytes,0);
 }
});
test('pure invalid event and limit inputs reject with fixed message',()=>{
 for(const options of [{timeoutMs:0},{timeoutMs:300001},{maxOutputBytes:0},{maxOutputBytes:1048577}])assert.throws(()=>policy(options),/NATIVE_PROCESS_INPUT_REJECTED/);
 for(const e of [{type:'data',byteLength:-1},{type:'tick',now:NaN},{type:'close',exitCode:'private-secret',signal:null},{type:'unknown'}])assert.throws(()=>reduceProcessLifecycle(policy(),{now:0,...e}),/NATIVE_PROCESS_INPUT_REJECTED/);
});
let runtimeDigest;
function specification(directory){
 const entryPath=join(directory,'synthetic.mjs');writeFileSync(entryPath,'process.stdout.write("synthetic only")',{mode:0o600});
 const nodePath=realpathSync(process.execPath),nodeSha256=runtimeDigest??=hash(readFileSync(nodePath)),entrySha256=hash(readFileSync(entryPath));
 return {nodePath,entryPath,args:[],cwd:directory,env:{LANG:'C',TZ:'UTC'},receiptDirectory:directory,timeoutMs:1000,maxOutputBytes:1024,invocationId:'inv_source',nodeSha256,entrySha256,subjects:{config_sha256:hash('config'),candidate_sha:'a'.repeat(40),candidate_tree_sha:'b'.repeat(40),composition_sha256:hash('composition'),node_sha256:nodeSha256,build_sha256:entrySha256,authority_record_sha256:hash('not-authority'),scenario_sha256:hash('scenario'),actors_sha256:hash('actors'),workspaces_sha256:hash('workspaces')}};
}
async function withSpec(fn,assertNoSpawn=true){
 const dir=mkdtempSync(join(tmpdir(),'native-r2-source-'));let calls=0;
 const spy=assertNoSpawn?mock.method(childProcess,'spawn',()=>{calls++;throw Error('UNEXPECTED_SOURCE_SPAWN');}):null;
 if(spy)syncBuiltinESMExports();
 try{await fn(specification(dir),dir);if(assertNoSpawn)assert.equal(calls,0,'rejection must precede spawn');}
 finally{spy?.mock.restore();if(spy)syncBuiltinESMExports();rmSync(dir,{recursive:true,force:true});}
}
for(const key of ['NODE_OPTIONS','NODE_PATH','PATH','HOME','CF_AGENT_HUB_TOKEN','HTTP_PROXY','HTTPS_PROXY','NODE_TLS_REJECT_UNAUTHORIZED'])test('rejects unsafe '+key+' before invocation',()=>withSpec(async(spec,dir)=>{
 spec.env[key]='private-secret';await assert.rejects(()=>runOwnedProcess(spec),error=>error.message==='NATIVE_PROCESS_ENV_REJECTED');assert.deepEqual(readdirSync(dir),['synthetic.mjs']);
}));
for(const [label,mutate] of [
 ['unknown field',s=>{s.shell=true;}],['relative Node',s=>{s.nodePath='node';}],['relative entry',s=>{s.entryPath='synthetic.mjs';}],['noncanonical cwd',s=>{s.cwd+='/.';}],['receipt traversal',s=>{s.invocationId='../private-secret';}],['missing actor binding',s=>{delete s.subjects.actors_sha256;}],['mismatched bundle subject',s=>{s.subjects.build_sha256=hash('other');}],['mismatched Node subject',s=>{s.subjects.node_sha256=hash('other');}],['unsafe argument',s=>{s.args=['private\nsecret'];}],['oversized args',s=>{s.args=['a'.repeat(8193)];}],['shell command field',s=>{s.command='sh -c private-secret';}],['missing config subject',s=>{delete s.subjects.config_sha256;}],['mutable function value',s=>{s.args=[()=>1];}]
])test('rejects '+label+' before custody or spawn',()=>withSpec(async(spec,dir)=>{
 mutate(spec);await assert.rejects(()=>runOwnedProcess(spec),error=>error.message==='NATIVE_PROCESS_INPUT_REJECTED');assert.deepEqual(readdirSync(dir),['synthetic.mjs']);
}));
test('actual managed runtime owner failure stays blocked without copying or relaxing Node custody',()=>withSpec(async(spec,dir)=>{
 const owner=lstatSync(spec.nodePath).uid;
 if([0,process.getuid()].includes(owner))return; // This environment's specific negative is inapplicable elsewhere.
 await assert.rejects(()=>runOwnedProcess(spec),error=>error.message==='NATIVE_PROCESS_INPUT_REJECTED');assert.deepEqual(readdirSync(dir),['synthetic.mjs']);
}));
test('real owned process positive execution remains blocked pending trusted runtime custody',{skip:![0,process.getuid()].includes(lstatSync(process.execPath).uid)?'Managed Node UID65534 is not currentUID/root; no host attestation or alternate-root bypass':false},t=>withSpec(async(spec)=>{
 let result;try{result=await runOwnedProcess(spec);}catch(error){t.diagnostic('custody-predicates '+JSON.stringify(custodyDiagnostic(spec)));throw error;}assert.equal(result.status,'terminal');assert.equal(result.exitCode,0);assert.equal(result.readCapturedOutput().stdout.toString(),'synthetic only');assert.equal(Object.keys(result).includes('readCapturedOutput'),false);assert.equal(JSON.stringify(result).includes('synthetic only'),false);
},false));

import {projectProcessTranscripts} from '../../scripts/lib/native-r2-process.mjs';
const transcript={stdout:{name:'inv_source.stdout',sha256:'a'.repeat(64),byteSize:8}};
test('complete transcript requires observed close and no truncation',()=>{
 const s=event(policy(),'close',{exitCode:0,signal:null}).state;assert.equal(projectProcessTranscripts(s,transcript).stdout.complete,true);
});
test('overflow followed by close preserves only incomplete prefix metadata',()=>{
 let s=event(policy(),'data',{byteLength:9}).state;s=event(s,'close',{exitCode:null,signal:'SIGTERM'}).state;
 assert.equal(projectProcessTranscripts(s,transcript).stdout.complete,false);
});
test('unknown no-close transcript can never claim complete',()=>{
 const s={...policy(),phase:'finished',status:'unknown',closeObserved:false};assert.equal(projectProcessTranscripts(s,transcript).stdout.complete,false);
});
