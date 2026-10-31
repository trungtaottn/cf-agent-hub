/** Build-time only: deterministic fixed host bundle from captured source bytes. */
import {build} from 'esbuild';
import ts from 'typescript';
import {isBuiltin} from 'node:module';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,realpath,access} from 'node:fs/promises';
import {resolve,relative,dirname,sep,extname} from 'node:path';
const fail=()=>{throw Error('NATIVE_COMPLETE_BUILD_REJECTED');},check=v=>{if(!v)fail();};
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const ENTRY='scripts/native-complete-host-entry.mjs',VIRTUAL='#native-complete-source-inventory';
const METADATA=['scripts/build-native-host.mjs','scripts/lib/native-complete-build.mjs','package.json','package-lock.json'];
const READER='../../dist/native-host/complete-host-observation.mjs',READER_SOURCE='packages/cli/src/complete-host-observation.ts';
const SHIM=`import {createRequire as __hostCreateRequire,isBuiltin as __hostIsBuiltin} from 'node:module';\nconst __hostBuiltinRequire=__hostCreateRequire('file:///opt/agenthub-native/host-v2.mjs');\nconst require=(id)=>{if(typeof id!=='string'||!__hostIsBuiltin(id))throw Error('NATIVE_COMPLETE_BUILD_REQUIRE_REJECTED');return __hostBuiltinRequire(id);};`;
const inside=(root,p)=>p===root||p.startsWith(root+sep);
function outputImports(bytes){const source=ts.createSourceFile('host-v2.mjs',bytes.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);check(source.parseDiagnostics.length===0);function visit(n){if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword)check(n.arguments.length===1&&ts.isStringLiteral(n.arguments[0])&&isBuiltin(n.arguments[0].text));if(ts.isImportDeclaration(n)||ts.isExportDeclaration(n)){if(n.moduleSpecifier)check(ts.isStringLiteral(n.moduleSpecifier)&&isBuiltin(n.moduleSpecifier.text));}ts.forEachChild(n,visit);}visit(source);}
/** This accepts a build checkout root, never a runtime installation/module path. */
export async function prepareCompleteHostBuild({root}){
 check(typeof root==='string');root=await realpath(root);const deps=resolve(root,'node_modules');let depRoot=null;try{depRoot=await realpath(deps);}catch{}
 const captured=new Map(),edges=new Map(),compilerToSource=new Map(),sourceToCompiler=new Map();let aggregate=0,edgeBytes=0;
 function logical(input){const p=resolve(input);let name;if(inside(root,p))name=relative(root,p);else if(depRoot&&inside(depRoot,p))name='node_modules/'+relative(depRoot,p);else fail();name=name.split(sep).join('/');check(name&&name.length<=256&&!/[\x00-\x20\x7f\\]/.test(name)&&!name.startsWith('dist/')&&!name.split('/').some(x=>!x||x==='.'||x==='..'));return name;}
 async function guardedPath(name){const dependent=name.startsWith('node_modules/');const base=dependent?depRoot:root;check(base);let p=base;const parts=(dependent?name.slice(13):name).split('/');for(const part of parts){p=resolve(p,part);check(inside(base,p));const st=await lstat(p);check(!st.isSymbolicLink());}return p;}
 async function read(name){const p=await guardedPath(name),fd=await open(p,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await fd.stat({bigint:true});check(before.isFile()&&before.size>=0n&&before.size<=4194304n);const bytesWithProbe=Buffer.alloc(Number(before.size)+1);let offset=0;while(offset<bytesWithProbe.length){const {bytesRead}=await fd.read(bytesWithProbe,offset,bytesWithProbe.length-offset,offset);check(Number.isInteger(bytesRead)&&bytesRead>=0&&bytesRead<=bytesWithProbe.length-offset);if(bytesRead===0)break;offset+=bytesRead;}check(offset===Number(before.size));const bytes=bytesWithProbe.subarray(0,offset);const after=await fd.stat({bigint:true});check(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&BigInt(bytes.length)===after.size);return {bytes,mode:(after.mode&0o111n)!==0n?'100755':'100644',sha256:hash(bytes)};}finally{await fd.close();}}
 async function capture(name){if(captured.has(name))return captured.get(name);check(captured.size<2048);const value=await read(name);aggregate+=value.bytes.length;check(aggregate<=67108864);captured.set(name,value);return value;}
 for(const name of METADATA)await capture(name);
 // Explicit compiler extensions retain captured Node package scope in pass two.
 async function moduleMode(name){
  const ext=extname(name);if(['.mjs','.mts'].includes(ext))return 'module';if(['.cjs','.cts'].includes(ext))return 'commonjs';if(ext==='.json')return 'json';
  check(ext==='.js'||ext==='.ts');const parts=name.split('/');let floor=0;
  const boundary=parts.lastIndexOf('node_modules');if(boundary>=0){floor=boundary+(parts[boundary+1]?.startsWith('@')?3:2);check(parts.length>floor);}
  for(let n=parts.length-1;n>=floor;n--){const path=[...parts.slice(0,n),'package.json'].join('/');let metadata;
   try{metadata=await capture(path);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   const value=JSON.parse(metadata.bytes.toString('utf8'));check(value&&typeof value==='object'&&!Array.isArray(value));
   if(value.type!==undefined)check(value.type==='module'||value.type==='commonjs');return value.type==='module'?'module':'commonjs';
  }
  return 'commonjs';
 }
 async function compilerPath(name){
  if(sourceToCompiler.has(name))return sourceToCompiler.get(name);
  check(sourceToCompiler.size<2048);const mode=await moduleMode(name),extension=mode==='json'?'.json':['.ts','.mts','.cts'].includes(extname(name))?(mode==='module'?'.mts':'.cts'):(mode==='module'?'.mjs':'.cjs');
  const path=resolve(root,'.native-complete-captured',hash(name)+extension);check(!compilerToSource.has(path)||compilerToSource.get(path)===name);compilerToSource.set(path,name);sourceToCompiler.set(name,path);return path;
 }
 const originalImporter=input=>{if(!input)return '';check(compilerToSource.has(input));return compilerToSource.get(input);};
 const loader=name=>{const extension=extname(name);check(['.mjs','.cjs','.js','.ts','.mts','.cts','.json'].includes(extension));return extension==='.json'?'json':['.ts','.mts','.cts'].includes(extension)?'ts':'js';};
 async function compile(rows,second){const used=new Set();const result=await build({absWorkingDir:root,entryPoints:[ENTRY],outfile:'dist/native-host/host-v2.mjs',bundle:true,platform:'node',format:'esm',target:'node24',write:false,metafile:true,preserveSymlinks:true,sourcemap:false,minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:true,keepNames:true,legalComments:'inline',logLevel:'silent',banner:{js:SHIM},plugins:[{name:'fixed-complete-source',setup(b){
  b.onResolve({filter:/.*/},async args=>{
   if(args.pluginData?.fixedResolverBypass===true)return;
   const importer=originalImporter(args.importer);const key=canonical({importer,path:args.path,kind:args.kind,namespace:args.namespace,attributes:args.with});check(Buffer.byteLength(key)<=8192);
   if(second){check(edges.has(key));return {...edges.get(key)};}
   if(edges.has(key))return {...edges.get(key)};
   let edge;
   if(args.path===VIRTUAL)edge={path:VIRTUAL,namespace:'complete-inventory'};
   else if(isBuiltin(args.path))edge={path:args.path,external:true};
   else if(args.path===READER){check(importer==='scripts/lib/native-complete-host-twins.mjs');edge={path:await compilerPath(READER_SOURCE),namespace:'file'};}
   else{const found=await b.resolve(args.path,{importer:importer?resolve(root,importer):'',namespace:args.namespace,resolveDir:importer?dirname(resolve(root,importer)):root,kind:args.kind,with:args.with,pluginData:{fixedResolverBypass:true}});check(found.errors.length===0&&found.warnings.length===0&&!found.external&&found.namespace==='file'&&!found.suffix);const name=logical(found.path);edge={path:await compilerPath(name),namespace:found.namespace,external:false,sideEffects:found.sideEffects};}
   check(edges.size<65536);edgeBytes+=Buffer.byteLength(key)+Buffer.byteLength(canonical(edge));check(edgeBytes<=4194304);edges.set(key,Object.freeze(edge));return {...edge};
  });
  b.onLoad({filter:/.*/,namespace:'complete-inventory'},()=>({contents:`export const COMPLETE_HOST_SOURCE_INVENTORY=Object.freeze(${canonical(rows)}.map(row=>Object.freeze(row)));`,loader:'js'}));
  b.onLoad({filter:/.*/,namespace:'file'},async args=>{check(compilerToSource.has(args.path));const name=compilerToSource.get(args.path);used.add(name);if(second)check(captured.has(name));const value=second?captured.get(name):await capture(name);return {contents:Buffer.from(value.bytes),loader:loader(name),resolveDir:dirname(resolve(root,name))};});
 }}]});check(result.warnings.length===0&&result.outputFiles.length===1);for(const out of Object.values(result.metafile.outputs))for(const i of out.imports)check(i.external&&isBuiltin(i.path));return {result,used};}
 const first=await compile([],false);
 // Observed dependency metadata is stability-checked context. Exact captured
 // resolution edges, not a claim about independently re-resolving metadata, own pass two.
 for(const name of [...captured.keys()])if(name.startsWith('node_modules/')){let dir=dirname(resolve(root,name));while(inside(deps,dir)&&dir!==deps){const meta=logical(resolve(dir,'package.json'));try{await access(resolve(root,meta));await capture(meta);}catch(error){if(error.code!=='ENOENT')throw error;}dir=dirname(dir);}}
 const inventory=[...captured].map(([path,v])=>({path,sha256:v.sha256,byte_size:v.bytes.length,mode:v.mode})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);const encoded=canonical(inventory);check(Buffer.byteLength(encoded)<=4194304);
 let finalized=false;return Object.freeze({async finalize(){check(!finalized);finalized=true;
 const second=await compile(inventory,true);check(canonical([...first.used].sort())===canonical([...second.used].sort()));
 for(const [name,v]of captured){const current=await read(name);check(current.mode===v.mode&&current.sha256===v.sha256&&current.bytes.equals(v.bytes));}
 const bytes=Buffer.from(second.result.outputFiles[0].contents);if(bytes.length>4194304)throw Error('NATIVE_COMPLETE_BUILD_OUTPUT_TOO_LARGE:'+bytes.length);check(bytes.length>0);outputImports(bytes);
 const exports=Object.values(second.result.metafile.outputs)[0].exports;check(canonical([...exports].sort())===canonical(['COMPLETE_HOST_BUNDLE_VERSION','COMPLETE_HOST_SOURCE_INVENTORY','executeFixedCompleteHost']));
 return Object.freeze({bytes,sha256:hash(bytes),inventory:Object.freeze(inventory.map(Object.freeze)),inventorySha256:hash(encoded),sourceBytes:aggregate});
 }});
}
export async function buildCompleteHost(options){return (await prepareCompleteHostBuild(options)).finalize();}
