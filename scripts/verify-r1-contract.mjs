#!/usr/bin/env node
/** Contract tooling only. This bounded schema probe is not a replacement for Ajv. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const readJson=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
export function probe(schema,value,document=schema,path='$') {
  const fail=()=>[path];
  if(schema===true)return [];if(schema===false)return fail();
  if(schema.not&&probe(schema.not,value,document,path).length===0)return fail();
  if(schema.$ref){
    const [id,fragment='']=schema.$ref.split('#');
    const sources={'urn:cf-agent-hub:decision-policy:1':'spec/decision-policy.schema.json','urn:cf-agent-hub:execution-policy:1':'spec/execution-policy.schema.json','urn:cf-agent-hub:deployment-config:0.2':'spec/deployment-config.schema.json','urn:cf-agent-hub:r1-bootstrap:0.1':'spec/r1-bootstrap.schema.json','urn:cf-agent-hub:recovery-manifest:1':'spec/recovery-manifest.schema.json','urn:cf-agent-hub:recovery-command:1':'spec/recovery-command.schema.json'};
    let source=id==='urn:cf-agent-hub:openapi-components:1'?{components:readJson('spec/openapi.json').components}:id?readJson(sources[id]??(()=>{throw Error('Unregistered contract schema: '+id)})()):document;
    let target=source;
    if(fragment){if(!fragment.startsWith('/'))throw Error('Invalid local schema fragment: '+schema.$ref);for(const key of fragment.slice(1).split('/'))target=target[key.replaceAll('~1','/').replaceAll('~0','~')];}
    return probe(target,value,source,path);
  }
  if(schema.const!==undefined&&JSON.stringify(value)!==JSON.stringify(schema.const))return fail();
  if(schema.enum&&!schema.enum.some(v=>JSON.stringify(v)===JSON.stringify(value)))return fail();
  if(schema.anyOf&&!schema.anyOf.some(s=>probe(s,value,document,path).length===0))return fail();
  if(schema.oneOf&&schema.oneOf.filter(s=>probe(s,value,document,path).length===0).length!==1)return fail();
  let errors=(schema.allOf??[]).flatMap(s=>probe(s,value,document,path));
  if(schema.if&&probe(schema.if,value,document,path).length===0&&schema.then)errors.push(...probe(schema.then,value,document,path));
  if(schema.type){const types=Array.isArray(schema.type)?schema.type:[schema.type];if(!types.some(t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):t==='integer'?Number.isSafeInteger(value):typeof value===t))return fail();}
  if(typeof value==='number'&&((schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))errors.push(path);
  if(typeof value==='string'){
    if(value.length<(schema.minLength??0)||value.length>(schema.maxLength??Infinity)||(schema.pattern&&!new RegExp(schema.pattern).test(value)))errors.push(path);
    if(schema.format==='date-time'&&(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))))errors.push(path);
    if(schema.format==='uri'){try{new URL(value);}catch{errors.push(path);}}
  }
  if(Array.isArray(value)){if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity)||(schema.uniqueItems&&new Set(value.map(v=>JSON.stringify(v))).size!==value.length))errors.push(path);if(schema.items)value.forEach((v,i)=>errors.push(...probe(schema.items,v,document,path+'['+i+']')));}
  if(value!==null&&typeof value==='object'&&!Array.isArray(value)){
    for(const key of schema.required??[])if(!(key in value))errors.push(path+'.'+key);
    for(const [key,v]of Object.entries(value)){if(schema.properties?.[key])errors.push(...probe(schema.properties[key],v,document,path+'.'+key));else if(schema.additionalProperties===false)errors.push(path+'.'+key);else if(typeof schema.additionalProperties==='object')errors.push(...probe(schema.additionalProperties,v,document,path+'.'+key));}
  }
  return [...new Set(errors)];
}
export function deploymentIssues(config,{installedEpoch=0,identity=null,discovery=null,nowMs=Date.parse('2026-10-23T00:00:00Z')}={}){
 const errors=[];const add=p=>errors.push(p);const unique=(items,key,p)=>{const seen=new Set();for(const item of items??[]){const id=key(item);if(seen.has(id))add(p);seen.add(id);}};
 const catalog=config.workspace_catalog??[];const workspaces=new Set(catalog.map(x=>x.workspace_id));
 unique(catalog,x=>x.workspace_id,'workspace_catalog.workspace_id');unique(catalog,x=>x.object_name,'workspace_catalog.object_name');
 const grants=config.human_grants??[];unique(grants,x=>x.workspace_id+'|'+x.issuer+'|'+x.subject,'human_grants.subject');unique(grants,x=>x.workspace_id+'|'+x.principal_id,'human_grants.principal_id');
 unique(config.static_participants,x=>x.workspace_id+'|'+x.agent_id,'static_participants.agent_id');
 unique(config.static_credential_refs,x=>x.workspace_id+'|'+x.credential_id,'static_credential_refs.credential_id');
 unique(config.workspace_policies,x=>x.workspace_id,'workspace_policies.workspace_id');
 for(const [name,items]of Object.entries({human_grants:grants,static_participants:config.static_participants,static_credential_refs:config.static_credential_refs,workspace_policies:config.workspace_policies}))for(const x of items??[])if(!workspaces.has(x.workspace_id))add(name+'.workspace_id');
 if(config.config_epoch<=installedEpoch)add('config_epoch');
 if(config.authentication?.client_id!==config.authentication?.audience)add('authentication.client_id');
 const pins=config.authentication?.reviewed_oidc_endpoints??{};
 for(const key of ['authorization_endpoint','token_endpoint','jwks_uri'])if(!safeUrl(pins[key]))add('authentication.reviewed_oidc_endpoints.'+key);
 if(discovery&&(discovery.issuer!==config.authentication?.issuer||['authorization_endpoint','token_endpoint','jwks_uri'].some(key=>discovery[key]!==pins[key])))add('authentication.reviewed_oidc_endpoints');
 const redirects=config.authentication?.redirect_uris??[];unique(redirects,x=>x.workspace_id,'authentication.redirect_uris.workspace_id');
 if(redirects.length!==catalog.length)add('authentication.redirect_uris');
 for(const x of redirects){if(!workspaces.has(x.workspace_id))add('authentication.redirect_uris.workspace_id');try{const u=new URL(x.redirect_uri);if(!safeUrl(x.redirect_uri)||u.pathname!='/v2/workspaces/'+x.workspace_id+'/auth/callback'||u.search||u.hash||!config.authentication.allowed_origins.includes(u.origin))add('authentication.redirect_uris.redirect_uri');}catch{add('authentication.redirect_uris.redirect_uri');}}
 const subjects=new Map(),principals=new Map();for(const x of grants){const pair=x.issuer+'|'+x.subject;if((subjects.has(pair)&&subjects.get(pair)!==x.principal_id)||(principals.has(x.principal_id)&&principals.get(x.principal_id)!==pair))add('human_grants.principal_id');subjects.set(pair,x.principal_id);principals.set(x.principal_id,pair);}
 if(identity&&!grants.some(x=>x.workspace_id===identity.workspace_id&&x.issuer===identity.issuer&&x.subject===identity.subject&&x.enabled))add('human_grants');
 for(const x of config.static_credential_refs??[]){if(!(config.static_participants??[]).some(a=>a.workspace_id===x.workspace_id&&a.agent_id===x.agent_id))add('static_credential_refs.agent_id');const expiry=Date.parse(x.expires_at);if(expiry<=nowMs||expiry>nowMs+90*86400000)add('static_credential_refs.expires_at');}
 for(const policy of config.workspace_policies??[]){unique(policy.notification_destinations,x=>x.destination_id,'workspace_policies.notification_destinations.destination_id');for(const d of policy.notification_destinations??[]){if(!safeUrl(d.url))add('workspace_policies.notification_destinations.url');if(!(config.static_participants??[]).some(a=>a.workspace_id===policy.workspace_id&&a.agent_id===d.agent_id))add('workspace_policies.notification_destinations.agent_id');}}
 if((config.workspace_policies??[]).length!==catalog.length)add('workspace_policies');
 return [...new Set(errors)];
}
export function safeUrl(value){try{const u=new URL(value),h=u.hostname.toLowerCase();return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search&&u.href===value&&(!u.port||u.port==='443')&&!/^[\d.]+$|:|(^|\.)(localhost|local|internal|metadata|home|lan|test)$|^metadata\./.test(h)&&h.includes('.');}catch{return false;}}
export function recoveryAuthorityIssues(command,manifest){
 const errors=[];if(command.operation!=='resume')return errors;
 const add=field=>errors.push(field);
 const {source_retirement_receipt:receipt,cutover_record:cutover,ledger}=command.payload;
 const sourceEpoch=manifest.checkpoint.authority_epoch;
 const mapping=ledger.config.workspace_catalog.find(x=>x.workspace_id===manifest.workspace_id);
 const sameMapping=(a,b)=>Boolean(a&&b&&a.workspace_id===b.workspace_id&&a.object_name===b.object_name);
 if(command.workspace_id!==manifest.workspace_id||ledger.workspace_id!==manifest.workspace_id)add('workspace_id');
 if(command.capture_id!==manifest.capture_id)add('capture_id');
 if(command.expected_authority_epoch!==ledger.authority_epoch||ledger.config.config_epoch!==ledger.authority_epoch||ledger.verification_bundle.config_epoch!==ledger.authority_epoch)add('expected_authority_epoch');
 if((receipt===null)!==(cutover===null)){add('source_retirement_receipt');return [...new Set(errors)];}
 if(receipt===null){
  if(ledger.authority_epoch<sourceEpoch)add('ledger.authority_epoch');
  if(ledger.environment_id!==manifest.environment_id||!sameMapping(mapping,manifest.release.catalog_mapping))add('source_retirement_receipt');
  return [...new Set(errors)];
 }
 if(ledger.authority_epoch<=sourceEpoch)add('ledger.authority_epoch');
 if(ledger.environment_id===manifest.environment_id)add('cutover_record.target_environment_id');
 if(receipt.capture_id!==manifest.capture_id||receipt.workspace_id!==manifest.workspace_id||receipt.environment_id!==manifest.environment_id||receipt.authority_epoch!==sourceEpoch||receipt.barrier_id!==manifest.checkpoint.barrier_id)add('source_retirement_receipt.environment_id');
 if(cutover.capture_id!==manifest.capture_id||cutover.workspace_id!==manifest.workspace_id||cutover.source_environment_id!==receipt.environment_id||cutover.source_authority_epoch!==receipt.authority_epoch||cutover.source_retirement_receipt_id!==receipt.id)add('cutover_record.source_authority_epoch');
 if(cutover.target_environment_id!==ledger.environment_id||cutover.target_authority_epoch!==ledger.authority_epoch||cutover.target_authority_epoch<=receipt.authority_epoch)add('cutover_record.target_authority_epoch');
 if(!sameMapping(cutover.target_catalog_mapping,mapping))add('cutover_record.target_catalog_mapping');
 return [...new Set(errors)];
}
export function run(){
 const deployment=readJson('spec/deployment-config.schema.json'),api=readJson('spec/openapi.json');
 for(const key of ['human_grants','config_epoch','workspace_policies','static_credential_refs'])assert(deployment.required.includes(key),'Missing required deployment contract: '+key);
 assert.equal(deployment.properties.contract_revision.const,'0.2');
 assert(deployment.properties.authentication.required.includes('reviewed_oidc_endpoints'));
 assert.equal(api.info['x-amendment-id'],'r1-foundation-1');
 const fixtures=readJson('examples/http/fixture-map.json').fixtures;
 const base='/v2/workspaces/{workspace_id}';
 for(const [method,path,scope,actor]of [['post','/auth/start',null,'protocol'],['get','/auth/callback',null,'protocol'],['get','/auth/session',null,'human'],['post','/auth/logout',null,'human'],['get','/configuration','workspace:read','both'],['get','/profile','workspace:read','both'],['post','/profile:preview','profile:edit','human'],['put','/profile','profile:edit','human'],['get','/profile:export','profile:edit','human'],['get','/preferences','workspace:read','human'],['put','/preferences','workspace:read','human'],['get','/operations','operations:read','human'],['get','/readiness','operations:read','human']]){
  const op=api.paths[base+path]?.[method];assert(op,'Missing R1 route: '+method+' '+path);assert.equal(op['x-actor-kind'],actor);if(scope)assert(op['x-required-scopes'].includes(scope));assert(fixtures.some(f=>f.operation_id===op.operationId),'Missing route fixture: '+op.operationId);
 }
 assert(api.paths['/health/live']?.get);
 for(const prefix of ['/tasks','/artifacts','/credentials','/runtimes'])for(const [path,item]of Object.entries(api.paths))if(path.startsWith(base+prefix))for(const [method,op]of Object.entries(item))if(['get','post','put','patch','delete'].includes(method))assert.equal(op['x-r1-available'],false,path);
 const config=readJson('examples/config/deployment.example.json');assert.deepEqual(probe(deployment,config),[]);assert.deepEqual(deploymentIssues(config),[]);
 for(const test of readJson('examples/http/r1-contract-negative.json').cases){const doc=readJson(test.schema);let value=test.value;const errors=[...probe(doc,value),...(test.schema==='spec/deployment-config.schema.json'?deploymentIssues(value,test.context??{}):[])];assert(errors.some(e=>e.includes(test.field)),test.name+': expected field '+test.field+', got '+JSON.stringify(errors));}
 for(const entry of fixtures){const doc={components:api.components,$ref:entry.schema};assert.deepEqual(probe(doc,readJson('examples/http/'+entry.file)),[],entry.file);}
 const settings=readJson('examples/http/r1-settings.json'),settingsSchema=readJson('spec/r1-settings.schema.json');
 assert.deepEqual(probe(settingsSchema,settings),[],'Named settings fixture must validate against canonical OpenAPI DTOs');
 assert(readJson('validation/fixtures.json').fixtures.some(x=>x.file==='examples/http/r1-settings.json'&&x.schema==='spec/r1-settings.schema.json'));
 const settingFiles={get_configuration:'r1-getConfiguration.response.json',get_profile:'r1-getProfile.response.json',preview_profile_request:'r1-previewProfile.request.json',preview_profile_response:'r1-previewProfile.response.json',put_profile_request:'r1-putProfile.request.json',put_profile_response:'r1-putProfile.response.json',export_profile:'r1-exportProfile.response.json',get_preferences:'r1-getPreferences.response.json',put_preferences_request:'r1-putPreferences.request.json',put_preferences_response:'r1-putPreferences.response.json',get_operations:'r1-getOperations.response.json',get_readiness:'r1-getReadiness.response.json'};
 for(const [key,file]of Object.entries(settingFiles))assert.deepEqual(settings[key],readJson('examples/http/'+file),key);
 for(const [name,feature]of [['artifact-ids','artifacts'],['artifact-reference','artifacts'],['task-reference','tasks']]){
  const requestFile='r1-unavailable-'+name+'.request.json',responseFile='r1-unavailable-'+name+'.response.json';
  const request=readJson('examples/http/'+requestFile),response=readJson('examples/http/'+responseFile);
  const mappedRequest=fixtures.find(x=>x.file===requestFile),mappedResponse=fixtures.find(x=>x.file===responseFile);
  assert.equal(mappedRequest?.operation_id,'createMessage');assert.equal(mappedRequest?.schema,'#/components/schemas/MessageCreateRequest');
  assert.equal(mappedResponse?.operation_id,'createMessage');assert.equal(mappedResponse?.http_status,400);assert.equal(mappedResponse?.schema,'#/components/schemas/Error');
  assert.equal(response.error.code,'INVALID_REQUEST');assert.equal(response.error.details?.feature,feature);assert.equal(response.error.retryable,false);
  assert.deepEqual(probe({components:api.components,$ref:mappedRequest.schema},request),[]);
  assert.deepEqual(probe({components:api.components,$ref:mappedResponse.schema},response),[]);
  if(name==='artifact-ids')assert(request.artifact_ids.length>0&&request.refs.length===0);
  if(name==='artifact-reference')assert(request.artifact_ids.length===0&&request.refs.some(x=>x.kind==='artifact'));
  if(name==='task-reference')assert(request.artifact_ids.length===0&&request.refs.some(x=>x.kind==='task'));
 }
 const recovery=readJson('spec/recovery-manifest.schema.json'),manifest=readJson('examples/recovery/r1-manifest.json');assert.deepEqual(probe(recovery,manifest),[]);
 const commands=readJson('spec/recovery-command.schema.json'),commandExamples=readJson('examples/recovery/r1-commands.json');
 assert.equal(commands.$id,'urn:cf-agent-hub:recovery-command:1');
 assert.equal(readJson('spec/recovery-command-examples.schema.json').properties.commands.items.$ref,commands.$id);
 assert.equal(readJson('spec/recovery-authority-cases.schema.json').properties.matching_target_resume.$ref,commands.$id);
 for(const [id,expected]of [['urn:cf-agent-hub:deployment-config:0.2',3],['urn:cf-agent-hub:r1-bootstrap:0.1',3],['urn:cf-agent-hub:recovery-manifest:1',2]])assert.equal((JSON.stringify(commands).match(new RegExp(id,'g'))??[]).length,expected,id+' must be referenced exactly');
 for(const command of commandExamples.commands)assert.deepEqual(probe(commands,command),[],command.operation);
 assert.deepEqual(probe(readJson('spec/recovery-command-examples.schema.json'),commandExamples),[],'Command fixture wrapper must resolve canonical command schema');
 const sourceResume=commandExamples.commands.find(x=>x.operation==='resume');
 assert.equal(sourceResume.expected_authority_epoch,manifest.checkpoint.authority_epoch);
 assert.equal(sourceResume.payload.ledger.authority_epoch,manifest.checkpoint.authority_epoch);
 assert.equal(sourceResume.payload.ledger.environment_id,manifest.environment_id);
 assert.deepEqual(sourceResume.payload.ledger.config,readJson('examples/config/deployment.example.json'));
 assert.deepEqual(sourceResume.payload.ledger.verification_bundle,readJson('examples/config/r1-bootstrap.example.json'));
 assert.equal(sourceResume.payload.source_retirement_receipt,null);
 assert.equal(sourceResume.payload.cutover_record,null);
 assert.deepEqual(recoveryAuthorityIssues(sourceResume,manifest),[],'Original unchanged source resume must be coherent');
 const authority=readJson('examples/recovery/r1-authority-cases.json');
 assert.deepEqual(probe(readJson('spec/recovery-authority-cases.schema.json'),authority),[]);
 assert.deepEqual(probe(commands,authority.matching_target_resume),[]);
 assert.deepEqual(recoveryAuthorityIssues(authority.matching_target_resume,manifest),[]);
 const unadvancedTarget=structuredClone(authority.matching_target_resume);unadvancedTarget.payload.ledger.authority_epoch=manifest.checkpoint.authority_epoch;assert(recoveryAuthorityIssues(unadvancedTarget,manifest).includes('ledger.authority_epoch'),'Target restore must advance authority epoch');
 const reordered=structuredClone(authority.matching_target_resume);const objectName=reordered.payload.cutover_record.target_catalog_mapping.object_name,workspaceId=reordered.payload.cutover_record.target_catalog_mapping.workspace_id;reordered.payload.cutover_record.target_catalog_mapping={object_name:objectName,workspace_id:workspaceId};assert.deepEqual(recoveryAuthorityIssues(reordered,manifest),[],'Mapping order must not affect authority linkage');
 for(const item of authority.rejections){const branch=commands.oneOf.find(x=>x.properties.operation.const===item.command.operation);const errors=[...probe(branch,item.command,commands),...recoveryAuthorityIssues(item.command,manifest)];assert(errors.some(e=>e.includes(item.field)),item.name+': expected '+item.field+', got '+JSON.stringify(errors));}
 const editOnly=structuredClone(config);editOnly.human_grants[0].scopes=['profile:edit'];assert.deepEqual(deploymentIssues(editOnly),[]);
 for(const name of ['getAuthSession','logoutAuth']){const op=Object.values(api.paths).flatMap(item=>Object.values(item)).find(x=>x.operationId===name);assert.deepEqual(op.security,[{HumanSession:[]}]);assert.deepEqual(op['x-required-scopes'],[]);assert.equal(op['x-auth-protocol'],true);}
 console.log('R1 contract route/grant/conflict assertions passed. Product tests were not run. Full Ajv/Vitest validation is required in Task 2.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run();
