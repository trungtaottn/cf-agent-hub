/** Fixed source journal entry; separate from the native CLI executable commitment. */
import {build} from 'esbuild';
await build({entryPoints:['packages/cli/src/native-journal-observation.ts'],outfile:'dist/native-host/journal-observation.mjs',bundle:true,platform:'node',format:'esm',target:'node24',logLevel:'warning'});
await build({entryPoints:['packages/cli/src/complete-host-observation.ts'],outfile:'dist/native-host/complete-host-observation.mjs',bundle:true,platform:'node',format:'esm',target:'node24',logLevel:'warning'});

// Complete host is one self-contained, exact-byte-verifiable ESM artifact.
import {buildCompleteHost} from './lib/native-complete-build.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const completeRoot=fileURLToPath(new URL('../',import.meta.url));
const complete=await buildCompleteHost({root:completeRoot});
const completeDir=new URL('../dist/native-host/',import.meta.url);
await mkdir(completeDir,{recursive:true});
await writeFile(new URL('host-v2.mjs',completeDir),complete.bytes);
await writeFile(new URL('host-v2.manifest.json',completeDir),JSON.stringify({version:1,artifact:'host-v2.mjs',sha256:complete.sha256,byte_size:complete.bytes.length,source_inventory_sha256:complete.inventorySha256,source_inventory:complete.inventory},null,2)+'\n');
