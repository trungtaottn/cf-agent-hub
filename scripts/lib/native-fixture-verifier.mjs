/** Binding around an independently installed identity verifier, not an identity provider. */
import {createHash} from 'node:crypto';
import {validateFixturePolicy,validateFixtureRequest,validateFixtureClaims,fixturePolicyDigest} from './native-fixture-protocol.mjs';
const reject=()=>{throw Error('FIXTURE_VERIFIER_REJECTED');};
const check=value=>{if(!value)reject();};
function closed(value,keys){check(value&&Object.getPrototypeOf(value)===Object.prototype);const descriptors=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(descriptors).length===keys.length);const copy={};for(const key of keys){const d=descriptors[key];check(d&&Object.hasOwn(d,'value')&&d.enumerable);copy[key]=d.value;}return copy;}
export function createBoundFixtureVerifier(configuration){
 let policy,verifyIdentity,policySha256;
 try{const supplied=closed(configuration,['policy','verifyIdentity']);policy=validateFixturePolicy(supplied.policy,Date.now());verifyIdentity=supplied.verifyIdentity;check(typeof verifyIdentity==='function');policySha256=fixturePolicyDigest(policy);}catch{reject();}
 return async function verify(message,input){
  try{
   const context=closed(input,['policy_sha256','request_sha256','request','signal']);
   check(context.signal instanceof AbortSignal&&!context.signal.aborted&&Date.now()<policy.expires_at);
   check(message instanceof Request&&message.url===policy.origin+'/native-fixture/v1'&&message.method==='POST'&&message.headers.get('content-type')==='application/json'&&!message.signal.aborted);
   check(context.policy_sha256===policySha256);
   const request=validateFixtureRequest(context.request,policy),requestSha256=createHash('sha256').update(JSON.stringify(request)).digest('hex');
   check(context.request_sha256===requestSha256);
   const bound=Object.freeze({policy,policy_sha256:policySha256,request_sha256:requestSha256,request,signal:context.signal});
   // Do not race away from this await: service session retains the real provider work.
   const returned=await verifyIdentity(message,bound);
   check(!context.signal.aborted&&!message.signal.aborted&&Date.now()<policy.expires_at);
   const wrapper=closed(returned,['version','request_sha256','claims']);
   check(wrapper.version===1&&wrapper.request_sha256===requestSha256);
   const claims=validateFixtureClaims(wrapper.claims,policy,Date.now());
   check(!context.signal.aborted&&!message.signal.aborted&&Date.now()<claims.expires_at);
   return claims;
  }catch{reject();}
 };
}
