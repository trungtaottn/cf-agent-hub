import {readFile,writeFile,mkdir} from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import {_} from 'ajv/dist/compile/codegen/index.js';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const executionPolicy=await read('spec/execution-policy.schema.json');
const decisionPolicy=await read('spec/decision-policy.schema.json');
const deployment=await read('spec/deployment-config.schema.json'),bundle=await read('spec/r1-bootstrap.schema.json'),commands=await read('spec/recovery-command.schema.json');
const schema={$id:'urn:cf-agent-hub:operator-install',...commands.oneOf.find(x=>x.properties.operation.const==='install')};
const ajv=new Ajv2020({strict:false,allErrors:true,code:{source:true,esm:true,formats:_`formats`}});
addFormats(ajv);for(const item of [executionPolicy,decisionPolicy,deployment,bundle,schema])ajv.addSchema(item);
const generated=standalone(ajv,{validateInstall:schema.$id}).replaceAll('require("ajv/dist/runtime/ucs2length").default','ucs2Length').replaceAll('require("ajv/dist/runtime/equal").default','equalValues');
const js='// Generated from the canonical recovery install discriminant.\nimport formatModule from "ajv-formats/dist/formats.js";\nimport ucs2Module from "ajv/dist/runtime/ucs2length.js";\nimport equalModule from "ajv/dist/runtime/equal.js";\nconst formats=formatModule.fullFormats;\nconst ucs2Length=typeof ucs2Module==="function"?ucs2Module:ucs2Module.default;\nconst equalValues=typeof equalModule==="function"?equalModule:equalModule.default;\n'+generated+'\n';
function type(s){
 if(s.$ref)return s.$ref===deployment.$id?'DeploymentConfig':s.$ref===bundle.$id?'VerificationBundle':'never';
 if(s.const!==undefined)return JSON.stringify(s.const);
 if(s.type==='object')return '{'+Object.entries(s.properties).map(([k,v])=>JSON.stringify(k)+(s.required?.includes(k)?'':'?')+':'+type(v)+';').join('')+'}';
 return ({string:'string',integer:'number',null:'null'})[s.type]??'never';
}
const dts='// Generated from the canonical recovery install discriminant.\nimport type {DeploymentConfig,VerificationBundle} from "../../config/generated/validators.js";\nexport type OperatorInstallRequest='+type(schema)+';\nexport declare function validateInstall(input:unknown):input is OperatorInstallRequest;\n';
await mkdir('src/recovery/generated',{recursive:true});
for(const [path,content] of [['src/recovery/generated/install-validator.js',js],['src/recovery/generated/install-validator.d.ts',dts]]){
 if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==content)throw Error('Stale operator contract');}else await writeFile(path,content);
}

// The finite recovery protocol uses the same checked-in schemas in Workers and the CLI.
const manifest=await read('spec/recovery-manifest.schema.json'),responses=await read('spec/recovery-response.schema.json');
const byOperation=name=>commands.oneOf.find(x=>x.properties.operation.const===name);
const roots={
 RecoveryCommand:commands,RecoveryManifest:manifest,
 CurrentLedger:{$id:'urn:cf-agent-hub:current-ledger:1',...byOperation('restore').properties.payload.properties.ledger},
 RetirementReceipt:{$id:'urn:cf-agent-hub:retirement-receipt:1',...byOperation('resume').properties.payload.properties.source_retirement_receipt.anyOf[0]},
 CutoverRecord:{$id:'urn:cf-agent-hub:cutover-record:1',...byOperation('resume').properties.payload.properties.cutover_record.anyOf[0]}
};
const full=new Ajv2020({strict:false,allErrors:true,code:{source:true,esm:true,formats:_`formats`}});addFormats(full);
for(const item of [executionPolicy,decisionPolicy,deployment,bundle,commands,manifest,responses,...Object.values(roots).slice(2)])full.addSchema(item);
const names={...Object.fromEntries(Object.entries(roots).map(([name,s])=>['validate'+name,s.$id])),...Object.fromEntries(Object.keys(responses.$defs).map(name=>['validate'+name,responses.$id+'#/$defs/'+name]))};
let runtime=standalone(full,names).replaceAll('require("ajv/dist/runtime/ucs2length").default','ucs2Length').replaceAll('require("ajv/dist/runtime/equal").default','equalValues');
const effectLimit=responses.$defs.RecoveryReceipt.properties.unresolved_effect_ids.maxItems;
if(effectLimit!==64)throw Error('Review unresolved-effect summary bound before changing it');
for(const name of ['RecoveryReceipt','RecoveryJobProgress','RecoveryArtifactTransferState']){
 const exportName='export const validate'+name+' =';
 if(!runtime.includes(exportName))throw Error('Recovery validator export changed');
 runtime=runtime.replace(exportName,'const validate'+name+'Shape =');
}
// Standard schema checks cover the closed structure. These generated guards also
// enforce cross-field count/ordering semantics in every Worker and CLI consumer.
const responseSemantics=`
export const UNRESOLVED_EFFECT_IDS_LIMIT=${effectLimit};
export function validateRecoveryArtifactTransferState(value){
 return validateRecoveryArtifactTransferStateShape(value)&&
  (value.pending===null||(value.phase!=='complete'&&value.pending.index===value.artifact_index));
}
export function validateRecoveryReceipt(value){
 if(!validateRecoveryReceiptShape(value))return false;
 const ids=value.unresolved_effect_ids,count=value.unresolved_effect_count;
 return ids.length===Math.min(UNRESOLVED_EFFECT_IDS_LIMIT,count)&&value.unresolved_effect_ids_complete===(count===ids.length)&&ids.every((id,index)=>index===0||ids[index-1]<id);
}
export function validateRecoveryJobProgress(value){
 return validateRecoveryJobProgressShape(value)&&(value.receipt===null||validateRecoveryReceipt(value.receipt));
}
`;
const prefix='// Generated from finite recovery command, manifest and response schemas.\nimport formatModule from "ajv-formats/dist/formats.js";\nimport ucs2Module from "ajv/dist/runtime/ucs2length.js";\nimport equalModule from "ajv/dist/runtime/equal.js";\nconst formats=formatModule.fullFormats;\nconst ucs2Length=typeof ucs2Module==="function"?ucs2Module:ucs2Module.default;\nconst equalValues=typeof equalModule==="function"?equalModule:equalModule.default;\n';
function fullType(s){
 if(s.$ref){if(s.$ref===deployment.$id)return 'DeploymentConfig';if(s.$ref===bundle.$id)return 'VerificationBundle';if(s.$ref===manifest.$id)return 'RecoveryManifest';if(s.$ref.startsWith('#/$defs/'))return s.$ref.slice('#/$defs/'.length);throw Error('Unsupported recovery type reference');}
 if(s.const!==undefined)return JSON.stringify(s.const);
 if(s.enum)return s.enum.map(JSON.stringify).join('|');
 if(s.oneOf||s.anyOf)return '('+(s.oneOf??s.anyOf).map(fullType).join('|')+')';
 if(Array.isArray(s.type))return s.type.map(t=>fullType({...s,type:t})).join('|');
 if(s.type==='object')return '{'+Object.entries(s.properties??{}).map(([k,v])=>JSON.stringify(k)+(s.required?.includes(k)?'':'?')+':'+fullType(v)+';').join('')+'}';
 if(s.type==='array')return s.maxItems===0?'[]':'Array<'+fullType(s.items)+'>';
 const primitive=({string:'string',integer:'number',number:'number',boolean:'boolean',null:'null'})[s.type];if(!primitive)throw Error('Unsupported recovery schema node');return primitive;
}
const declarations='// Generated from finite recovery schemas.\nexport declare const UNRESOLVED_EFFECT_IDS_LIMIT:64;\nimport type {DeploymentConfig,VerificationBundle} from "../../config/generated/validators.js";\n'+Object.entries({...roots,...responses.$defs}).map(([name,s])=>'export type '+name+'='+fullType(s)+';\nexport declare function validate'+name+'(input:unknown):input is '+name+';\n').join('');
for(const [path,content] of [['src/recovery/generated/recovery-validators.js',prefix+runtime+'\n'+responseSemantics],['src/recovery/generated/recovery-validators.d.ts',declarations]]){
 if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==content)throw Error('Stale recovery contract');}else await writeFile(path,content);
}
