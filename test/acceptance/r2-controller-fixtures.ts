/** Synthetic structural graph, never an authenticated acceptance record. */
import {readFileSync} from 'node:fs';
import {canonicalR2,hashR2} from '../../scripts/lib/r2-release-verifier.mjs';
import {R2_COMPOSITION,R2_ROLES,R2_CONFIG_PATHS,R2_FEATURES,R2_KINDS,componentNames} from '../../scripts/lib/r2-release-policy.mjs';
import {ALL_FEATURES} from '../../scripts/lib/release-policy.mjs';
import {recoveryFixture,graphFixture} from './r2-recovery-fixtures.mjs';
import {makeCaseEvidence} from './r2-case-fixtures';
import {makePlatformEvidence} from './r2-platform-fixtures.mjs';
export function controllerFixture(){
 const files=new Map<string,Uint8Array|string>(),prefix='validation/releases/synthetic/';
 const put=(path:string,value:any)=>{const bytes=typeof value==='string'||value instanceof Uint8Array?value:canonicalR2(value);files.set(path,bytes);return {path,sha256:hashR2(bytes),byte_size:Buffer.byteLength(bytes)};};
 const sourcePaths=[...new Set(['package-lock.json',...Object.values(R2_CONFIG_PATHS),...R2_COMPOSITION.operator_source_closure,...R2_COMPOSITION.application_sql.map((x:any)=>x.source)])];
 const inventory=sourcePaths.map(path=>({...put(path,readFileSync(new URL('../../'+path,import.meta.url))),mode:'100644'}));
 // Canonical controller order is code-unit lexical order, not host locale.
 inventory.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const components=R2_ROLES.map(role=>({role,files:componentNames(role).map(name=>({name,artifact:role==='operator-cli-source'?inventory.find(x=>x.path===name) && (({path,sha256,byte_size})=>({path,sha256,byte_size}))(inventory.find(x=>x.path===name)!):put(prefix+'components/'+role+'/'+name,role==='application-worker'&&name!=='index.js'?files.get(R2_COMPOSITION.application_sql.find((x:any)=>x.name===name)!.source):'synthetic-'+role+'-'+name)})),configuration_path:R2_CONFIG_PATHS[role],configuration_sha256:inventory.find(x=>x.path===R2_CONFIG_PATHS[role])!.sha256}));
 const root:any={format_version:2,round:'R2',release_id:'synthetic',author_id:'author',revision:'a'.repeat(40),tree_sha256:hashR2(canonicalR2(inventory)),schema_version:16,config_epoch:2,files:inventory,environment:{id:'target_env',workspace_id:'workspace_a',object_name:'target_object',deployment_id:'app_deployment',worker_version:'app_version',isolation_record_sha256:hashR2('isolation')},toolchain:{node:'24.22.1',npm:'11.19.1',lock_sha256:inventory.find(x=>x.path==='package-lock.json')!.sha256},components,commands:[],features:[...R2_FEATURES],disabled_features:ALL_FEATURES.filter(x=>!R2_FEATURES.includes(x))};
 const ordered=components.map(x=>({...x,files:[...x.files].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)})).sort((a,b)=>a.role<b.role?-1:a.role>b.role?1:0),composition=hashR2(canonicalR2(ordered));
 const commands=new Map<string,any>(),receipts=new Map<string,any>();
 const normalize=(c:any)=>({...c,record_sha256:hashR2('execution-'+c.id),type:'command',version:1,invocation:'r2-'+c.kind+'-v1',revision:root.revision,tree_sha256:root.tree_sha256,composition_sha256:composition,environment_id:root.environment.id,provenance:c.provenance??'synthetic',case_ids:c.case_ids??[],results:[],subjects:{graph:null,recovery:null,cases:[],platform:null,...(c.subjects??c.prepared_subjects??{})}});
 const addCommand=(id:string,kind='contract',start=0,end=5000)=>{const c=normalize({id,kind,started_at:start,ended_at:end,exit_code:0});commands.set(id,c);return c;};
 const header=(type:string,id:string)=>({type,version:1,revision:root.revision,tree_sha256:root.tree_sha256,composition_sha256:composition,environment_id:root.environment.id,command_id:id,observed_at:4000,observer_id:'observer',record_sha256:hashR2(id)});
 const attach=(key:string,value:any)=>{const artifact=put(prefix+key+'.json',value);receipts.set(key,value);commands.get(value.command_id).results.push({type:value.type,artifact});return artifact;};
 function rebind(value:any):any {if(value===hashR2('tree'))return root.tree_sha256;if(value===hashR2('composition'))return composition;if(Array.isArray(value))return value.map(rebind);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rebind(v)]));return value;}
 const rec=recoveryFixture();for(const [id,c]of rec.ctx.commands)commands.set(id,normalize(rebind(c)));
 const recovery=rebind(rec.value),input=rebind(rec.input),expected=rebind(rec.expected);
 recovery.restore_input=attach('restore-input',input);expected.restore_input_sha256=recovery.restore_input.sha256;recovery.expected_transform=attach('expected-transform',expected);root.recovery=attach('recovery',recovery);
 const graph=graphFixture();commands.set('graph',normalize({...rebind(graph.ctx.commands.get('graph')),kind:'workers-tests'}));root.result_graph=attach('result-graph',rebind(graph.value));
 const cases=makeCaseEvidence({revision:root.revision,tree_sha256:root.tree_sha256,environment_id:root.environment.id,composition_sha256:composition,workspaceId:root.environment.workspace_id,configEpoch:root.config_epoch,nativeExecutableSha256:components.find(x=>x.role==='native-cli')!.files[0].artifact!.sha256,uiAssetsSha256:hashR2(canonicalR2(ordered.find(x=>x.role==='ui-assets')!.files)),resultGraphSha256:root.result_graph.sha256});
 for(const [id,c]of cases.commands)commands.set(id,normalize(c));root.preparations=attach('preparations',cases.preparations);for(const family of ['isolation','gates','native','browser'])root[family]=attach(family,cases.receipts[family]);
 addCommand('review');root.review=attach('review',{...header('r2-review','review'),observer_id:'reviewer',author_id:root.author_id,reviewer_id:'reviewer',verdict:'pass',open_findings:[]});
 addCommand('audit','dependency-audit');root.audit=attach('audit',{...header('r2-audit','audit'),...root.toolchain,embedded_inventory_complete:true,advisories:[],packages:[{name:'synthetic-package',version:'1.0.0',kind:'installed',path:'node_modules/synthetic-package',sha256:hashR2('package')}]});
 addCommand('deployment','deployed-ingress');root.deployment=attach('deployment',{...header('r2-deployment','deployment'),workspace_id:root.environment.workspace_id,object_name:root.environment.object_name,config_epoch:root.config_epoch,schema_version:16,previous_revision:'b'.repeat(40),isolation_record_sha256:root.environment.isolation_record_sha256,components:ordered.map(c=>{const app=c.role==='application-worker',operator=c.role==='operator-worker',provider=c.role==='anchor-provider',ui=c.role==='ui-assets';return {role:c.role,configuration_sha256:c.configuration_sha256,artifact_inventory_sha256:hashR2(canonicalR2(c.files)),deployment_id:app||ui?root.environment.deployment_id:operator||provider?c.role+'-deployment':null,worker_version:app||ui?root.environment.worker_version:operator||provider?c.role+'-version':null,environment_id:root.environment.id,namespace_id:app||provider?c.role+'-namespace':null,bindings:app?[{kind:'service',name:'RECOVERY_ANCHOR',target_role:'anchor-provider',entrypoint:'default'}]:operator?[{kind:'durable-object',name:'WORKSPACE',target_role:'application-worker',entrypoint:'WorkspaceDO'}]:[]};})});
 const platform=makePlatformEvidence();
 for(const [id,c]of platform.ctx.commands)commands.set(id,normalize(rebind(c)));
 const resolution=rebind(platform.resolution),plan=rebind(platform.plan),platformRoot=rebind(platform.value);
 resolution.configuration_sha256=inventory.find(x=>x.path==='wrangler.jsonc')!.sha256;
 commands.get(resolution.command_id).subjects.platform.configuration_sha256=resolution.configuration_sha256;
 platformRoot.resolution=attach('platform-resolution',resolution);plan.resolution_sha256=platformRoot.resolution.sha256;
 commands.get(plan.command_id).subjects.platform.resolution_sha256=plan.resolution_sha256;
 platformRoot.plan=attach('platform-plan',plan);
 platformRoot.workloads=platform.workloads.map((row:any)=>attach('platform-'+row.id,rebind(row)));
 root.platform=attach('platform',platformRoot);
 for(const kind of R2_KINDS)if(![...commands.values()].some(c=>c.kind===kind))addCommand('gate-'+kind,kind);
 function refreshCommands(){root.commands=[...commands.values()].map(c=>{delete c.prepared_subjects;const artifact=put(prefix+'commands/'+c.id+'.json',c);return Object.fromEntries([...['id','kind','revision','tree_sha256','environment_id','started_at','ended_at','exit_code','record_sha256'].map(key=>[key,c[key]]),['artifact',artifact]]);});}
 refreshCommands();return {root,files,commands,receipts,put,attach,addCommand,header,refreshCommands,composition};
}
