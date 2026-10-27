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
const ajv=new Ajv2020({strict:false,code:{source:true,esm:true}});addFormats(ajv);
ajv.addSchema({$id:'cfhub-http',components:{schemas}});
const exports={};
for(const name of validated){ajv.addSchema({$id:name,$ref:'cfhub-http#/components/schemas/'+name});exports['validate'+name]=name;}
const js='// Generated from spec/openapi.json; npm run generate:auth.\nimport ucs2Module from "ajv/dist/runtime/ucs2length.js";\nimport formatsModule from "ajv-formats/dist/formats.js";\nimport equalModule from "ajv/dist/runtime/equal.js";\nconst ucs2Length=typeof ucs2Module==="function"?ucs2Module:ucs2Module.default;\nconst fullFormats=formatsModule.fullFormats;\nconst equal=typeof equalModule==="function"?equalModule:equalModule.default;\n'+standalone(ajv,exports).replaceAll('require("ajv/dist/runtime/ucs2length").default','ucs2Length').replaceAll('require("ajv-formats/dist/formats").fullFormats','fullFormats').replaceAll('require("ajv/dist/runtime/equal").default','equal')+'\n';
const dts='// Generated from spec/openapi.json.\nimport type {'+validated.join(',')+'} from "../dto";\n'+validated.map(name=>'export declare function validate'+name+'(input:unknown): input is '+name+';').join('\n')+'\n';
const dto='// Generated from spec/openapi.json; npm run generate:auth.\n'+aliases.join('\n')+'\nexport interface HttpDTOMap {\n'+[...seen].map(name=>JSON.stringify(name)+':'+name+';').join('\n')+'\n}\nexport const authReturnPaths = '+JSON.stringify(schemas.AuthStartRequest.properties.return_path.enum)+' as const;\n';
function byteRules(s,path=[]){
 if(s.$ref){let target=spec;for(const part of s.$ref.split('/').slice(1))target=target[part.replaceAll('~1','/').replaceAll('~0','~')];return byteRules(target,path);}
 const rules=[];
 if(s['x-utf8-max-bytes']!==undefined)rules.push({path,encoding:'utf8',maxBytes:s['x-utf8-max-bytes']});
 if(s['x-json-max-bytes']!==undefined)rules.push({path,encoding:'json',maxBytes:s['x-json-max-bytes']});
 for(const [name,child] of Object.entries(s.properties??{}))rules.push(...byteRules(child,[...path,name]));
 if(s.items)rules.push(...byteRules(s.items,[...path,'*']));
 return rules;
}
const fields=[...new Set(Object.values(schemas).flatMap(function walk(s){return [...Object.keys(s.properties??{}),...Object.values(s.properties??{}).flatMap(walk),...(s.items?walk(s.items):[])];}))].sort();
const registry='// Generated from spec/openapi.json; npm run generate:auth.\nimport * as validators from "./auth-validators.js";\nexport const httpSchemas = {\n'+inputs.map(name=>JSON.stringify(name)+':{validate:validators.validate'+name+',byteRules:'+JSON.stringify(byteRules(schemas[name]))+'}').join(',\n')+'\n} as const;\nexport type HttpSchemaName=keyof typeof httpSchemas;\nexport const httpFieldNames = '+JSON.stringify(fields)+' as const;\n';
await mkdir('src/http/generated',{recursive:true});
for(const [path,content]of [['src/http/dto.ts',dto],['src/http/generated/auth-validators.js',js],['src/http/generated/auth-validators.d.ts',dts],['src/http/generated/http-schemas.ts',registry]]){
 if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==content)throw Error('Stale generated file: '+path);}else await writeFile(path,content);
}
