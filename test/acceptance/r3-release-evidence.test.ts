import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {verifyRelease} from '../../scripts/verify-release.mjs';

const pending = (input:unknown) => {
 const result=verifyRelease(input,new Map());
 expect(result).toMatchObject({passed:false,scope:'structural-only',acceptance:'pending-external-inspection'});
 expect(result.findings.some(x=>x.code==='R3_PROFILE_INCOMPLETE')).toBe(true);
};
it('recognizes R3 without accepting a synthetic fixture or caller supplied pass',()=>{
 for(const input of [{round:'R3'}, {round:'R3',format_version:1,profile:'r3-runtime-v1',evidence_class:'source-fixture'}, {round:'R3',format_version:1,profile:'r3-runtime-v1',evidence_class:'runtime',passed:true,findings:[],exceptions:[]}])pending(input);
});
it('rejects unknown profiles rather than silently selecting an earlier round',()=>{
 for(const input of [{round:'R3',profile:'unknown'},{round:'R1',profile:'r3-runtime-v1'},{round:'R2',format_version:3,profile:'unknown'}]){
  const result=verifyRelease(input,new Map());
  expect(result.passed).toBe(false);
  expect(result.findings.some(x=>x.code==='UNKNOWN_RELEASE_PROFILE')).toBe(true);
 }
});
it('rejects proxy and nonplain routing inputs without invoking hooks',()=>{
 let calls=0;const hook=()=>{calls++;throw Error('hook invoked');};
 const proxy=new Proxy({round:'R3'},{get:hook,getPrototypeOf:hook,ownKeys:hook,getOwnPropertyDescriptor:hook});
 const revoked=Proxy.revocable({},{});revoked.revoke();
 for(const input of [proxy,revoked.proxy,Object.create({get round(){return hook();}}),Object.create({get profile(){return hook();}})]){
  expect(()=>verifyRelease(input,new Map())).not.toThrow();
  expect(verifyRelease(input,new Map()).passed).toBe(false);
 }
 expect(calls).toBe(0);
});
it('rejects own accessors before legacy dispatch or serialization invokes them',()=>{
 let calls=0;const hook=()=>{calls++;throw Error('hook invoked');};
 for(const field of ['profile','round','format_version','toJSON']){
  const input=Object.defineProperty({},field,{get:hook,enumerable:true});
  expect(()=>verifyRelease(input,new Map())).not.toThrow();
  expect(verifyRelease(input,new Map()).passed).toBe(false);
 }
 expect(calls).toBe(0);
});
it('R3 pending verdict never reads nested evidence or file-store hooks',()=>{
 let calls=0;const hook=()=>{calls++;throw Error('hook invoked');};
 const input={round:'R3',profile:'r3-runtime-v1',toJSON:hook,evidence:new Proxy({},{get:hook,ownKeys:hook})};
 const files=new Proxy(new Map(),{get:hook});
 expect(verifyRelease(input,files).passed).toBe(false);
 expect(calls).toBe(0);
});
it('CLI recognizes the R3 pending boundary without reading a supplied evidence path',()=>{
 const result=spawnSync(process.execPath,['scripts/verify-release.mjs','--round','R3','--evidence','/does-not-exist'],{encoding:'utf8'});
 expect(result.status).toBe(1);
 expect(result.stderr).toBe('');
 const verdict=JSON.parse(result.stdout);
 expect(verdict).toMatchObject({passed:false,scope:'structural-only',acceptance:'pending-external-inspection'});
 expect(verdict.findings.some((x:{code:string})=>x.code==='R3_PROFILE_INCOMPLETE')).toBe(true);
});

it('rejects inherited routing accessors on the otherwise plain-object prototype',()=>{
 let calls=0;
 for(const field of ['profile','round']){
  let result;
  try{
   Object.defineProperty(Object.prototype,field,{configurable:true,get(){calls++;throw Error('inherited hook');}});
   result=verifyRelease({},new Map());
  }finally{delete (Object.prototype as Record<string,unknown>)[field];}
  expect(result?.passed).toBe(false);
 }
 expect(calls).toBe(0);
});

import {controllerFixture} from './r2-controller-fixtures';
import {verifyR2Release} from '../../scripts/lib/r2-release-verifier.mjs';
it('preserves direct R2 verdicts for historical JSON roots and invalid mutations',()=>{
 for(const version of [2,3])for(const mutation of ['none','feature','command']){
  const f=controllerFixture();
  const root=JSON.parse(JSON.stringify(f.root));root.format_version=version;
  if(mutation==='feature')root.features.pop();
  if(mutation==='command')root.commands[0].exit_code=1;
  expect(verifyRelease(root,f.files)).toEqual(verifyR2Release(root,{files:f.files}));
 }
});
