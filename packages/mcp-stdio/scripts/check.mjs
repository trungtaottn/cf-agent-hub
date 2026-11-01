import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=mkdtempSync(join(tmpdir(),'agenthub-mcp-check-'));
for(const directory of ['config','tmp'])mkdirSync(join(scratch,directory));
const env={...process.env,XDG_CONFIG_HOME:join(scratch,'config'),TMPDIR:join(scratch,'tmp')};
const commands=[['packages/mcp-stdio/scripts/generate-contract.mjs','--check'],['packages/mcp-stdio/scripts/build.mjs'],['node_modules/typescript/bin/tsc','--project','packages/mcp-stdio/tsconfig.json','--noEmit'],['node_modules/vitest/vitest.mjs','run','--config','packages/mcp-stdio/vitest.config.mjs','--maxWorkers=1'],['node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts','test/cli/mcp-journal.test.ts','test/cli/mcp-durable-mutations.test.ts','test/cli/journal-recovery.test.ts','test/cli/durable-mutations.test.ts','--maxWorkers=1']];
try{for(const args of commands){const result=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(result.error||result.status!==0){process.exitCode=result.status??1;break;}}}finally{rmSync(scratch,{recursive:true,force:true});}
