/** Fixed context-enabled eight-case J1 source profile; not formal acceptance. */
import base from './vitest.workers.config';
import {J1_MODULE} from './scripts/lib/r3-source-producer-policy.mjs';
export default {...base,test:{...base.test,name:'r3-j1-source-context-producer',include:[J1_MODULE],exclude:[],provide:{r3SourceProfile:'j1-context-v2'},reporters:['./scripts/lib/r3-source-context-reporter.ts'],watch:false,retry:0,maxWorkers:1,fileParallelism:false,allowOnly:false}};
