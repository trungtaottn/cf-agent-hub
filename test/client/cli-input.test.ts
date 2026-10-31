import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readInputFile} from '../../packages/cli/src/input';
describe('bounded CLI JSON input',()=>{
 function fixture(run:(dir:string)=>void){const dir=mkdtempSync(join(tmpdir(),'cli-input-'));try{run(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
 it('reads a bounded UTF-8 JSON body without schema guessing',()=>fixture(dir=>{const file=join(dir,'body');writeFileSync(file,'{"name":"hello"}');expect(readInputFile(file)).toEqual({name:'hello'});}));
 it('rejects oversized input before JSON parsing',()=>fixture(dir=>{const file=join(dir,'body');writeFileSync(file,' '.repeat(65537));expect(()=>readInputFile(file)).toThrow('CLI_INPUT_REJECTED');}));
 it('rejects malformed UTF-8 rather than replacing it',()=>fixture(dir=>{const file=join(dir,'body');writeFileSync(file,Buffer.from([123,34,120,34,58,34,255,34,125]));expect(()=>readInputFile(file)).toThrow('CLI_INPUT_REJECTED');}));
 it('rejects a symlink and a directory',()=>fixture(dir=>{const file=join(dir,'body');writeFileSync(file,'{}');symlinkSync(file,join(dir,'link'));mkdirSync(join(dir,'directory'));expect(()=>readInputFile(join(dir,'link'))).toThrow('CLI_INPUT_REJECTED');expect(()=>readInputFile(join(dir,'directory'))).toThrow('CLI_INPUT_REJECTED');}));
 it('rejects invalid JSON with a bounded non-sensitive error',()=>fixture(dir=>{const file=join(dir,'body');writeFileSync(file,'secret-value');expect(()=>readInputFile(file)).toThrow(/^CLI_INPUT_REJECTED$/);}));
});
