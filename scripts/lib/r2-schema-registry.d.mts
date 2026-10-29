export function assertSharedSchemaDialect(schema:unknown):void;
export const validR2Root:(value:unknown)=>boolean;
export const validR2Command:(value:unknown)=>boolean;
export const receiptPolicies:Readonly<Record<string,{validate:(value:unknown)=>boolean;bound:number;kinds:string[]}>>;
export const validR2RootV3:(value:unknown)=>boolean;
export const validVersionedR2Root:(value:unknown)=>boolean;
export const validR2PreparationsV2:(value:unknown)=>boolean;
export const receiptPoliciesV3:typeof receiptPolicies;
