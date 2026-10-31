// Canonical HTTP contracts. Generated availability never registers a public route.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
const spec=JSON.parse(await readFile('spec/openapi.json','utf8')),schemas=spec.components.schemas;
const settings=['Configuration','ProfileData','ProfilePreview','ProfileExport','PreferencesData','WorkspaceProfile','UserPreferences','ConfigurationResponse','ProfileDataResponse','ProfilePreviewResponse','ProfileExportResponse','PreferencesDataResponse'];
const r2=["Task", "Run", "Artifact", "Agent", "Credential", "CredentialIssue", "Runtime", "RuntimeIssue", "SearchHit", "TaskCommandResult", "TaskResult", "TaskResultListResponse", "CatalogPlan", "CatalogPlanResponse", "CatalogPreviewRequest", "CatalogApplyRequest", "ImportRow", "ImportBatch", "ImportEnvelope", "ImportProvenance", "ImportPreviewRow", "ImportReportRow", "ImportPreview", "ImportApplyRequest", "ImportReport", "Import", "ImportPreviewResponse", "ImportReportResponse", "ImportResponse", "TaskCreateRequest", "TaskPatchRequest", "TaskVersionRequest", "TaskReasonRequest", "TaskClaimRequest", "TaskSubmitResultRequest", "TaskFailRequest", "RunHeartbeatRequest", "AgentCreateRequest", "AgentPatchRequest", "AgentArchiveRequest", "RuntimeCreateRequest", "RuntimeHeartbeatRequest", "ArtifactStageRequest", "ArtifactCommitRequest", "CredentialCreateRequest", "CredentialRevokeRequest", "TaskResponse", "RunResponse", "TaskCommandResultResponse", "AgentResponse", "RuntimeResponse", "ArtifactResponse", "CredentialResponse", "CredentialIssueResponse", "RuntimeIssueResponse", "TaskListResponse", "AgentListResponse", "ArtifactListResponse", "CredentialListResponse", "SearchHitListResponse"];
const r2Inputs=["CatalogPreviewRequest", "CatalogApplyRequest", "ImportApplyRequest", "TaskCreateRequest", "TaskPatchRequest", "TaskVersionRequest", "TaskReasonRequest", "TaskClaimRequest", "TaskSubmitResultRequest", "TaskFailRequest", "RunHeartbeatRequest", "AgentCreateRequest", "AgentPatchRequest", "AgentArchiveRequest", "RuntimeCreateRequest", "RuntimeHeartbeatRequest", "ArtifactStageRequest", "ArtifactCommitRequest", "CredentialCreateRequest", "CredentialRevokeRequest", "ImportEnvelope"];
const inputs=['AuthStartRequest','AuthCallbackQuery','AuthLogoutRequest','MessageCreateRequest','MessageAckRequest','ProfileWriteRequest','PreferencesWriteRequest',...r2Inputs];
const roots=['Workspace','WorkspaceResponse','Readiness','ReadinessResponse','Liveness','Operations','OperationsResponse','AckResult',...inputs,'AuthStartDataResponse','AuthSessionResponse','AuthLogoutDataResponse','Error','Event','Message','MessageNotification',...settings,...r2];
const validated=['Workspace','WorkspaceResponse','Readiness','ReadinessResponse','Liveness','Operations','OperationsResponse',...inputs,'Error','Event','Message','MessageNotification',...settings,'AuthStartData','AuthSession','AuthLogoutData',...r2.filter(name=>!inputs.includes(name))];
// This inventory selects supported source operations; OpenAPI remains the wire/policy owner.
const inventory=JSON.parse(await readFile('src/contracts/client-operations.json','utf8'));
const resolve=s=>{if(!s?.$ref)return s;let node=spec;for(const p of s.$ref.split('/').slice(1))node=node[p.replaceAll('~1','/').replaceAll('~0','~')];return node;};
const operations=Object.entries(spec.paths).flatMap(([path,item])=>Object.entries(item).filter(([,op])=>op.operationId).map(([method,op])=>({...op,path,method:method.toUpperCase(),parameters:[...(item.parameters??[]),...(op.parameters??[])].map(resolve)})));
const classified=[...inventory.supported,...Object.keys(inventory.excluded)];
if(new Set(classified).size!==classified.length||JSON.stringify([...classified].sort())!==JSON.stringify(operations.map(x=>x.operationId).sort()))throw Error('Incomplete or duplicate client operation inventory');
const clientContracts=inventory.supported.map(id=>{
 const op=operations.find(x=>x.operationId===id),properties={},required=[];
 for(const location of ['path','query']){
  const parameters=op.parameters.filter(p=>p.in===location&&p.name!=='workspace_id');if(!parameters.length)continue;
  const needs=parameters.filter(p=>p.required).map(p=>p.name);
  properties[location]={type:'object',additionalProperties:false,properties:Object.fromEntries(parameters.map(p=>[p.name,p.schema])),required:needs};
  if(needs.length)required.push(location);
 }
 const body=op.requestBody?.content,upload=Boolean(body?.['application/octet-stream']);
 if(body?.['application/json']){properties.body=op['x-envelope-schema']??body['application/json'].schema;required.push('body');}
 const request={type:'object',additionalProperties:false,properties,required};
 const success=Object.entries(op.responses).filter(([code])=>/^2[0-9][0-9]$/.test(code));
 if(success.length!==1)throw Error('Expected one canonical success for '+id);
 const [status,response]=success[0],content=resolve(response).content,download=Boolean(content?.['application/octet-stream']);
 const responseSchema=download?null:content?.['application/json']?.schema;
 if(!download&&!responseSchema)throw Error('Missing success schema '+id);
 const responseName=responseSchema?.$ref?.split('/').at(-1);
 if(responseName&&!validated.includes(responseName))validated.push(responseName);
 if(responseName&&!roots.includes(responseName))roots.push(responseName);
 const scheme=op.security?.find(s=>Object.hasOwn(s,'NativeBearer'));
 return {id,request,responseName,data:download?null:resolve(responseSchema).properties.data,metadata:{method:op.method,path:op.path,native:Boolean(scheme),runtimeProof:Boolean(scheme&&Object.hasOwn(scheme,'RuntimeProof')),idempotency:op.parameters.some(p=>p.in==='header'&&p.name.toLowerCase()==='idempotency-key'),status:Number(status),upload,download,page:!download&&Boolean(resolve(responseSchema).properties.page),invocationMode:id==='createRuntime'?'enrollment':'ordinary'}};
});
const seen=new Set(),aliases=[];
function type(s) {
 if(s.$ref){const parts=s.$ref.split('/').slice(3),name=parts.shift();if(parts.length){let target=schemas[name];for(const part of parts)target=target[part.replaceAll('~1','/').replaceAll('~0','~')];return type(target);}collect(name);return name;}
 if(s.const!==undefined)return JSON.stringify(s.const);
 if(s.enum)return s.enum.map(x=>JSON.stringify(x)).join(' | ');
 if(s.anyOf||s.oneOf)return (s.anyOf??s.oneOf).map(type).join(' | ');
 if(s.type==='array')return 'Array<'+type(s.items)+'>';
 if(s.type==='object'){
  if(!Object.keys(s.properties??{}).length&&s.additionalProperties===false)return 'Record<string, never>';
  return '{'+Object.entries(s.properties??{}).map(([key,v])=>JSON.stringify(key)+(s.required?.includes(key)?'':'?')+':'+type(v)).join(';')+'}';
 }
 return ({string:'string',integer:'number',number:'number',null:'null',boolean:'boolean'})[s.type]??'unknown';
}
function collect(name){if(seen.has(name))return;seen.add(name);aliases.push('export type '+name+' = '+type(schemas[name])+';');}
for(const name of roots)collect(name);
const requestTypes=clientContracts.map(c=>JSON.stringify(c.id)+':'+type(c.request)+';').join('\n');
const dataTypes=clientContracts.map(c=>JSON.stringify(c.id)+':'+(c.data?type(c.data):'ReadableStream<Uint8Array>')+';').join('\n');
const ajv=new Ajv2020({strict:false,code:{source:true,esm:true}});addFormats(ajv);
ajv.addSchema({$id:'cfhub-http',components:{schemas}});
const exports={};
for(const name of validated){ajv.addSchema({$id:name,$ref:'cfhub-http#/components/schemas/'+name});exports['validate'+name]=name;}
for(const c of clientContracts){const name='ClientRequest_'+c.id;const request=JSON.parse(JSON.stringify(c.request).replaceAll('\"#/components/', '\"cfhub-http#/components/'));ajv.addSchema({$id:name,...request});exports['validate'+name]=name;}
const js='// Generated from spec/openapi.json; npm run generate:auth.\nimport ucs2Module from "ajv/dist/runtime/ucs2length.js";\nimport formatsModule from "ajv-formats/dist/formats.js";\nimport equalModule from "ajv/dist/runtime/equal.js";\nconst ucs2Length=typeof ucs2Module==="function"?ucs2Module:ucs2Module.default;\nconst fullFormats=formatsModule.fullFormats;\nconst equal=typeof equalModule==="function"?equalModule:equalModule.default;\n'+standalone(ajv,exports).replaceAll('require("ajv/dist/runtime/ucs2length").default','ucs2Length').replaceAll('require("ajv-formats/dist/formats").fullFormats','fullFormats').replaceAll('require("ajv/dist/runtime/equal").default','equal')+'\n';
const dts='// Generated from spec/openapi.json.\nimport type {'+['HttpOperationRequests',...validated].join(',')+'} from "../dto";\n'+validated.map(name=>'export declare function validate'+name+'(input:unknown): input is '+name+';').join('\n')+'\n'+clientContracts.map(c=>'export declare function validateClientRequest_'+c.id+'(input:unknown): input is HttpOperationRequests['+JSON.stringify(c.id)+'];').join('\n')+'\n';
const dto='// Generated from spec/openapi.json; npm run generate:auth.\n'+aliases.join('\n')+'\nexport interface HttpOperationRequests {\n'+requestTypes+'\n}\nexport interface HttpOperationData {\n'+dataTypes+'\n}\nexport interface HttpDTOMap {\n'+[...seen].map(name=>JSON.stringify(name)+':'+name+';').join('\n')+'\n}\nexport const authReturnPaths = '+JSON.stringify(schemas.AuthStartRequest.properties.return_path.enum)+' as const;\n';
function byteRules(s,path=[]){
 if(s.$ref){let target=spec;for(const part of s.$ref.split('/').slice(1))target=target[part.replaceAll('~1','/').replaceAll('~0','~')];return byteRules(target,path);}
 const rules=[];
 if(s['x-normalized-utf8-max-bytes']!==undefined)rules.push({path,encoding:'nfc-utf8',maxBytes:s['x-normalized-utf8-max-bytes']});
 if(s['x-utf8-max-bytes']!==undefined)rules.push({path,encoding:'utf8',maxBytes:s['x-utf8-max-bytes']});
 if(s['x-json-max-bytes']!==undefined)rules.push({path,encoding:'json',maxBytes:s['x-json-max-bytes']});
 for(const [name,child] of Object.entries(s.properties??{}))rules.push(...byteRules(child,[...path,name]));
 if(s.items)rules.push(...byteRules(s.items,[...path,'*']));
 return rules;
}
const fields=[...new Set(Object.values(schemas).flatMap(function walk(s){return [...Object.keys(s.properties??{}),...Object.values(s.properties??{}).flatMap(walk),...(s.items?walk(s.items):[])];}))].sort();
const registry='// Generated from spec/openapi.json; npm run generate:auth.\nimport * as validators from "./auth-validators.js";\nexport const httpSchemas = {\n'+inputs.map(name=>JSON.stringify(name)+':{validate:validators.validate'+name+',byteRules:'+JSON.stringify(byteRules(schemas[name]))+'}').join(',\n')+'\n} as const;\nexport type HttpSchemaName=keyof typeof httpSchemas;\nexport const httpFieldNames = '+JSON.stringify(fields)+' as const;\n';
const clientRegistry='// Generated from the reviewed inventory + spec/openapi.json; npm run generate:auth.\nimport * as validators from \"./auth-validators.js\";\nexport const clientOperations = {\n'+clientContracts.map(c=>JSON.stringify(c.id)+':{...'+JSON.stringify(c.metadata)+',validateRequest:validators.validateClientRequest_'+c.id+',validateResponse:'+(c.responseName?'validators.validate'+c.responseName:'null')+',byteRules:'+JSON.stringify(byteRules(c.request))+'}').join(',\n')+'\n} as const;\nexport type EnabledOperationId=keyof typeof clientOperations;\nexport const artifactClientMaxBytes='+JSON.stringify(schemas.ArtifactStageRequest.properties.byte_size.maximum)+';\n';
await mkdir('src/http/generated',{recursive:true});
for(const [path,content]of [['src/http/dto.ts',dto],['src/http/generated/auth-validators.js',js],['src/http/generated/auth-validators.d.ts',dts],['src/http/generated/http-schemas.ts',registry],['src/http/generated/client-operations.ts',clientRegistry]]){
 if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==content)throw Error('Stale generated file: '+path);}else await writeFile(path,content);
}
