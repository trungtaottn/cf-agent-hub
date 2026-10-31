import {test} from 'vitest';
import assert from 'node:assert/strict';
import {schema,PLATFORM_LIMITS,references,validatePlatform} from '../../scripts/lib/r2-platform-evidence.mjs';
test('platform rejects missing evidence without claiming eligibility',()=>{
 for(const value of [null,{}, {type:'r2-platform',version:1}])assert.ok(validatePlatform(value,{}).length);
});
test('platform exposes closed main and independently typed observer schemas',()=>{
 for(const name of ['platform','resolution','plan','workload'])assert.equal(schema.$defs[name].additionalProperties,false);
});
test('platform only enumerates owned typed refs with reviewed bounds',()=>{
 const ref=name=>({path:name+'.json',sha256:'a'.repeat(64),byte_size:100});
 const value={type:'r2-platform',resolution:ref('resolution'),plan:ref('plan'),workloads:[ref('sql'),ref('artifact'),ref('combined'),ref('over')]};
 assert.deepEqual(references(value),[{ref:value.resolution,type:'r2-platform-resolution',maxBytes:8192},{ref:value.plan,type:'r2-platform-plan',maxBytes:32768},...value.workloads.map(ref=>({ref,type:'r2-platform-workload',maxBytes:8192}))]);
 assert.deepEqual(references({type:'unknown',resolution:value.resolution}),[]);
});
test('platform root remains bounded separately from global16MiB',()=>{assert.equal(PLATFORM_LIMITS.platform,16384);});
import {makePlatformEvidence,changeWorkloadDimensions,hash} from './r2-platform-fixtures.mjs';
test('synthetic platform records satisfy structural checks without real qualification claim',()=>{
 const f=makePlatformEvidence();assert.deepEqual(validatePlatform(f.value,f.ctx),[]);
});
const mutations={
 'pending qualification':f=>{f.resolution.status='pending';},
 'unrelated application configuration':f=>{f.resolution.configuration_sha256=hash('other');},
 'unrelated runtime applicability':f=>{f.resolution.applicability_record_sha256=hash('other');},
 'unrelated current entitlement':f=>{f.resolution.plan_record_sha256=hash('other');},
 'source-only resolution':f=>{f.ctx.commands.get('resolution').kind='operator-tests';},
 'author self review':f=>{f.plan.reviewer_id='author';f.plan.observer_id='author';},
 'wrong review observer':f=>{f.plan.observer_id='other_reviewer';},
 'unrelated resolution receipt':f=>{f.plan.resolution_sha256=hash('other');},
 'wrong review record':f=>{f.plan.record_sha256=hash('other');},
 'missing qualification receipt':f=>{f.ctx.receipts.delete(f.value.resolution.path);},
 'untyped qualification substitute':f=>{f.resolution.type='r2-platform-plan';},
 'duplicate workload refs':f=>{f.value.workloads[1]=f.value.workloads[0];},
 'missing workload':f=>{f.value.workloads.pop();},
 'reordered workload identities':f=>{f.value.workloads.reverse();},
 'duplicate original execution record':f=>{f.workloads[1].record_sha256=f.workloads[0].record_sha256;},
 'same workload command':f=>{f.workloads[1].command_id=f.workloads[0].command_id;},
 'unreviewed workload input':f=>{f.workloads[0].input_sha256=hash('other');},
 'unreviewed workload dimensions':f=>{f.workloads[0].dimensions.sql_bytes++;},
 'unreviewed expected rejection':f=>{f.plan.workloads[0].expected_outcome='rejected';},
 'accepted source-only local counts':f=>{f.ctx.commands.get(f.workloads[0].command_id).kind='operator-tests';},
 'wrong peak observation layer':f=>{f.workloads[0].observation_layer='manifest-validator';},
 'missing restore stage':f=>{f.workloads[0].stages=['capture','remote-verify'];},
 'reordered stages':f=>{f.workloads[0].stages.reverse();},
 'HTTP gateway claim':f=>{f.workloads[3].http_status=400;},
 'missing accepted invocation measurement':f=>{f.workloads[0].peak_worker_invocations=0;},
 'depth exceeds whole invocation peak':f=>{f.workloads[0].peak_depth=9;},
 'subrequests exceed actual evidenced plan':f=>{f.workloads[0].peak_subrequests=1001;},
 'aggregate invocation limit33':f=>{f.workloads[0].peak_worker_invocations=33;},
 'artifact workload without bytes':f=>{changeWorkloadDimensions(f,1,{artifact_bytes:0,artifact_count:0});},
 'artifact bytes without count':f=>{changeWorkloadDimensions(f,1,{artifact_count:0});},
 'artifact count1001':f=>{changeWorkloadDimensions(f,1,{artifact_count:1001});},
 'chunk bytes exceed producible per-chunk max':f=>{changeWorkloadDimensions(f,0,{sql_bytes:1048577});},
 'SQLbytes less than positive chunk count':f=>{changeWorkloadDimensions(f,0,{sql_bytes:1,chunks:2});},
 'unsafe summed dimensions':f=>{changeWorkloadDimensions(f,0,{sql_bytes:Number.MAX_SAFE_INTEGER,artifact_bytes:Number.MAX_SAFE_INTEGER});},
 'over-limit input actually inside limits':f=>{changeWorkloadDimensions(f,3,{sql_bytes:268435455});},
 'compound over-limit inputs':f=>{changeWorkloadDimensions(f,3,{canonical_manifest_bytes:65537});},
 'over-limit performs external effects':f=>{f.workloads[3].external_effects=1;},
 'over-limit invents worker invocation':f=>{f.workloads[3].peak_worker_invocations=1;},
 'over-limit invokes subrequest':f=>{f.workloads[3].peak_subrequests=1;},
 'over-limit wrong error precedence':f=>{f.workloads[3].rejection_code='INVALID_RECOVERY_MANIFEST';},
 'over-limit invokes stages':f=>{f.workloads[3].stages=['capture'];},
 'assembly precedes actual observations':f=>{f.value.observed_at=1;}
};
for(const [label,mutate] of Object.entries(mutations))test('platform rejects '+label,()=>{const f=makePlatformEvidence();mutate(f);assert.ok(validatePlatform(f.value,f.ctx).length);});
for(const id of ['platform_assembly','resolution','boundary_plan','sql-boundary'])for(const field of ['revision','tree_sha256','composition_sha256','environment_id'])test('platform rejects '+id+' substituted '+field,()=>{
 const f=makePlatformEvidence();f.ctx.commands.get(id)[field]=field==='revision'?'b'.repeat(40):field==='environment_id'?'other_env':hash('other');assert.ok(validatePlatform(f.value,f.ctx).length);
});
test('depth policy compares depth not aggregate count; aggregate policy rejects same measurements',()=>{
 const f=makePlatformEvidence({limit_kind:'depth'});f.workloads[0].peak_worker_invocations=100;f.workloads[0].peak_depth=32;assert.deepEqual(validatePlatform(f.value,f.ctx),[]);
 f.resolution.limit_kind='aggregate-chain';assert.ok(validatePlatform(f.value,f.ctx).length);
 f.resolution.limit_kind='depth';f.workloads[0].peak_depth=33;assert.ok(validatePlatform(f.value,f.ctx).length);
});
test('aggregate32 exact accepted and33 rejected',()=>{
 const f=makePlatformEvidence();f.workloads[0].peak_worker_invocations=32;assert.deepEqual(validatePlatform(f.value,f.ctx),[]);f.workloads[0].peak_worker_invocations++;assert.ok(validatePlatform(f.value,f.ctx).length);
});
test('independently evidenced subrequest exact limit and oneover',()=>{
 const f=makePlatformEvidence();f.workloads[0].peak_subrequests=1000;assert.deepEqual(validatePlatform(f.value,f.ctx),[]);f.workloads[0].peak_subrequests++;assert.ok(validatePlatform(f.value,f.ctx).length);
});
for(const [dimension,changes] of [['chunks',{sql_bytes:257,chunks:257,artifact_bytes:0,artifact_count:0}],['canonical_manifest_bytes',{sql_bytes:1,chunks:1,artifact_bytes:0,artifact_count:0,canonical_manifest_bytes:65537}]])test('isolated '+dimension+' excess uses source manifest rejection',()=>{
 const f=makePlatformEvidence();changeWorkloadDimensions(f,3,changes);f.workloads[3].rejection_code='INVALID_RECOVERY_MANIFEST';assert.deepEqual(validatePlatform(f.value,f.ctx),[]);
});
test('independent boundary plan must precede execution, not be assembled after workloads',()=>{
 const f=makePlatformEvidence();f.plan.observed_at=350;f.ctx.commands.get(f.plan.command_id).ended_at=400;assert.ok(validatePlatform(f.value,f.ctx).length);
});
test('runtime resolution must precede independent plan admission',()=>{
 const f=makePlatformEvidence();f.resolution.observed_at=250;f.ctx.commands.get(f.resolution.command_id).ended_at=300;assert.ok(validatePlatform(f.value,f.ctx).length);
});
import Ajv from 'ajv';
const schemaValidator=new Ajv({strict:true});schemaValidator.addSchema(schema);
const validateWorkloadShape=schemaValidator.compile({$ref:schema.$id+'#/$defs/workload'});
const maximumPrimitive=def=>{
 if(def.$ref)return maximumPrimitive(schema.$defs[def.$ref.split('/').at(-1)]);
 if('const'in def)return def.const;
 if(def.enum)return [...def.enum].sort((a,b)=>JSON.stringify(b).length-JSON.stringify(a).length)[0];
 if(def.type==='object')return Object.fromEntries(Object.entries(def.properties).map(([key,value])=>[key,maximumPrimitive(value)]));
 if(def.type==='array')return Array.from({length:def.maxItems},()=>maximumPrimitive(def.items));
 if(def.type==='integer')return def.maximum;
 if(def.pattern?.includes('{64}'))return 'f'.repeat(64);
 if(def.pattern?.includes('{40}'))return 'f'.repeat(40);
 return (def.pattern?.startsWith('^[a-z]')?'a':'"').repeat(def.maxLength);
};
for(const [name,bytes] of [['platform',4872],['resolution',1784],['plan',2903],['workload',1696]])test('escape-aware primitive '+name+' maximum remains below raw cap',()=>{
 assert.equal(Buffer.byteLength(JSON.stringify(maximumPrimitive(schema.$defs[name]))),bytes);assert.ok(bytes<PLATFORM_LIMITS[name]);
});
for(const [field,bound,changes] of [['chunks',256,{sql_bytes:256}],['canonical_manifest_bytes',65536,{}],['artifact_count',1000,{artifact_bytes:1}]])test('accepted '+field+' exact bound and oneover',()=>{
 const f=makePlatformEvidence();changeWorkloadDimensions(f,0,{...changes,[field]:bound});assert.deepEqual(validatePlatform(f.value,f.ctx),[]);
 changeWorkloadDimensions(f,0,{[field]:bound+1});assert.ok(validatePlatform(f.value,f.ctx).length);
});
test('accepted combined bytes exact256MiB and oneover',()=>{
 const f=makePlatformEvidence();changeWorkloadDimensions(f,2,{sql_bytes:1,chunks:1,artifact_bytes:268435455,artifact_count:26});assert.deepEqual(validatePlatform(f.value,f.ctx),[]);
 changeWorkloadDimensions(f,2,{artifact_bytes:268435456});assert.ok(validatePlatform(f.value,f.ctx).length);
});
test('workload arrays and dimensions are closed and diagnostics omit input values',()=>{
 const f=makePlatformEvidence();f.workloads[0].dimensions.secret='synthetic-secret';assert.equal(validateWorkloadShape(f.workloads[0]),false);
 const found=validatePlatform(f.value,f.ctx);assert.ok(found.length);assert.equal(JSON.stringify(found).includes('synthetic-secret'),false);
});
