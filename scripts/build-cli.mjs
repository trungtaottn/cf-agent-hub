import {build} from 'esbuild';
import {chmod} from 'node:fs/promises';
await build({entryPoints:['packages/cli/src/entry.ts'],outfile:'dist/cli/agenthub.mjs',bundle:true,platform:'node',format:'esm',target:'node24',banner:{js:'#!/usr/bin/env node'},logLevel:'warning'});
await chmod('dist/cli/agenthub.mjs',0o755);
