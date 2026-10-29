/** Fixed composition; no config-selected transport/module and no default credential lookup. */
import {validateFixturePolicy} from './native-fixture-protocol.mjs';
import {createFixtureClient} from './native-fixture-client.mjs';
import {createFixtureHttpsTransport} from './native-fixture-https.mjs';
export function createInstalledFixtureClient(configuration){
 if(!configuration||Object.getPrototypeOf(configuration)!==Object.prototype)throw Error('FIXTURE_INSTALLED_REJECTED');const d=Object.getOwnPropertyDescriptors(configuration);if(Reflect.ownKeys(d).length!==2||!['policy','readAuthentication'].every(k=>d[k]?.enumerable&&Object.hasOwn(d[k],'value')))throw Error('FIXTURE_INSTALLED_REJECTED');
 const policy=validateFixturePolicy(d.policy.value,Date.now()),transport=createFixtureHttpsTransport({policy,readAuthentication:d.readAuthentication.value}),client=createFixtureClient({policy,send:transport.send});
 return Object.freeze({call:client.call,snapshot:()=>({client:client.snapshot(),transport:transport.snapshot()}),async close(){const results=await Promise.allSettled([client.close(),transport.close()]);if(results.some(x=>x.status==='rejected'))throw Error('FIXTURE_INSTALLED_CLEANUP_UNKNOWN');return {status:'closed'};}});
}
