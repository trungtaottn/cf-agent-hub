import {execFileSync} from 'node:child_process';
import {resolve,relative,sep} from 'node:path';
import {readR2Root} from './r2-evidence-loader.mjs';
import {validR2Root} from './r2-schema-registry.mjs';
import {verifyR2Release} from './r2-release-verifier.mjs';
/** R2 CLI uses bounded disk reads, not the historical eager R1 Map loader. */
export function verifyR2Checkout(root,evidencePath){
 const path=relative(root,resolve(root,evidencePath)).split(sep).join('/');
 const input=readR2Root(root,path);
 if(!validR2Root(input))return verifyR2Release(input,{root});
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000,maxBuffer:2097152});
 const head=git(['rev-parse','HEAD']).trim(),prefix='validation/releases/'+input.release_id+'/';
 const tracked=git(['ls-files','--stage','-z']).split('\0').filter(Boolean);
 const modes=new Map(tracked.map(line=>{const tab=line.indexOf('\t');return [line.slice(tab+1),line.slice(0,6)];}));
 const names=git(['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(x=>x&&!x.startsWith(prefix));
 const inventory=new Set(input.files.map(x=>x.path));
 const result=verifyR2Release(input,{root});
 const fail=(code,message)=>result.findings.push({code,path:'/',message});
 if(names.length!==inventory.size||names.some(name=>!inventory.has(name)))fail('R2_GIT_INVENTORY','The Git candidate inventory differs from recorded sources.');
 for(const entry of input.files)if(modes.get(entry.path)!==entry.mode)fail('FILE_MODE','Recorded file mode differs from the committed candidate.');
 if(head!==input.revision)fail('REVISION_MISMATCH','Evidence revision does not match the checked-out commit.');
 // NUL format avoids quoted-path parsing and locale-dependent Git rendering.
 const dirty=git(['status','--porcelain=v1','-z','--untracked-files=all']).split('\0').filter(Boolean);
 if(dirty.some(line=>!line.slice(3).startsWith(prefix)))fail('UNCOMMITTED_CANDIDATE','A candidate must be committed; evidence files are the only allowed additions.');
 result.passed=result.findings.length===0;return result;
}
