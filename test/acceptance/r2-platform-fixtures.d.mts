/** Synthetic test builders, not production evidence producers. */
export function hash(label:string):string;
export function makePlatformEvidence(options?:{limit_kind?:'aggregate-chain'|'depth'}):{value:any;resolution:any;plan:any;workloads:any[];ctx:any};
export function changeWorkloadDimensions(f:any,index:number,changes:Record<string,number>):void;
