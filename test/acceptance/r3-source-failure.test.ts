import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,existsSync,statSync} from 'node:fs';
import {writeJ1Failure} from '../../scripts/lib/r3-source-failure.mjs';
const roots:string[]=[];afterEach(()=>{for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
function root(){const p=mkdtempSync('/tmp/agenthub-r3-source-');roots.push(p);return p;}
it('writes fixed reporter failure phase privately without replacing first failure',()=>{const p=root();writeJ1Failure(p+'/input.json','reporter',{phase:'init-pool'});expect(JSON.parse(readFileSync(p+'/failure-reporter.json','utf8'))).toEqual({stage:'j1-source-failure-diagnostic',acceptance_eligible:false,phase:'init-pool'});expect(statSync(p+'/failure-reporter.json').mode&0o777).toBe(0o600);expect(()=>writeJ1Failure(p+'/input.json','reporter',{phase:'case'})).toThrow();});
it('rejects arbitrary error strings/private facts before output',()=>{const p=root();for(const x of [{phase:'secret'}, {phase:'case',message:'do not export'}])expect(()=>writeJ1Failure(p+'/input.json','reporter',x)).toThrow();expect(existsSync(p+'/failure-reporter.json')).toBe(false);});
it('records actual failed close facts but not a success record',()=>{const p=root();writeJ1Failure(p+'/input.json','controller',{phase:'child',exit_code:1,signal:null,closed:true,error_code:null,elapsed_ms:100,discarded_log_bytes:200});const x=JSON.parse(readFileSync(p+'/failure-controller.json','utf8'));expect(x.acceptance_eligible).toBe(false);expect(x.exit_code).toBe(1);expect(x.stage).toBe('j1-source-failure-diagnostic');});
