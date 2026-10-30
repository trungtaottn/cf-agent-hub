/** Fixed checkout build/import gate; never calls the host executor or installs files. */
import {fileURLToPath} from 'node:url';
import {buildCompleteHost} from './lib/native-complete-build.mjs';
import {checkCompleteBuildPair} from './lib/native-complete-build-check.mjs';
try {
 if(process.argv.length!==2)throw Error('UNEXPECTED_ARGUMENT');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const first=await buildCompleteHost({root});
 const second=await buildCompleteHost({root});
 if(first.bytes.includes(Buffer.from(root)))throw Error('BUILD_ROOT_LEAK');
 console.log(JSON.stringify(await checkCompleteBuildPair(first,second)));
} catch {
 // Do not emit data-URL stack/source bytes, paths or executor inputs on import error.
 console.error('NATIVE_COMPLETE_BUILD_CHECK_FAILED');
 process.exitCode=1;
}
