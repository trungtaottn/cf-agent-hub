import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const readJson=relative=>JSON.parse(readFileSync(new URL('../'+relative,import.meta.url),'utf8'));
const api=readJson('spec/openapi.json');
// OpenAPI components include annotation/extension keywords. Ajv still enforces
// all JSON Schema assertions; no defaults, coercion or unknown-field removal.
const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);
const validate=ajv.compile({components:api.components,$ref:'#/components/schemas/CatalogPlan'});
const ttlMs=900000;
const validTime=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000-ttlMs;

/**
 * Static contract checks against explicit hypothetical clock evidence only.
 * Callers cannot establish trusted production time by supplying these inputs.
 * This is not endpoint authorization, resource/version lookup, persistence,
 * or proof that runtime expiry is enforced. No implicit Date.now() fallback.
 */
export function catalogPlanIssues(plan,timeContext){
 if(!validate(plan))return ['invalid_shape'];
 const issues=[];
 if(plan.affected_task_ids.length+plan.affected_agent_ids.length>200)issues.push('affected_entities_limit');
 if(!timeContext||typeof timeContext!=='object'||Array.isArray(timeContext)
  ||Object.keys(timeContext).length!==2||!Object.hasOwn(timeContext,'issuedAtMs')||!Object.hasOwn(timeContext,'nowMs')
  ||!validTime(timeContext.issuedAtMs)||!validTime(timeContext.nowMs))return [...issues,'invalid_time_context'];
 const {issuedAtMs,nowMs}=timeContext;
 if(nowMs<issuedAtMs)issues.push('time_order');
 const expiryMs=Date.parse(plan.expires_at);
 // Date.parse truncates fractional precision; do not accept a later sub-ms
 // expiry merely because its millisecond projection equals the expected time.
 const fractional=plan.expires_at.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1]??'';
 if(!Number.isFinite(expiryMs)||expiryMs!==issuedAtMs+ttlMs||/[1-9]/.test(fractional.slice(3)))issues.push('expiry_duration');
 if(Number.isFinite(expiryMs)&&nowMs>=expiryMs)issues.push('expired');
 return issues;
}

export function run(){
 const collection=readJson('examples/http/r2-catalog-contracts.json');
 const plans=collection.fixtures.filter(entry=>entry.schema==='#/components/schemas/CatalogPlanResponse');
 assert(plans.length>0,'catalog plan fixtures must be collected');
 // Deliberately fixed synthetic context, independent of expires_at; never
 // derive issuance by subtracting the desired TTL from the value under test.
 const hypothetical={issuedAtMs:Date.parse('2026-10-26T15:00:00Z'),nowMs:Date.parse('2026-10-26T15:00:00Z')};
 for(const entry of plans)assert.deepEqual(catalogPlanIssues(entry.value.data,hypothetical),[],'invalid catalog fixture '+entry.name);
 return {scope:'static-catalog-contract',plans:plans.length,clock:'explicit-hypothetical-fixture-times'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(run()));}catch(error){console.error(error.message);process.exitCode=1;}
}
