import {parseExactJson} from '../approvals/exact-json';
import {validateObservationEstablishRequest,validateObservationBatchRequest,validateObservationReplaceRequest,validateObservationRecord} from '../http/generated/auth-validators.js';
import type {ObservationEstablishRequest,ObservationBatchRequest,ObservationReplaceRequest,ObservationRecord} from '../http/dto';
import {HttpError} from '../http/envelopes';
export const OBSERVATION_REQUEST_BYTES=32768,OBSERVATION_METADATA_BYTES=16384,OBSERVATION_STORED_BYTES=262144;
export const jsonBytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const utf8Bytes=(value:string)=>new TextEncoder().encode(value).byteLength;
export function assertReportedRecord(value:unknown):asserts value is ObservationRecord{
 if(!validateObservationRecord(value))throw new HttpError('INVALID_REQUEST',400);
 const p=value.relative_path;
 if(utf8Bytes(p)>1024||value.label!==undefined&&utf8Bytes(value.label)>512||p.includes('\\')||p.includes('\0')||/^[a-zA-Z]:/.test(p)||p.split('/').some(x=>x===''||x==='.'||x==='..'))throw new HttpError('INVALID_REQUEST',400);
 const time=Date.parse(value.observed_at);if(!Number.isFinite(time)||new Date(time).toISOString()!==value.observed_at.replace(/Z$/,value.observed_at.includes('.')?'Z':'.000Z'))throw new HttpError('INVALID_REQUEST',400);
}
export type ObservationInput=ObservationEstablishRequest|ObservationBatchRequest|ObservationReplaceRequest;
export function validateObservationInput(bytes:Uint8Array,kind:'establish'|'append'|'replace'):ObservationInput{
 let value:unknown;try{value=parseExactJson(bytes,{maxBytes:OBSERVATION_REQUEST_BYTES,maxDepth:8,maxNodes:1024});}catch{throw new HttpError(bytes.byteLength>OBSERVATION_REQUEST_BYTES?'LIMIT_EXCEEDED':'INVALID_REQUEST',bytes.byteLength>OBSERVATION_REQUEST_BYTES?413:400);}
 const valid=kind==='establish'?validateObservationEstablishRequest(value):kind==='append'?validateObservationBatchRequest(value):validateObservationReplaceRequest(value);
 if(!valid)throw new HttpError('INVALID_REQUEST',400);
 if(kind==='append')for(const record of (value as ObservationBatchRequest).records)assertReportedRecord(record);
 return value as ObservationInput;
}
