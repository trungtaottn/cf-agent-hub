import {canonicalBytes,CONTROL_LIMIT} from './encoding.ts';
import type {RecoveryCommand} from './generated/recovery-validators.js';

/** Exact canonical framing + independently bounded nested signed records. */
export const RESTORE_ENVELOPE_LIMIT=137765;
export const VERIFY_ENVELOPE_LIMIT=72218;
export const RESUME_ENVELOPE_LIMIT=203479;
export const OPERATOR_RAW_LIMIT=RESUME_ENVELOPE_LIMIT;
export interface EnvelopeOptions {
 /** Only trusted RPC transport metadata, never a command property or caller header. */
 rawBytes?:number;
 /** Selected from authenticated installed schema and validated persisted job at the DO. */
 current16Job?:boolean;
 /** HTTP cannot know resume's persisted version. DO must repeat with authoritative dispatch. */
 provisional?:boolean;
}
export function isCurrent16Manifest(value:unknown):boolean {
 if(!value||typeof value!=='object')return false;
 const v=value as {format_version?:unknown;checkpoint?:{contract_revision?:unknown;schema_version?:unknown}};
 return v.format_version===2&&v.checkpoint?.contract_revision==='0.2'&&v.checkpoint.schema_version===16;
}
/** Finite raw transport selection before detailed schema validation; never authorizes a command. */
export function assertProvisionalRawEnvelope(value:unknown,rawBytes:number):void {
 let limit=CONTROL_LIMIT;
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  const body=value as {operation?:unknown;payload?:{manifest?:unknown}};
  if(body.operation==='resume')limit=RESUME_ENVELOPE_LIMIT;
  else if(isCurrent16Manifest(body.payload?.manifest)){
   if(body.operation==='restore')limit=RESTORE_ENVELOPE_LIMIT;
   else if(body.operation==='verify')limit=VERIFY_ENVELOPE_LIMIT;
  }
 }
 if(!Number.isSafeInteger(rawBytes)||rawBytes<1||rawBytes>limit)throw Error('RECOVERY_BYTES_LIMIT');
}
/** Shape validation is performed by the generated closed-command validator before this helper. */
export function assertRecoveryEnvelope(body:RecoveryCommand,options:EnvelopeOptions={}):void {
 const canonical=canonicalBytes(body).length,raw=options.rawBytes;
 if(raw!==undefined&&(!Number.isSafeInteger(raw)||raw<1||raw>OPERATOR_RAW_LIMIT))throw Error('RECOVERY_BYTES_LIMIT');
 let limit=CONTROL_LIMIT;const components:unknown[]=[];
 if(body.operation==='restore'&&isCurrent16Manifest(body.payload.manifest)){
  limit=RESTORE_ENVELOPE_LIMIT;components.push(body.payload.manifest,body.payload.ledger);
 }else if(body.operation==='verify'&&isCurrent16Manifest(body.payload.manifest)&&(options.current16Job===true||options.provisional===true)){
  limit=VERIFY_ENVELOPE_LIMIT;components.push(body.payload.manifest);
 }else if(body.operation==='resume'&&(options.current16Job===true||options.provisional===true)){
  limit=RESUME_ENVELOPE_LIMIT;components.push(body.payload.ledger,body.payload.source_retirement_receipt,body.payload.cutover_record);
 }
 if(canonical>limit||raw!==undefined&&raw>limit||components.some(value=>canonicalBytes(value).length>CONTROL_LIMIT))throw Error('RECOVERY_BYTES_LIMIT');
}
