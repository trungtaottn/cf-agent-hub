export interface Finding {code:string;message:string;}
export interface CasePolicy {id:string;family:string;producer:string;source:string;fields:Record<string,string|string[]>;rules:unknown[][];operation?:string;lane?:string;phase?:string;runtime_proof?:boolean;}
export const CASE_OPERATIONS:Readonly<Record<string,{method:string;path:string;native:boolean;runtimeProof:boolean;idempotency:boolean;status:number;upload:boolean;download:boolean;page:boolean;invocationMode:string}>>;
export const CASE_POLICY:readonly CasePolicy[];
export const caseSchemas:Record<string,any>;
export const CASE_LIMITS:Readonly<{record:number;family:number;commandCases:number}>;
export function canonicalCaseSubject(value:unknown):string;
export function references(value?:unknown):never[];
export function validatePreparations(value:any,ctx?:any):Finding[];
export function validateCaseFamily(value:any,ctx?:any):Finding[];

/** Native-only non-receipt validation; does not establish final assembly timing. */
export function validateNativeCaseCore(value:any,ctx?:any):Finding[];
