import {closed,isSlug,canonicalBytes} from '../../../src/recovery/encoding.ts';
import type {Identity,Capability} from './types';
export interface Policy {environment_id:string;identities:{workspace_id:string;object_name:string}[];writers:Record<Capability,{workspace_id:string;object_name:string}[]>;}
export function reject():never {throw Error('ANCHOR_DENIED');}
export function identity(value:unknown):asserts value is Identity {
 if(!closed(value,['workspace_id','environment_id','object_name'])||![value.workspace_id,value.environment_id,value.object_name].every(isSlug))reject();
}
const key=(x:{workspace_id:string;object_name:string})=>JSON.stringify([x.workspace_id,x.object_name]);
export function parsePolicy(value:unknown):Policy {
 if(typeof value!=='string'||new TextEncoder().encode(value).length>65536)reject();
 let p:any;try{p=JSON.parse(value);}catch{reject();}
 if(!closed(p,['environment_id','identities','writers'])||!isSlug(p.environment_id)||!closed(p.writers,['rotation','bootstrap']))reject();
 const list=(v:unknown):{workspace_id:string;object_name:string}[]=>{
  if(!Array.isArray(v)||v.length>128)reject();const seen=new Set<string>();
  for(const x of v){if(!closed(x,['workspace_id','object_name'])||!isSlug(x.workspace_id)||!isSlug(x.object_name))reject();const k=key(x as any);if(seen.has(k))reject();seen.add(k);}return v as any;
 };
 const identities=list(p.identities),rotation=list(p.writers.rotation),bootstrap=list(p.writers.bootstrap),allowed=new Set(identities.map(key));
 if([...rotation,...bootstrap].some(x=>!allowed.has(key(x))))reject();
 return {environment_id:p.environment_id,identities,writers:{rotation,bootstrap}};
}
export function authorize(policy:Policy,value:unknown,role:'read'|Capability):asserts value is Identity {
 identity(value);if(value.environment_id!==policy.environment_id||!policy.identities.some(x=>key(x)===key(value)))reject();
 if(role!=='read'&&!policy.writers[role]?.some(x=>key(x)===key(value)))reject();
}
export const canonical=(value:unknown)=>new TextDecoder().decode(canonicalBytes(value));
