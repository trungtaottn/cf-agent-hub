/** Independent artifact; deliberately outside the frozen native-host build graph. */
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const result=await build({entryPoints:['packages/observation-adapter/src/entry.ts'],outfile:'dist/observation-adapter/reporter.mjs',bundle:true,preserveSymlinks:true,platform:'node',format:'esm',target:'node24',write:false,metafile:true,logLevel:'warning'});
const bytes=result.outputFiles[0].contents;
await mkdir('dist/observation-adapter',{recursive:true});await writeFile('dist/observation-adapter/reporter.mjs',bytes);
await writeFile('dist/observation-adapter/reporter.manifest.json',JSON.stringify({version:1,artifact:'reporter.mjs',sha256:createHash('sha256').update(bytes).digest('hex'),byte_size:bytes.length,inputs:Object.keys(result.metafile.inputs).sort()},null,2)+'\n');
