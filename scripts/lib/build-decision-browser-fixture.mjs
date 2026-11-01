/** Private build tooling. No runtime descriptor switch; never imported by Worker code. */
import {resolve,relative,sep} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const composition='test/helpers/decision-browser-composition.ts';
const ordinary='src/approvals/commands.ts';
const factory='src/approvals/commands-source.ts';
const marker='synthetic.task-review';
const digest=value=>createHash('sha256').update(value).digest('hex');
export function createDecisionFixturePlugin(root){
 const canonical=resolve(root,ordinary),replacement=resolve(root,composition);let count=0;
 return {name:'fixed-private-decision-composition',setup(builder){
  builder.onResolve({filter:/commands(?:\.ts)?$/},args=>{
   if(args.namespace!=='file'||!args.path.startsWith('.'))return;
   const path=resolve(args.resolveDir,args.path.endsWith('.ts')?args.path:args.path+'.ts');
   if(path!==canonical)return;
   count++;return {path:replacement};
  });
  builder.onEnd(()=>count===1?undefined:{errors:[{text:'DECISION_FIXTURE_REPLACEMENT_COUNT'}]});
 }};
}
export function assertDecisionBuildGraph({root,kind,inputs,code}){
 if(kind!=='normal'&&kind!=='private')throw Error('DECISION_FIXTURE_BUILD_KIND');
 const paths=Object.keys(inputs).map(path=>relative(resolve(root),resolve(root,path)).split(sep).join('/'));
 if(kind==='normal'){
  if(paths.some(path=>path.startsWith('test/'))||!paths.includes(ordinary)||!paths.includes(factory))throw Error('DECISION_FIXTURE_PRODUCTION_GRAPH');
  if(code.includes(marker)||code.includes('PRIVATE TEST BUILD ONLY'))throw Error('DECISION_FIXTURE_PRODUCTION_MARKER');
 }else if(paths.filter(path=>path===composition).length!==1||paths.includes(ordinary)||!paths.includes(factory)||!code.includes(marker))throw Error('DECISION_FIXTURE_PRIVATE_GRAPH');
}
export async function buildDecisionBrowserFixture(options){
 if(!options||Object.keys(options).sort().join(',')!=='outputDirectory,root'||typeof options.root!=='string'||typeof options.outputDirectory!=='string')throw Error('DECISION_FIXTURE_BUILD_OPTIONS');
 const root=resolve(options.root),outputDirectory=resolve(options.outputDirectory);
 const guarded=[ordinary,'src/approvals/action-registry.ts'];
 const before=Object.fromEntries(await Promise.all(guarded.map(async path=>[path,digest(await readFile(resolve(root,path)))])));
 await mkdir(outputDirectory,{recursive:true});
 const manifest={kind:'PRIVATE_SYNTHETIC_DECISION_BROWSER_TEST_ONLY',productionSource:before,builds:{}};
 for(const kind of ['normal','private']){
  const outfile=resolve(outputDirectory,kind+'-worker.mjs');
  const result=await build({absWorkingDir:root,entryPoints:['src/index.ts'],outfile,bundle:true,platform:'neutral',format:'esm',target:'es2022',external:['cloudflare:*','node:*'],loader:{'.sql':'text'},metafile:true,write:false,logLevel:'silent',plugins:kind==='private'?[createDecisionFixturePlugin(root)]:[]});
  if(result.outputFiles.length!==1||!result.metafile)throw Error('DECISION_FIXTURE_BUILD_OUTPUT');
  const file=result.outputFiles[0];assertDecisionBuildGraph({root,kind,inputs:result.metafile.inputs,code:file.text});
  await writeFile(outfile,file.contents);
  const graph=JSON.stringify(result.metafile);await writeFile(resolve(outputDirectory,kind+'-metafile.json'),graph);
  const inputPaths=Object.keys(result.metafile.inputs).sort();
  const inputSha256=Object.fromEntries(await Promise.all(inputPaths.map(async path=>[path,digest(await readFile(resolve(root,path)))])));
  manifest.builds[kind]={sha256:digest(file.contents),graphSha256:digest(graph),inputPaths,inputSha256};
 }
 for(const path of guarded)if(digest(await readFile(resolve(root,path)))!==before[path])throw Error('DECISION_FIXTURE_PRODUCTION_SOURCE_CHANGED');
 await writeFile(resolve(outputDirectory,'decision-build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return {privateWorker:resolve(outputDirectory,'private-worker.mjs'),normalWorker:resolve(outputDirectory,'normal-worker.mjs'),manifest};
}
