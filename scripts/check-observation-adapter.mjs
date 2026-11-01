/** Required local/CI source gate, separate from frozen native package metadata. */
import {spawnSync} from 'node:child_process';
for(const args of [
 ['scripts/build-observation-adapter.mjs'],
 ['node_modules/typescript/bin/tsc','-p','tsconfig.observation-adapter.json','--noEmit'],
 ['node_modules/vitest/vitest.mjs','run','--config','vitest.observation-adapter.config.ts']
]){
 const result=spawnSync(process.execPath,args,{stdio:'inherit'});
 if(result.error||result.status!==0){process.exitCode=1;break;}
}
