/** Measured local inputs only. No install-origin, immutable-source, or build attestation. */
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,readSync,fstatSync,lstatSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {relative,resolve,isAbsolute} from 'node:path';
import {build} from 'esbuild';
import {J1_MODULE,J1_LIMITS as L} from './r3-source-producer-policy.mjs';
export const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Error('R3_SOURCE_CONTEXT_INVALID');};
function bytes(path,cap){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>cap||realpathSync(path)!==path)fail();const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const opened=fstatSync(fd);if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)fail();const b=Buffer.alloc(stat.size);let offset=0;while(offset<b.length){const n=readSync(fd,b,offset,b.length-offset,null);if(n<=0)fail();offset+=n;}if(readSync(fd,Buffer.alloc(1),0,1,null)!==0||fstatSync(fd).size!==stat.size)fail();return b;}finally{closeSync(fd);}}
export function sourceReference(root,path){if(typeof path!=='string'||path.length>512||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..')||path.includes('\\'))fail();const b=bytes(root+'/'+path,L.sourceFile);return {path,sha256:sha(b),byte_size:b.length};}
const versions={vitest:'4.1.12',vite:'7.3.7','@cloudflare/vitest-plugin':'1.4.7',wrangler:'4.152.0',esbuild:'0.28.2',typescript:'6.0.3'};
function runtime(root){if(process.versions.node!=='24.22.1'||process.execArgv.length)fail();const entries=[];
 for(const [name,version]of Object.entries(versions)){
  const packagePath=realpathSync(root+'/node_modules/'+name+'/package.json'),packageBytes=bytes(packagePath,L.sourceFile),p=JSON.parse(packageBytes);
  if(p.name!==name||p.version!==version)fail();const entry=realpathSync(name==='vitest'?resolve(packagePath,'../vitest.mjs'):fileURLToPath(import.meta.resolve(name)));
  const entryPath=relative(resolve(packagePath,'..'),entry);if(!entryPath||entryPath==='..'||entryPath.startsWith('../')||isAbsolute(entryPath))fail();const entryBytes=bytes(entry,L.sourceFile);
  entries.push({name,package_json_sha256:sha(packageBytes),entry_sha256:sha(entryBytes),entry_path:entryPath});
 }
 return {node:process.versions.node,node_executable_sha256:sha(bytes(realpathSync(process.execPath),268435456)),vitest:versions.vitest,vite:versions.vite,workers_plugin:versions['@cloudflare/vitest-plugin'],wrangler:versions.wrangler,esbuild:versions.esbuild,typescript:versions.typescript,npm_engine_declared:'11.19.1',npm_executed:false,install_origin_verified:false,package_entries:entries};
}
function git(root,args){return execFileSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8',maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();}
export async function measureJ1ContextV2(root,environment){
 if(realpathSync(root)!==root)fail();assertJ1ContextCleanSource(root);
 const revision=git(root,['rev-parse','HEAD']),tree=git(root,['rev-parse','HEAD^{tree}']);
 const entries=[J1_MODULE,'vitest.r3-source-context-producer.config.ts','scripts/r3-source-context-producer.mjs','scripts/lib/r3-source-context-reporter.ts','test/helpers/historical-worker.ts','src/index.ts','scripts/lib/r3-source-context-validator.ts'];
 const graph=await build({absWorkingDir:root,entryPoints:entries,bundle:true,packages:'external',loader:{'.sql':'text'},external:['cloudflare:*'],platform:'node',format:'esm',target:'node24',outdir:'/tmp/r3-unused-build-output',write:false,metafile:true,logLevel:'silent'});
 const paths=new Set([...Object.keys(graph.metafile.inputs),'package.json','package-lock.json','wrangler.jsonc','tsconfig.json']);
 if(paths.size>L.sourceCount)fail();const tracked=new Set(git(root,['ls-files']).split('\n'));let total=0;const source_files=[...paths].sort().map(path=>{if(!tracked.has(path))fail();const ref=sourceReference(root,path);total+=ref.byte_size;if(total>L.sourceBytes)fail();return ref;});
 const config=source_files.find(x=>x.path==='vitest.r3-source-context-producer.config.ts'),lock=source_files.find(x=>x.path==='package-lock.json');if(!config||!lock)fail();
 return {revision,tree,source_files,inventory_sha256:sha(canonical(source_files)),lock_sha256:lock.sha256,configuration:{file:config.path,sha256:config.sha256,project_name:'r3-j1-source-context-producer',module_path:J1_MODULE,filter:null,watch:false,retry:0,repeat_policy:'reject-nonzero-diagnostic',exclude:[],allow_only:false,shard:null,file_parallelism:false,max_workers:1,pool:'cloudflare-pool',reporter:'scripts/lib/r3-source-context-reporter.ts',profile:'j1-context-v2',provided_context:{r3SourceProfile:'j1-context-v2'}},runtime:runtime(root),environment,product_build:null};
}
export function recheckJ1ContextV2(root,context){assertJ1ContextCleanSource(root);if(git(root,['rev-parse','HEAD'])!==context.revision||git(root,['rev-parse','HEAD^{tree}'])!==context.tree||git(root,['diff','--name-only','HEAD']))fail();for(const ref of context.source_files)if(canonical(sourceReference(root,ref.path))!==canonical(ref))fail();if(canonical(runtime(root))!==canonical(context.runtime))fail();}

export function assertJ1ContextCleanSource(root){const status=git(root,['status','--porcelain','--untracked-files=all','--ignored=matching']);if(status.split('\n').filter(Boolean).some(x=>!['?? node_modules','?? packages/mcp-stdio/node_modules','!! node_modules/','!! packages/mcp-stdio/node_modules/'].includes(x)))fail();}
