import test from 'node:test';import assert from 'node:assert/strict';
import {serviceConfigurationFixture} from './complete-service-configuration-values.mjs';
import {verifyCompleteServiceConfiguration,deriveCompleteServiceRun,readCompleteServiceConfiguration} from '../../scripts/lib/native-complete-service-configuration.mjs';
test('verified source-test root/authority/key configuration mints a private service binding',()=>{const f=serviceConfigurationFixture(),binding=verifyCompleteServiceConfiguration(f.input),run=deriveCompleteServiceRun(binding,'run_'+'1'.repeat(32),f.input.now);assert.equal(run.policy.assurance,'installed');assert.equal(run.policy.run_context.authorityRecordSha256,f.config.authority_record_sha256);assert.deepEqual(run.expected,f.expected);assert.equal(run.authorization.authorityRecordSha256,f.config.authority_record_sha256);assert.equal(readCompleteServiceConfiguration(binding).serviceOrigin,f.descriptor.payload.service_origin);assert.throws(()=>deriveCompleteServiceRun({...binding},'run_'+'1'.repeat(32),f.input.now));});
for(const kind of ['signature','authority','key','inputs','config','oversize','shared'])test('service configuration rejects '+kind+' before runtime effects',()=>{const f=serviceConfigurationFixture();if(kind==='signature')f.input.descriptorBytes[10]^=1;if(kind==='authority')f.input.authorityBytes[10]^=1;if(kind==='key')f.input.serviceKeyBytes=f.client.privateKey.export({type:'pkcs8',format:'der'});if(kind==='inputs')f.input.privateInputsBytes[10]^=1;if(kind==='config')f.input.configBytes=Buffer.from('{}');if(kind==='oversize')f.input.configBytes=Buffer.alloc(65537);if(kind==='shared')f.input.authorityBytes=new Uint8Array(new SharedArrayBuffer(10));assert.throws(()=>verifyCompleteServiceConfiguration(f.input));});
test('service configuration owns one run and does not renew or recover after clock rollback',()=>{
 const f=serviceConfigurationFixture(),binding=verifyCompleteServiceConfiguration(f.input);
 deriveCompleteServiceRun(binding,'run_'+'2'.repeat(32),f.input.now+1);
 assert.throws(()=>deriveCompleteServiceRun(binding,'run_'+'3'.repeat(32),f.input.now+2));
 assert.throws(()=>readCompleteServiceConfiguration(binding));
 const g=serviceConfigurationFixture(),b=verifyCompleteServiceConfiguration(g.input);
 assert.throws(()=>deriveCompleteServiceRun(b,'run_'+'4'.repeat(32),g.input.now-1));
 assert.throws(()=>deriveCompleteServiceRun(b,'run_'+'4'.repeat(32),g.input.now));
});
test('service configuration rejects caller accessors without running them',()=>{
 const f=serviceConfigurationFixture();let calls=0;
 Object.defineProperty(f.input,'serviceKeyBytes',{enumerable:true,get(){calls++;throw Error('hook');}});
 assert.throws(()=>verifyCompleteServiceConfiguration(f.input));assert.equal(calls,0);
});
