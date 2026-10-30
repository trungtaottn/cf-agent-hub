/** Native key-content ownership, not installation or signing authority.
 * Only this module's actual canonical import can create the private brand.
 */
import {createPrivateKey,createPublicKey} from 'node:crypto';
import {types} from 'node:util';
const owned=new WeakMap();
const fail=()=>{throw Error('NATIVE_OWNED_ED25519_KEY_REJECTED');},check=v=>{if(!v)fail();};
const typed=Object.getPrototypeOf(Uint8Array.prototype),size=Object.getOwnPropertyDescriptor(typed,'byteLength').get,backing=Object.getOwnPropertyDescriptor(typed,'buffer').get,set=Uint8Array.prototype.set;
function copy(value,n){
 check(value&&!types.isProxy(value)&&[Buffer.prototype,Uint8Array.prototype].includes(Object.getPrototypeOf(value)));
 check(size.call(value)===n&&Object.getPrototypeOf(backing.call(value))===ArrayBuffer.prototype&&Reflect.ownKeys(value).every(k=>typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)));
 const out=new Uint8Array(n);set.call(out,value);return Buffer.from(out.buffer);
}
export function importOwnedEd25519PrivateKey(input){try{
 check(input&&!types.isProxy(input)&&Object.getPrototypeOf(input)===Object.prototype);const d=Object.getOwnPropertyDescriptors(input);check(Reflect.ownKeys(d).length===2);for(const k of ['pkcs8','publicKeyDer'])check(d[k]?.enumerable&&Object.hasOwn(d[k],'value'));
 const privateDer=copy(d.pkcs8.value,48),publicDer=copy(d.publicKeyDer.value,44),key=createPrivateKey({key:privateDer,format:'der',type:'pkcs8'});
 check(key.asymmetricKeyType==='ed25519'&&copy(key.export({format:'der',type:'pkcs8'}),48).equals(privateDer));
 const publicKey=createPublicKey(key);check(publicKey.asymmetricKeyType==='ed25519'&&copy(publicKey.export({format:'der',type:'spki'}),44).equals(publicDer));
 Object.freeze(key);owned.set(key,true);return key;
 }catch{fail();}}
export function isOwnedEd25519PrivateKey(value){return !!value&&typeof value==='object'&&!types.isProxy(value)&&owned.has(value);}
