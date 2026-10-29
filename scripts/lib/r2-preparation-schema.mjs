/** Narrow, lazy schema gate: legacy policy imports do not compile the R2 registry. */
import Ajv from 'ajv';
import schema from '../../validation/r2-case-evidence.schema.json' with {type:'json'};
let validate;
export function validR2PreparationsV2(value){
 if(!validate){const ajv=new Ajv({strict:true,allErrors:false,inlineRefs:false});ajv.addSchema(schema);validate=ajv.getSchema(schema.$id+'#/$defs/r2-case-preparations-v2');}
 return validate(value);
}
