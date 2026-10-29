/** Fixed source journal entry; separate from the native CLI executable commitment. */
import {build} from 'esbuild';
await build({entryPoints:['packages/cli/src/native-journal-observation.ts'],outfile:'dist/native-host/journal-observation.mjs',bundle:true,platform:'node',format:'esm',target:'node24',logLevel:'warning'});
