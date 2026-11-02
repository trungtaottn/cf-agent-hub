import {types} from 'node:util';

const rejected=(code,message)=>({passed:false,findings:[{code,path:'/',message}]});

// This is an explicit closed gate, not an R3 schema or a runtime verifier.
// No caller-controlled evidence, files, exceptions or pass flags can open it.
export function pendingR3Release(){
 return {...rejected('R3_PROFILE_INCOMPLETE','R3 verification is unavailable until all mandatory domain, browser, STDIO/native, client, recovery and exact-candidate evidence predicates are integrated and independently reviewed.'),scope:'structural-only',acceptance:'pending-external-inspection'};
}

/** Inspect routing data without executing property accessors or Proxy traps. */
export function inspectReleaseDispatch(input){
 if(input===null||typeof input!=='object'||types.isProxy(input))return {result:rejected('INVALID_RELEASE_INPUT','Release evidence must be a plain data object.')};
 const prototype=Object.getPrototypeOf(input);
 if(prototype!==null&&prototype!==Object.prototype)return {result:rejected('INVALID_RELEASE_INPUT','Release evidence must be a plain data object.')};
 const descriptors=Object.getOwnPropertyDescriptors(input);
 // Inspect before reading even format_version; legacy dispatch must not run getters.
 if(Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')))return {result:rejected('INVALID_RELEASE_INPUT','Release evidence cannot contain root accessors.')};
 for(const name of ['profile','round','format_version','toJSON']){
  if(prototype&&Object.getOwnPropertyDescriptor(prototype,name))return {result:rejected('INVALID_RELEASE_INPUT','Release routing and serialization fields cannot be inherited.')};
 }
 const round=descriptors.round?.value,profile=descriptors.profile?.value;
 if(Object.hasOwn(descriptors,'profile')&&(round!=='R3'||profile!=='r3-runtime-v1'))return {result:rejected('UNKNOWN_RELEASE_PROFILE','The release profile is not supported for this round.')};
 if(round==='R3')return {result:pendingR3Release()};
 if(typeof descriptors.toJSON?.value==='function')return {result:rejected('INVALID_RELEASE_INPUT','Release evidence cannot provide a serialization hook.')};
 return {round,formatVersion:descriptors.format_version?.value};
}
