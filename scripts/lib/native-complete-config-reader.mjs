/** Complete-profile input custody only, not runtime or installed authority.
 * Existing v1 reader and all underlying file/directory guards remain unchanged.
 */
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectNativeDirectory} from './native-r2-admission.mjs';
import {readProtectedJson} from './protected-io.mjs';
import {validateNativeConfig} from './native-r2-config.mjs';
import {validateCompleteConfig} from './native-complete-config.mjs';
import {canonicalCaseSubject} from './r2-case-policy.mjs';
const reject=()=>{throw Error('NATIVE_COMPLETE_CONFIG_INPUT_REJECTED');};
export function readCompleteConfig(path){
 try{
  if(typeof path!=='string'||resolve(path)!==path)reject();
  inspectNativeDirectory(dirname(path));
  return validateCompleteConfig(readProtectedJson(path,65536));
 }catch{reject();}
}
export function completeConfigDigest(value){
 try{return createHash('sha256').update(canonicalCaseSubject(validateCompleteConfig(value))).digest('hex');}
 catch{reject();}
}

/** Read once under the same protected-file guards; version never falls back. */
export function readNativeRunnerConfig(path){
 try{
  if(typeof path!=='string'||resolve(path)!==path)reject();
  inspectNativeDirectory(dirname(path));
  const value=readProtectedJson(path,65536);
  if(value?.version===1)return validateNativeConfig(value);
  if(value?.version===2)return validateCompleteConfig(value);
  reject();
 }catch{reject();}
}
