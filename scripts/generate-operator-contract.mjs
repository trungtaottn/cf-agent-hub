import {readFile,writeFile,mkdir} from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import {_} from 'ajv/dist/compile/codegen/index.js';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const deployment=await read('spec/deployment-config.schema.json'),bundle=await read('spec/r1-bootstrap.schema.json'),commands=await read('spec/recovery-command.schema.json');
const schema={$id:'urn:cf-agent-hub:operator-install',...commands.oneOf.find(x=>x.properties.operation.const==='install')};
const ajv=new Ajv2020({strict:false,allErrors:true,code:{source:true,esm:true,formats:_`formats`}});
addFormats(ajv);for(const item of [deployment,bundle,schema])ajv.addSchema(item);
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
