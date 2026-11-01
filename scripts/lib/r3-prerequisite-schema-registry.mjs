import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../validation/r3-prerequisite-evidence.schema.json' with {type:'json'};
const ajv=new Ajv2020({allErrors:false,strict:true});
ajv.addSchema(schema);
const compile=name=>ajv.compile({$ref:schema.$id+'#/$defs/'+name});
export const validR3PrerequisiteRoot=compile('root');
export const validR3PrerequisiteProducer=compile('producer');
export const validR3ComparisonContext=compile('context');
