export interface R2Finding {code:string;path:string;message:string;}
export function canonicalR2(value:unknown):string;
export function hashR2(value:string|Uint8Array):string;
export function verifyR2Release(input:unknown,options:{files?:ReadonlyMap<string,string|Uint8Array>;root?:string}):{passed:boolean;scope:'structural-only';acceptance:'pending-external-inspection';findings:R2Finding[]};
