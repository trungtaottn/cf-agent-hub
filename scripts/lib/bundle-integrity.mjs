import {createHmac,timingSafeEqual} from 'node:crypto';
import {canonicalJson} from '../../src/config/bootstrap.ts';
import {validateBundle} from '../../src/config/generated/validators.js';
import {fail} from './protected-io.mjs';
export function integrityKey(input) {
 if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='key_base64,key_id'||typeof input.key_id!=='string'||!/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(input.key_id)||input.key_id.length>128||typeof input.key_base64!=='string')fail();
 const bytes=Buffer.from(input.key_base64,'base64');
 if(bytes.length<32||bytes.length>128||bytes.toString('base64')!==input.key_base64)fail();
 return {id:input.key_id,bytes};
}
function tag(bundle,key) {
 const {tag:_,...auth}=bundle.auth;
 return createHmac('sha256',key.bytes).update(canonicalJson({...bundle,auth})).digest();
}
export function authenticateBundle(bundle,key) {
 if(!validateBundle(bundle)||bundle.auth.key_id!==key.id)fail();
 const supplied=Buffer.from(bundle.auth.tag,'hex'),expected=tag(bundle,key);
 // Node 24.11's WebCrypto HMAC comparison is not used; native timingSafeEqual is explicit.
 if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))fail();
}
export function signBundle(bundle,key) {
 const signed={...bundle,auth:{key_id:key.id,algorithm:'HMAC-SHA256',tag:''}};
 signed.auth.tag=tag(signed,key).toString('hex');return signed;
}
