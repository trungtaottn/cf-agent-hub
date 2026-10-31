import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalCaseSubject} from '../../scripts/lib/r2-case-policy.mjs';
import {completeOriginalCap,encodeCompleteOriginal,verifyCompleteOriginal} from '../../scripts/lib/native-complete-original-wire.mjs';
const pair=generateKeyPairSync('ed25519'),der=pair.publicKey.export({type:'spki',format:'der'}),hash=b=>createHash('sha256').update(b).digest('hex');
const meta=(family='independent-observation',slot={kind:'process',id:'success/getWorkspace'},bytes=Buffer.from('{}'))=>({profile:'native-r2-required-prepared-v1',service_id:'service',instance_id:'instance',run_id:'run',descriptor_sha256:'a'.repeat(64),policy_sha256:'b'.repeat(64),slot,invocation_id:slot.kind==='process'?'invocation':null,request_id:'request',sequence:1,producer_id:'producer',record_id:'record',family,preparation_sha256:'c'.repeat(64),byte_size:bytes.length,sha256:hash(bytes)});
const encode=(m,b)=>encodeCompleteOriginal({expected:m,bytes:b,privateKey:pair.privateKey});
const verify=(m,w)=>verifyCompleteOriginal({expected:m,wire:w,publicKeyDer:der});
test('closed complete original signs exact bytes but never grants installed authority',()=>{
 const bytes=Buffer.from('{}'),m=meta(),wire=encode(m,bytes),result=verify(m,wire);
 assert.deepEqual(result.bytes,bytes);assert.equal(result.installedAuthority,false);assert.equal(result.native_conformance,false);assert.equal(result.scope,'signed-statement-only');
});
test('run original omits all slot-only metadata',()=>{
 const bytes=Buffer.from('{}'),m=meta('final-output-scan');for(const k of ['slot','invocation_id','preparation_sha256'])delete m[k];m.scope='run';
 assert.deepEqual(verify(m,encode(m,bytes)).bytes,bytes);assert.throws(()=>encode({...m,slot:null},bytes));
});
test('fixed caps reject host-local families and owner-deferred slots',()=>{
 assert.equal(completeOriginalCap(meta()),9960);
 for(const family of ['native-config','assembly','process-custody','prepared-subject','harness-result','transport-request'])assert.throws(()=>completeOriginalCap(meta(family)));
 for(const profile of ['native-r2-complete-prepared-v1','native-r2-required-prepared-v1'])assert.throws(()=>completeOriginalCap({...meta('control-acknowledgment',{kind:'control',id:'control/prepare-swap-slot'}),profile}));
 assert.throws(()=>completeOriginalCap({...meta(),profile:'unknown'}));
});
test('exact fixed cap succeeds and one-over rejects before signing',()=>{
 const bytes=Buffer.alloc(9960,120),m=meta('independent-observation',undefined,bytes);assert.equal(verify(m,encode(m,bytes)).bytes.length,9960);
 const too=Buffer.alloc(9961,120);assert.throws(()=>encode(meta('independent-observation',undefined,too),too));
});
test('signed fields, key and profile are not interchangeable',()=>{
 const bytes=Buffer.from('{}'),m=meta(),wire=encode(m,bytes);
 for(const [key,value] of [['policy_sha256','e'.repeat(64)],['profile','native-r2-complete-prepared-v1'],['request_id','another'],['sequence',2]])assert.throws(()=>verify({...m,[key]:value},wire));
 const other=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'});assert.throws(()=>verifyCompleteOriginal({expected:m,wire,publicKeyDer:other}));
 assert.throws(()=>encode({...m,extra:true},bytes));assert.throws(()=>encode({...m,sha256:'0'.repeat(64)},bytes));
});

test('every retained remote family/slot class has exact source applicability',async()=>{
 const {selectCompleteProfile}=await import('../../scripts/lib/native-profile-selection.mjs');const bytes=Buffer.from('{}');
 for(const tag of ['native-r2-complete-prepared-v1','native-r2-required-prepared-v1']){
  const selected=selectCompleteProfile(tag);let typed=0,summaries=0,controls=0,scans=0;
  for(const step of selected.scenario.steps){
   if(/swap/.test(step.id))continue;
   const slot={kind:step.kind==='control'?'control':'process',id:step.id};
   const family=step.kind==='control'?'control-acknowledgment':step.caseId||['prepare/fail-create','prepare/revoke-own-positive'].includes(step.id)?'independent-observation':'process-observation-summary';
   const m={...meta(family,slot,bytes),profile:tag};assert.deepEqual(verify(m,encode(m,bytes)).bytes,bytes);
   if(step.kind==='control')controls++;else{family==='independent-observation'?typed++:summaries++;const scan={...m,family:'secret-inventory-scan'};verify(scan,encode(scan,bytes));scans++;}
  }
  assert.equal(typed,39);assert.equal(summaries,14);assert.equal(controls,9);assert.equal(scans,53);
  for(const e of selected.scenario.externalRequirements){const m={...meta('external-observation',{kind:'external',id:e.id},bytes),profile:tag};verify(m,encode(m,bytes));}
  const disable={...meta('disable-acknowledgment',{kind:'control',id:'control/revoke-submitter'},bytes),profile:tag};verify(disable,encode(disable,bytes));
  for(const family of ['control-roster','slot-coverage-roster']){const m={...meta(family),profile:tag,scope:'run'};for(const k of ['slot','invocation_id','preparation_sha256'])delete m[k];verify(m,encode(m,bytes));}
 }
});
test('accessors, proxies and shared backing memory cannot manufacture bytes or metadata',()=>{
 let calls=0;const bytes=Buffer.from('{}'),m=meta();
 const getter={...m};Object.defineProperty(getter,'profile',{enumerable:true,get(){calls++;return m.profile;}});assert.throws(()=>encode(getter,bytes));
 assert.throws(()=>encode(new Proxy(m,{get(){calls++;}}),bytes));assert.equal(calls,0);
 const shared=new Uint8Array(new SharedArrayBuffer(2));assert.throws(()=>encode(m,shared));
 const dirty=Buffer.from('{}');dirty.secret='not accepted';assert.throws(()=>encode(m,dirty));
 assert.throws(()=>encode(m,new Proxy(bytes,{})));
});
test('declared oversize rejects before base64 payload decoding and canonical wire is mandatory',()=>{
 const m=meta(),wire=encode(m,Buffer.from('{}')),value=JSON.parse(wire.toString());
 let decoded=0;const original=Buffer.from;Buffer.from=function(...args){if(args[1]==='base64')decoded++;return Reflect.apply(original,this,args);};
 try{assert.throws(()=>verify({...m,byte_size:9961},wire));assert.equal(decoded,0);}finally{Buffer.from=original;}
 assert.throws(()=>verify(m,Buffer.from(' '+wire.toString())));
 assert.throws(()=>verify(m,Buffer.from('{"type":"native-complete-original","version":2}')));
 assert.throws(()=>verify(m,Buffer.alloc(100000)));
 value.payload_base64='e30';assert.throws(()=>verify(m,Buffer.from(JSON.stringify(value))));
});


test('old signing domain cannot authenticate a complete-profile envelope',()=>{
 const m=meta(),wire=encode(m,Buffer.from('{}')),envelope=JSON.parse(wire.toString());
 const {signature_base64,...unsigned}=envelope;
 envelope.signature_base64=sign(null,Buffer.from('AGENTHUB_NATIVE_HOST_ORIGINAL_V2\n'+canonicalCaseSubject(unsigned)),pair.privateKey).toString('base64');
 assert.throws(()=>verify(m,Buffer.from(canonicalCaseSubject(envelope))));
});
test('valid signature cannot bless noncanonical base64 or a different payload digest',()=>{
 const m=meta(),wire=encode(m,Buffer.from('{}')),envelope=JSON.parse(wire.toString());
 // e30= is canonical for {}; e31= decodes the same bytes with nonzero padding bits.
 envelope.payload_base64='e31=';const {signature_base64,...unsigned}=envelope;
 envelope.signature_base64=sign(null,Buffer.from('AGENTHUB_NATIVE_COMPLETE_ORIGINAL_V2\n'+canonicalCaseSubject(unsigned)),pair.privateKey).toString('base64');
 assert.throws(()=>verify(m,Buffer.from(canonicalCaseSubject(envelope))));
});

test('every distinct remote role cap admits exact maximum metadata and rejects one over',async()=>{
 const {getRequiredScenario}=await import('../../scripts/lib/native-required-profile.mjs');
 const rows=[];
 for(const step of getRequiredScenario().steps){
  const slot={kind:step.kind==='control'?'control':'process',id:step.id};
  const family=step.kind==='control'?'control-acknowledgment':step.caseId||['prepare/fail-create','prepare/revoke-own-positive'].includes(step.id)?'independent-observation':'process-observation-summary';
  rows.push(meta(family,slot));if(step.kind!=='control')rows.push(meta('secret-inventory-scan',slot));
 }
 for(const e of getRequiredScenario().externalRequirements)rows.push(meta('external-observation',{kind:'external',id:e.id}));
 rows.push(meta('disable-acknowledgment',{kind:'control',id:'control/revoke-submitter'}));
 for(const family of ['final-output-scan','control-roster','slot-coverage-roster']){const m=meta(family);for(const k of ['slot','invocation_id','preparation_sha256'])delete m[k];m.scope='run';rows.push(m);}
 const seen=new Set();for(const row of rows){
  const cap=completeOriginalCap(row),key=row.family+':'+cap;if(seen.has(key))continue;seen.add(key);
  for(const profile of ['native-r2-complete-prepared-v1','native-r2-required-prepared-v1']){
   const bytes=Buffer.alloc(cap,120),m={...row,profile,byte_size:cap,sha256:hash(bytes),sequence:profile.includes('required')?346:370};
   for(const k of ['service_id','instance_id','run_id','request_id','producer_id','record_id'])m[k]='z'.repeat(128);
   if(m.invocation_id)m.invocation_id='z'.repeat(128);
   assert.equal(verify(m,encode(m,bytes)).bytes.length,cap,key);
   const over=Buffer.alloc(cap+1,120);assert.throws(()=>encode({...m,byte_size:cap+1,sha256:hash(over)},over),key);
  }
 }
 assert.ok(seen.size>=20);
});
test('valid signature over canonical payload with wrong digest still rejects',()=>{
 const m=meta(),wire=encode(m,Buffer.from('{}')),envelope=JSON.parse(wire.toString());
 envelope.payload_base64=Buffer.from('[]').toString('base64');const {signature_base64,...unsigned}=envelope;
 envelope.signature_base64=sign(null,Buffer.from('AGENTHUB_NATIVE_COMPLETE_ORIGINAL_V2\n'+canonicalCaseSubject(unsigned)),pair.privateKey).toString('base64');
 assert.throws(()=>verify(m,Buffer.from(canonicalCaseSubject(envelope))));
});
