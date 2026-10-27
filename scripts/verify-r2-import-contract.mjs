import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const input=read('spec/import-batch.schema.json');
const inputAjv=new Ajv2020({strict:true});addFormats(inputAjv);inputAjv.addSchema(input);
const validRow=inputAjv.compile({$ref:input.$id+'#/$defs/ImportRow'});
const validEnvelope=inputAjv.compile({$ref:input.$id+'#/$defs/ImportEnvelope'});
// Side-effect-free finite-JSON canonicalization, tested against the repository
// canonicalJson implementation. Objects reaching hash functions are schema checked
// by their owning verifier; digest computation is never authorization.
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export const importSourceSha256=value=>validRow(value)?digest(value):null;
export function importPreviewSha256(value){const {preview_sha256,...body}=value;return digest(body);}
let cachedSpec='',validators;
function valid(name,value){
 const raw=readFileSync(new URL('../spec/openapi.json',import.meta.url),'utf8');
 if(raw!==cachedSpec){
  const api=JSON.parse(raw),ajv=new Ajv2020({strict:false});addFormats(ajv);
  validators=Object.fromEntries(['ImportPreview','ImportApplyRequest','ImportReport'].map(name=>[name,ajv.compile({components:api.components,$ref:'#/components/schemas/'+name})]));cachedSpec=raw;
 }
 return validators[name](value);
}
const result=code=>({code});
const ttl=900000;
const validTime=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000-ttl;
const exactTime=(text,ms)=>Date.parse(text)===ms&&!/[1-9]/.test((text.match(/\.(\d+)(?:z|[+-]\d{2}:\d{2})$/i)?.[1]??'').slice(3));
function duplicateGroupsValid(rows){
 // Only disclosed IDs participate; rejected null identifiers remain private.
 const groups=new Map();for(const row of rows)if(row.external_id!==null){const group=groups.get(row.external_id)??[];group.push(row);groups.set(row.external_id,group);}
 return [...groups.values()].every(group=>group.length===1||group.every(row=>row.disposition==='conflict'&&row.code==='DUPLICATE_EXTERNAL_ID'));
}
function countsMatch(value,created){
 const names=[created,'unchanged','conflict','rejected'];
 return value.rows.length===value.counts.received&&names.every(name=>value.counts[name]===value.rows.filter(row=>row.disposition===name).length)&&value.rows.every((row,index)=>row.index===index);
}
/** Static contract inspection only. Supplied clocks, snapshots and authority
 * statements are hypothetical fixture evidence, never trusted runtime inputs.
 * No endpoint, lookup, reference resolution, task/map write or fetch occurs.
 * Every outcome is a generic code without payload or rejected input details.
 */
export function inspectImportPreview(preview,time){
 if(!valid('ImportPreview',preview)||!validTime(time?.issuedAtMs)||!countsMatch(preview,'create')||!duplicateGroupsValid(preview.rows)||!exactTime(preview.expires_at,time.issuedAtMs+ttl))return result('INVALID_STATE');
 if(importPreviewSha256(preview)!==preview.preview_sha256)return result('VERSION_CONFLICT');
 return result(null);
}
const authorityValid=context=>['ownerMatches','workspaceMatches','scopesSatisfied','allReferencesVisible'].every(key=>context?.authority?.[key]===true);
function snapshotValid(snapshot){
 return snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)&&Object.keys(snapshot).sort().join(',')==='mappings,references'&&['mappings','references'].every(key=>Array.isArray(snapshot[key])&&snapshot[key].every(entry=>entry&&typeof entry==='object'&&!Array.isArray(entry)&&Object.keys(entry).sort().join(',')==='id,version'&&typeof entry.id==='string'&&entry.id.length>0&&Number.isSafeInteger(entry.version)&&entry.version>=1)&&new Set(snapshot[key].map(entry=>entry.id)).size===snapshot[key].length);
}
const normalizedSnapshot=snapshot=>Object.fromEntries(['mappings','references'].map(key=>[key,[...snapshot[key]].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)]));
export function inspectImportApply(preview,request,context){
 // Denial precedes shape/version details to prevent an existence oracle.
 if(!authorityValid(context))return result('NOT_FOUND');
 if(!validTime(context?.issuedAtMs)||!validTime(context?.nowMs)||context.nowMs<context.issuedAtMs||!snapshotValid(context.stored)||!snapshotValid(context.current))return result('INVALID_STATE');
 if(request&&Object.hasOwn(request,'expected_import_version')&&request.expected_import_version!==1)return result('VERSION_CONFLICT');
 if(!valid('ImportApplyRequest',request))return result('INVALID_STATE');
 const checked=inspectImportPreview(preview,{issuedAtMs:context.issuedAtMs});if(checked.code)return checked;
 if(request.preview_sha256!==preview.preview_sha256)return result('VERSION_CONFLICT');
 if(context.nowMs>=Date.parse(preview.expires_at))return result('INVALID_STATE');
 if(canonical(normalizedSnapshot(context.stored))!==canonical(normalizedSnapshot(context.current)))return result('VERSION_CONFLICT');
 if(!request.accept_rejected_rows&&(preview.counts.conflict||preview.counts.rejected))return result('INVALID_STATE');
 return result(null);
}
export function inspectImportReport(report,context){
 const {preview,batch,issuedAtMs,appliedAtMs}=context??{};
 if(!valid('ImportReport',report)||!validEnvelope(batch)||inspectImportPreview(preview,{issuedAtMs}).code||!validTime(appliedAtMs)||appliedAtMs<issuedAtMs||appliedAtMs>=Date.parse(preview.expires_at)||!exactTime(report.applied_at,appliedAtMs)||!countsMatch(report,'created')||report.id!==preview.id||batch.source_namespace!==preview.source_namespace||batch.source_revision!==preview.source_revision||batch.rows.length!==preview.counts.received||report.rows.length!==preview.rows.length)return result('INVALID_STATE');
 const successfulTaskIds=[];
 for(const row of report.rows){
  const before=preview.rows[row.index],source=batch.rows[row.index];
  if(row.disposition!==(before.disposition==='create'?'created':before.disposition)||row.external_id!==before.external_id||row.code!==before.code)return result('INVALID_STATE');
  if(row.disposition==='created'||row.disposition==='unchanged'){
   const sourceHash=importSourceSha256(source);
   if(sourceHash===null||source.external_id!==row.external_id||typeof row.task_id!=='string'||!row.task_id||(row.disposition==='unchanged'&&row.task_id!==before.task_id))return result('INVALID_STATE');
   const expected={source_namespace:batch.source_namespace,external_id:source.external_id,source_revision:batch.source_revision,source_updated_at:source.source_updated_at,source_state:source.source_state,source_ref:source.source_ref,source_sha256:sourceHash,import_id:report.id,task_id:row.task_id};
   if(canonical(row.provenance)!==canonical(expected))return result('INVALID_STATE');successfulTaskIds.push(row.task_id);
  }else if(row.task_id!==null||row.provenance!==null)return result('INVALID_STATE');
 }
 if(new Set(successfulTaskIds).size!==successfulTaskIds.length)return result('INVALID_STATE');
 return result(null);
}
