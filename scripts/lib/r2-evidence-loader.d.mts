export interface ArtifactRef {path:string;sha256:string;byte_size:number;}
export const R2_LIMITS:Readonly<Record<'root'|'sourceFile'|'sourceTotal'|'componentFile'|'componentTotal'|'evidenceFile'|'evidenceTotal'|'command'|'referenceCount'|'sourceCount',number>>;
export function safeR2Path(path:unknown):boolean;
export function readR2Root(root:string,path:string):unknown;
export function createR2Reader(options:{files?:ReadonlyMap<string,string|Uint8Array>;root?:string;releaseId:string}): {reserveAll(batch:readonly {ref:ArtifactRef;category:'source'|'component'|'evidence';type:string;bound?:number}[]):void;readonly usage:{source:number;component:number;evidence:number;sourceCount:number;referenceCount:number};bytes(ref:ArtifactRef,category:'source'|'component'|'evidence',type:string,bound?:number):Uint8Array;json(ref:ArtifactRef,category:'source'|'component'|'evidence',type:string,bound?:number):any};
