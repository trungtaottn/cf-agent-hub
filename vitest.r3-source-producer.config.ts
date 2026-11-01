/** Dedicated eight-case J1 execution; never a filtered multi-stage suite. */
import base from './vitest.workers.config';
import {J1_MODULE} from './scripts/lib/r3-source-producer-policy.mjs';
export default {...base,test:{...base.test,name:'r3-j1-source-producer',include:[J1_MODULE],exclude:[],reporters:['./scripts/lib/r3-source-producer-reporter.ts'],watch:false,retry:0,maxWorkers:1,fileParallelism:false,allowOnly:false}};
