import fs from 'node:fs';
import {parsePolicy} from '../workers/recovery-anchor/src/policy.ts';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
/** Static source declarations only; no provisioning or provider freshness proof. */
export function anchorBindingIssues(product,operator,provider){
 const errors=[],providerNames=new Set(),bindingIds=new Set();
 const names=new Set(['default',...Object.keys(product.env??{}),...Object.keys(operator.env??{}),...Object.keys(provider.env??{})]);
 const identity=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
 for(const name of names){
  const p=name==='default'?product:product.env?.[name],o=name==='default'?operator:operator.env?.[name],a=name==='default'?provider:provider.env?.[name];
  const bad=message=>errors.push(name+': '+message);
  if(!p||!o||!a){bad('explicit matching environment declarations required');continue;}
  if(a.workers_dev!==false||a.preview_urls!==false||a.route!==undefined||!Array.isArray(a.routes)||a.routes.length!==0)bad('provider must have no public ingress');
  try{const policy=parsePolicy(a.vars?.ANCHOR_POLICY);if(policy.environment_id!==(p.vars?.RECOVERY_ENVIRONMENT_ID??(name==='default'?'unconfigured':name)))bad('provider policy environment must match product environment');}catch{bad('provider policy must be closed and valid');}
  const namespaces=a.durable_objects?.bindings??[];
  if(namespaces.length!==1||namespaces[0].name!=='ANCHORS'||namespaces[0].class_name!=='RecoveryAnchorDO'||namespaces[0].script_name!==undefined)bad('provider owns its independent local SQLite namespace');
  const reads=(p.services??[]).filter(b=>b.binding==='RECOVERY_ANCHOR');
  if(reads.length!==1||reads[0].service!==a.name||reads[0].entrypoint!==undefined)bad('product requires exact default read service mapping');
  if(typeof p.vars?.RECOVERY_ANCHOR_BINDING_ID!=='string'||!identity.test(p.vars.RECOVERY_ANCHOR_BINDING_ID))bad('explicit binding identity required');
  for(const c of [p,o]){
   for(const b of c.services??[])if(b.entrypoint==='RecoveryAnchorWriter'||b.entrypoint==='RecoveryAnchorBootstrap'||(b.service===a.name&&(c===o||b.binding!=='RECOVERY_ANCHOR'||b.entrypoint!==undefined)))bad('ordinary consumers cannot receive writer/bootstrap capability');
   for(const b of c.durable_objects?.bindings??[])if(b.class_name==='RecoveryAnchorDO'||b.script_name===a.name||b.name==='ANCHORS')bad('ordinary consumers cannot receive provider namespace');
  }
  if(typeof a.name!=='string'||!a.name||providerNames.has(a.name))bad('provider names must be pairwise distinct');
  providerNames.add(a.name);
  if(bindingIds.has(p.vars?.RECOVERY_ANCHOR_BINDING_ID))bad('binding identities must be pairwise distinct');
  bindingIds.add(p.vars?.RECOVERY_ANCHOR_BINDING_ID);
  if(name!=='default'&&(a.name===provider.name||p.vars?.RECOVERY_ANCHOR_BINDING_ID===product.vars?.RECOVERY_ANCHOR_BINDING_ID))bad('environment namespace and binding identity must be distinct');
 }
 return errors;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
 const errors=anchorBindingIssues(read('../wrangler.jsonc'),read('../workers/operator/wrangler.jsonc'),read('../workers/recovery-anchor/wrangler.jsonc'));
 if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Private recovery anchor declarations checked; no deployment or freshness proof.');
}
