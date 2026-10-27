#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
/** Static trusted mapping check; never probes, provisions or modifies infrastructure. */
export function artifactBindingIssues(config){
 const errors=[];
 for(const [name,environment] of [['default',config],...Object.entries(config.env??{})]){
  const bindings=environment.r2_buckets??[],products=bindings.filter(b=>b.binding==='ARTIFACT_BUCKET'),recoveries=bindings.filter(b=>b.binding==='RECOVERY_BUCKET');
  if(products.length===0)continue;
  if(products.length!==1||recoveries.length!==1){errors.push(name+': distinct named bindings required');continue;}
  const p=products[0],r=recoveries[0];
  if(typeof p.bucket_name!=='string'||!p.bucket_name||typeof r.bucket_name!=='string'||!r.bucket_name||p.bucket_name===r.bucket_name)errors.push(name+': product/recovery bucket identity must differ');
  const productNames=[p.bucket_name,p.preview_bucket_name].filter(x=>typeof x==='string'),recoveryNames=[r.bucket_name,r.preview_bucket_name].filter(x=>typeof x==='string');
  if(productNames.some(x=>recoveryNames.includes(x)))errors.push(name+': product/recovery preview identity must differ');
 }
 return errors;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')),errors=artifactBindingIssues(config);
 if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Artifact binding declarations are separate; absent product bindings remain disabled. No remote verification performed.');
}
