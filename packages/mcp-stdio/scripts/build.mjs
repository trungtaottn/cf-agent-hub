import {build} from 'esbuild';
import {mkdir,chmod} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
await build({absWorkingDir:root,entryPoints:['packages/mcp-stdio/src/main.ts'],outfile:'packages/mcp-stdio/dist/main.mjs',bundle:true,platform:'node',format:'esm',target:'node24',banner:{js:'#!/usr/bin/env node'},logLevel:'warning'});
await chmod(new URL('../dist/main.mjs',import.meta.url),0o755);
