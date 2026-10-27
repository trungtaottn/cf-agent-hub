import { readFile, writeFile, mkdir } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import { _ } from 'ajv/dist/compile/codegen/index.js';
const paths = ['spec/deployment-config.schema.json', 'spec/r1-bootstrap.schema.json', 'spec/execution-policy.schema.json'];
const schemas = await Promise.all(paths.map(async p => JSON.parse(await readFile(p, 'utf8'))));
const ajv = new Ajv2020({strict:false, allErrors:true, code:{source:true, esm:true, formats: _`formats`}});
addFormats(ajv);
for (const schema of schemas) ajv.addSchema(schema);
function type(s,document=s) {
 if(s.$ref){const [id,fragment=""]=s.$ref.split("#");if(id===schemas[2].$id&&!fragment)return "ExecutionPolicy";const root=id?schemas.find(x=>x.$id===id):document;if(!root)throw Error("Unknown schema reference");const target=fragment?fragment.slice(1).split("/").reduce((a,k)=>a[k],root):root;return type(target,root);}
 if(s.anyOf||s.oneOf)return "("+(s.anyOf??s.oneOf).map(x=>type(x,document)).join(" | ")+")";
 if (s.const !== undefined) return JSON.stringify(s.const);
 if (s.enum) return s.enum.map(JSON.stringify).join(' | ');
 if (Array.isArray(s.type)) return s.type.map(t => type({...s,type:t},document)).join(' | ');
 if (s.type === 'array') return 'Array<'+type(s.items,document)+'>';
 if (s.type === 'object') return '{\n'+Object.entries(s.properties??{}).map(([k,v])=>JSON.stringify(k)+(s.required?.includes(k)?'':'?')+': '+type(v,document)+';').join('\n')+'\n}';
 return ({integer:'number',number:'number',string:'string',boolean:'boolean',null:'null'})[s.type]??'unknown';
}
const generated = standalone(ajv,{validateDeployment:schemas[0].$id,validateBundle:schemas[1].$id,validateExecutionPolicyShape:schemas[2].$id}).replaceAll('require("ajv/dist/runtime/ucs2length").default','ucs2Length').replaceAll('require("ajv/dist/runtime/equal").default','equalValues');
const js = '// Generated from canonical schemas. Run npm run generate:config.\nimport formatModule from "ajv-formats/dist/formats.js";\nimport ucs2Module from "ajv/dist/runtime/ucs2length.js";\nimport equalModule from "ajv/dist/runtime/equal.js";\nconst formats = formatModule.fullFormats;\nconst ucs2Length = typeof ucs2Module === "function" ? ucs2Module : ucs2Module.default;\nconst equalValues = typeof equalModule === "function" ? equalModule : equalModule.default;\n'+generated+'\n';
const dts = '// Generated from canonical schemas.\nexport type DeploymentConfig = '+type(schemas[0])+';\nexport type VerificationBundle = '+type(schemas[1])+';\nexport type ExecutionPolicy = '+type(schemas[2])+';\nexport declare function validateDeployment(input: unknown): input is DeploymentConfig;\nexport declare function validateBundle(input: unknown): input is VerificationBundle;\nexport declare function validateExecutionPolicyShape(input: unknown): input is ExecutionPolicy;\n';
await mkdir('src/config/generated',{recursive:true});
for (const [path, content] of [['src/config/generated/validators.js',js],['src/config/generated/validators.d.ts',dts]]) {
 if(process.argv.includes('--check')) { if(await readFile(path,'utf8')!==content) throw Error('Stale generated file: '+path); }
 else await writeFile(path,content);
}
