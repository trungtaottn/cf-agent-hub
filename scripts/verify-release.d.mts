export interface Finding {code:string;path:string;message:string;}
export interface VerificationResult {passed:boolean;findings:Finding[];}
export function verifyRelease(input:unknown,files:ReadonlyMap<string,string|Uint8Array>):VerificationResult;
export function sha256(value:string|Uint8Array):string;
export function canonical(value:unknown):string;
export function fileManifest(files:ReadonlyMap<string,string|Uint8Array>):Array<{path:string;sha256:string;byte_size:number;mode:string}>;

export function runCli(argv?:string[],root?:string):number;
