export const R2_FEATURES:readonly string[];
export const R2_ROLES:readonly string[];
export const R2_KINDS:readonly string[];
export const R2_LIVE_KINDS:readonly string[];
export const R2_COMPOSITION:Readonly<{operator_source_closure:string[];application_sql:{source:string;name:string;sha256:string}[]}>;
export const R2_CONFIG_PATHS:Readonly<Record<string,string>>;
export function componentNames(role:string):string[];
