import {validR2PreparationsV2} from './r2-preparation-schema.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
import draft7Meta from 'ajv/dist/refs/json-schema-draft-07.json' with {type:'json'};
import core from '../../validation/r2-runtime-evidence.schema.json' with {type:'json'};
import cases from '../../validation/r2-case-evidence.schema.json' with {type:'json'};
import recovery from '../../validation/r2-recovery-evidence.schema.json' with {type:'json'};
import platform from '../../validation/r2-platform-evidence.schema.json' with {type:'json'};
// These closed receipt schemas use the common draft-07/2020 keyword subset.
// Register the declared draft metadata; do not mutate supplied schema objects.
const COMMON_KEYS=new Set(['$schema','$id','$ref','$defs','title','description','type','properties','required','additionalProperties','items','anyOf','oneOf','allOf','not','const','enum','pattern','minimum','maximum','minLength','maxLength','minItems','maxItems','uniqueItems']);
export function assertSharedSchemaDialect(schema){
 if(typeof schema==='boolean')return;
 if(!schema||typeof schema!=='object'||Array.isArray(schema))throw Error('R2_SCHEMA_DIALECT');
 for(const [key,value]of Object.entries(schema)){
  if(!COMMON_KEYS.has(key))throw Error('R2_SCHEMA_DIALECT');
  if(key==='properties'||key==='$defs')for(const child of Object.values(value))assertSharedSchemaDialect(child);
  else if(['items','additionalProperties','not'].includes(key))assertSharedSchemaDialect(value);
  else if(['anyOf','oneOf','allOf'].includes(key))for(const child of value)assertSharedSchemaDialect(child);
 }
}
for(const schema of [core,cases,recovery,platform])assertSharedSchemaDialect(schema);
const ajv=new Ajv2020({allErrors:false,strict:false,inlineRefs:false});
ajv.addMetaSchema(draft7Meta);
for(const schema of [core,cases,recovery,platform])ajv.addSchema(schema);
const compile=(schema,name)=>ajv.compile({$ref:schema.$id+'#/$defs/'+name});
export const validR2Root=compile(core,'root');
export const validR2Command=compile(core,'command');
export const receiptPolicies=Object.freeze({
 'r2-review':{validate:compile(core,'review'),bound:65536,kinds:['contract','node-tests']},
 'r2-audit':{validate:compile(core,'audit'),bound:4194304,kinds:['dependency-audit']},
 'r2-deployment':{validate:compile(core,'deployment'),bound:65536,kinds:['deployed-ingress']},
 ...Object.fromEntries(['case-preparations','isolation','gates','native','browser'].map(name=>['r2-'+name,{validate:compile(cases,'r2-'+name),bound:4194304,kinds:['contract']}])),
 ...Object.fromEntries([['recovery','recovery',2097152,['deployed-recovery']],['result-graph','result_graph',16384,['native-live','workers-tests','node-tests']],['restore-input-context','restore_input',8192,['operator-tests']],['expected-transform','expected_transform',65536,['operator-tests']]].map(([type,name,bound,kinds])=>['r2-'+type,{validate:compile(recovery,name),bound,kinds}])),
 ...Object.fromEntries([['platform','platform',16384,['contract']],['platform-resolution','resolution',8192,['deployed-recovery']],['platform-plan','plan',32768,['contract']],['platform-workload','workload',8192,['deployed-recovery','operator-tests']]].map(([type,name,bound,kinds])=>['r2-'+type,{validate:compile(platform,name),bound,kinds}]))
});

// Explicit evidence-format selection; legacy exports and lookup remain unchanged.
export const validR2RootV3=compile(core,'root_v3');
export {validR2PreparationsV2} from './r2-preparation-schema.mjs';
export const validVersionedR2Root=value=>value?.format_version===3?validR2RootV3(value):validR2Root(value);
const {['r2-case-preparations']:legacyPreparation,...sharedReceiptPolicies}=receiptPolicies;
export const receiptPoliciesV3=Object.freeze({...sharedReceiptPolicies,'r2-case-preparations-v2':{validate:validR2PreparationsV2,bound:4194304,kinds:['contract']}});
